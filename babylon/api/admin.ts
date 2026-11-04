// BarrioMU: panel de administracion (web/admin.html). Solo para cuentas GM
// (AccountState GameMaster o GameMasterInvisible de OpenMU).
//
// - Estadisticas del juego desde la base: jugadores conectados, cuentas y
//   personajes nuevos por dia, top de resets.
// - Visitas por pais y cache, desde la API de Cloudflare (ultimas 24 horas).
// - Descargas del instalador de PC, desde GitHub.
// - Boton para borrar la cache de Cloudflare del juego.
//
// El token de Cloudflare vive solo en la tablet, en CF_TOKEN_FILE (lo guarda
// `bash ~/barriomu.sh cloudflare`). La pagina nunca lo ve: le pide a esta API
// que haga las consultas. Permisos del token: Zone > Zone > Read,
// Zone > Analytics > Read y Zone > Cache Purge > Purge, solo para makeseo.app.

import type { Sql } from "postgres";
import bcrypt from "bcryptjs";
import { existsSync, readFileSync } from "node:fs";
import {
  MAX_FAILS_PER_ACCOUNT,
  MAX_FAILS_PER_IP,
  PASSWORD_RE,
  PanelError,
  USERNAME_RE,
  addFail,
  body,
  clientIp,
  json,
  recentFails,
} from "./panel";
import { readMasterResets } from "./masterReset";
import { adminMarket, adminSaveEconomy } from "./mercado";
import { adminAddItem, adminDeleteItem, adminGivePoints, adminSaveItems, adminSaveMonsters, adminShop } from "./tienda";

const LEVEL = "560931ad-0901-4342-b7f4-fd2e2fcc0563";
const RESETS = "89a891a7-f9f9-4ab5-af36-12056e53a5f7";

/** AccountState de OpenMU: GameMaster y GameMasterInvisible. */
const GM_STATES = new Set([2, 3]);

const CF_TOKEN_FILE = process.env.CF_TOKEN_FILE ?? `${process.env.HOME ?? "/root"}/.barriomu-cloudflare`;
const CF_ZONE_NAME = process.env.CF_ZONE_NAME ?? "makeseo.app";
const CF_API = process.env.CF_API_URL ?? "https://api.cloudflare.com/client/v4";
/** Los hostnames del juego, cuya cache se borra con el boton. */
const GAME_HOSTS = ["mu.makeseo.app", "mu-registro.makeseo.app"];
const LANDING_HOST = "barriomu.makeseo.app";
const GITHUB_RELEASE = "https://api.github.com/repos/bboymak3/openmu-fly-server/releases/tags/barriomu-pc";

// El dia de las estadisticas cambia a medianoche en UTC-4, como el premio diario.

const SESSION_MS = 2 * 60 * 60 * 1000;
const sessions = new Map<string, { accountId: string; login: string; expires: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token);
}, 5 * 60 * 1000).unref();

type Status = () => Promise<{
  online: boolean;
  players: number | null;
  servers: { name: string; players: number | null }[];
}>;

/** Respuestas de servicios de afuera guardadas un rato (Cloudflare y GitHub tienen limites). */
const cache = new Map<string, { at: number; value: unknown }>();
async function remembered<T>(key: string, seconds: number, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < seconds * 1000) return hit.value as T;
  const value = await make();
  cache.set(key, { at: Date.now(), value });
  return value;
}

function session(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) {
    sessions.delete(token);
    throw new PanelError(401, "Tu sesion de admin vencio. Vuelve a entrar.");
  }
  s.expires = Date.now() + SESSION_MS;
  return { token, ...s };
}

