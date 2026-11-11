// BarrioMU: el Sabio del Barrio por WhatsApp (Fase A: vincular y conversar, sin acciones).
//
// - El bot de la tablet (babylon/whatsapp/bot.mjs) manda aqui cada mensaje con el secreto
//   compartido; esta ruta no responde a nada que llegue por el tunel.
// - Un numero maneja una sola cuenta: el jugador genera un codigo en Mi cuenta y le
//   escribe al bot "vincular 123456". "desvincular" lo suelta.
// - Con el numero vinculado, el Sabio contesta con los datos reales de la cuenta y sus
//   personajes (de la base). Comparte el limite diario del /ia del juego.
// - Fase B: reset y repartir puntos. La IA (o un comando directo: "reset barrio02",
//   "puntos barrio02 fuerza 500") propone; el jugador confirma con "si" en 2 minutos y se
//   hace con las mismas reglas y protecciones de Mi cuenta (cuenta fuera del juego). Nada
//   mas: no da ni cambia otra cosa.

import type { Sql } from "postgres";
import { LEVEL, MASTER_LEVEL, RESETS, PanelError, doAddPoints, doReset, json, presence, session } from "./panel";
import { economy, ensureSettings } from "./economia";
import { doSell, vaultItems } from "./mercado";
import { cancelExtraPending, confirmExtra, extrasCommand, extrasContext, hasExtraPending, waChatFromGame } from "./wa-extras";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  PERSONALITY, SERVER_FACTS, cloudflareKey, ensureSabioTables, giveBack, remember, runModel, sameSecret,
  periodWord, secret, settings, store, takeOne,
} from "./sabio";

const CLASSES: Record<number, string> = {
  0: "Dark Wizard", 2: "Soul Master", 3: "Grand Master", 4: "Dark Knight", 6: "Blade Knight", 7: "Blade Master",
  8: "Fairy Elf", 10: "Muse Elf", 11: "High Elf", 12: "Magic Gladiator", 13: "Duel Master", 16: "Dark Lord",
  17: "Lord Emperor", 20: "Summoner", 22: "Bloody Summoner", 23: "Dimension Master", 24: "Rage Fighter", 25: "Fist Master",
};
const MAPS: Record<number, string> = {
  0: "Lorencia", 1: "Dungeon", 2: "Devias", 3: "Noria", 4: "Lost Tower", 6: "Arena", 7: "Atlans", 8: "Tarkan",
  10: "Icarus", 30: "Valle de Loren", 33: "Aida", 34: "Crywolf", 37: "Kanturu", 38: "Kanturu", 39: "Kanturu",
  51: "Elbeland", 56: "Swamp of Calmness", 57: "Raklion", 58: "Raklion", 63: "Vulcanus", 79: "Loren Market",
  80: "Karutan", 81: "Karutan",
};
const CODE_MS = 15 * 60_000;
/** Codigos equivocados por chat y por hora: frena a quien quiera adivinar codigos ajenos. */
const MAX_BAD_CODES = 5;
const badCodes = new Map<string, number[]>();
const JID_RE = /^\d{5,20}@(s\.whatsapp\.net|lid)$/;

let ready: Promise<void> | null = null;
function ensureTables(sql: Sql): Promise<void> {
  ready ??= (async () => {
    await ensureSettings(sql);
    await sql`
      create table if not exists barrio.wa_link (
        jid text primary key,
        account uuid not null unique,
        linked_at timestamptz not null default now())`;
    await sql`
      create table if not exists barrio.wa_code (
        account uuid primary key,
        code text not null unique,
        expires timestamptz not null)`;
  })().catch(error => {
    ready = null;
    throw error;
  });
  return ready;
}

const HELP = [
  "Épale pana, soy el *Sabio del Barrio* de BarrioMU. 🧙",
  "Para hablar conmigo primero vincula tu cuenta:",
  "1) Entra a barriomu.makeseo.app → *Mi cuenta* → *WhatsApp* → *Generar código*.",
  "2) Escríbeme aquí: *vincular 123456* (con tu código).",
].join("\n");

// ---------------------------------------------------------------- Mi cuenta

async function myLink(req: Request, sql: Sql) {
  const s = session(req);
  await ensureTables(sql);
  const [link] = await sql`select jid, linked_at as "linkedAt" from barrio.wa_link where account = ${s.accountId}`;
  return { linked: !!link, number: link ? maskJid(link.jid) : null, linkedAt: link?.linkedAt ?? null };
}

