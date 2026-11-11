// BarrioMU: mas cosas del bot de WhatsApp (sin IA, no gastan preguntas).
//
// - estado, top, mi puesto, eventos            consultas con datos reales
// - avisar <evento|todos> / no avisar          aviso 10 minutos antes de Blood Castle, Devil
//                                              Square y Chaos Castle
// - resumen si / resumen no                    resumen diario a las 8:00 (hora de Venezuela)
// - @Nombre mensaje                            le llega a ese jugador DENTRO del juego como
//                                              susurro (si esta conectado); responde con /wa
// - admin ...                                  solo cuentas GM: estado, jugadores, anuncio,
//                                              dar wcoinc (con "si")
// Los jugadores en el juego escriben "/wa Nombre mensaje" y le llega al WhatsApp vinculado a
// la cuenta de Nombre (ruta /wa-chat, solo desde la tablet).

import type { Sql } from "postgres";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { PanelError, offlineTransaction } from "./panel";
import { sendToJid } from "./whatsapp";

type Status = { online: boolean; players: number | null; servers: { name: string; players: number | null }[] };
type Ranked = { rank: number; name: string; level: number; resets: number; masterResets?: number };
type EventInfo = { key: string; name: string; active: boolean; next: string[] };
type Data = {
  status: () => Promise<Status>;
  ranking: (limit: number) => Promise<Ranked[]>;
  events: () => Promise<EventInfo[]>;
};

let data: Data | null = null;
/** main.ts le pasa sus funciones de estado, ranking y eventos (las mismas de la pagina). */
export function setWaData(d: Data): void {
  data = d;
}

const DATA_DIR = process.env.OPENMU_DATA_DIR ?? `${process.env.HOME ?? "/root"}/openmu/data`;
const VE_OFFSET_MS = -4 * 3600_000;
const ADMIN_STATES = [2, 3];
const WHISPERS_PER_HOUR = 20;
const SUMMARY_HOUR = 8;

const EVENT_WORDS: Record<string, string> = {
  "blood castle": "blood-castle", bc: "blood-castle", blood: "blood-castle",
  "devil square": "devil-square", ds: "devil-square", devil: "devil-square",
  "chaos castle": "chaos-castle", cc: "chaos-castle", chaos: "chaos-castle",
};
const EVENT_NAMES: Record<string, string> = {
  "blood-castle": "Blood Castle", "devil-square": "Devil Square", "chaos-castle": "Chaos Castle",
};

let ready: Promise<void> | null = null;
function ensureTables(sql: Sql): Promise<void> {
  ready ??= (async () => {
    await sql`create table if not exists barrio.wa_alert (jid text not null, event text not null, primary key (jid, event))`;
    await sql`alter table barrio.wa_link add column if not exists resumen boolean not null default true`;
    await sql`
      create table if not exists barrio.wa_snapshot (
        character uuid not null,
        day date not null,
        account uuid not null,
        name text not null,
        level int not null,
        resets int not null,
        master int not null,
        zen bigint not null,
        primary key (character, day))`;
    await sql`
      create table if not exists barrio.wa_snapshot_acc (
        account uuid not null,
        day date not null,
        points int not null,
        wcoinc int not null,
        wcoinp int not null,
        primary key (account, day))`;
  })().catch(error => {
    ready = null;
    throw error;
  });
  return ready;
}

const veDate = (ms = Date.now()) => new Date(ms + VE_OFFSET_MS);
const veTime = (iso: string) => veDate(Date.parse(iso)).toISOString().slice(11, 16);
const fmt = (n: unknown) => Number(n ?? 0).toLocaleString("es");

function inGame(): { logins: string[]; offline: string[] } | null {
  try {
    const d = JSON.parse(readFileSync(`${DATA_DIR}/en-juego.json`, "utf8")) as { at?: number; logins?: unknown[]; offline?: unknown[] };
    if (typeof d.at !== "number" || Date.now() - d.at > 60_000) return null;
    const list = (v: unknown[] | undefined) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return { logins: list(d.logins), offline: list(d.offline) };
  } catch {
    return null;
  }
}