async function login(req: Request, sql: Sql) {
  const b = await body(req);
  const username = typeof b.username === "string" ? b.username.trim() : "";
  const password = typeof b.password === "string" ? b.password : "";
  const ip = clientIp(req);
  const accountKey = "acc:" + username.toLowerCase();

  if (recentFails("ip:" + ip) >= MAX_FAILS_PER_IP || recentFails(accountKey) >= MAX_FAILS_PER_ACCOUNT) {
    throw new PanelError(429, "Demasiados intentos. Espera 15 minutos.");
  }
  if (!USERNAME_RE.test(username) || !PASSWORD_RE.test(password)) {
    addFail("ip:" + ip);
    throw new PanelError(401, "Usuario o contrasena incorrectos.");
  }
  const [account] = await sql`
    select "Id"::text as id, "LoginName" as login, "PasswordHash" as hash, "State" as state
    from data."Account" where lower("LoginName") = lower(${username}) limit 1`;
  const ok = account ? await bcrypt.compare(password, account.hash) : false;
  if (!ok) {
    addFail("ip:" + ip);
    addFail(accountKey);
    throw new PanelError(401, "Usuario o contrasena incorrectos.");
  }
  if (!GM_STATES.has(account.state)) {
    addFail("ip:" + ip);
    throw new PanelError(403, "Esta cuenta no es GM. Hazla GM en la tablet con: bash ~/barriomu.sh gm " + account.login);
  }
  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  sessions.set(token, { accountId: account.id, login: account.login, expires: Date.now() + SESSION_MS });
  return { token, account: account.login };
}

// ---------------------------------------------------------------- juego

async function gameStats(sql: Sql, status: Status) {
  // Las fechas son "timestamp with time zone": se pasan a UTC y se restan 4 horas.
  const [totals] = await sql`
    select
      (select count(*) from data."Account" where not "IsTemplate")::int as accounts,
      (select count(*) from data."Account" where not "IsTemplate"
         and ("RegistrationDate" at time zone 'UTC' - interval '4 hours')::date
           = (now() at time zone 'UTC' - interval '4 hours')::date)::int as "accountsToday",
      (select count(*) from data."Account" where not "IsTemplate"
         and "RegistrationDate" >= now() - interval '7 days')::int as "accounts7d",
      (select count(*) from data."Character")::int as characters,
      (select count(*) from data."Character"
         where ("CreateDate" at time zone 'UTC' - interval '4 hours')::date
           = (now() at time zone 'UTC' - interval '4 hours')::date)::int as "charactersToday",
      (select count(*) from data."Account" where "State" in (4, 5))::int as banned`;

  const days = await sql`
    with dias as (
      select generate_series(
        (now() at time zone 'UTC' - interval '4 hours')::date - 13,
        (now() at time zone 'UTC' - interval '4 hours')::date,
        interval '1 day')::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*) from data."Account" a where not a."IsTemplate"
         and (a."RegistrationDate" at time zone 'UTC' - interval '4 hours')::date = d.day)::int as accounts,
      (select count(*) from data."Character" c
         where (c."CreateDate" at time zone 'UTC' - interval '4 hours')::date = d.day)::int as characters
    from dias d order by d.day`;

  const masterResets = [...readMasterResets()];
  const top = await sql`
    select c."Name" as name, coalesce(rs."Value", 0)::int as resets, coalesce(lv."Value", 0)::int as level,
           coalesce(mr.n, 0)::int as "masterResets"
    from data."Character" c
    join data."Account" a on a."Id" = c."AccountId"
    left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
    left join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = ${RESETS}
    left join unnest(${masterResets.map(([id]) => id)}::uuid[], ${masterResets.map(([, n]) => n)}::int[]) as mr(id, n)
      on mr.id = c."Id"
    where a."State" not in (2, 3, 4, 5)
    order by "masterResets" desc, resets desc, level desc
    limit 5`;

  let live: Awaited<ReturnType<Status>> | null = null;
  try {
    live = await status();
  } catch {
    live = null;
  }
  return { ...totals, days, top, online: live?.online ?? false, players: live?.players ?? null, servers: live?.servers ?? [] };
}

// ---------------------------------------------------------------- Cloudflare

