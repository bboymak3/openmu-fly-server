// BarrioMU: panel de usuario. Login con la cuenta del juego y acciones sobre
// los personajes (Add Points, PK Clear, Unstuck) y la cuenta (cambio de clave).
//
// Todo cambio se hace solo con la cuenta desconectada: OpenMU guarda en memoria
// lo que un jugador conectado tiene, y al salir pisaria lo escrito aqui. Quien
// esta conectado lo sabe el proxy (todos los jugadores entran por el), que lo
// responde en http://127.0.0.1:3001/presence/<cuenta>.

import type { Sql } from "postgres";
import bcrypt from "bcryptjs";
import { BONUS_POINTS, REQUIRED_RESETS, masterResetsOf, readMasterResets, setMasterResets } from "./masterReset";

// Atributos de OpenMU (MUnique.OpenMU.GameLogic.Attributes.Stats).
const LEVEL = "560931ad-0901-4342-b7f4-fd2e2fcc0563";
const MASTER_LEVEL = "70cd8c10-391a-4c51-9aa4-a854600e3a9f";
const RESETS = "89a891a7-f9f9-4ab5-af36-12056e53a5f7";
const STATS = {
  str: "123282fe-fead-448e-ad2c-baece939b4b1",
  agi: "1ae9c014-e3cd-4703-bd05-1b65f5f94ceb",
  vit: "6ca5c3a6-b109-45a5-87a7-fdcb107b4982",
  ene: "01b0ef28-f7a0-46b5-97ba-2b624a54cd75",
  cmd: "6af2c9df-3ae4-4721-8462-9a8ec7f56fe4",
} as const;
type StatKey = keyof typeof STATS;

/** El tope de cada estadistica en Season 6. */
const MAX_STAT = 32767;

/** HeroState de OpenMU: 3 = Normal, mas alto = PK. */
const HERO_NORMAL = 3;

/** AccountState de OpenMU: Banned y TemporarilyBanned no entran. */
const BANNED_STATES = new Set([4, 5]);

// Igual que el registro (register/server/accounts.ts) y OpenMU.
const PASSWORD_RE = /^[!-~]{4,10}$/;
const USERNAME_RE = /^[A-Za-z0-9]{4,10}$/;
const BCRYPT_COST = 11;

const PRESENCE_URL = process.env.PRESENCE_URL ?? "http://127.0.0.1:3001";
/** Tiempo que OpenMU necesita para guardar despues de que el jugador sale. */
const OFFLINE_COOLDOWN_MS = Number(process.env.OFFLINE_COOLDOWN_MS ?? 60_000);

/** ResetFeaturePlugIn de OpenMU: su configuracion la escribe `barriomu.sh resets`. */
const RESET_PLUGIN = "6a9d585d-79d7-4674-b6ea-7e87392fa501";

type ResetConfig = {
  RequiredLevel: number;
  ResetLimit: number | null;
  LevelAfterReset: number;
  RequiredMoney: number;
  MultiplyRequiredMoneyByResetCount: boolean;
  ResetStats: boolean;
  PointsPerReset: number;
  MultiplyPointsByResetCount: boolean;
  ReplacePointsPerReset: boolean;
  MoveHome: boolean;
  /** Si hay items o escalas, el reset solo se hace en el juego (/reset). */
  simple: boolean;
};

const RESET_DEFAULTS = {
  RequiredLevel: 400, ResetLimit: null, LevelAfterReset: 10, RequiredMoney: 1,
  MultiplyRequiredMoneyByResetCount: true, ResetStats: true, PointsPerReset: 1500,
  MultiplyPointsByResetCount: true, ReplacePointsPerReset: true, MoveHome: true,
};

/** La lista de una coleccion del JSON de OpenMU (con o sin "$values"). */
const listOf = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : Array.isArray((v as { $values?: unknown[] })?.$values) ? (v as { $values: unknown[] }).$values : [];

/** La configuracion del reset si esta activo; null si no. */
async function resetConfig(sql: Sql): Promise<ResetConfig | null> {
  const [row] = await sql`
    select "IsActive" as active, "CustomConfiguration" as config
    from config."PlugInConfiguration" where "TypeId" = ${RESET_PLUGIN} limit 1`;
  if (!row?.active) return null;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = row.config ? JSON.parse(row.config) : {};
  } catch {
    return null;
  }
  return {
    ...RESET_DEFAULTS,
    ...parsed,
    simple: !parsed.RequiredResetItem && listOf(parsed.PointsTiers).length === 0 && listOf(parsed.ItemCostTiers).length === 0,
  } as ResetConfig;
}

