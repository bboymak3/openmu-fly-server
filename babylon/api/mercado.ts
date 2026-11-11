// BarrioMU: "La Plaza", el mercado entre jugadores, con WCoinP.
//
// - Vender: el jugador elige un item de su baul y le pone precio en WCoinP. El item sale del
//   baul a un baul de custodia del servidor (un ItemStorage que no es de ninguna cuenta, asi
//   OpenMU no lo carga) y queda publicado. El item es la misma fila de data."Item": conserva
//   nivel, opciones, excelentes y ancient.
// - Comprar: otro jugador paga el precio en WCoinP y el item va a su baul.
// - El vendedor cobra el precio menos el impuesto (barrio.settings market_tax, 25% por defecto);
//   el impuesto sale del juego.
// - Retirar: si nadie lo compro, vuelve al baul del vendedor.
// Todo con la cuenta fuera del juego (OpenMU guarda en memoria al jugador conectado) y en
// transacciones.

import type { Sql } from "postgres";
import { PanelError, body, json, offlineTransaction, requireOffline, session } from "./panel";
import { notifyAccount } from "./whatsapp";
import { cleanName, economy, ensureSettings, freeSlot, occupy, saveEconomy, vaultOf, vaultUsage } from "./economia";

const MAX_PRICE = 100_000_000;
const MAX_ACTIVE_PER_SELLER = 20;

let ready: Promise<void> | null = null;

function ensureTables(sql: Sql): Promise<void> {
  ready ??= (async () => {
    await ensureSettings(sql);
    await sql`
      create table if not exists barrio.market_listing (
        id serial primary key,
        seller uuid not null,
        item_id uuid not null,
        label text not null,
        price int not null,
        state text not null default 'active',
        buyer uuid,
        tax int,
        proceeds int,
        paid boolean not null default false,
        listed_at timestamptz not null default now(),
        closed_at timestamptz)`;
    await sql`create index if not exists market_state on barrio.market_listing (state)`;
    await sql`create index if not exists market_seller on barrio.market_listing (seller)`;
    // Ventas publicadas antes de limpiar los nombres de OpenMU (con sus traducciones pegadas).
    for (const row of await sql`select id, label from barrio.market_listing where label like '%||%' or label like '% · %'`) {
      await sql`update barrio.market_listing set label = ${cleanName(row.label).split(" · ")[0]} where id = ${row.id}`;
    }
  })().catch(error => {
    ready = null;
    throw error;
  });
  return ready;
}

