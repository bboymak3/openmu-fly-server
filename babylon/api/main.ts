// BarrioMU API: estado del servidor, rankings y horarios de eventos para la
// landing https://barriomu.makeseo.app, y el panel de usuario (panel.ts).
//
// Corre en la tablet con el Bun del proxy (usa su paquete `postgres`) y se
// publica por el tunel en https://mu-api.makeseo.app. Las rutas publicas solo
// devuelven nombres de personajes, clase, nivel, resets y PvP.
//
// Variables:
//   PORT          puerto (por defecto 3400, solo dentro de la tablet)
//   DATABASE_URL  base de OpenMU (por defecto la de la tablet)
//   CORS_ORIGIN   origenes permitidos, separados por coma

import postgres from "postgres";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { handlePanel } from "./panel";

const PORT = Number(process.env.PORT || 3400);
const DATABASE_URL = process.env.DATABASE_URL || "postgres://postgres:admin@127.0.0.1:5432/openmu";
const ORIGINS = new Set(
  (process.env.CORS_ORIGIN ?? "https://barriomu.makeseo.app")
    .split(",")
    .map(o => o.trim())
    .filter(Boolean),
);

const sql = postgres(DATABASE_URL, { max: 2, idle_timeout: 30 });

// Atributos de OpenMU (MUnique.OpenMU.GameLogic.Attributes.Stats).
const LEVEL = "560931ad-0901-4342-b7f4-fd2e2fcc0563";
const MASTER_LEVEL = "70cd8c10-391a-4c51-9aa4-a854600e3a9f";
const RESETS = "89a891a7-f9f9-4ab5-af36-12056e53a5f7";

// Cuentas que no entran al ranking: GameMaster, GameMasterInvisible, Banned, TemporarilyBanned.
const HIDDEN_ACCOUNT_STATES = [2, 3, 4, 5];

// Game servers de BarrioMU y sus puertos (uno por cada tipo de cliente).
const GAME_SERVERS = [
  { id: 0, name: "MIJAGUA", pvp: true, drop: "Normal", ports: [45901, 45902] },
  { id: 1, name: "ALTOBARINAS", pvp: false, drop: "Doble", ports: [45903, 45904] },
];

// Eventos (plugins de OpenMU) y su horario por defecto si nadie lo cambio.
const EVENTS = [
  { key: "blood-castle", name: "Blood Castle", plugin: "95e68c14-ad87-4b3c-af46-45b8f1c3bc2a", every: 4, from: 1 },
  { key: "devil-square", name: "Devil Square", plugin: "61c61a58-211e-4d6a-9ea1-d25e0c4a47c5", every: 4, from: 0 },
  { key: "chaos-castle", name: "Chaos Castle", plugin: "3ad96a70-ed24-4979-80b8-169e461e548f", every: 4, from: 2 },
];

/** Respuestas guardadas un rato, para no consultar la base en cada visita. */
const cache = new Map<string, { at: number; body: string }>();

async function cached(key: string, seconds: number, make: () => Promise<unknown>): Promise<string> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < seconds * 1000) return hit.body;
  const body = JSON.stringify(await make());
  cache.set(key, { at: Date.now(), body });
  return body;
}

function portOpen(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(1500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Jugadores conectados a cada puerto de game server: las conexiones TCP
 * establecidas en /proc/net/tcp(6). Si Android no deja leerlo, null.
 */
function establishedByPort(): Map<number, number> | null {
  const counts = new Map<number, number>();
  let readAny = false;
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
      readAny = true;
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4 || cols[3] !== "01") continue; // 01 = ESTABLISHED
      const port = parseInt(cols[1].split(":").pop() ?? "", 16);
      counts.set(port, (counts.get(port) ?? 0) + 1);
    }
  }
  return readAny ? counts : null;
}

async function status() {
  const online = await portOpen(44405);
  const counts = online ? establishedByPort() : null;
  const servers = GAME_SERVERS.map(s => ({
    id: s.id,
    name: s.name,
    pvp: s.pvp,
    drop: s.drop,
    players: counts ? s.ports.reduce((sum, p) => sum + (counts.get(p) ?? 0), 0) : null,
  }));
  const players = counts ? servers.reduce((sum, s) => sum + (s.players ?? 0), 0) : null;
  return { online, players, servers, updated: new Date().toISOString() };
}

