// BarrioMU: tienda de puntos.
//
// - Los puntos son los Goblin Points de la cuenta (data."Account"."GoblinPoints"). Los da
//   BarrioPointsPlugIn de OpenMU al matar monstruos dorados y jefes; cuantos da cada uno esta
//   en ~/openmu/data/puntos.json (numero de monstruo: puntos), que se edita desde el panel admin.
// - El catalogo vive en barrio.points_shop. Solo se ve en la web lo que esta prendido.
// - Lo comprado va al baul de la cuenta, en el primer hueco donde quepa, con la cuenta
//   desconectada (OpenMU guarda en memoria al jugador conectado).

import type { Sql } from "postgres";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PanelError, body, json, offlineTransaction, requireOffline, session } from "./panel";
import { economy, freeSlot, occupy, vaultOf, vaultUsage } from "./economia";

const POINTS_FILE = process.env.POINTS_FILE ?? `${process.env.HOME ?? "/root"}/openmu/data/puntos.json`;

const MAX_QTY = 50;

/**
 * Las monedas de la cuenta en OpenMU. Puntos: los que da el juego (dorados, jefes, horas
 * jugadas). WCoinC: la da el admin, sirve en la tienda y se cambia 1:1 por WCoinP. WCoinP: la
 * moneda para comerciar entre jugadores.
 */
export const CURRENCIES = {
  puntos: { column: "GoblinPoints", name: "puntos" },
  wcoinc: { column: "WCoinC", name: "WCoinC" },
  wcoinp: { column: "WCoinP", name: "WCoinP" },
} as const;
type Currency = keyof typeof CURRENCIES;
const SHOP_CURRENCIES: Currency[] = ["puntos", "wcoinc"];
const isCurrency = (v: unknown, allowed: readonly Currency[] = Object.keys(CURRENCIES) as Currency[]): v is Currency =>
  typeof v === "string" && (allowed as readonly string[]).includes(v);

/** Monstruos que dan puntos, con los puntos por defecto (los mismos de BarrioPointsPlugIn.cs). */
export const MONSTERS: { number: number; name: string; points: number; kind: string }[] = [
  { number: 43, name: "Golden Budge Dragon", points: 1, kind: "Invasión dorada" },
  { number: 78, name: "Golden Goblin", points: 2, kind: "Invasión dorada" },
  { number: 54, name: "Golden Soldier", points: 2, kind: "Invasión dorada" },
  { number: 53, name: "Golden Titan", points: 3, kind: "Invasión dorada" },
  { number: 80, name: "Golden Lizard King", points: 3, kind: "Invasión dorada" },
  { number: 81, name: "Golden Vepar", points: 3, kind: "Invasión dorada" },
  { number: 82, name: "Golden Tantallos", points: 3, kind: "Invasión dorada" },
  { number: 83, name: "Golden Wheel", points: 3, kind: "Invasión dorada" },
  { number: 79, name: "Golden Dragon", points: 5, kind: "Invasión dorada" },
  { number: 44, name: "Red Dragon", points: 5, kind: "Invasión" },
  { number: 135, name: "White Wizard", points: 10, kind: "Invasión" },
  { number: 77, name: "Phoenix of Darkness (Icarus)", points: 20, kind: "Jefe" },
  { number: 161, name: "Illusion of Kundun 1 (Kalima 1)", points: 10, kind: "Jefe" },
  { number: 181, name: "Illusion of Kundun 2 (Kalima 2)", points: 15, kind: "Jefe" },
  { number: 189, name: "Illusion of Kundun 3 (Kalima 3)", points: 20, kind: "Jefe" },
  { number: 197, name: "Illusion of Kundun 4 (Kalima 4)", points: 25, kind: "Jefe" },
  { number: 267, name: "Illusion of Kundun 5 (Kalima 5)", points: 30, kind: "Jefe" },
  { number: 338, name: "Illusion of Kundun 6 (Kalima 6)", points: 40, kind: "Jefe" },
  { number: 275, name: "Kundun (Kalima 7)", points: 50, kind: "Jefe" },
  { number: 295, name: "Erohim (Land of Trials)", points: 30, kind: "Jefe" },
  { number: 349, name: "Balgass (Crywolf)", points: 50, kind: "Jefe" },
  { number: 361, name: "Nightmare (Kanturu)", points: 50, kind: "Jefe" },
  { number: 362, name: "Mano izquierda de Maya (Kanturu)", points: 20, kind: "Jefe" },
  { number: 363, name: "Mano derecha de Maya (Kanturu)", points: 20, kind: "Jefe" },
  { number: 459, name: "Selupan (Raklion)", points: 50, kind: "Jefe" },
];