/** El baul de custodia del mercado: un ItemStorage propio (lo crea la primera vez). */
async function escrowStorage(sql: Sql): Promise<string> {
  await ensureTables(sql);
  const [row] = await sql`select value from barrio.settings where key = 'market_escrow'`;
  if (row) return row.value as string;
  return sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext('market_escrow'))`;
    const [again] = await tx`select value from barrio.settings where key = 'market_escrow'`;
    if (again) return again.value as string;
    const [created] = await tx`insert into data."ItemStorage" ("Id", "Money") values (gen_random_uuid(), 0) returning "Id"::text as id`;
    await tx`insert into barrio.settings (key, value) values ('market_escrow', ${created.id})`;
    return created.id as string;
  });
}

const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** Como se ve un item: nombre, nivel y cuantas opciones tiene. */
const ITEM_VIEW = (sql: Sql) => sql`
  d."Name" as name, d."Group" as "group", d."Number" as number, i."Level" as level,
  i."Durability" as durability, i."HasSkill" as skill,
  (select count(*)::int from data."ItemOptionLink" o where o."ItemId" = i."Id") as options,
  exists (select 1 from data."ItemItemOfItemSet" a where a."ItemId" = i."Id") as ancient`;

/** El nombre que se publica: solo el nombre del item y su +nivel (lo demas va en la ficha). */
function itemLabel(r: { name: string; level: number }): string {
  return `${cleanName(r.name)}${r.level ? ` +${r.level}` : ""}`;
}

// ---------------------------------------------------------------- ficha del item

/** Que es cada grupo de items de MU (para la ficha). */
const KINDS: Record<number, string> = {
  0: "Espada", 1: "Hacha", 2: "Maza / Cetro", 3: "Lanza", 4: "Arco / Ballesta", 5: "Bastón",
  6: "Escudo", 7: "Casco", 8: "Armadura", 9: "Pantalón", 10: "Guantes", 11: "Botas",
  12: "Alas / Joya", 13: "Accesorio / Mascota", 14: "Joya / Consumible", 15: "Pergamino",
};
const EXC_ATTACK = ["Maná al matar +maná/8", "Vida al matar +vida/8", "Velocidad de ataque +7", "Daño +2%", "Daño +nivel/20", "Daño excelente +10%"];
const EXC_DEFENSE = ["Zen +40%", "Defensa +10%", "Refleja daño +5%", "Reduce daño +4%", "Maná máximo +4%", "Vida máxima +4%"];

export interface ItemInfo {
  group: number; number: number; level: number; durability: number; skill: boolean;
  kind: string; excellent: boolean; ancient: boolean; options: string[];
}

/** La ficha de cada item (tipo, nivel, skill, suerte, opcion, excelentes, ancient), por id de item. */
async function itemInfo(sql: Sql, ids: string[]): Promise<Map<string, ItemInfo>> {
  const out = new Map<string, ItemInfo>();
  if (!ids.length) return out;
  const rows = await sql`
    select i."Id"::text as id, d."Group" as "group", d."Number" as number, i."Level" as level,
           i."Durability" as durability, i."HasSkill" as skill,
           exists (select 1 from data."ItemItemOfItemSet" a where a."ItemId" = i."Id") as ancient
    from data."Item" i join config."ItemDefinition" d on d."Id" = i."DefinitionId"
    where i."Id" = any(${ids}::uuid[])`;
  let opts: { item: string; type: string; number: number; level: number }[] = [];
  try {
    opts = await sql`
      select l."ItemId"::text as item, coalesce(t."Name", '') as type, coalesce(o."Number", 0) as number, coalesce(l."Level", 0) as level
      from data."ItemOptionLink" l
      left join config."IncreasableItemOption" o on o."Id" = l."ItemOptionId"
      left join config."ItemOptionType" t on t."Id" = o."OptionTypeId"
      where l."ItemId" = any(${ids}::uuid[])
      order by l."ItemId", o."Number"`;
  } catch (error) {
    console.error("ficha del item: opciones", error);
  }
  for (const r of rows) {
    const weapon = r.group <= 5;
    const options: string[] = [];
    let excellent = false;
    if (r.skill) options.push("Skill del arma");
    for (const o of opts.filter(o => o.item === r.id)) {
      const type = o.type.toLowerCase();
      if (type.startsWith("excellent")) {
        excellent = true;
        options.push((weapon ? EXC_ATTACK : EXC_DEFENSE)[o.number - 1] ?? `Excelente #${o.number}`);
      } else if (type.includes("luck")) options.push("Suerte (+5% crítico, +25% éxito con joyas)");
      else if (type === "option" || type.includes("additional")) options.push(`Opción adicional +${(o.level || 1) * 4}`);
      else if (type.includes("harmony")) options.push(`Opción Harmony (nivel ${o.level || 1})`);
      else if (type.includes("guardian")) options.push("Opción 380 (Guardian)");
      else if (type.includes("socket")) options.push("Socket");
      else if (type.includes("wing")) options.push("Opción de alas");
      else if (type.includes("ancient")) options.push("Opción ancient");
      else if (type) options.push(`${o.type}${o.level > 1 ? ` (nivel ${o.level})` : ""}`);
    }
    out.set(r.id, {
      group: r.group, number: r.number, level: r.level, durability: Math.round(Number(r.durability) || 0), skill: r.skill,
      kind: KINDS[r.group] ?? "Item", excellent, ancient: r.ancient, options,
    });
  }
  return out;
}

async function publicName(sql: Sql, accountId: string): Promise<string> {
  const [row] = await sql`
    select c."Name" as name from data."Character" c where c."AccountId" = ${accountId}
    order by c."CharacterSlot" limit 1`;
  return row?.name ?? "Un jugador";
}

// ---------------------------------------------------------------- jugador

async function market(req: Request, sql: Sql) {
  const s = session(req);
  await ensureTables(sql);
  const { tax } = await economy(sql);
  const [account] = await sql`select "WCoinP" as wcoinp, "VaultId"::text as vault from data."Account" where "Id" = ${s.accountId}`;
  const listings = await sql`
    select l.id, l.label, l.price, l.listed_at as "listedAt", l.seller::text as seller, l.item_id::text as item
    from barrio.market_listing l where l.state = 'active'
    order by l.listed_at desc limit 200`;
  const names = new Map<string, string>();
  for (const l of listings) if (!names.has(l.seller)) names.set(l.seller, await publicName(sql, l.seller));
  const mine = await sql`
    select id, label, price, state, tax, proceeds, paid, listed_at as "listedAt", closed_at as "closedAt"
    from barrio.market_listing where seller = ${s.accountId}
    order by (state = 'active') desc, listed_at desc limit 50`;
  const vault = account?.vault
    ? await sql`
        select i."Id"::text as id, i."ItemSlot" as slot, ${ITEM_VIEW(sql)}
        from data."Item" i join config."ItemDefinition" d on d."Id" = i."DefinitionId"
        where i."ItemStorageId" = ${account.vault}
        order by i."ItemSlot"`
    : [];
  const info = await itemInfo(sql, [...listings.map(l => l.item as string), ...vault.map(v => v.id as string)]);
  const pending = mine.filter(m => m.state === "sold" && !m.paid).reduce((sum, m) => sum + (m.proceeds ?? 0), 0);
  return {
    wcoinp: account?.wcoinp ?? 0,
    tax,
    pending,
    listings: listings.map(l => ({
      id: l.id, label: l.label, price: l.price, listedAt: l.listedAt,
      seller: names.get(l.seller), mine: l.seller === s.accountId, info: info.get(l.item) ?? null,
    })),
    mine,
    vault: vault.map(v => ({ id: v.id, label: itemLabel(v), info: info.get(v.id) ?? null })),
  };
}