/**
 * Lo que cuesta y da el proximo reset (ResetProgressionCalculator de OpenMU, sin escalas),
 * con los puntos extra de los Master Reset (master-reset.patch).
 */
function nextReset(cfg: ResetConfig, resets: number, masterResets: number) {
  const next = resets + 1;
  const zen = Math.max(0, cfg.RequiredMoney) * (cfg.MultiplyRequiredMoneyByResetCount ? next : 1);
  const bonus = masterResets * BONUS_POINTS;
  const points = Math.max(0, cfg.PointsPerReset) * (cfg.MultiplyPointsByResetCount ? next : 1) + bonus;
  return { next, zen, points, bonus };
}

const SESSION_MS = 2 * 60 * 60 * 1000;
const sessions = new Map<string, { accountId: string; login: string; expires: number }>();

// Intentos fallidos de login: por IP y por cuenta, en una ventana de 15 minutos.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 10;
const MAX_FAILS_PER_ACCOUNT = 5;
const fails = new Map<string, number[]>();

function recentFails(key: string): number {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter(t => now - t < FAIL_WINDOW_MS);
  if (list.length) fails.set(key, list);
  else fails.delete(key);
  return list.length;
}

function addFail(key: string): void {
  fails.set(key, [...(fails.get(key) ?? []), Date.now()]);
}

setInterval(() => {
  const now = Date.now();
  for (const [token, s] of sessions) if (s.expires < now) sessions.delete(token);
  for (const key of fails.keys()) recentFails(key);
}, 5 * 60 * 1000).unref();

class PanelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors },
  });
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 2048) throw new PanelError(413, "Solicitud demasiado grande.");
  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new PanelError(400, "Solicitud mal formada.");
  }
}

function clientIp(req: Request): string {
  // Solo cloudflared llega a esta API (escucha en 127.0.0.1): este encabezado es de Cloudflare.
  return req.headers.get("cf-connecting-ip") ?? "local";
}

function session(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) {
    sessions.delete(token);
    throw new PanelError(401, "Tu sesion vencio. Vuelve a entrar.");
  }
  s.expires = Date.now() + SESSION_MS;
  return { token, ...s };
}

type Presence = { online: boolean; lastSeenAt: number | null; startedAt: number; now: number; unidentifiedConnections: number };

async function presence(login: string): Promise<Presence> {
  const res = await fetch(`${PRESENCE_URL}/presence/${encodeURIComponent(login)}`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`presence ${res.status}`);
  return (await res.json()) as Presence;
}

/** Solo deja seguir si la cuenta esta desconectada hace al menos un minuto. */
async function requireOffline(login: string): Promise<void> {
  let p: Presence;
  try {
    p = await presence(login);
  } catch {
    throw new PanelError(503, "No se pudo confirmar que estas desconectado. Intenta en un rato.");
  }
  if (p.online) throw new PanelError(409, "Sal del juego para usar el panel.");
  if (p.unidentifiedConnections > 0) {
    throw new PanelError(409, "El servidor esta ocupado ahora mismo. Intenta en unos minutos.");
  }
  const since = Math.max(p.lastSeenAt ?? 0, p.startedAt);
  const wait = OFFLINE_COOLDOWN_MS - (p.now - since);
  if (wait > 0) throw new PanelError(409, `Saliste hace poco del juego. Espera ${Math.ceil(wait / 1000)} segundos.`);
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
  if (BANNED_STATES.has(account.state)) throw new PanelError(403, "Esta cuenta esta bloqueada.");

  const token = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
  sessions.set(token, { accountId: account.id, login: account.login, expires: Date.now() + SESSION_MS });
  return { token, account: account.login };
}