/** Lo que trae la tienda la primera vez. Prendido: joyas y alas; lo demas lo prende el admin. */
const SEED: { group: number; number: number; level: number; label: string; price: number; enabled: boolean; maxQty: number }[] = [
  // Joyas
  { group: 14, number: 13, level: 0, label: "Jewel of Bless", price: 10, enabled: true, maxQty: MAX_QTY },
  { group: 14, number: 14, level: 0, label: "Jewel of Soul", price: 10, enabled: true, maxQty: MAX_QTY },
  { group: 12, number: 15, level: 0, label: "Jewel of Chaos", price: 15, enabled: true, maxQty: MAX_QTY },
  { group: 14, number: 16, level: 0, label: "Jewel of Life", price: 25, enabled: true, maxQty: MAX_QTY },
  { group: 14, number: 22, level: 0, label: "Jewel of Creation", price: 30, enabled: true, maxQty: MAX_QTY },
  // Alas de 1ra
  { group: 12, number: 1, level: 0, label: "Wings of Heaven (Dark Wizard)", price: 300, enabled: true, maxQty: 1 },
  { group: 12, number: 2, level: 0, label: "Wings of Satan (Dark Knight, Magic Gladiator)", price: 300, enabled: true, maxQty: 1 },
  { group: 12, number: 0, level: 0, label: "Wings of Elf (Fairy Elf)", price: 300, enabled: true, maxQty: 1 },
  { group: 12, number: 41, level: 0, label: "Wings of Curse (Summoner)", price: 300, enabled: true, maxQty: 1 },
  // Alas de 2da (el Dark Lord y el Rage Fighter empiezan con capa)
  { group: 12, number: 4, level: 0, label: "Wings of Soul (Dark Wizard)", price: 800, enabled: true, maxQty: 1 },
  { group: 12, number: 5, level: 0, label: "Wings of Dragon (Dark Knight)", price: 800, enabled: true, maxQty: 1 },
  { group: 12, number: 3, level: 0, label: "Wings of Spirits (Fairy Elf)", price: 800, enabled: true, maxQty: 1 },
  { group: 12, number: 6, level: 0, label: "Wings of Darkness (Magic Gladiator)", price: 800, enabled: true, maxQty: 1 },
  { group: 12, number: 42, level: 0, label: "Wings of Despair (Summoner)", price: 800, enabled: true, maxQty: 1 },
  { group: 13, number: 30, level: 0, label: "Cape of Lord (Dark Lord)", price: 800, enabled: true, maxQty: 1 },
  { group: 12, number: 49, level: 0, label: "Cape of Fighter (Rage Fighter)", price: 800, enabled: true, maxQty: 1 },
  // Recomendados, apagados: el admin decide
  { group: 14, number: 31, level: 0, label: "Jewel of Guardian", price: 40, enabled: false, maxQty: 20 },
  { group: 14, number: 42, level: 0, label: "Jewel of Harmony", price: 30, enabled: false, maxQty: 20 },
  { group: 14, number: 41, level: 0, label: "Gemstone", price: 15, enabled: false, maxQty: 20 },
  { group: 13, number: 14, level: 0, label: "Loch's Feather (alas de 2da)", price: 150, enabled: false, maxQty: 5 },
  { group: 13, number: 53, level: 0, label: "Feather of Condor (alas de 3ra)", price: 400, enabled: false, maxQty: 1 },
  { group: 13, number: 52, level: 0, label: "Flame of Condor (alas de 3ra)", price: 400, enabled: false, maxQty: 1 },
  { group: 13, number: 0, level: 0, label: "Guardian Angel", price: 50, enabled: false, maxQty: 1 },
  { group: 13, number: 1, level: 0, label: "Imp", price: 80, enabled: false, maxQty: 1 },
  { group: 13, number: 2, level: 0, label: "Horn of Uniria", price: 120, enabled: false, maxQty: 1 },
  { group: 13, number: 3, level: 0, label: "Horn of Dinorant", price: 250, enabled: false, maxQty: 1 },
  { group: 13, number: 37, level: 0, label: "Horn of Fenrir", price: 600, enabled: false, maxQty: 1 },
  // Armas basicas +15
  { group: 0, number: 0, level: 15, label: "Kris +15", price: 200, enabled: false, maxQty: 1 },
  { group: 0, number: 1, level: 15, label: "Short Sword +15", price: 200, enabled: false, maxQty: 1 },
  { group: 1, number: 0, level: 15, label: "Small Axe +15 (Dark Knight)", price: 200, enabled: false, maxQty: 1 },
  { group: 2, number: 0, level: 15, label: "Mace +15", price: 200, enabled: false, maxQty: 1 },
  { group: 4, number: 0, level: 15, label: "Short Bow +15 (Fairy Elf)", price: 200, enabled: false, maxQty: 1 },
  { group: 5, number: 0, level: 15, label: "Skull Staff +15 (Dark Wizard, Summoner)", price: 200, enabled: false, maxQty: 1 },
  { group: 0, number: 32, level: 15, label: "Sacred Glove +15 (Rage Fighter)", price: 200, enabled: false, maxQty: 1 },
];