async function newCode(req: Request, sql: Sql) {
  const s = session(req);
  await ensureTables(sql);
  for (let i = 0; i < 5; i++) {
    const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    try {
      await sql`
        insert into barrio.wa_code (account, code, expires) values (${s.accountId}, ${code}, ${new Date(Date.now() + CODE_MS)})
        on conflict (account) do update set code = excluded.code, expires = excluded.expires`;
      return { code, minutes: CODE_MS / 60_000 };
    } catch {
      // codigo repetido con otra cuenta: otro intento
    }
  }
  throw new PanelError(500, "No se pudo generar el codigo. Intenta de nuevo.");
}

async function unlink(req: Request, sql: Sql) {
  const s = session(req);
  await ensureTables(sql);
  await sql`delete from barrio.wa_link where account = ${s.accountId}`;
  return { ok: true, message: "Listo: tu WhatsApp ya no maneja esta cuenta." };
}

function maskJid(jid: string): string {
  const id = jid.split("@")[0];
  return jid.endsWith("@lid") ? "WhatsApp vinculado" : `+${id.slice(0, 3)}…${id.slice(-3)}`;
}

// ---------------------------------------------------------------- el bot

async function accountContext(sql: Sql, accountId: string, login: string): Promise<string> {
  const [acc] = await sql`
    select "GoblinPoints" as points, "WCoinC" as wcoinc, "WCoinP" as wcoinp from data."Account" where "Id" = ${accountId}`;
  const chars = await sql`
    select c."Name" as name, cc."Number" as class, m."Number" as map, coalesce(inv."Money", 0) as zen,
           c."LevelUpPoints" as points,
           coalesce(lv."Value", 0)::int as level, coalesce(ml."Value", 0)::int as "masterLevel",
           coalesce(rs."Value", 0)::int as resets
    from data."Character" c
    join config."CharacterClass" cc on cc."Id" = c."CharacterClassId"
    left join config."GameMapDefinition" m on m."Id" = c."CurrentMapId"
    left join data."ItemStorage" inv on inv."Id" = c."InventoryId"
    left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
    left join data."StatAttribute" ml on ml."CharacterId" = c."Id" and ml."DefinitionId" = ${MASTER_LEVEL}
    left join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = ${RESETS}
    where c."AccountId" = ${accountId}
    order by c."CharacterSlot"`;
  let online = "no se sabe";
  try {
    online = (await presence(login)).online ? "SI esta dentro del juego ahora" : "esta fuera del juego";
  } catch {
    // sin datos de conexion
  }
  const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("es");
  return [
    "DATOS DE LA CUENTA (reales, de la base; el jugador habla por WhatsApp, no esta en el juego por este medio):",
    `- Cuenta ${login}: ${online}. ${fmt(acc?.points)} puntos, ${fmt(acc?.wcoinc)} WCoinC, ${fmt(acc?.wcoinp)} WCoinP.`,
    chars.length
      ? chars.map(c => `- Personaje ${c.name}: ${CLASSES[c.class] ?? "?"}, nivel ${c.level}${c.masterLevel ? ` (master ${c.masterLevel})` : ""}, ${c.resets} resets, ${fmt(c.zen)} zen, ${c.points} puntos sin repartir, en ${MAPS[c.map] ?? (c.map == null ? "?" : `el mapa ${c.map}`)}.`).join("\n")
      : "- No tiene personajes todavia.",
    "- Si esta dentro del juego, estos datos son de su ultimo guardado y pueden estar un poco atrasados.",
    "- Por WhatsApp SOLO puedes proponer estas acciones (el sistema le pide confirmacion al jugador):",
    "  RESET de un personaje, REPARTIR PUNTOS (fuerza, agilidad, vitalidad, energia, comando), PARAR el farmeo sin conexion (/offlevel)",
    "  y VENDER en La Plaza un item de su baul por un precio en WCoinP.",
    "  Cuando el jugador pida claramente una de ellas, responde UNICAMENTE con una linea JSON, sin nada mas:",
    '  {"accion":"reset","personaje":"NOMBRE"}',
    '  {"accion":"puntos","personaje":"NOMBRE","fuerza":0,"agilidad":0,"vitalidad":0,"energia":0,"comando":0}',
    '  {"accion":"parar"}',
    '  {"accion":"mover","spot":"NUMERO O NOMBRE DEL SPOT"}  (mover al personaje que farmea sin conexion a un spot de farmeo)',
    '  {"accion":"vender","item":"NOMBRE DEL ITEM","precio":0}',
    "  Si no dice el personaje y tiene uno solo, usa ese; si tiene varios, preguntale cual. Para vender sin precio, preguntale el precio.",
    "  Cualquier otra accion (comprar, mover a lugares que no son spots, dar items o monedas) no se puede por WhatsApp.",
    "- Comandos directos que le puedes recomendar: *baul* (lista su baul), *vender 3 50* (item 3 del baul a 50 WCoinP), *parar*, *spots* y *mover 2* (spots de farmeo), *reset NOMBRE*, *puntos NOMBRE fuerza 100*.",
  ].join("\n");
}

