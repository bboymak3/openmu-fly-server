// BarrioMU: el Sabio del Barrio por WhatsApp (Fase A: vincular y conversar, sin acciones).
//
// - El bot de la tablet (babylon/whatsapp/bot.ts) manda aqui cada mensaje con el secreto
//   compartido; esta ruta no responde a nada que llegue por el tunel.
// - Un numero maneja una sola cuenta: el jugador genera un codigo en Mi cuenta y le
//   escribe al bot "vincular 123456". "desvincular" lo suelta.
// - Con el numero vinculado, el Sabio contesta con los datos reales de la cuenta y sus
//   personajes (de la base). Comparte el limite diario del /ia del juego.
// - No hay herramientas: no da ni cambia nada (las acciones con "si" vienen despues).

import type { Sql } from "postgres";
import { LEVEL, MASTER_LEVEL, RESETS, PanelError, json, presence, session } from "./panel";
import { ensureSettings } from "./economia";
import {
  PERSONALITY, SERVER_FACTS, cloudflareKey, ensureSabioTables, giveBack, remember, runModel, sameSecret,
  settings, store, takeOne,
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
    "- Por WhatsApp todavia NO puedes hacer acciones (reset, comprar, mover): solo conversar y consultar. Dile que pronto podra.",
  ].join("\n");
}

async function botMessage(sql: Sql, jid: string, text: string): Promise<string[]> {
  await ensureTables(sql);
  const lower = text.trim().toLowerCase();

  const link = lower.match(/^vincular\s+(\d{6})$/);
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

  if (lower === "desvincular") {
    await sql`delete from barrio.wa_link where jid = ${jid}`;
    return ["Listo: este WhatsApp ya no maneja tu cuenta. Para volver, genera otro código en Mi cuenta."];
  }

  await ensureSabioTables(sql);
  const { on, daily } = await settings(sql);
  if (!on) return ["El Sabio está de vacaciones por ahora. Vuelve pronto, pana."];
  const key = cloudflareKey();
  if (!key) return ["El Sabio está durmiendo (falta configurarlo). Avísale al admin."];
  const used = await takeOne(sql, linked.login, daily);
  if (used === null) return [`Ya me hiciste tus ${daily} preguntas de hoy, pana. Mañana seguimos.`];

  const memoryKey = `wa:${linked.login}`;
  try {
    const messages = [
      {
        role: "system",
        content: `${PERSONALITY}\n- Estas hablando por WhatsApp: puedes usar emojis con moderacion y *negritas* de WhatsApp; maximo 5 frases.\n\n${SERVER_FACTS}\n\n${await accountContext(sql, linked.account, linked.login)}`,
      },
      ...remember(memoryKey),
      { role: "user", content: text.slice(0, 500) },
    ];
    // WhatsApp marca las negritas con un solo asterisco.
    const answer = (await runModel(key, messages)).trim().replace(/\*\*(.+?)\*\*/g, "*$1*");
    store(memoryKey, text.slice(0, 500), answer);
    await sql`insert into barrio.sabio_log (login, character, question, answer) values (${linked.login}, ${"WhatsApp"}, ${text.slice(0, 500)}, ${answer})`;
    const left = daily - used;
    return left <= 3 ? [answer, `_(Te quedan ${left} preguntas hoy.)_`] : [answer];
  } catch (error) {
    console.error("whatsapp", error);
    await giveBack(sql, linked.login).catch(() => {});
    return ["Se me cruzaron los cables, pana. Intenta en un rato."];
  }
}

// ---------------------------------------------------------------- rutas

export async function handleWhatsapp(req: Request, url: URL, cors: Record<string, string>, sql: Sql): Promise<Response | null> {
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