let ready: Promise<void> | null = null;

function ensureTables(sql: Sql): Promise<void> {
  ready ??= (async () => {
    await sql`create schema if not exists barrio`;
    await sql`
      create table if not exists barrio.points_shop (
        id serial primary key,
        item_group smallint not null,
        item_number smallint not null,
        item_level smallint not null default 0,
        label text not null,
        price int not null,
        enabled boolean not null default false,
        max_qty int not null default 1,
        sort int not null default 0,
        unique (item_group, item_number, item_level))`;
    await sql`
      create table if not exists barrio.points_log (
        id bigserial primary key,
        account uuid not null,
        kind text not null,
        detail text,
        points int not null,
        by_account uuid,
        at timestamptz not null default now())`;
    await sql`alter table barrio.points_shop add column if not exists currency text not null default 'puntos'`;
    await sql`alter table barrio.points_log add column if not exists currency text not null default 'puntos'`;
    const [{ n }] = await sql`select count(*)::int as n from barrio.points_shop`;
    if (n === 0) {
      let sort = 0;
      for (const s of SEED) {
        await sql`
          insert into barrio.points_shop (item_group, item_number, item_level, label, price, enabled, max_qty, sort)
          values (${s.group}, ${s.number}, ${s.level}, ${s.label}, ${s.price}, ${s.enabled}, ${s.maxQty}, ${sort++})
          on conflict do nothing`;
      }
    }
  })().catch(error => {
    ready = null;
    throw error;
  });
  return ready;
}

const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

// ---------------------------------------------------------------- jugador

async function shop(req: Request, sql: Sql) {
  const s = session(req);
  await ensureTables(sql);
  const [account] = await sql`
    select "GoblinPoints" as points, "WCoinC" as wcoinc, "WCoinP" as wcoinp from data."Account" where "Id" = ${s.accountId}`;
  const items = await sql`
    select id, label, price, max_qty as "maxQty", item_level as level, currency
    from barrio.points_shop where enabled order by sort, id`;
  return {
    points: account?.points ?? 0,
    wcoinc: account?.wcoinc ?? 0,
    wcoinp: account?.wcoinp ?? 0,
    rate: (await economy(sql)).rate,
    items,
    monsters: monsterTable().filter(m => m.points > 0),
  };
}

/** Catalogo publico (pagina tienda.html): lo que esta a la venta, sin datos de ninguna cuenta. */
async function catalog(_req: Request, sql: Sql) {
  await ensureTables(sql);
  const items = await sql`
    select id, label, price, max_qty as "maxQty", item_level as level, currency
    from barrio.points_shop where enabled order by sort, id`;
  const { rate, tax } = await economy(sql);
  return { rate, tax, items, monsters: monsterTable().filter(m => m.points > 0) };
}