async function me(req: Request, sql: Sql) {
  const s = session(req);
  const rows = await sql`
    select c."Id"::text as id, c."Name" as name, cc."Number" as class,
           c."LevelUpPoints" as points, c."PlayerKillCount" as kills, c."State" as "heroState",
           m."Number" as map, coalesce(inv."Money", 0) as zen,
           coalesce(lv."Value", 0)::int as level,
           coalesce(ml."Value", 0)::int as "masterLevel",
           coalesce(rs."Value", 0)::int as resets,
           coalesce(st."Value", 0)::int as str, coalesce(ag."Value", 0)::int as agi,
           coalesce(vi."Value", 0)::int as vit, coalesce(en."Value", 0)::int as ene,
           cm."Value"::int as cmd
    from data."Character" c
    join config."CharacterClass" cc on cc."Id" = c."CharacterClassId"
    left join config."GameMapDefinition" m on m."Id" = c."CurrentMapId"
    left join data."ItemStorage" inv on inv."Id" = c."InventoryId"
    left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
    left join data."StatAttribute" ml on ml."CharacterId" = c."Id" and ml."DefinitionId" = ${MASTER_LEVEL}
    left join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = ${RESETS}
    left join data."StatAttribute" st on st."CharacterId" = c."Id" and st."DefinitionId" = ${STATS.str}
    left join data."StatAttribute" ag on ag."CharacterId" = c."Id" and ag."DefinitionId" = ${STATS.agi}
    left join data."StatAttribute" vi on vi."CharacterId" = c."Id" and vi."DefinitionId" = ${STATS.vit}
    left join data."StatAttribute" en on en."CharacterId" = c."Id" and en."DefinitionId" = ${STATS.ene}
    left join data."StatAttribute" cm on cm."CharacterId" = c."Id" and cm."DefinitionId" = ${STATS.cmd}
    where c."AccountId" = ${s.accountId}
    order by c."CharacterSlot"`;

  let online: boolean | null = null;
  try {
    online = (await presence(s.login)).online;
  } catch {
    online = null;
  }
  const cfg = await resetConfig(sql);
  const masterResets = readMasterResets();
  return {
    account: s.login,
    online,
    reset: cfg ? { requiredLevel: cfg.RequiredLevel, limit: cfg.ResetLimit, panel: cfg.simple } : null,
    masterReset: { requiredResets: REQUIRED_RESETS, requiredLevel: cfg?.RequiredLevel ?? 400, bonus: BONUS_POINTS },
    characters: rows.map(({ id, ...r }) => {
      const mr = masterResets.get(id.toLowerCase()) ?? 0;
      return {
        ...r,
        masterResets: mr,
        isPk: r.heroState > HERO_NORMAL,
        nextReset: cfg ? nextReset(cfg, r.resets, mr) : null,
      };
    }),
  };
}

/** El personaje, si es de la cuenta de la sesion; bloquea la fila hasta el final de la transaccion. */
async function ownCharacter(tx: Sql, accountId: string, name: unknown) {
  if (typeof name !== "string" || !name) throw new PanelError(400, "Falta el personaje.");
  const [row] = await tx`
    select c."Id"::text as id, c."Name" as name, c."CharacterClassId"::text as "classId",
           c."LevelUpPoints" as points, c."State" as "heroState"
    from data."Character" c
    where c."AccountId" = ${accountId} and c."Name" = ${name}
    for update`;
  if (!row) throw new PanelError(404, "Ese personaje no es de tu cuenta.");
  return row;
}

async function addPoints(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const wanted: Partial<Record<StatKey, number>> = {};
  let total = 0;
  for (const key of Object.keys(STATS) as StatKey[]) {
    const n = b[key] ?? 0;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > MAX_STAT) {
      throw new PanelError(400, "Los puntos deben ser numeros enteros positivos.");
    }
    if (n > 0) wanted[key] = n;
    total += n;
  }
  if (total === 0) throw new PanelError(400, "No pusiste ningun punto.");

  await requireOffline(s.login);
  return sql.begin(async tx => {
    const c = await ownCharacter(tx, s.accountId, b.character);
    if (total > c.points) throw new PanelError(400, `Solo tienes ${c.points} puntos libres.`);

    for (const [key, n] of Object.entries(wanted) as [StatKey, number][]) {
      // Solo las estadisticas que la clase puede subir (Comando solo el Dark Lord).
      const [allowed] = await tx`
        select 1 from config."StatAttributeDefinition"
        where "CharacterClassId" = ${c.classId} and "AttributeId" = ${STATS[key]} and "IncreasableByPlayer"`;
      const [stat] = await tx`
        select "Id"::text as id, "Value" as value from data."StatAttribute"
        where "CharacterId" = ${c.id} and "DefinitionId" = ${STATS[key]} for update`;
      if (!allowed || !stat) throw new PanelError(400, "Tu clase no puede subir esa estadistica.");
      if (stat.value + n > MAX_STAT) throw new PanelError(400, `Una estadistica no puede pasar de ${MAX_STAT}.`);
      await tx`update data."StatAttribute" set "Value" = "Value" + ${n} where "Id" = ${stat.id}`;
    }
    await tx`update data."Character" set "LevelUpPoints" = "LevelUpPoints" - ${total} where "Id" = ${c.id}`;
    return { ok: true, message: `Listo: ${total} puntos repartidos en ${c.name}.` };
  });
}