function orderGame(order: Record<string, unknown>): void {
  const dir = `${DATA_DIR}/ordenes`;
  mkdirSync(dir, { recursive: true });
  const name = `${Date.now()}-${crypto.randomUUID()}.json`;
  writeFileSync(`${dir}/${name}.tmp`, JSON.stringify({ ...order, at: Date.now() }));
  renameSync(`${dir}/${name}.tmp`, `${dir}/${name}`);
}

// ---------------------------------------------------------------- consultas

async function statusText(): Promise<string> {
  if (!data) return "No pude ver el estado ahora mismo.";
  const s = await data.status();
  const ig = inGame();
  if (!s.online) return "🔴 El servidor está *apagado* ahora mismo. Vuelve en un rato.";
  const per = s.servers.map(x => `${x.name}: ${x.players ?? "?"}`).join(" · ");
  const farming = ig ? ` · ${ig.offline.length} farmeando sin conexión` : "";
  return `🟢 BarrioMU está *prendido*.\n👥 Conectados: *${s.players ?? ig?.logins.length ?? "?"}* (${per})${farming}`;
}

async function topText(): Promise<string> {
  if (!data) return "No pude ver el ranking ahora mismo.";
  const top = await data.ranking(5);
  if (!top.length) return "Todavía no hay nadie en el ranking.";
  const medal = ["🥇", "🥈", "🥉", "4.", "5."];
  return `🏆 *Top 5 de BarrioMU*\n${top.map((r, i) => `${medal[i]} *${r.name}*: ${r.masterResets ? `${r.masterResets} MR · ` : ""}${r.resets} resets · nivel ${r.level}`).join("\n")}`;
}

async function myRankText(sql: Sql, accountId: string): Promise<string> {
  if (!data) return "No pude ver el ranking ahora mismo.";
  const mine = await sql`select "Name" as name from data."Character" where "AccountId" = ${accountId}`;
  const names = new Set(mine.map(c => String(c.name)));
  const all = await data.ranking(1000);
  const found = all.filter(r => names.has(r.name));
  if (!found.length) return "Tus personajes todavía no aparecen en el ranking.";
  return `📊 *Tus puestos* (de ${all.length}):\n${found.map(r => `• *${r.name}*: puesto *${r.rank}* (${r.resets} resets, nivel ${r.level})`).join("\n")}`;
}

async function eventsText(): Promise<string> {
  if (!data) return "No pude ver los eventos ahora mismo.";
  const list = await data.events();
  return `🗓️ *Próximos eventos* (hora de Venezuela):\n${list
    .filter(e => e.active)
    .map(e => `• *${e.name}*: ${e.next.map(veTime).join(", ")}`)
    .join("\n")}\n\nPara que te avise 10 minutos antes: *avisar todos* o *avisar blood castle*.`;
}