async function rankingLevel(limit: number) {
  const rows = await sql`
    select c."Name" as name, cc."Number" as class,
           coalesce(lv."Value", 0)::int as level,
           coalesce(ml."Value", 0)::int as "masterLevel",
           coalesce(rs."Value", 0)::int as resets,
           c."PlayerKillCount" as kills
    from data."Character" c
    join data."Account" a on a."Id" = c."AccountId"
    join config."CharacterClass" cc on cc."Id" = c."CharacterClassId"
    left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
    left join data."StatAttribute" ml on ml."CharacterId" = c."Id" and ml."DefinitionId" = ${MASTER_LEVEL}
    left join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = ${RESETS}
    where a."State" <> all(${HIDDEN_ACCOUNT_STATES}::int[])
    order by resets desc, level desc, "masterLevel" desc, c."Experience" desc, c."Name"
    limit ${limit}`;
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

async function rankingPvp(limit: number) {
  const rows = await sql`
    select c."Name" as name, cc."Number" as class, c."PlayerKillCount" as kills,
           c."State" as "heroState", coalesce(lv."Value", 0)::int as level
    from data."Character" c
    join data."Account" a on a."Id" = c."AccountId"
    join config."CharacterClass" cc on cc."Id" = c."CharacterClassId"
    left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
    where a."State" <> all(${HIDDEN_ACCOUNT_STATES}::int[]) and c."PlayerKillCount" > 0
    order by c."PlayerKillCount" desc, level desc, c."Name"
    limit ${limit}`;
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}

/** "HH:mm:ss" -> minutos del dia. */
function minutesOf(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Los proximos inicios, en UTC, de un horario diario en la zona horaria del servidor. */
function nextStarts(minutes: number[], timeZoneOffsetMinutes: number, count: number): string[] {
  const now = Date.now();
  const out: number[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  const serverNow = new Date(now + timeZoneOffsetMinutes * 60000);
  const serverMidnightUtc =
    Date.UTC(serverNow.getUTCFullYear(), serverNow.getUTCMonth(), serverNow.getUTCDate()) -
    timeZoneOffsetMinutes * 60000;
  for (let day = 0; day < 2 && out.length < count; day++) {
    for (const m of [...minutes].sort((a, b) => a - b)) {
      const at = serverMidnightUtc + day * dayMs + m * 60000;
      if (at > now) out.push(at);
    }
  }
  return out.slice(0, count).map(t => new Date(t).toISOString());
}

/** Desfase de la zona horaria del servidor (SystemConfiguration de OpenMU); UTC si no hay. */
async function serverOffsetMinutes(): Promise<number> {
  try {
    const [row] = await sql`select "TimeZoneId" as tz from config."SystemConfiguration" limit 1`;
    if (!row?.tz) return 0;
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: row.tz, timeZoneName: "longOffset" })
      .formatToParts(new Date())
      .find(p => p.type === "timeZoneName")?.value;
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(parts ?? "");
    return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  } catch {
    return 0;
  }
}

async function events() {
  const offset = await serverOffsetMinutes();
  const configs = await sql`
    select "TypeId"::text as type, "IsActive" as active, "CustomConfiguration" as config
    from config."PlugInConfiguration"
    where "TypeId" in ${sql(EVENTS.map(e => e.plugin))}`.catch(() => []);
  return EVENTS.map(e => {
    const row = configs.find(c => c.type.toLowerCase() === e.plugin);
    let minutes: number[] = [];
    try {
      const parsed = row?.config ? JSON.parse(row.config) : null;
      minutes = (parsed?.Timetable ?? []).map(minutesOf).filter((m: number | null) => m !== null);
    } catch {
      minutes = [];
    }
    if (!minutes.length) {
      for (let h = e.from; h < 24; h += e.every) minutes.push(h * 60);
    }
    return { key: e.key, name: e.name, active: row ? row.active : true, next: nextStarts(minutes, offset, 3) };
  });
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function limitOf(url: URL): number {
  const n = Number(url.searchParams.get("limit") ?? 50);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 100) : 50;
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const panel = await handlePanel(req, url, cors, sql);
    if (panel) return panel;
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });

    const reply = (body: string, seconds: number) =>
      new Response(body, {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${seconds}`, ...cors },
      });

    try {
      switch (url.pathname) {
        case "/status":
          return reply(await cached("status", 20, status), 20);
        case "/rankings/level": {
          const limit = limitOf(url);
          return reply(await cached(`level:${limit}`, 60, () => rankingLevel(limit)), 60);
        }
        case "/rankings/pvp": {
          const limit = limitOf(url);
          return reply(await cached(`pvp:${limit}`, 60, () => rankingPvp(limit)), 60);
        }
        case "/events":
          return reply(await cached("events", 60, events), 60);
        default:
          return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: cors });
      }
    } catch (error) {
      console.error(url.pathname, error);
      return new Response(JSON.stringify({ error: "Servidor no disponible" }), { status: 503, headers: cors });
    }
  },
});

console.log(`BarrioMU API en http://127.0.0.1:${PORT} (CORS: ${[...ORIGINS].join(", ")})`);
