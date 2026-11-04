// BarrioMU: Cash Shop (WCoinC), la tienda que traia el cliente, recreada en la web.
//
// - Tres lineas, como la original: Alas, Items de mision y el Cofre sorpresa (una armadura al
//   azar de +0 a +12, a veces excelente). Se paga con WCoinC (data."Account"."WCoinC").
// - Cada item tiene un limite de compras por dia y por cuenta (barrio.cash_daily).
// - Lo comprado va al baul, con la cuenta desconectada (offlineTransaction), igual que la
//   tienda de puntos.
// - El catalogo (precio, limite, prendido) se maneja desde el panel admin.

import type { Sql } from "postgres";
import { PanelError, body, json, offlineTransaction, session } from "./panel";
import { cleanName, freeSlot, occupy, vaultOf, vaultUsage } from "./economia";

export type Line = "alas" | "mision" | "cofre";
export const LINES: { id: Line; label: string }[] = [
  { id: "alas", label: "Alas" },
  { id: "mision", label: "Items de misión" },
  { id: "cofre", label: "Cofre sorpresa" },
];
const MAX_QTY = 12;

/** Lo que trae el Cash Shop la primera vez (los items y limites diarios de la tienda original). */
const SEED: { line: Line; group: number | null; number: number | null; level: number; label: string; price: number; cap: number; icon: string }[] = [
  { line: "alas", group: 12, number: 0, level: 0, label: "Wings of Elf (Fairy Elf)", price: 90, cap: 1, icon: "12_0_0" },
  { line: "alas", group: 12, number: 1, level: 0, label: "Wings of Heaven (Dark Wizard)", price: 120, cap: 1, icon: "12_1_0" },
  { line: "alas", group: 12, number: 2, level: 0, label: "Wings of Satan (Dark Knight, Magic Gladiator)", price: 120, cap: 1, icon: "12_2_0" },
  { line: "alas", group: 13, number: 30, level: 0, label: "Cape of Lord (Dark Lord)", price: 120, cap: 1, icon: "13_30_0" },
  { line: "mision", group: 14, number: 23, level: 0, label: "Scroll of Emperor", price: 50, cap: 5, icon: "14_23_0" },
  { line: "mision", group: 14, number: 24, level: 0, label: "Broken Sword", price: 40, cap: 5, icon: "14_24_0" },
  { line: "mision", group: 14, number: 25, level: 0, label: "Tear of Elf", price: 40, cap: 5, icon: "14_25_0" },
  { line: "mision", group: 14, number: 26, level: 0, label: "Soul Shard of Wizard", price: 40, cap: 5, icon: "14_26_0" },
  { line: "mision", group: 14, number: 17, level: 1, label: "Devil's Eye +1 (Devil Square)", price: 30, cap: 10, icon: "14_17_1" },
  { line: "mision", group: 14, number: 18, level: 1, label: "Devil's Key +1 (Devil Square)", price: 30, cap: 10, icon: "14_18_0" },
  { line: "mision", group: 14, number: 29, level: 1, label: "Symbol of Kundun +1", price: 50, cap: 10, icon: "" },
  { line: "cofre", group: null, number: null, level: 0, label: "Cofre sorpresa: armadura al azar", price: 100, cap: 12, icon: "8_1_15_e" },
];

let ready: Promise<void> | null = null;