async function pkClear(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  await requireOffline(s.login);
  return sql.begin(async tx => {
    const c = await ownCharacter(tx, s.accountId, b.character);
    if (c.heroState <= HERO_NORMAL) throw new PanelError(400, `${c.name} no esta en estado PK.`);
    // Solo el estado PK: los asesinatos se quedan para el ranking PvP.
    await tx`update data."Character" set "State" = ${HERO_NORMAL}, "StateRemainingSeconds" = 0 where "Id" = ${c.id}`;
    return { ok: true, message: `Listo: ${c.name} ya no es PK.` };
  });
}

async function unstuck(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  await requireOffline(s.login);
  return sql.begin(async tx => {
    const c = await ownCharacter(tx, s.accountId, b.character);
    // El mapa de inicio de la clase (Lorencia, Noria o Elbeland) y su punto de aparicion.
    const [gate] = await tx`
      select g."MapId"::text as map, g."X1" as x1, g."Y1" as y1, g."X2" as x2, g."Y2" as y2
      from config."CharacterClass" cc
      join config."ExitGate" g on g."MapId" = cc."HomeMapId" and g."IsSpawnGate"
      where cc."Id" = ${c.classId}
      limit 1`;
    if (!gate) throw new PanelError(500, "No se encontro el punto de aparicion.");
    const x = Math.round((gate.x1 + gate.x2) / 2);
    const y = Math.round((gate.y1 + gate.y2) / 2);
    await tx`update data."Character" set "CurrentMapId" = ${gate.map}, "PositionX" = ${x}, "PositionY" = ${y} where "Id" = ${c.id}`;
    return { ok: true, message: `Listo: ${c.name} aparecera en su ciudad de inicio.` };
  });
}