// ---------------------------------------------------------------- acciones con "si"

const STAT_WORDS: Record<string, "str" | "agi" | "vit" | "ene" | "cmd"> = {
  fuerza: "str", fue: "str", str: "str", agilidad: "agi", agi: "agi", vitalidad: "vit", vit: "vit",
  energia: "ene", "energía": "ene", ene: "ene", comando: "cmd", cmd: "cmd",
};
const STAT_NAMES = { str: "Fuerza", agi: "Agilidad", vit: "Vitalidad", ene: "Energía", cmd: "Comando" } as const;
const CONFIRM_MS = 2 * 60_000;

type Action =
  | { kind: "reset"; character: string }
  | { kind: "puntos"; character: string; stats: Partial<Record<keyof typeof STAT_NAMES, number>> }
  | { kind: "parar" }
  | { kind: "mover"; spot?: string; spotId?: number; spotName?: string }
  | { kind: "vender"; item?: string; index?: number; price: number; itemId?: string; label?: string };

/** El ultimo "baul" que se le mostro a cada chat, para "vender 3 50". */
const lastVault = new Map<string, { at: number; items: { id: string; label: string }[] }>();

/** Las cuentas que farmean sin conexion ahora (BarrioAvisosPlugIn las escribe en en-juego.json). */
const DATA_DIR = process.env.OPENMU_DATA_DIR ?? `${process.env.HOME ?? "/root"}/openmu/data`;
function farmingOffline(login: string): boolean | null {
  try {
    const data = JSON.parse(readFileSync(`${DATA_DIR}/en-juego.json`, "utf8")) as { at?: number; offline?: unknown[] };
    if (typeof data.at !== "number" || Date.now() - data.at > 60_000 || !Array.isArray(data.offline)) return null;
    return data.offline.some(l => typeof l === "string" && l.toLowerCase() === login.toLowerCase());
  } catch {
    return null;
  }
}