function ensureTables(sql: Sql): Promise<void> {
  ready ??= (async () => {
    await sql`create schema if not exists barrio`;
    await sql`
      create table if not exists barrio.cash_shop (
        id serial primary key,
        line text not null,
        item_group smallint,
        item_number smallint,
        item_level smallint not null default 0,
        label text not null,
        price int not null,
        daily_cap int not null default 1,
        enabled boolean not null default true,
        icon text not null default '',
        sort int not null default 0)`;
    await sql`
      create table if not exists barrio.cash_daily (
        account uuid not null,
        item_id int not null,
        day date not null default current_date,
        qty int not null,
        primary key (account, item_id, day))`;
    await sql`
      create table if not exists barrio.cash_log (
        id bigserial primary key,
        account uuid not null,
        item_id int not null,
        detail text not null,
        price int not null,
        at timestamptz not null default now())`;
    const [{ n }] = await sql`select count(*)::int as n from barrio.cash_shop`;
    if (n === 0) {
      let sort = 0;
      for (const s of SEED) {
        await sql`
          insert into barrio.cash_shop (line, item_group, item_number, item_level, label, price, daily_cap, icon, sort)
          values (${s.line}, ${s.group}, ${s.number}, ${s.level}, ${s.label}, ${s.price}, ${s.cap}, ${s.icon}, ${sort++})`;
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

const listItems = (sql: Sql) => sql`
  select id, line, label, price, daily_cap as "dailyCap", item_level as level, icon
  from barrio.cash_shop where enabled order by sort, id`;

// ---------------------------------------------------------------- cofre sorpresa

/**
 * Las probabilidades del cofre de la tienda original, por cada 1000 aperturas: comun (+0..+4),
 * raro (+5..+9), epico (excelente +3..+9 con 1-2 opciones) y legendario (excelente +10..+12 con
 * 2-3 opciones). Excelente en total: 6,5%; legendario: 1 de cada 200.
 */
const TIERS = [
  { tier: "Común", weight: 700, levels: [0, 4], options: [0, 0] },
  { tier: "Raro", weight: 235, levels: [5, 9], options: [0, 0] },
  { tier: "Épico", weight: 60, levels: [3, 9], options: [1, 2] },
  { tier: "Legendario", weight: 5, levels: [10, 12], options: [2, 3] },
] as const;

/** Las 6 opciones excelentes de defensa, por su numero en OpenMU (IncreasableItemOption.Number). */
const EXCELLENT = ["Zen +40%", "Defensa +10%", "Refleja daño +5%", "Reduce daño +4%", "Maná máximo +4%", "Vida máxima +4%"];

const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const between = ([min, max]: readonly number[]) => min + rand(max - min + 1);

/** Nombres reales de las tablas de opciones (cambian entre versiones de OpenMU). */
let optionSchema: Promise<{ join: string; joinOpt: string } | null> | null = null;
function resolveOptionSchema(sql: Sql) {
  optionSchema ??= (async () => {
    const cols = await sql<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns
      where table_schema = 'config' and table_name in ('ItemDefinitionItemOptionDefinition', 'ItemOptionDefinitionItemDefinition')`;
    for (const table of ["ItemDefinitionItemOptionDefinition", "ItemOptionDefinitionItemDefinition"]) {
      const names = cols.filter(c => c.table_name === table).map(c => c.column_name);
      const joinOpt = ["ItemOptionDefinitionId", "PossibleItemOptionsId"].find(c => names.includes(c));
      if (names.includes("ItemDefinitionId") && joinOpt) return { join: table, joinOpt };
    }
    return null;
  })().catch(() => null);
  return optionSchema;
}

/** Las opciones excelentes que esta armadura puede llevar: numero -> id de la opcion. */
async function excellentOptionsOf(tx: Sql, definitionId: string): Promise<Map<number, string>> {
  const schema = await resolveOptionSchema(tx);
  const out = new Map<number, string>();
  if (!schema) return out;
  const rows = await tx.unsafe<{ number: number; id: string }[]>(
    `select o."Number" as number, o."Id"::text as id
       from config."IncreasableItemOption" o
       join config."${schema.join}" j on j."${schema.joinOpt}" = o."ItemOptionDefinitionId"
       join config."ItemOptionType" t on t."Id" = o."OptionTypeId"
      where j."ItemDefinitionId" = $1 and t."Name" ilike 'excellent%'`,
    [definitionId],
  );
  for (const r of rows) out.set(Number(r.number), r.id);
  return out;
}

interface Piece { def: string; name: string; w: number; h: number; durability: number }

/** Saca la armadura del cofre y la deja en el baul. Devuelve lo que salio, para mostrarlo. */
async function openChest(tx: Sql, vault: string, used: boolean[]) {
  const pool = await tx<Piece[]>`
    select "Id"::text as def, "Name" as name, "Width" as w, "Height" as h, "Durability" as durability
    from config."ItemDefinition" where "Group" between 7 and 11 and coalesce("Name", '') <> ''`;
  if (!pool.length) throw new PanelError(500, "El cofre no tiene armaduras configuradas.");
  let total = 0;
  for (const t of TIERS) total += t.weight;
  let roll = rand(total);
  const tier = TIERS.find(t => (roll -= t.weight) < 0) ?? TIERS[0];
  const piece = pool[rand(pool.length)];
  const level = between(tier.levels);

  const slot = freeSlot(used, piece.w || 2, piece.h || 2);
  if (slot < 0) throw new PanelError(409, "No hay espacio en tu baúl para la armadura del cofre (deja un hueco de 2x3).");
  occupy(used, slot, piece.w || 2, piece.h || 2);

  const [item] = await tx`
    insert into data."Item" ("Id", "DefinitionId", "Durability", "HasSkill", "ItemSlot", "ItemStorageId", "Level", "PetExperience", "SocketCount")
    values (gen_random_uuid(), ${piece.def}, ${piece.durability}, false, ${slot}, ${vault}, ${level}, 0, 0)
    returning "Id"::text as id`;

  const options: string[] = [];
  const want = between(tier.options);
  if (want > 0) {
    const possible = await excellentOptionsOf(tx, piece.def);
    const numbers = [...possible.keys()].filter(n => n >= 1 && n <= EXCELLENT.length);
    for (let i = 0; i < want && numbers.length; i++) {
      const n = numbers.splice(rand(numbers.length), 1)[0];
      await tx`
        insert into data."ItemOptionLink" ("Id", "ItemId", "ItemOptionId", "Level", "Index")
        values (gen_random_uuid(), ${item.id}, ${possible.get(n)!}, 1, 0)`;
      options.push(EXCELLENT[n - 1]);
    }
  }
  const excellent = options.length > 0;
  return {
    tier: excellent ? tier.tier : tier.tier === "Épico" || tier.tier === "Legendario" ? "Raro" : tier.tier,
    name: `${excellent ? "Excellent " : ""}${cleanName(piece.name)} +${level}`,
    options,
  };
}

// ---------------------------------------------------------------- jugador

async function catalog(_req: Request, sql: Sql) {
  await ensureTables(sql);
  return { lines: LINES, items: await listItems(sql) };
}

async function myShop(req: Request, sql: Sql) {
  const s = session(req);
  await ensureTables(sql);
  const [account] = await sql`select "WCoinC" as wcoinc from data."Account" where "Id" = ${s.accountId}`;
  const today = await sql`select item_id, qty from barrio.cash_daily where account = ${s.accountId} and day = current_date`;
  const bought = new Map(today.map(r => [r.item_id, r.qty]));
  const items = (await listItems(sql)).map(it => ({ ...it, boughtToday: bought.get(it.id) ?? 0 }));
  return { wcoinc: account?.wcoinc ?? 0, lines: LINES, items };
}

async function buy(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const id = intIn(b.id, 1, 1_000_000);
  const qty = intIn(b.qty ?? 1, 1, MAX_QTY);
  if (!id || !qty) throw new PanelError(400, "Elige un item y una cantidad válida.");
  await ensureTables(sql);

  return offlineTransaction(sql, s.login, async tx => {
    const [item] = await tx`select * from barrio.cash_shop where id = ${id} and enabled`;
    if (!item) throw new PanelError(404, "Ese item ya no está en el Cash Shop.");
    // Bloquea la fila del dia: dos compras a la vez no se saltan el limite.
    await tx`
      insert into barrio.cash_daily (account, item_id, qty) values (${s.accountId}, ${id}, 0)
      on conflict do nothing`;
    const [day] = await tx`
      select qty from barrio.cash_daily where account = ${s.accountId} and item_id = ${id} and day = current_date for update`;
    const left = item.daily_cap - (day?.qty ?? 0);
    if (left <= 0) throw new PanelError(400, `Ya compraste el máximo de hoy de ${item.label} (${item.daily_cap}). Vuelve mañana.`);
    if (qty > left) throw new PanelError(400, `Hoy solo puedes comprar ${left} más de ${item.label}.`);

    const vault = await vaultOf(tx, s.accountId);
    const total = item.price * qty;
    const [account] = await tx`select "WCoinC" as wcoinc from data."Account" where "Id" = ${s.accountId}`;
    if (!account) throw new PanelError(404, "No se encontró la cuenta.");
    if (account.wcoinc < total) throw new PanelError(400, `Te faltan ${total - account.wcoinc} WCoinC (tienes ${account.wcoinc}, cuesta ${total}).`);
    const used = await vaultUsage(tx, vault);

    const results: { tier: string; name: string; options: string[] }[] = [];
    if (item.line === "cofre") {
      for (let i = 0; i < qty; i++) results.push(await openChest(tx, vault, used));
    } else {
      const [def] = await tx`
        select "Id"::text as def, "Width" as w, "Height" as h, "Durability" as durability
        from config."ItemDefinition" where "Group" = ${item.item_group} and "Number" = ${item.item_number} limit 1`;
      if (!def) throw new PanelError(500, `${item.label} no existe en la configuración del juego.`);
      for (let i = 0; i < qty; i++) {
        const slot = freeSlot(used, def.w || 1, def.h || 1);
        if (slot < 0) {
          throw new PanelError(409, i === 0
            ? `No hay espacio en tu baúl para ${item.label}. Saca algo del baúl y vuelve a intentar.`
            : `Solo caben ${i} en tu baúl. Compra menos o saca algo del baúl.`);
        }
        occupy(used, slot, def.w || 1, def.h || 1);
        await tx`
          insert into data."Item" ("Id", "DefinitionId", "Durability", "HasSkill", "ItemSlot", "ItemStorageId", "Level", "PetExperience", "SocketCount")
          values (gen_random_uuid(), ${def.def}, ${def.durability}, false, ${slot}, ${vault}, ${item.item_level}, 0, 0)`;
      }
    }

    await tx`update data."Account" set "WCoinC" = "WCoinC" - ${total} where "Id" = ${s.accountId}`;
    await tx`update barrio.cash_daily set qty = qty + ${qty} where account = ${s.accountId} and item_id = ${id} and day = current_date`;
    const detail = results.length
      ? results.map(r => `${r.name}${r.options.length ? ` [${r.options.join(", ")}]` : ""}`).join("; ")
      : `${qty} x ${item.label}`;
    await tx`insert into barrio.cash_log (account, item_id, detail, price) values (${s.accountId}, ${id}, ${detail}, ${total})`;
    const restan = account.wcoinc - total;
    return {
      ok: true,
      results,
      message: results.length
        ? `¡Abriste ${qty === 1 ? "el cofre" : `${qty} cofres`}! Ya está en tu baúl. Te quedan ${restan} WCoinC.`
        : `¡Listo! ${qty} x ${item.label} ya ${qty === 1 ? "está" : "están"} en tu baúl. Te quedan ${restan} WCoinC.`,
    };
  });
}

// ---------------------------------------------------------------- admin

export async function adminCashShop(sql: Sql) {
  await ensureTables(sql);
  const items = await sql`
    select id, line, label, price, daily_cap as "dailyCap", item_level as level, enabled
    from barrio.cash_shop order by sort, id`;
  const recent = await sql`
    select l.detail, l.price, l.at, a."LoginName" as login
    from barrio.cash_log l left join data."Account" a on a."Id" = l.account
    order by l.at desc limit 30`;
  return { lines: LINES, items, recent };
}

export async function adminSaveCashShop(req: Request, sql: Sql) {
  const b = await body(req, 64 * 1024);
  if (!Array.isArray(b.items)) throw new PanelError(400, "Faltan los items.");
  await ensureTables(sql);
  await sql.begin(async tx => {
    for (const raw of b.items as Record<string, unknown>[]) {
      const id = intIn(raw.id, 1, 1_000_000);
      const price = intIn(raw.price, 1, 1_000_000);
      const cap = intIn(raw.dailyCap, 1, 1000);
      if (!id || !price || !cap) throw new PanelError(400, "Precio y límite diario deben ser números enteros mayores que 0.");
      await tx`
        update barrio.cash_shop set price = ${price}, daily_cap = ${cap}, enabled = ${raw.enabled === true}
        where id = ${id}`;
    }
  });
  return { ok: true, message: "Cash Shop guardado." };
}

export async function handleCashShop(req: Request, url: URL, cors: Record<string, string>, sql: Sql): Promise<Response | null> {
  const routes: Record<string, [string, (req: Request, sql: Sql) => Promise<unknown>]> = {
    "/cashshop": ["GET", catalog],
    "/me/cashshop": ["GET", myShop],
    "/me/cashshop/comprar": ["POST", buy],
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