async function sell(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const itemId = typeof b.item === "string" && /^[0-9a-f-]{36}$/i.test(b.item) ? b.item : null;
  const price = intIn(b.price, 1, MAX_PRICE);
  if (!itemId || !price) throw new PanelError(400, "Elige un item de tu baul y un precio en WCoinP.");
  const escrow = await escrowStorage(sql);
  return offlineTransaction(sql, s.login, async tx => {
    const vault = await vaultOf(tx, s.accountId);
    const [{ n }] = await tx`select count(*)::int as n from barrio.market_listing where seller = ${s.accountId} and state = 'active'`;
    if (n >= MAX_ACTIVE_PER_SELLER) throw new PanelError(400, `Ya tienes ${MAX_ACTIVE_PER_SELLER} items a la venta. Espera a que se vendan o retira alguno.`);
    const [item] = await tx`
      select i."Id"::text as id, ${ITEM_VIEW(tx as unknown as Sql)}
      from data."Item" i join config."ItemDefinition" d on d."Id" = i."DefinitionId"
      where i."Id" = ${itemId} and i."ItemStorageId" = ${vault}
      for update of i`;
    if (!item) throw new PanelError(404, "Ese item no esta en tu baul. Ponlo en el baul y vuelve a intentar.");
    const label = itemLabel(item);
    await tx`update data."Item" set "ItemStorageId" = ${escrow}, "ItemSlot" = 0 where "Id" = ${itemId}`;
    await tx`insert into barrio.market_listing (seller, item_id, label, price) values (${s.accountId}, ${itemId}, ${label}, ${price})`;
    return { ok: true, message: `Publicado: ${label} por ${price.toLocaleString("es")} WCoinP.` };
  });
}

/** Pasa un item de la custodia a un baul, en el primer hueco. */
async function deliver(tx: Sql, vault: string, itemId: string, label: string): Promise<void> {
  const [size] = await tx`
    select coalesce(d."Width", 1) as w, coalesce(d."Height", 1) as h
    from data."Item" i left join config."ItemDefinition" d on d."Id" = i."DefinitionId" where i."Id" = ${itemId}`;
  if (!size) throw new PanelError(500, "No se encontro el item del mercado. Avisa al staff.");
  const used = await vaultUsage(tx, vault);
  const slot = freeSlot(used, size.w, size.h);
  if (slot < 0) throw new PanelError(409, `No hay espacio en tu baul para ${label}. Saca algo del baul y vuelve a intentar.`);
  occupy(used, slot, size.w, size.h);
  await tx`update data."Item" set "ItemStorageId" = ${vault}, "ItemSlot" = ${slot} where "Id" = ${itemId}`;
}

async function buy(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const id = intIn(b.id, 1, 100_000_000);
  if (!id) throw new PanelError(400, "Falta la publicacion.");
  await ensureTables(sql);
  const { tax } = await economy(sql);
  let sale: { seller: string; label: string; price: number; taxed: number } | null = null;
  const result = await offlineTransaction(sql, s.login, async tx => {
    const [listing] = await tx`select * from barrio.market_listing where id = ${id} for update`;
    if (!listing || listing.state !== "active") throw new PanelError(409, "Ese item ya no esta a la venta.");
    if (listing.seller === s.accountId) throw new PanelError(400, "Es tu propio item: para sacarlo usa Retirar.");
    const vault = await vaultOf(tx as unknown as Sql, s.accountId);
    const [account] = await tx`select "WCoinP" as p from data."Account" where "Id" = ${s.accountId}`;
    if (account.p < listing.price) throw new PanelError(400, `Te faltan ${listing.price - account.p} WCoinP (tienes ${account.p}).`);
    await deliver(tx as unknown as Sql, vault, listing.item_id, listing.label);
    const taxed = Math.floor((listing.price * tax) / 100);
    await tx`update data."Account" set "WCoinP" = "WCoinP" - ${listing.price} where "Id" = ${s.accountId}`;
    await tx`
      update barrio.market_listing set state = 'sold', buyer = ${s.accountId}, tax = ${taxed},
             proceeds = ${listing.price - taxed}, closed_at = now()
      where id = ${id}`;
    sale = { seller: String(listing.seller), label: listing.label, price: listing.price, taxed };
    return { ok: true, message: `¡Comprado! ${listing.label} ya esta en tu baul. Te quedan ${account.p - listing.price} WCoinP.` };
  });
  // Ya guardado: aviso por WhatsApp al vendedor, si lo tiene vinculado (sin esperar).
  const done = sale as { seller: string; label: string; price: number; taxed: number } | null;
  if (done) {
    void notifyAccount(
      sql,
      { accountId: done.seller },
      `💰 ¡Vendiste *${done.label}* en La Plaza por ${done.price} WCoinP! Recibes ${done.price - done.taxed} (impuesto ${done.taxed}). Cóbralo en Mi cuenta → La Plaza → Mis ventas.`,
    );
  }
  return result;
}