/** El reset de OpenMU (ResetCharacterAction), hecho sobre la base con la cuenta desconectada. */
async function reset(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const cfg = await resetConfig(sql);
  if (!cfg) throw new PanelError(400, "Los resets no estan activos en BarrioMU.");
  if (!cfg.simple) throw new PanelError(400, "Este reset se hace dentro del juego: escribe /reset.");
  await requireOffline(s.login);

  return sql.begin(async tx => {
    const c = await ownCharacter(tx, s.accountId, b.character);
    const [info] = await tx`
      select coalesce(lv."Value", 0)::int as level, coalesce(rs."Value", 0)::int as resets,
             lv."Id"::text as "levelId", rs."Id"::text as "resetsId",
             inv."Id"::text as "inventoryId", coalesce(inv."Money", 0) as money
      from data."Character" ch
      left join data."StatAttribute" lv on lv."CharacterId" = ch."Id" and lv."DefinitionId" = ${LEVEL}
      left join data."StatAttribute" rs on rs."CharacterId" = ch."Id" and rs."DefinitionId" = ${RESETS}
      left join data."ItemStorage" inv on inv."Id" = ch."InventoryId"
      where ch."Id" = ${c.id}
      for update of ch`;
    if (!info?.levelId) throw new PanelError(500, "No se encontro el nivel del personaje.");
    if (info.level < cfg.RequiredLevel) throw new PanelError(400, `${c.name} necesita nivel ${cfg.RequiredLevel} para resetear.`);

    const { next, zen, points } = nextReset(cfg, info.resets, masterResetsOf(c.id));
    if (cfg.ResetLimit && cfg.ResetLimit > 0 && next > cfg.ResetLimit) {
      throw new PanelError(400, `Ya llegaste al maximo de ${cfg.ResetLimit} resets.`);
    }
    if (zen > 0) {
      if (!info.inventoryId || info.money < zen) {
        throw new PanelError(400, `Necesitas ${zen.toLocaleString("es")} de zen en el inventario de ${c.name}.`);
      }
      await tx`update data."ItemStorage" set "Money" = "Money" - ${zen} where "Id" = ${info.inventoryId}`;
    }

    if (info.resetsId) {
      await tx`update data."StatAttribute" set "Value" = ${next} where "Id" = ${info.resetsId}`;
    } else {
      await tx`insert into data."StatAttribute" ("Id", "DefinitionId", "CharacterId", "Value")
               values (gen_random_uuid(), ${RESETS}, ${c.id}, ${next})`;
    }
    await tx`update data."StatAttribute" set "Value" = ${cfg.LevelAfterReset} where "Id" = ${info.levelId}`;

    if (cfg.ResetStats) {
      // Las estadisticas que el jugador sube vuelven al valor inicial de su clase.
      await tx`
        update data."StatAttribute" sa set "Value" = d."BaseValue"
        from config."StatAttributeDefinition" d
        where sa."CharacterId" = ${c.id} and d."CharacterClassId" = ${c.classId}
          and d."AttributeId" = sa."DefinitionId" and d."IncreasableByPlayer"`;
    }
    const newPoints = cfg.ReplacePointsPerReset ? points : c.points + points;
    await tx`update data."Character" set "Experience" = 0, "LevelUpPoints" = ${newPoints} where "Id" = ${c.id}`;

    if (cfg.MoveHome) {
      const [gate] = await tx`
        select g."MapId"::text as map, g."X1" as x1, g."Y1" as y1, g."X2" as x2, g."Y2" as y2
        from config."CharacterClass" cc
        join config."ExitGate" g on g."MapId" = cc."HomeMapId" and g."IsSpawnGate"
        where cc."Id" = ${c.classId} limit 1`;
      if (gate) {
        await tx`update data."Character" set "CurrentMapId" = ${gate.map},
                 "PositionX" = ${Math.round((gate.x1 + gate.x2) / 2)}, "PositionY" = ${Math.round((gate.y1 + gate.y2) / 2)}
                 where "Id" = ${c.id}`;
      }
    }
    return { ok: true, message: `¡Reset ${next} listo! ${c.name} vuelve a nivel ${cfg.LevelAfterReset} con ${newPoints.toLocaleString("es")} puntos.` };
  });
}

/** El Master Reset (BarrioMasterResetPlugIn de OpenMU), hecho sobre la base con la cuenta desconectada. */
async function masterReset(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const cfg = await resetConfig(sql);
  const requiredLevel = cfg?.RequiredLevel ?? 400;
  const levelAfterReset = cfg?.LevelAfterReset ?? 1;
  await requireOffline(s.login);

  return sql.begin(async tx => {
    const c = await ownCharacter(tx, s.accountId, b.character);
    const [info] = await tx`
      select coalesce(lv."Value", 0)::int as level, coalesce(rs."Value", 0)::int as resets,
             lv."Id"::text as "levelId", rs."Id"::text as "resetsId"
      from data."Character" ch
      left join data."StatAttribute" lv on lv."CharacterId" = ch."Id" and lv."DefinitionId" = ${LEVEL}
      left join data."StatAttribute" rs on rs."CharacterId" = ch."Id" and rs."DefinitionId" = ${RESETS}
      where ch."Id" = ${c.id}`;
    if (!info?.levelId) throw new PanelError(500, "No se encontro el nivel del personaje.");
    if (info.resets < REQUIRED_RESETS || info.level < requiredLevel) {
      throw new PanelError(400, `${c.name} necesita ${REQUIRED_RESETS} resets y nivel ${requiredLevel} para el Master Reset.`);
    }

    const next = masterResetsOf(c.id) + 1;
    const points = next * BONUS_POINTS;
    await tx`update data."StatAttribute" set "Value" = 0 where "Id" = ${info.resetsId}`;
    await tx`update data."StatAttribute" set "Value" = ${levelAfterReset} where "Id" = ${info.levelId}`;
    await tx`
      update data."StatAttribute" sa set "Value" = d."BaseValue"
      from config."StatAttributeDefinition" d
      where sa."CharacterId" = ${c.id} and d."CharacterClassId" = ${c.classId}
        and d."AttributeId" = sa."DefinitionId" and d."IncreasableByPlayer"`;
    await tx`update data."Character" set "Experience" = 0, "LevelUpPoints" = ${points} where "Id" = ${c.id}`;
    const [gate] = await tx`
      select g."MapId"::text as map, g."X1" as x1, g."Y1" as y1, g."X2" as x2, g."Y2" as y2
      from config."CharacterClass" cc
      join config."ExitGate" g on g."MapId" = cc."HomeMapId" and g."IsSpawnGate"
      where cc."Id" = ${c.classId} limit 1`;
    if (gate) {
      await tx`update data."Character" set "CurrentMapId" = ${gate.map},
               "PositionX" = ${Math.round((gate.x1 + gate.x2) / 2)}, "PositionY" = ${Math.round((gate.y1 + gate.y2) / 2)}
               where "Id" = ${c.id}`;
    }
    // Al final: si no se puede guardar el archivo, la transaccion se deshace.
    try {
      await setMasterResets(c.id, next);
    } catch (error) {
      console.error("master reset", error);
      throw new PanelError(503, "No se pudo guardar el Master Reset. Intenta en un rato.");
    }
    return {
      ok: true,
      message: `¡Master Reset ${next} listo! ${c.name} vuelve a nivel ${levelAfterReset} con ${points.toLocaleString("es")} puntos, y cada reset le dara ${points.toLocaleString("es")} puntos extra.`,
    };
  });
}