async function buy(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const id = intIn(b.id, 1, 1_000_000);
  const qty = intIn(b.qty ?? 1, 1, MAX_QTY);
  if (!id || !qty) throw new PanelError(400, "Elige un item y una cantidad valida.");
  await ensureTables(sql);
  const [item] = await sql`
    select s.id, s.label, s.price, s.max_qty as "maxQty", s.item_level as level, s.currency,
           d."Id"::text as def, d."Width" as w, d."Height" as h, d."Durability" as durability
    from barrio.points_shop s
    join config."ItemDefinition" d on d."Group" = s.item_group and d."Number" = s.item_number
    where s.id = ${id} and s.enabled
    limit 1`;
  if (!item) throw new PanelError(404, "Ese item ya no esta en la tienda.");
  if (qty > item.maxQty) throw new PanelError(400, `De ${item.label} puedes comprar hasta ${item.maxQty} de una vez.`);
  const total = item.price * qty;
  const currency: Currency = isCurrency(item.currency, SHOP_CURRENCIES) ? item.currency : "puntos";
  const { column, name: coin } = CURRENCIES[currency];

  return offlineTransaction(sql, s.login, async tx => {
    const vault = await vaultOf(tx, s.accountId);
    const [account] = await tx`select ${tx(column)} as points from data."Account" where "Id" = ${s.accountId}`;
    if (!account) throw new PanelError(404, "No se encontro la cuenta.");
    if (account.points < total) throw new PanelError(400, `Te faltan ${total - account.points} ${coin} (tienes ${account.points}, cuesta ${total}).`);
    const used = await vaultUsage(tx, vault);

    for (let i = 0; i < qty; i++) {
      const slot = freeSlot(used, item.w || 1, item.h || 1);
      if (slot < 0) {
        throw new PanelError(409, i === 0
          ? `No hay espacio en tu baul para ${item.label}. Saca algo del baul y vuelve a intentar.`
          : `Solo caben ${i} en tu baul. Compra menos o saca algo del baul.`);
      }
      occupy(used, slot, item.w || 1, item.h || 1);
      await tx`
        insert into data."Item" ("Id", "DefinitionId", "Durability", "HasSkill", "ItemSlot", "ItemStorageId", "Level", "PetExperience", "SocketCount")
        values (gen_random_uuid(), ${item.def}, ${item.durability}, false, ${slot}, ${vault}, ${item.level}, 0, 0)`;
    }
    await tx`update data."Account" set ${tx(column)} = ${tx(column)} - ${total} where "Id" = ${s.accountId}`;
    await tx`insert into barrio.points_log (account, kind, detail, points, currency) values (${s.accountId}, 'compra', ${`${qty} x ${item.label}`}, ${-total}, ${currency})`;
    return {
      ok: true,
      message: `¡Listo! ${qty} x ${item.label} ya ${qty === 1 ? "esta" : "estan"} en tu baul. Te quedan ${account.points - total} ${coin}.`,
    };
  });
}

/** WCoinC -> WCoinP a la tasa del admin (por defecto 1 a 2), con la cuenta fuera del juego. Solo en ese sentido. */
async function convert(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const amount = intIn(b.amount, 1, 10_000_000);
  if (!amount) throw new PanelError(400, "Escribe cuantas WCoinC quieres cambiar.");
  await ensureTables(sql);
  const { rate } = await economy(sql);
  return offlineTransaction(sql, s.login, async tx => {
    const [account] = await tx`select "WCoinC" as c, "WCoinP" as p from data."Account" where "Id" = ${s.accountId} for update`;
    if (!account) throw new PanelError(404, "No se encontro la cuenta.");
    if (account.c < amount) throw new PanelError(400, `Solo tienes ${account.c} WCoinC.`);
    const got = amount * rate;
    await tx`update data."Account" set "WCoinC" = "WCoinC" - ${amount}, "WCoinP" = "WCoinP" + ${got} where "Id" = ${s.accountId}`;
    await tx`insert into barrio.points_log (account, kind, detail, points, currency) values (${s.accountId}, 'cambio', ${`${amount} WCoinC a ${got} WCoinP`}, ${got}, 'wcoinp')`;
    return { ok: true, message: `Listo: cambiaste ${amount} WCoinC por ${got} WCoinP. Ahora tienes ${account.c - amount} WCoinC y ${account.p + got} WCoinP.` };
  });
}