function cfToken(): string | null {
  try {
    if (!existsSync(CF_TOKEN_FILE)) return null;
    const token = readFileSync(CF_TOKEN_FILE, "utf8").trim();
    return /^[A-Za-z0-9_-]{20,}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

async function cf<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(CF_API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    errors?: { code?: number; message?: string }[];
    result?: unknown;
    data?: unknown;
  };
  const errors = data.errors ?? [];
  if (!res.ok || data.success === false || (errors.length && !data.data)) {
    const message = errors.map(e => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ") || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

async function zoneId(token: string): Promise<string> {
  if (process.env.CF_ZONE_ID) return process.env.CF_ZONE_ID;
  return remembered("cf-zone", 24 * 3600, async () => {
    const data = await cf<{ result: { id: string }[] }>(token, `/zones?name=${encodeURIComponent(CF_ZONE_NAME)}`);
    const id = data.result?.[0]?.id;
    if (!id) throw new Error(`No se encontro la zona ${CF_ZONE_NAME} con este token.`);
    return id;
  });
}

type Group = { count: number; sum?: { edgeResponseBytes: number }; dimensions: Record<string, string> };

const ANALYTICS_QUERY = `
query ($zone: String!, $since: Time!, $until: Time!, $landing: String!, $game: String!) {
  viewer {
    zones(filter: { zoneTag: $zone }) {
      landing: httpRequestsAdaptiveGroups(
        limit: 30, orderBy: [count_DESC],
        filter: { datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost: $landing,
                  clientRequestPath_in: ["/", "/index.html"], requestSource: "eyeball" }
      ) { count dimensions { clientCountryName } }
      game: httpRequestsAdaptiveGroups(
        limit: 30, orderBy: [count_DESC],
        filter: { datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost: $game,
                  clientRequestPath_in: ["/", "/index.html"], requestSource: "eyeball" }
      ) { count dimensions { clientCountryName } }
      cache: httpRequestsAdaptiveGroups(
        limit: 20,
        filter: { datetime_geq: $since, datetime_lt: $until, clientRequestHTTPHost: $game, requestSource: "eyeball" }
      ) { count sum { edgeResponseBytes } dimensions { cacheStatus } }
    }
  }
}`;

function byCountry(groups: Group[]) {
  const out = groups
    .map(g => ({ country: g.dimensions.clientCountryName || "??", count: g.count }))
    .filter(g => g.count > 0);
  return { total: out.reduce((s, g) => s + g.count, 0), countries: out };
}

async function cloudflareStats() {
  const token = cfToken();
  if (!token) return { configured: false };
  try {
    return await remembered("cf-stats", 300, async () => {
      const zone = await zoneId(token);
      const until = new Date();
      const since = new Date(until.getTime() - 24 * 3600 * 1000);
      const data = await cf<{ data: { viewer: { zones: { landing: Group[]; game: Group[]; cache: Group[] }[] } } }>(
        token,
        "/graphql",
        {
          method: "POST",
          body: JSON.stringify({
            query: ANALYTICS_QUERY,
            variables: { zone, since: since.toISOString(), until: until.toISOString(), landing: LANDING_HOST, game: GAME_HOSTS[0] },
          }),
        },
      );
      const z = data.data?.viewer?.zones?.[0];
      if (!z) throw new Error("Cloudflare no devolvio datos de la zona.");
      // Lo que Cloudflare entrego sin pedirselo a la tablet: HIT, y las variantes de lo ya guardado.
      const fromCache = new Set(["hit", "stale", "updating", "revalidated"]);
      let cached = 0;
      let total = 0;
      let bytesCached = 0;
      let bytes = 0;
      for (const g of z.cache) {
        const b = g.sum?.edgeResponseBytes ?? 0;
        total += g.count;
        bytes += b;
        if (fromCache.has((g.dimensions.cacheStatus ?? "").toLowerCase())) {
          cached += g.count;
          bytesCached += b;
        }
      }
      return {
        configured: true,
        since: since.toISOString(),
        landing: byCountry(z.landing),
        game: byCountry(z.game),
        cache: { requests: total, cached, bytes, bytesCached },
      };
    });
  } catch (error) {
    return { configured: true, error: (error as Error).message };
  }
}

async function purge(req: Request) {
  session(req);
  const b = await body(req);
  const token = cfToken();
  if (!token) throw new PanelError(400, "Falta el token de Cloudflare en la tablet: bash ~/barriomu.sh cloudflare");
  const everything = b.everything === true;
  try {
    const zone = await zoneId(token);
    await cf(token, `/zones/${zone}/purge_cache`, {
      method: "POST",
      body: JSON.stringify(everything ? { purge_everything: true } : { hosts: GAME_HOSTS }),
    });
    cache.delete("cf-stats");
    return {
      ok: true,
      message: everything
        ? "Listo: se borro la cache de todo makeseo.app. Cloudflare la vuelve a llenar sola."
        : "Listo: se borro la cache del juego (mu.makeseo.app y mu-registro). Los celulares bajan la version nueva.",
    };
  } catch (error) {
    const message = (error as Error).message;
    if (!everything) {
      return {
        ok: false,
        canPurgeEverything: true,
        message: `Cloudflare no dejo borrar solo el juego (${message}). Puedes borrar la cache de todo makeseo.app: no rompe nada.`,
      };
    }
    throw new PanelError(502, `Cloudflare no dejo borrar la cache: ${message}`);
  }
}

// ---------------------------------------------------------------- GitHub

async function pcDownloads() {
  try {
    return await remembered("gh-downloads", 600, async () => {
      const res = await fetch(GITHUB_RELEASE, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "BarrioMU-API" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`GitHub ${res.status}`);
      const release = (await res.json()) as { assets?: { name: string; download_count: number }[] };
      const installers = (release.assets ?? []).filter(a => /^BarrioMU-Setup.*\.exe$/.test(a.name));
      return { total: installers.reduce((s, a) => s + a.download_count, 0) };
    });
  } catch {
    return { total: null };
  }
}

// ---------------------------------------------------------------- rutas

async function stats(req: Request, sql: Sql, status: Status) {
  const s = session(req);
  const [game, cloudflare, downloads] = await Promise.all([gameStats(sql, status), cloudflareStats(), pcDownloads()]);
  return { account: s.login, game, cloudflare, downloads, updated: new Date().toISOString() };
}

/** Rutas /admin/*; null si la ruta no es del panel admin. */
export async function handleAdmin(
  req: Request,
  url: URL,
  cors: Record<string, string>,
  sql: Sql,
  status: Status,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/admin/")) return null;
  const routes: Record<string, [string, () => Promise<unknown>]> = {
    "/admin/login": ["POST", () => login(req, sql)],
    "/admin/stats": ["GET", () => stats(req, sql, status)],
    "/admin/purge": ["POST", () => purge(req)],
    "/admin/tienda": ["GET", () => (session(req), adminShop(sql))],
    "/admin/tienda/guardar": ["POST", () => (session(req), adminSaveItems(req, sql))],
    "/admin/tienda/agregar": ["POST", () => (session(req), adminAddItem(req, sql))],
    "/admin/tienda/quitar": ["POST", () => (session(req), adminDeleteItem(req, sql))],
    "/admin/puntos/monstruos": ["POST", () => (session(req), adminSaveMonsters(req))],
    "/admin/puntos/dar": ["POST", () => adminGivePoints(req, sql, session(req).accountId)],
    "/admin/economia": ["GET", () => (session(req), adminMarket(sql))],
    "/admin/economia/guardar": ["POST", () => (session(req), adminSaveEconomy(req, sql))],
    "/admin/logout": [
      "POST",
      async () => {
        sessions.delete(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
        return { ok: true };
      },
    ],
  };
  const route = routes[url.pathname];
  if (!route) return json({ error: "No encontrado." }, 404, cors);
  if (req.method !== route[0]) return json({ error: "Metodo no permitido." }, 405, cors);
  try {
    return json(await route[1](), 200, cors);
  } catch (error) {
    if (error instanceof PanelError) return json({ error: error.message }, error.status, cors);
    console.error(url.pathname, error);
    return json({ error: "Algo salio mal. Intenta en un rato." }, 500, cors);
  }
}