async function changePassword(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const current = typeof b.current === "string" ? b.current : "";
  const next = typeof b.next === "string" ? b.next : "";
  if (!PASSWORD_RE.test(next)) {
    throw new PanelError(400, "La clave nueva debe tener de 4 a 10 caracteres (letras, numeros o simbolos basicos).");
  }
  await requireOffline(s.login);

  const [account] = await sql`select "PasswordHash" as hash from data."Account" where "Id" = ${s.accountId}`;
  if (!account || !(await bcrypt.compare(current, account.hash))) {
    addFail("acc:" + s.login.toLowerCase());
    throw new PanelError(401, "La clave actual no es correcta.");
  }
  let hash = await bcrypt.hash(next, BCRYPT_COST);
  // OpenMU guarda bcrypt "$2a$"; bcryptjs a veces escribe "$2b$" (mismo resultado para claves cortas).
  if (!hash.startsWith("$2a$")) hash = "$2a$" + hash.slice(hash.indexOf("$", 1) + 1);
  await sql`update data."Account" set "PasswordHash" = ${hash} where "Id" = ${s.accountId}`;

  // Cierra las demas sesiones de esta cuenta.
  for (const [token, other] of sessions) if (other.accountId === s.accountId && token !== s.token) sessions.delete(token);
  return { ok: true, message: "Listo: tu clave fue cambiada. Usala la proxima vez que entres al juego." };
}

/** Rutas del panel; null si la ruta no es del panel. */
export async function handlePanel(
  req: Request,
  url: URL,
  cors: Record<string, string>,
  sql: Sql,
): Promise<Response | null> {
  const routes: Record<string, [string, (req: Request, sql: Sql) => Promise<unknown>]> = {
    "/auth/login": ["POST", login],
    "/me": ["GET", me],
    "/me/add-points": ["POST", addPoints],
    "/me/pk-clear": ["POST", pkClear],
    "/me/unstuck": ["POST", unstuck],
    "/me/reset": ["POST", reset],
    "/me/master-reset": ["POST", masterReset],
    "/me/password": ["POST", changePassword],
  };
  if (url.pathname === "/auth/logout" && req.method === "POST") {
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    sessions.delete(token);
    return json({ ok: true }, 200, cors);
  }
  const route = routes[url.pathname];
  if (!route) return null;
  if (req.method !== route[0]) return json({ error: "Metodo no permitido." }, 405, cors);
  try {
    return json(await route[1](req, sql), 200, cors);
  } catch (error) {
    if (error instanceof PanelError) return json({ error: error.message }, error.status, cors);
    console.error(url.pathname, error);
    return json({ error: "Algo salio mal. Intenta en un rato." }, 500, cors);
  }
}