// ---------------------------------------------------------------- admin

/** La tabla de puntos por monstruo: el archivo de OpenMU, o los valores por defecto. */
function readPointsFile(): Record<string, number> | null {
  try {
    if (!existsSync(POINTS_FILE)) return null;
    const parsed = JSON.parse(readFileSync(POINTS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function monsterTable() {
  const file = readPointsFile();
  const known = MONSTERS.map(m => ({ ...m, points: file ? Number(file[String(m.number)] ?? 0) : m.points }));
  const extra = file
    ? Object.entries(file)
        .filter(([n]) => !MONSTERS.some(m => String(m.number) === n))
        .map(([n, p]) => ({ number: Number(n), name: `Monstruo ${n}`, points: Number(p), kind: "Otro" }))
    : [];
  return [...known, ...extra];
}

export async function adminShop(sql: Sql) {
  await ensureTables(sql);
  const items = await sql`
    select id, item_group as "group", item_number as number, item_level as level, label, price, enabled,
           max_qty as "maxQty", sort, currency
    from barrio.points_shop order by sort, id`;
  const log = await sql`
    select l.at, a."LoginName" as account, l.kind, l.detail, l.points, l.currency
    from barrio.points_log l left join data."Account" a on a."Id" = l.account
    order by l.at desc limit 25`;
  const top = await sql`
    select "LoginName" as account, "GoblinPoints" as points, "WCoinC" as wcoinc, "WCoinP" as wcoinp from data."Account"
    where "GoblinPoints" > 0 or "WCoinC" > 0 or "WCoinP" > 0
    order by "GoblinPoints" + "WCoinC" + "WCoinP" desc limit 15`;
  return { items, monsters: monsterTable(), log, top, file: POINTS_FILE };
}

export async function adminSaveItems(req: Request, sql: Sql) {
  const b = await body(req, 64 * 1024);
  await ensureTables(sql);
  const list = Array.isArray(b.items) ? b.items : [];
  let n = 0;
  for (const raw of list.slice(0, 200)) {
    const it = raw as Record<string, unknown>;
    const id = intIn(it.id, 1, 1_000_000);
    const price = intIn(it.price, 1, 10_000_000);
    const maxQty = intIn(it.maxQty, 1, MAX_QTY);
    if (!id || !price || !maxQty || typeof it.enabled !== "boolean") continue;
    const currency = isCurrency(it.currency, SHOP_CURRENCIES) ? it.currency : "puntos";
    await sql`update barrio.points_shop set price = ${price}, enabled = ${it.enabled}, max_qty = ${maxQty}, currency = ${currency} where id = ${id}`;
    n++;
  }
  return { ok: true, message: `Listo: ${n} items guardados.` };
}

export async function adminAddItem(req: Request, sql: Sql) {
  const b = await body(req);
  await ensureTables(sql);
  const group = intIn(b.group, 0, 15);
  const number = intIn(b.number, 0, 511);
  const level = intIn(b.level ?? 0, 0, 15);
  const price = intIn(b.price, 1, 10_000_000);
  const maxQty = intIn(b.maxQty ?? 1, 1, MAX_QTY);
  if (group === null || number === null || level === null || !price || !maxQty) {
    throw new PanelError(400, "Revisa grupo (0-15), numero, nivel (0-15) y precio.");
  }
  const [def] = await sql`select "Name" as name from config."ItemDefinition" where "Group" = ${group} and "Number" = ${number} limit 1`;
  if (!def) throw new PanelError(404, `No existe el item ${group},${number} en OpenMU.`);
  const label = (typeof b.label === "string" && b.label.trim()) || `${def.name}${level ? ` +${level}` : ""}`;
  const currency = isCurrency(b.currency, SHOP_CURRENCIES) ? b.currency : "puntos";
  const [row] = await sql`
    insert into barrio.points_shop (item_group, item_number, item_level, label, price, enabled, max_qty, currency, sort)
    values (${group}, ${number}, ${level}, ${label.slice(0, 80)}, ${price}, true, ${maxQty}, ${currency},
            (select coalesce(max(sort), 0) + 1 from barrio.points_shop))
    on conflict (item_group, item_number, item_level) do nothing returning id`;
  if (!row) throw new PanelError(409, "Ese item (con ese nivel) ya esta en la tienda.");
  return { ok: true, message: `Agregado: ${label}.` };
}

export async function adminDeleteItem(req: Request, sql: Sql) {
  const b = await body(req);
  const id = intIn(b.id, 1, 1_000_000);
  if (!id) throw new PanelError(400, "Falta el item.");
  await ensureTables(sql);
  await sql`delete from barrio.points_shop where id = ${id}`;
  return { ok: true, message: "Item quitado de la tienda." };
}

export async function adminSaveMonsters(req: Request) {
  const b = await body(req, 64 * 1024);
  const table = b.table && typeof b.table === "object" ? (b.table as Record<string, unknown>) : null;
  if (!table) throw new PanelError(400, "Falta la tabla de puntos.");
  const out: Record<string, number> = {};
  for (const [n, p] of Object.entries(table)) {
    const number = Number(n);
    const points = Number(p);
    if (!Number.isInteger(number) || number < 0 || number > 2000) continue;
    if (!Number.isInteger(points) || points < 0 || points > 100_000) continue;
    if (points > 0) out[String(number)] = points;
  }
  try {
    mkdirSync(dirname(POINTS_FILE), { recursive: true });
    const temp = POINTS_FILE + ".tmp";
    writeFileSync(temp, JSON.stringify(out, null, 2));
    renameSync(temp, POINTS_FILE);
  } catch (error) {
    console.error("puntos.json", error);
    throw new PanelError(503, "No se pudo guardar la tabla de puntos en la tablet.");
  }
  return { ok: true, message: `Listo: ${Object.keys(out).length} monstruos dan puntos. OpenMU lo lee en menos de un minuto.` };
}

export async function adminGivePoints(req: Request, sql: Sql, adminAccountId: string) {
  const b = await body(req);
  const login = typeof b.account === "string" ? b.account.trim() : "";
  const points = intIn(b.points, -10_000_000, 10_000_000);
  const currency: Currency = isCurrency(b.currency) ? b.currency : "puntos";
  const { column, name: coin } = CURRENCIES[currency];
  if (!login || !points) throw new PanelError(400, "Escribe la cuenta y la cantidad (negativo para quitar).");
  await ensureTables(sql);
  const [account] = await sql`select "Id"::text as id, "LoginName" as login from data."Account" where lower("LoginName") = lower(${login})`;
  if (!account) throw new PanelError(404, "No existe esa cuenta.");
  return offlineTransaction(sql, account.login, async tx => {
    const [row] = await tx`
      update data."Account" set ${tx(column)} = greatest(0, ${tx(column)} + ${points})
      where "Id" = ${account.id} returning ${tx(column)} as total`;
    await tx`insert into barrio.points_log (account, kind, detail, points, by_account, currency) values (${account.id}, 'admin', ${`Dados por el admin (${coin})`}, ${points}, ${adminAccountId}, ${currency})`;
    return { ok: true, message: `Listo: ${account.login} ahora tiene ${row.total} ${coin}.` };
  });
}

/** Rutas de la tienda del jugador; null si la ruta no es de aqui. */
export async function handleTienda(req: Request, url: URL, cors: Record<string, string>, sql: Sql): Promise<Response | null> {
  const routes: Record<string, [string, (req: Request, sql: Sql) => Promise<unknown>]> = {
    "/tienda": ["GET", catalog],
    "/me/tienda": ["GET", shop],
    "/me/tienda/comprar": ["POST", buy],
    "/me/monedas/convertir": ["POST", convert],
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