async function withdraw(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const id = intIn(b.id, 1, 100_000_000);
  if (!id) throw new PanelError(400, "Falta la publicacion.");
  await ensureTables(sql);
  return offlineTransaction(sql, s.login, async tx => {
    const [listing] = await tx`select * from barrio.market_listing where id = ${id} and seller = ${s.accountId} for update`;
    if (!listing || listing.state !== "active") throw new PanelError(409, "Esa publicacion ya no esta activa.");
    const vault = await vaultOf(tx as unknown as Sql, s.accountId);
    await deliver(tx as unknown as Sql, vault, listing.item_id, listing.label);
    await tx`update barrio.market_listing set state = 'cancelled', closed_at = now() where id = ${id}`;
    return { ok: true, message: `Retirado: ${listing.label} volvio a tu baul.` };
  });
}

async function collect(req: Request, sql: Sql) {
  const s = session(req);
  await ensureTables(sql);
  return offlineTransaction(sql, s.login, async tx => {
    await tx`select 1 from data."Account" where "Id" = ${s.accountId} for update`;
    const rows = await tx`
      update barrio.market_listing set paid = true
      where seller = ${s.accountId} and state = 'sold' and not paid
      returning proceeds`;
    const total = rows.reduce((sum, r) => sum + (r.proceeds ?? 0), 0);
    if (!total) throw new PanelError(400, "No tienes ventas por cobrar.");
    const [account] = await tx`
      update data."Account" set "WCoinP" = "WCoinP" + ${total} where "Id" = ${s.accountId} returning "WCoinP" as p`;
    return { ok: true, message: `Cobraste ${total.toLocaleString("es")} WCoinP de ${rows.length} ${rows.length === 1 ? "venta" : "ventas"}. Ahora tienes ${account.p} WCoinP.` };
  });
}

// ---------------------------------------------------------------- admin

export async function adminMarket(sql: Sql) {
  await ensureTables(sql);
  const eco = await economy(sql);
  const [stats] = await sql`
    select count(*) filter (where state = 'active')::int as active,
           count(*) filter (where state = 'sold')::int as sold,
           coalesce(sum(tax) filter (where state = 'sold'), 0)::bigint as taxes,
           coalesce(sum(price) filter (where state = 'sold'), 0)::bigint as volume
    from barrio.market_listing`;
  const recent = await sql`
    select l.label, l.price, l.tax, l.state, l.closed_at as at,
           s."LoginName" as seller, b."LoginName" as buyer
    from barrio.market_listing l
    left join data."Account" s on s."Id" = l.seller
    left join data."Account" b on b."Id" = l.buyer
    where l.state = 'sold' order by l.closed_at desc limit 15`;
  return { ...eco, stats: { ...stats, taxes: Number(stats.taxes), volume: Number(stats.volume) }, recent };
}

export async function adminSaveEconomy(req: Request, sql: Sql) {
  const b = await body(req);
  const rate = intIn(b.rate, 1, 100);
  const tax = intIn(b.tax, 0, 90);
  if (!rate || tax === null) throw new PanelError(400, "La tasa va de 1 a 100 y el impuesto de 0 a 90%.");
  await saveEconomy(sql, rate, tax);
  return { ok: true, message: `Listo: 1 WCoinC = ${rate} WCoinP, impuesto de la Plaza ${tax}%.` };
}

/** Rutas del mercado del jugador; null si la ruta no es de aqui. */
export async function handleMercado(req: Request, url: URL, cors: Record<string, string>, sql: Sql): Promise<Response | null> {
  const routes: Record<string, [string, (req: Request, sql: Sql) => Promise<unknown>]> = {
    "/me/mercado": ["GET", market],
    "/me/mercado/vender": ["POST", sell],
    "/me/mercado/comprar": ["POST", buy],
    "/me/mercado/retirar": ["POST", withdraw],
    "/me/mercado/cobrar": ["POST", collect],
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