/** Una orden para el servidor de juego (BarrioAvisosPlugIn la lee en unos segundos). */
function orderGame(action: string, login: string, text?: string): void {
  const dir = `${DATA_DIR}/ordenes`;
  mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomUUID()}.json`;
  writeFileSync(`${dir}/${name}.tmp`, JSON.stringify({ accion: action, login, text, at: Date.now() }));
  renameSync(`${dir}/${name}.tmp`, `${dir}/${name}`);
}
/** Los spots de farmeo que guardo el GM en el juego (/guardarspot), en data/spots.json. */
type Spot = { id: number; nombre: string; mapa: number; mapaNombre: string; x: number; y: number; nivel: number };
function loadSpots(): Spot[] {
  try {
    const d = JSON.parse(readFileSync(`${DATA_DIR}/spots.json`, "utf8")) as { spots?: Spot[] };
    return Array.isArray(d.spots) ? d.spots : [];
  } catch {
    return [];
  }
}

function spotsText(): string {
  const spots = loadSpots();
  if (!spots.length) return "Todavía no hay spots de farmeo. (El staff los crea en el juego con /guardarspot.)";
  return `📍 *Spots de farmeo:*\n${spots.map(s => `${s.id}. *${s.nombre}* (${s.mapaNombre})${s.nivel > 0 ? ` · nivel ${s.nivel}+` : ""}`).join("\n")}\n\nCon tu personaje farmeando (MU Helper + /offlevel): *mover NÚMERO* (ej: mover 1).`;
}

const pending = new Map<string, { action: Action; expires: number }>();

/** Lo que se va a hacer, dicho para el jugador. */
function describe(a: Action): string {
  if (a.kind === "parar") return "*parar el farmeo* sin conexión (tu personaje se guarda y sale del juego)";
  if (a.kind === "mover") return `llevar a tu personaje que farmea a *${a.spotName ?? a.spot ?? "?"}* y dejarlo farmeando ahí (si muere vuelve solo, hasta 3 veces)`;
  if (a.kind === "vender") return `publicar *${a.label ?? a.item ?? "?"}* en La Plaza por *${a.price.toLocaleString("es")} WCoinP*`;
  if (a.kind === "reset") return `hacer *reset* a *${a.character}*`;
  const parts = Object.entries(a.stats).map(([k, n]) => `${n} a ${STAT_NAMES[k as keyof typeof STAT_NAMES]}`);
  return `repartir *${parts.join(", ")}* en *${a.character}*`;
}

/** Comandos directos, sin IA: "reset barrio02" o "puntos barrio02 fuerza 500 agilidad 100". */
function parseCommand(text: string): Action | null {
  const t = text.trim();
  if (/^(parar|detener|para|deten)( (el )?(farmeo|farm|offlevel))?[.!]*$/i.test(t)) return { kind: "parar" };
  const mv = t.match(/^mover(?: a)?(?: (?:al )?spot)?\s+(\d{1,3})$/i);
  if (mv) return { kind: "mover", spot: mv[1] };
  const v = t.match(/^vender\s+(\d{1,3})\s+(\d{1,9})$/i);
  if (v) return { kind: "vender", index: Number(v[1]), price: Number(v[2]) };
  const r = t.match(/^reset(?:ear)?\s+(?:a\s+)?([A-Za-z0-9]{3,10})$/i);
  if (r) return { kind: "reset", character: r[1] };
  const p = t.match(/^puntos\s+([A-Za-z0-9]{3,10})\s+(.+)$/i);
  if (p) {
    const stats: Partial<Record<keyof typeof STAT_NAMES, number>> = {};
    for (const [, word, n] of p[2].matchAll(/([a-zA-Zéí]+)\s+(\d{1,5})/g)) {
      const key = STAT_WORDS[word.toLowerCase()];
      if (!key) return null;
      stats[key] = (stats[key] ?? 0) + Number(n);
    }
    return Object.keys(stats).length ? { kind: "puntos", character: p[1], stats } : null;
  }
  return null;
}

/** La accion que propuso la IA (una linea JSON), validada. */
function parseAiAction(answer: string): Action | null {
  const m = answer.match(/\{[^{}]*"accion"[^{}]*\}/);
  if (!m) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (o.accion === "parar") return { kind: "parar" };
  if (o.accion === "mover" && (typeof o.spot === "string" || typeof o.spot === "number")) return { kind: "mover", spot: String(o.spot).slice(0, 40) };
  if (o.accion === "vender") {
    const price = typeof o.precio === "number" && Number.isInteger(o.precio) && o.precio > 0 ? o.precio : 0;
    const item = typeof o.item === "string" ? o.item.trim().slice(0, 60) : "";
    return item && price ? { kind: "vender", item, price } : null;
  }
  const character = typeof o.personaje === "string" ? o.personaje.trim() : "";
  if (!/^[A-Za-z0-9]{3,10}$/.test(character)) return null;
  if (o.accion === "reset") return { kind: "reset", character };
  if (o.accion === "puntos") {
    const stats: Partial<Record<keyof typeof STAT_NAMES, number>> = {};
    for (const [word, key] of [["fuerza", "str"], ["agilidad", "agi"], ["vitalidad", "vit"], ["energia", "ene"], ["comando", "cmd"]] as const) {
      const n = o[word];
      if (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 32767) stats[key] = n;
    }
    return Object.keys(stats).length ? { kind: "puntos", character, stats } : null;
  }
  return null;
}

const CONFIRM_TEXT = "Responde *sí* para hacerlo o *no* para cancelar (tienes 2 minutos).";

/** La lista del baul para el chat (y la guarda para "vender N precio"). */
async function showVault(sql: Sql, jid: string, accountId: string): Promise<string[]> {
  const items = await vaultItems(sql, accountId);
  lastVault.set(jid, { at: Date.now(), items });
  if (!items.length) return ["Tu baúl está vacío. Guarda en el baúl lo que quieras vender (dentro del juego) y vuelve a escribirme *baul*."];
  const lines = items.slice(0, 40).map((it, i) => `${i + 1}. ${it.label}`);
  return [`🎒 *Tu baúl:*\n${lines.join("\n")}\n\nPara vender: *vender NÚMERO PRECIO* (ej: vender 1 50).`];
}

/** Propone la accion, ya validada contra la cuenta. */
async function propose(sql: Sql, jid: string, linked: { account: string; login: string }, action: Action): Promise<string[]> {
  if (action.kind === "parar") {
    const farming = farmingOffline(linked.login);
    if (farming === false) return ["Ninguno de tus personajes está farmeando sin conexión ahora mismo. (Se arranca dentro del juego con el MU Helper y /offlevel.)"];
    if (farming === null) return ["No pude ver el estado del servidor ahora mismo. Intenta en un minuto."];
    pending.set(jid, { action, expires: Date.now() + CONFIRM_MS });
    return [`¿Quieres ${describe(action)}? 🧙\n${CONFIRM_TEXT}`];
  }

  if (action.kind === "mover") {
    const spots = loadSpots();
    const want = (action.spot ?? "").toLowerCase().trim();
    const spot = spots.find(sp => String(sp.id) === want) ?? spots.find(sp => sp.nombre.toLowerCase() === want)
      ?? (spots.filter(sp => sp.nombre.toLowerCase().includes(want)).length === 1 ? spots.find(sp => sp.nombre.toLowerCase().includes(want)) : undefined);
    if (!spot) return [`No encontré ese spot.`, spotsText()];
    const farming = farmingOffline(linked.login);
    if (farming === false) return ["Para moverlo tu personaje tiene que estar *farmeando sin conexión*: entra al juego, prende el MU Helper y escribe /offlevel. Después me dices *mover " + spot.id + "*."];
    if (farming === null) return ["No pude ver el estado del servidor ahora mismo. Intenta en un minuto."];
    const fixed: Action = { kind: "mover", spotId: spot.id, spotName: `${spot.nombre} (${spot.mapaNombre})` };
    pending.set(jid, { action: fixed, expires: Date.now() + CONFIRM_MS });
    return [`¿Quieres ${describe(fixed)}?${spot.nivel > 0 ? ` (pide nivel ${spot.nivel})` : ""} 🧙\n${CONFIRM_TEXT}`];
  }

  if (action.kind === "vender") {
    if (action.price > 100_000_000) return ["Ese precio es demasiado alto. El máximo es 100.000.000 WCoinP."];
    let items = lastVault.get(jid);
    if (!items || Date.now() - items.at > 10 * 60_000) items = { at: Date.now(), items: await vaultItems(sql, linked.account) };
    lastVault.set(jid, items);
    let chosen: { id: string; label: string } | undefined;
    if (action.index) {
      chosen = items.items[action.index - 1];
      if (!chosen) return [`No hay item número ${action.index} en tu baúl. Escribe *baul* para ver la lista.`, ...(await showVault(sql, jid, linked.account))];
    } else {
      const want = (action.item ?? "").toLowerCase().replace(/\s+/g, " ");
      const matches = items.items.filter(it => it.label.toLowerCase().includes(want) || want.includes(it.label.toLowerCase()));
      if (matches.length !== 1) {
        const vault = await showVault(sql, jid, linked.account);
        return [matches.length ? `Tienes varios items que se parecen a *${action.item}*. Dime cuál con su número:` : `No encontré *${action.item}* en tu baúl.`, ...vault];
      }
      chosen = matches[0];
    }
    const { tax } = await economy(sql);
    const net = action.price - Math.floor((action.price * tax) / 100);
    const fixed: Action = { kind: "vender", price: action.price, itemId: chosen.id, label: chosen.label };
    pending.set(jid, { action: fixed, expires: Date.now() + CONFIRM_MS });
    return [`¿Quieres ${describe(fixed)}? 🧙\nSi se vende recibes *${net.toLocaleString("es")} WCoinP* (impuesto ${tax}%). Tu cuenta tiene que estar *fuera del juego*.\n${CONFIRM_TEXT}`];
  }

  const chars = await sql`select "Name" as name from data."Character" where "AccountId" = ${linked.account} order by "CharacterSlot"`;
  const match = chars.find(c => String(c.name).toLowerCase() === action.character.toLowerCase());
  if (!match) {
    return [`No tienes un personaje llamado *${action.character}*. Tus personajes: ${chars.map(c => c.name).join(", ") || "ninguno"}.`];
  }
  const fixed = { ...action, character: String(match.name) } as Action;
  pending.set(jid, { action: fixed, expires: Date.now() + CONFIRM_MS });
  return [`¿Quieres ${describe(fixed)}? 🧙\nTu cuenta tiene que estar *fuera del juego*.\n${CONFIRM_TEXT}`];
}

async function confirm(sql: Sql, jid: string, linked: { account: string; login: string }): Promise<string[]> {
  const p = pending.get(jid);
  pending.delete(jid);
  if (!p || p.expires < Date.now()) return ["No hay nada pendiente por confirmar (o ya pasaron los 2 minutos). Pídemelo otra vez."];
  const who = { accountId: linked.account, login: linked.login };
  try {
    let res: { message: string };
    if (p.action.kind === "parar") {
      if (!farmingOffline(linked.login)) return ["Ya no está farmeando sin conexión. No hice nada."];
      orderGame("parar", linked.login);
      res = { message: "Le pedí al servidor que pare el farmeo. Te aviso por aquí cuando quede guardado (unos segundos)." };
    } else if (p.action.kind === "mover") {
      if (!farmingOffline(linked.login)) return ["Ya no está farmeando sin conexión. No hice nada."];
      orderGame("mover", linked.login, String(p.action.spotId));
      res = { message: "Le pedí al servidor que lo mueva. Te aviso por aquí cuando llegue (unos segundos)." };
    } else if (p.action.kind === "vender") {
      res = await doSell(sql, who, { item: p.action.itemId, price: p.action.price });
      lastVault.delete(jid);
    } else if (p.action.kind === "reset") {
      res = await doReset(sql, who, { character: p.action.character });
    } else {
      res = await doAddPoints(sql, who, { character: p.action.character, ...p.action.stats });
    }
    await sql`insert into barrio.sabio_log (login, character, question, answer) values (${linked.login}, ${"WhatsApp"}, ${`[accion] ${describe(p.action)}`}, ${res.message})`;
    return [`✅ ${res.message}`];
  } catch (error) {
    if (error instanceof PanelError) return [`❌ ${error.message}`];
    console.error("whatsapp accion", error);
    return ["❌ Algo salió mal y no se hizo nada. Intenta en un rato."];
  }
}

async function botMessage(sql: Sql, jid: string, text: string): Promise<string[]> {
  await ensureTables(sql);
  const lower = text.trim().toLowerCase();

  // "vincular 123456", "vincula 123456" o solo el numero de 6 cifras.
  const link = lower.match(/^(?:vincul(?:ar|a|o)\s*)?(\d{6})$/);
  if (link) {
    const now = Date.now();
    const bad = (badCodes.get(jid) ?? []).filter(t => now - t < 3600_000);
    if (bad.length >= MAX_BAD_CODES) return ["Demasiados códigos equivocados. Espera una hora y genera uno nuevo en Mi cuenta."];
    const [row] = await sql`
      delete from barrio.wa_code where code = ${link[1]} and expires > now()
      returning account::text as account`;
    if (!row) {
      badCodes.set(jid, [...bad, now]);
      return ["Ese código no sirve o ya venció. Genera uno nuevo en *Mi cuenta → WhatsApp*."];
    }
    await sql.begin(async tx => {
      await tx`delete from barrio.wa_link where jid = ${jid} or account = ${row.account}`;
      await tx`insert into barrio.wa_link (jid, account) values (${jid}, ${row.account})`;
    });
    const [acc] = await sql`select "LoginName" as login from data."Account" where "Id" = ${row.account}`;
    return [`¡Listo pana! Este WhatsApp quedó vinculado a la cuenta *${acc?.login ?? "?"}*. Pregúntame lo que quieras: tus personajes, cuánto te falta para el reset, qué hay en La Plaza... 🧙`];
  }

  const [linked] = await sql`
    select l.account::text as account, a."LoginName" as login
    from barrio.wa_link l join data."Account" a on a."Id" = l.account where l.jid = ${jid}`;
  if (!linked) return [HELP];

  if (/^(s[ií]|si+|dale|ok|confirmo)[.! ]*$/.test(lower) && hasExtraPending(jid)) return confirmExtra(sql, jid, linked);
  if (/^(s[ií]|si+|dale|ok|confirmo)[.! ]*$/.test(lower) && pending.has(jid)) return confirm(sql, jid, linked);
  if (/^(no|cancela(r)?)[.! ]*$/.test(lower) && (pending.has(jid) || hasExtraPending(jid))) {
    pending.delete(jid);
    cancelExtraPending(jid);
    return ["Listo, cancelado. No se hizo nada."];
  }
  const extra = await extrasCommand(sql, jid, linked, text);
  if (extra) return extra;
  if (/^(ba[uú]l|mi ba[uú]l|ver ba[uú]l)[.!?]*$/.test(lower)) return showVault(sql, jid, linked.account);
  if (/^(spots?|lugares|mapas de farmeo)[.!?]*$/.test(lower)) return [spotsText()];
  const direct = parseCommand(text);
  if (direct) return propose(sql, jid, linked, direct);

  if (lower === "desvincular") {
    await sql`delete from barrio.wa_link where jid = ${jid}`;
    return ["Listo: este WhatsApp ya no maneja tu cuenta. Para volver, genera otro código en Mi cuenta."];
  }

  await ensureSabioTables(sql);
  const cfg = await settings(sql);
  const { on, daily } = cfg;
  if (!on) return ["El Sabio está de vacaciones por ahora. Vuelve pronto, pana."];
  const key = cloudflareKey();
  if (!key) return ["El Sabio está durmiendo (falta configurarlo). Avísale al admin."];
  const used = await takeOne(sql, linked.login, cfg);
  if (used === null) {
    return [`Ya me hiciste tus ${daily} preguntas de ${periodWord(cfg)}, pana. ${cfg.hourly ? "En la próxima hora seguimos." : "Mañana seguimos."} (Los comandos *reset*, *puntos*, *vender* y *baúl* no gastan preguntas.)`];
  }

  const memoryKey = `wa:${linked.login}`;
  try {
    const messages = [
      {
        role: "system",
        content: `${PERSONALITY}\n- Estas hablando por WhatsApp: puedes usar emojis con moderacion y *negritas* de WhatsApp; maximo 5 frases.\n\n${SERVER_FACTS}\n\n${await extrasContext()}\n\n${await accountContext(sql, linked.account, linked.login)}`,
      },
      ...remember(memoryKey),
      { role: "user", content: text.slice(0, 500) },
    ];
    // WhatsApp marca las negritas con un solo asterisco.
    const answer = (await runModel(key, messages)).trim().replace(/\*\*(.+?)\*\*/g, "*$1*");
    const aiAction = parseAiAction(answer);
    if (aiAction) {
      store(memoryKey, text.slice(0, 500), `(propuse ${aiAction.kind})`);
      return propose(sql, jid, linked, aiAction);
    }
    // Una "accion" que no es reset ni puntos (dar monedas, items...) no existe: no se hace ni se muestra.
    if (/"accion"/.test(answer)) {
      store(memoryKey, text.slice(0, 500), "(eso no se puede por WhatsApp)");
      return ["Eso no lo puedo hacer, pana. Por WhatsApp puedo hacer *reset*, *repartir puntos*, *parar el farmeo* y *vender en La Plaza* (siempre con tu *sí*). Lo demás se gana jugando. 😉"];
    }
    store(memoryKey, text.slice(0, 500), answer);
    await sql`insert into barrio.sabio_log (login, character, question, answer) values (${linked.login}, ${"WhatsApp"}, ${text.slice(0, 500)}, ${answer})`;
    const left = daily - used;
    return daily > 0 && left <= 3 ? [answer, `_(Te quedan ${left} preguntas ${periodWord(cfg)}.)_`] : [answer];
  } catch (error) {
    console.error("whatsapp", error);
    await giveBack(sql, linked.login, cfg).catch(() => {});
    return ["Se me cruzaron los cables, pana. Intenta en un rato."];
  }
}

// ---------------------------------------------------------------- avisos (Fase C)

const BOT_SEND = process.env.WA_SEND_URL ?? "http://127.0.0.1:3410/send";
/** Avisos por cuenta y por dia como maximo (protege el numero del bot). */
const MAX_AVISOS_DIA = 30;
const avisosHoy = new Map<string, { day: string; n: number }>();

/** Manda un aviso al WhatsApp vinculado a la cuenta (por id o por login). Nunca falla hacia afuera. */
export async function notifyAccount(sql: Sql, who: { accountId?: string; login?: string }, text: string): Promise<boolean> {
  try {
    await ensureTables(sql);
    const [row] = who.accountId
      ? await sql`select jid, account::text as account from barrio.wa_link where account = ${who.accountId}`
      : await sql`
          select l.jid, l.account::text as account from barrio.wa_link l
          join data."Account" a on a."Id" = l.account where lower(a."LoginName") = lower(${who.login ?? ""})`;
    if (!row) return false;
    const day = new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
    const count = avisosHoy.get(row.account);
    const n = count?.day === day ? count.n : 0;
    if (n >= MAX_AVISOS_DIA) return false;
    avisosHoy.set(row.account, { day, n: n + 1 });
    const botSecret = secret();
    if (!botSecret) return false;
    const res = await fetch(BOT_SEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: botSecret, to: row.jid, text: text.slice(0, 1000) }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Manda un mensaje a un chat de WhatsApp por el bot de la tablet. Nunca falla hacia afuera. */
export async function sendToJid(jid: string, text: string): Promise<boolean> {
  try {
    const botSecret = secret();
    if (!botSecret || !JID_RE.test(jid)) return false;
    const res = await fetch(BOT_SEND, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: botSecret, to: jid, text: text.slice(0, 1500) }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- rutas

export async function handleWhatsapp(req: Request, url: URL, cors: Record<string, string>, sql: Sql): Promise<Response | null> {
  if (url.pathname === "/aviso") {
    // Avisos del servidor de juego (BarrioAvisosPlugIn): solo desde la tablet, con el secreto.
    if (req.method !== "POST" || req.headers.has("cf-connecting-ip")) return new Response("Not found", { status: 404 });
    const raw = await req.text();
    if (raw.length > 4096) return new Response("Too large", { status: 413 });
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(raw);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!sameSecret(b.secret)) return new Response("Not found", { status: 404 });
    const login = typeof b.login === "string" ? b.login.slice(0, 20) : "";
    const text = typeof b.text === "string" ? b.text.trim() : "";
    const sent = login && text ? await notifyAccount(sql, { login }, text) : false;
    return json({ ok: true, sent }, 200, cors);
  }

  if (url.pathname === "/wa-chat") {
    // "/wa Nombre mensaje" desde el juego (BarrioWhatsappChatPlugIn): solo desde la tablet.
    if (req.method !== "POST" || req.headers.has("cf-connecting-ip")) return new Response("Not found", { status: 404 });
    const raw = await req.text();
    if (raw.length > 4096) return new Response("Too large", { status: 413 });
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(raw);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!sameSecret(b.secret)) return new Response("Not found", { status: 404 });
    await ensureTables(sql);
    return json(await waChatFromGame(sql, b), 200, cors);
  }

  if (url.pathname === "/whatsapp") {
    // Solo el bot de la tablet: lo que llega por el tunel trae cabeceras de Cloudflare.
    if (req.method !== "POST" || req.headers.has("cf-connecting-ip")) return new Response("Not found", { status: 404 });
    const raw = await req.text();
    if (raw.length > 4096) return new Response("Too large", { status: 413 });
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(raw);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!sameSecret(b.secret)) return new Response("Not found", { status: 404 });
    const jid = typeof b.from === "string" ? b.from : "";
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!JID_RE.test(jid) || !text) return json({ messages: [] }, 200, cors);
    // Respuestas en pausa (Panel admin o barriomu.sh whatsapp pausar): no contesta nada.
    await ensureTables(sql);
    const [paused] = await sql`select 1 from barrio.settings where key = 'wa_on' and value = '0'`;
    // Los comandos de admin siguen funcionando en pausa (asi el staff maneja el servidor igual).
    if (paused && !/^admin\b/i.test(text)) return json({ messages: [] }, 200, cors);
    return json({ messages: await botMessage(sql, jid, text) }, 200, cors);
  }

  const routes: Record<string, [string, (req: Request, sql: Sql) => Promise<unknown>]> = {
    "/me/whatsapp": ["GET", myLink],
    "/me/whatsapp/codigo": ["POST", newCode],
    "/me/whatsapp/desvincular": ["POST", unlink],
  };
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