/** Un resumen corto para la IA: estado, top 3 y eventos (datos reales). */
export async function extrasContext(): Promise<string> {
  if (!data) return "";
  try {
    const [s, top, ev] = await Promise.all([data.status(), data.ranking(3), data.events()]);
    return [
      `SERVIDOR AHORA: ${s.online ? `prendido, ${s.players ?? "?"} conectados` : "apagado"}.`,
      `TOP 3: ${top.map(r => `${r.rank}. ${r.name} (${r.resets} resets, nivel ${r.level})`).join("; ")}.`,
      `PROXIMOS EVENTOS (hora de Venezuela): ${ev.filter(e => e.active).map(e => `${e.name} ${e.next.map(veTime).join(", ")}`).join("; ")}.`,
      "- Comandos que no gastan preguntas: estado, top, mi puesto, eventos, avisar todos, resumen si/no, @Nombre mensaje (le llega en el juego), spots, mover N.",
    ].join("\n");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------- admin

const adminPending = new Map<string, { login: string; amount: number; by: string; expires: number }>();

export function hasExtraPending(jid: string): boolean {
  const p = adminPending.get(jid);
  return !!p && p.expires > Date.now();
}

export function cancelExtraPending(jid: string): boolean {
  return adminPending.delete(jid);
}

export async function confirmExtra(sql: Sql, jid: string, linked: { account: string; login: string }): Promise<string[]> {
  const p = adminPending.get(jid);
  adminPending.delete(jid);
  if (!p || p.expires < Date.now()) return ["No hay nada pendiente (o pasaron los 2 minutos)."];
  try {
    const [target] = await sql`select "Id"::text as id, "LoginName" as login from data."Account" where lower("LoginName") = lower(${p.login})`;
    if (!target) return [`❌ No existe la cuenta *${p.login}*.`];
    await offlineTransaction(sql, target.login, async tx => {
      await tx`update data."Account" set "WCoinC" = "WCoinC" + ${p.amount} where "Id" = ${target.id}`;
      await tx`
        insert into barrio.points_log (account, kind, detail, points, by_account, currency)
        values (${target.id}, 'admin', ${`WhatsApp: ${p.by}`}, ${p.amount}, ${linked.account}, 'wcoinc')`;
    });
    await sql`
      insert into barrio.admin_log (account, action, ip) values (${linked.account}, ${`WhatsApp: dio ${p.amount} WCoinC a ${target.login}`}, ${"whatsapp"})`
      .catch(() => {});
    return [`✅ Listo: *${fmt(p.amount)} WCoinC* para *${target.login}*.`];
  } catch (error) {
    if (error instanceof PanelError) return [`❌ ${error.message}`];
    console.error("wa admin dar", error);
    return ["❌ Algo salió mal y no se hizo nada."];
  }
}

const ADMIN_HELP = [
  "👑 *Comandos de admin*",
  "• *admin estado*: servidor y conectados",
  "• *admin jugadores*: cuentas dentro del juego",
  "• *admin anuncio TEXTO*: aviso dorado para todos en el juego",
  "• *admin dar wcoinc CUENTA CANTIDAD*: con tu *sí*",
  "• *admin resumen*: manda ya el resumen diario (para probar)",
].join("\n");

async function adminCommand(sql: Sql, jid: string, linked: { account: string; login: string }, text: string): Promise<string[]> {
  const [me] = await sql`select "State" as state from data."Account" where "Id" = ${linked.account}`;
  if (!me || !ADMIN_STATES.includes(Number(me.state))) return ["Ese comando es solo para el staff."];
  const rest = text.trim().replace(/^admin\s*/i, "");
  const lower = rest.toLowerCase();
  if (!rest || lower === "ayuda") return [ADMIN_HELP];
  if (lower === "estado") return [await statusText()];
  if (lower === "jugadores") {
    const ig = inGame();
    if (!ig) return ["No pude ver quién está en el juego (¿OpenMU apagado?)."];
    const offline = new Set(ig.offline.map(l => l.toLowerCase()));
    return [ig.logins.length
      ? `👥 *En el juego (${ig.logins.length}):*\n${ig.logins.map(l => `• ${l}${offline.has(l.toLowerCase()) ? " (farmeando sin conexión)" : ""}`).join("\n")}`
      : "No hay nadie en el juego ahora mismo."];
  }
  const anuncio = rest.match(/^anuncio\s+(.{3,120})$/i);
  if (anuncio) {
    orderGame({ accion: "anuncio", login: linked.login, text: anuncio[1] });
    await sql`insert into barrio.admin_log (account, action, ip) values (${linked.account}, ${`WhatsApp: anuncio ${anuncio[1]}`}, ${"whatsapp"})`.catch(() => {});
    return [`📢 Anuncio enviado al juego: "${anuncio[1]}"`];
  }
  if (lower === "resumen") {
    const sent = await sendSummaries(sql, veDate().toISOString().slice(0, 10));
    return [`☀️ Resumen enviado a ${sent} WhatsApp (solo a quienes tuvieron cambios desde la foto anterior).`];
  }
  const dar = rest.match(/^dar\s+wcoinc\s+([A-Za-z0-9]{4,10})\s+(\d{1,7})$/i);
  if (dar) {
    const amount = Number(dar[2]);
    if (amount < 1 || amount > 100_000) return ["La cantidad debe ser de 1 a 100.000."];
    adminPending.set(jid, { login: dar[1], amount, by: linked.login, expires: Date.now() + 2 * 60_000 });
    return [`¿Le doy *${fmt(amount)} WCoinC* a la cuenta *${dar[1]}*? (tiene que estar fuera del juego)\nResponde *sí* o *no* (2 minutos).`];
  }
  return [`No entendí ese comando de admin.\n\n${ADMIN_HELP}`];
}

// ---------------------------------------------------------------- chat con el juego

const whispers = new Map<string, number[]>();

async function whisperToGame(sql: Sql, jid: string, linked: { account: string; login: string }, to: string, text: string): Promise<string[]> {
  const now = Date.now();
  const times = (whispers.get(jid) ?? []).filter(t => now - t < 3600_000);
  if (times.length >= WHISPERS_PER_HOUR) return [`Ya mandaste ${WHISPERS_PER_HOUR} mensajes al juego en esta hora. Espera un rato.`];
  const [me] = await sql`select "Name" as name from data."Character" where "AccountId" = ${linked.account} order by "CharacterSlot" limit 1`;
  if (!me) return ["Necesitas un personaje para mandar mensajes al juego."];
  if (!inGame()) return ["El servidor no está respondiendo ahora mismo. Intenta en un rato."];
  times.push(now);
  whispers.set(jid, times);
  orderGame({ accion: "susurro", login: linked.login, from: String(me.name), to, text: text.slice(0, 50) });
  return [];
}

/** /wa-chat: un jugador en el juego escribe "/wa Nombre mensaje" para el WhatsApp de Nombre. */
export async function waChatFromGame(sql: Sql, b: Record<string, unknown>): Promise<{ message: string }> {
  const from = typeof b.from === "string" ? b.from.slice(0, 10) : "";
  const to = typeof b.to === "string" ? b.to.slice(0, 10) : "";
  const text = typeof b.text === "string" ? b.text.trim().slice(0, 200) : "";
  if (!from || !to || !text) return { message: "Uso: /wa Nombre mensaje" };
  const [row] = await sql`
    select l.jid from data."Character" c join barrio.wa_link l on l.account = c."AccountId"
    where lower(c."Name") = lower(${to}) limit 1`;
  if (!row) return { message: `${to} no tiene WhatsApp vinculado.` };
  const sent = await sendToJid(row.jid, `💬 *${from}* te escribe desde el juego:\n${text}\n\nResponde: *@${from} tu mensaje*`);
  return { message: sent ? `Enviado al WhatsApp de ${to}.` : "No se pudo mandar el WhatsApp ahora." };
}

// ---------------------------------------------------------------- comandos

/** Los comandos de este modulo; null si el mensaje no es uno de ellos. */
export async function extrasCommand(sql: Sql, jid: string, linked: { account: string; login: string }, text: string): Promise<string[] | null> {
  await ensureTables(sql);
  const t = text.trim();
  const lower = t.toLowerCase();
  if (/^admin\b/i.test(t)) return adminCommand(sql, jid, linked, t);
  if (/^(estado|servidor|server)[?!.]*$/.test(lower)) return [await statusText()];
  if (/^(top|ranking|top ?5)[?!.]*$/.test(lower)) return [await topText()];
  if (/^(mi puesto|mi ranking|puesto)[?!.]*$/.test(lower)) return [await myRankText(sql, linked.account)];
  if (/^(eventos|evento|horarios?)[?!.]*$/.test(lower)) return [await eventsText()];
  if (/^ayuda[?!.]*$/.test(lower) || lower === "comandos") return [HELP_TEXT];

  const alert = lower.match(/^(no )?avisar(?:me)?(?: (?:de |del )?(.+))?$/);
  if (alert) {
    const off = !!alert[1];
    const what = (alert[2] ?? "todos").trim();
    const keys = what === "todos" || what === "eventos" ? Object.keys(EVENT_NAMES) : EVENT_WORDS[what] ? [EVENT_WORDS[what]] : [];
    if (!keys.length) return ["No conozco ese evento. Usa: *avisar todos*, *avisar blood castle*, *avisar devil square* o *avisar chaos castle*."];
    for (const k of keys) {
      if (off) await sql`delete from barrio.wa_alert where jid = ${jid} and event = ${k}`;
      else await sql`insert into barrio.wa_alert (jid, event) values (${jid}, ${k}) on conflict do nothing`;
    }
    const names = keys.map(k => EVENT_NAMES[k]).join(", ");
    return [off ? `🔕 Listo, ya no te aviso de ${names}.` : `⏰ Listo: te aviso *10 minutos antes* de ${names}. Para quitarlo: *no avisar ${what}*.`];
  }

  const resumen = lower.match(/^resumen (si|sí|no)$/);
  if (resumen) {
    const on = resumen[1] !== "no";
    await sql`update barrio.wa_link set resumen = ${on} where jid = ${jid}`;
    return [on ? `☀️ Listo: cada día a las ${SUMMARY_HOUR}:00 te mando el resumen de tus personajes.` : "Listo, ya no te mando el resumen diario."];
  }

  const chat = t.match(/^@([A-Za-z0-9]{3,10})\s+(.+)$/s);
  if (chat) return whisperToGame(sql, jid, linked, chat[1], chat[2]);
  return null;
}

export const HELP_TEXT = [
  "🧙 *Lo que puedo hacer* (estos comandos no gastan preguntas):",
  "• *estado* · *top* · *mi puesto* · *eventos*",
  "• *avisar todos* / *no avisar todos* (10 min antes de los eventos)",
  "• *resumen si* / *resumen no* (resumen diario a las 8:00)",
  "• *@Nombre mensaje*: le llega a ese jugador dentro del juego",
  "• *baul* · *vender 2 50* · *parar* · *reset NOMBRE* · *puntos NOMBRE fuerza 100*",
  "• *spots* · *mover 2*: lleva a tu personaje que farmea (/offlevel) a un spot de farmeo",
  "Y cualquier pregunta de MU, en tus palabras. 😉",
].join("\n");

// ---------------------------------------------------------------- trabajos

const sentAlerts = new Set<string>();

async function alertJob(sql: Sql): Promise<void> {
  if (!data) return;
  const list = await data.events();
  const now = Date.now();
  for (const e of list) {
    if (!e.active) continue;
    for (const iso of e.next) {
      const mins = (Date.parse(iso) - now) / 60_000;
      const key = `${e.key}:${iso}`;
      if (mins > 9 && mins <= 11 && !sentAlerts.has(key)) {
        sentAlerts.add(key);
        const subs = await sql`select jid from barrio.wa_alert where event = ${e.key}`;
        for (const s of subs) await sendToJid(s.jid, `⏰ *${e.name}* empieza en 10 minutos (${veTime(iso)}). ¡Prepárate!`);
      }
    }
  }
  if (sentAlerts.size > 500) sentAlerts.clear();
}

async function snapshot(sql: Sql, day: string, replace = false): Promise<void> {
  await sql`
    insert into barrio.wa_snapshot (character, day, account, name, level, resets, master, zen)
    select c."Id", ${day}::date, c."AccountId", c."Name",
           coalesce(lv."Value", 0)::int, coalesce(rs."Value", 0)::int, coalesce(ml."Value", 0)::int,
           coalesce(inv."Money", 0)
    from data."Character" c
    join barrio.wa_link l on l.account = c."AccountId"
    left join data."ItemStorage" inv on inv."Id" = c."InventoryId"
    left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = '560931ad-0901-4342-b7f4-fd2e2fcc0563'
    left join data."StatAttribute" ml on ml."CharacterId" = c."Id" and ml."DefinitionId" = '70cd8c10-391a-4c51-9aa4-a854600e3a9f'
    left join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = '89a891a7-f9f9-4ab5-af36-12056e53a5f7'
    on conflict (character, day) do ${replace
      ? sql`update set level = excluded.level, resets = excluded.resets, master = excluded.master, zen = excluded.zen, name = excluded.name`
      : sql`nothing`}`;
  await sql`
    insert into barrio.wa_snapshot_acc (account, day, points, wcoinc, wcoinp)
    select a."Id", ${day}::date, a."GoblinPoints", a."WCoinC", a."WCoinP"
    from data."Account" a join barrio.wa_link l on l.account = a."Id"
    on conflict (account, day) do ${replace
      ? sql`update set points = excluded.points, wcoinc = excluded.wcoinc, wcoinp = excluded.wcoinp`
      : sql`nothing`}`;
}

/** El resumen de una cuenta: lo que cambio desde la foto anterior (ayer). */
async function summaryFor(sql: Sql, account: string, today: string): Promise<string | null> {
  const rows = await sql`
    select t.name, t.level, t.resets, t.master, t.zen,
           y.level as "yLevel", y.resets as "yResets", y.master as "yMaster", y.zen as "yZen"
    from barrio.wa_snapshot t
    join lateral (
      select * from barrio.wa_snapshot p where p.character = t.character and p.day < t.day order by p.day desc limit 1
    ) y on true
    where t.account = ${account} and t.day = ${today}::date`;
  const [acc] = await sql`
    select t.points - y.points as points, t.wcoinc - y.wcoinc as wcoinc, t.wcoinp - y.wcoinp as wcoinp
    from barrio.wa_snapshot_acc t
    join lateral (select * from barrio.wa_snapshot_acc p where p.account = t.account and p.day < t.day order by p.day desc limit 1) y on true
    where t.account = ${account} and t.day = ${today}::date`;
  const lines: string[] = [];
  for (const r of rows) {
    const parts: string[] = [];
    if (r.resets > r.yResets) parts.push(`+${r.resets - r.yResets} reset${r.resets - r.yResets > 1 ? "s" : ""} (ahora ${r.resets})`);
    else if (r.level > r.yLevel) parts.push(`+${r.level - r.yLevel} niveles (nivel ${r.level})`);
    if (r.master > r.yMaster) parts.push(`+${r.master - r.yMaster} master`);
    const zen = Number(r.zen) - Number(r.yZen);
    if (zen > 0) parts.push(`+${fmt(zen)} zen`);
    if (parts.length) lines.push(`• *${r.name}*: ${parts.join(", ")}`);
  }
  if (acc && (acc.points > 0 || acc.wcoinc > 0 || acc.wcoinp > 0)) {
    const coins = [acc.points > 0 ? `+${acc.points} puntos` : "", acc.wcoinc > 0 ? `+${acc.wcoinc} WCoinC` : "", acc.wcoinp > 0 ? `+${acc.wcoinp} WCoinP` : ""].filter(Boolean);
    lines.push(`• Cuenta: ${coins.join(", ")}`);
  }
  if (!lines.length) return null;
  return `☀️ *Tu resumen de ayer en BarrioMU:*\n${lines.join("\n")}\n\n¡A seguir dándole! (Para no recibirlo: *resumen no*)`;
}

let lastSummaryDay = "";

async function summaryJob(sql: Sql): Promise<void> {
  const ve = veDate();
  const today = ve.toISOString().slice(0, 10);
  if (ve.getUTCHours() !== SUMMARY_HOUR || lastSummaryDay === today) return;
  lastSummaryDay = today;
  const [done] = await sql`select value from barrio.settings where key = 'wa_resumen_dia'`;
  if (done?.value === today) return;
  await sql`
    insert into barrio.settings (key, value) values ('wa_resumen_dia', ${today})
    on conflict (key) do update set value = excluded.value`;
  await sendSummaries(sql, today);
}

/** Saca la foto de hoy y manda el resumen a quien tuvo cambios desde la foto anterior. */
async function sendSummaries(sql: Sql, today: string): Promise<number> {
  await snapshot(sql, today, true);
  const links = await sql`select jid, account::text as account from barrio.wa_link where resumen`;
  let sent = 0;
  for (const l of links) {
    const text = await summaryFor(sql, l.account, today).catch(() => null);
    if (text && (await sendToJid(l.jid, text))) sent++;
  }
  return sent;
}

let started = false;
/** Avisos de eventos (cada minuto) y resumen diario: los arranca main.ts. */
export function startWaJobs(sql: Sql): void {
  if (started) return;
  started = true;
  const tick = async () => {
    try {
      await ensureTables(sql);
      await alertJob(sql);
      await summaryJob(sql);
    } catch (error) {
      console.error("wa jobs", error);
    }
  };
  setInterval(() => void tick(), 60_000);
  // La primera foto del dia (para que el resumen de manana tenga con que comparar).
  setTimeout(async () => {
    try {
      await ensureTables(sql);
      await snapshot(sql, veDate().toISOString().slice(0, 10));
    } catch (error) {
      console.error("wa snapshot", error);
    }
  }, 15_000);
}
