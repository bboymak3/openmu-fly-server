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
import { PanelError, body, json, requireOffline, session } from "./panel";
import { economy, ensureSettings, freeSlot, occupy, saveEconomy, vaultOf, vaultUsage } from "./economia";

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

function itemLabel(r: { name: string; level: number; options?: number; ancient?: boolean; skill?: boolean }): string {
  const parts = [`${r.name}${r.level ? ` +${r.level}` : ""}`];
  if (r.ancient) parts.push("Ancient");
  if (r.skill) parts.push("Skill");
  if (r.options) parts.push(`${r.options} ${r.options === 1 ? "opcion" : "opciones"}`);
  return parts.join(" · ");
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
    select l.id, l.label, l.price, l.listed_at as "listedAt", l.seller::text as seller
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
  const pending = mine.filter(m => m.state === "sold" && !m.paid).reduce((sum, m) => sum + (m.proceeds ?? 0), 0);
  return {
    wcoinp: account?.wcoinp ?? 0,
    tax,
    pending,
    listings: listings.map(l => ({
      id: l.id, label: l.label, price: l.price, listedAt: l.listedAt,
      seller: names.get(l.seller), mine: l.seller === s.accountId,
    })),
    mine,
    vault: vault.map(v => ({ id: v.id, label: itemLabel(v) })),
  };
}

async function sell(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const itemId = typeof b.item === "string" && /^[0-9a-f-]{36}$/i.test(b.item) ? b.item : null;
  const price = intIn(b.price, 1, MAX_PRICE);
  if (!itemId || !price) throw new PanelError(400, "Elige un item de tu baul y un precio en WCoinP.");
  const escrow = await escrowStorage(sql);
  await requireOffline(s.login);
  return sql.begin(async tx => {
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
  await requireOffline(s.login);
  return sql.begin(async tx => {
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
    return { ok: true, message: `¡Comprado! ${listing.label} ya esta en tu baul. Te quedan ${account.p - listing.price} WCoinP.` };
  });
}

async function withdraw(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const id = intIn(b.id, 1, 100_000_000);
  if (!id) throw new PanelError(400, "Falta la publicacion.");
  await ensureTables(sql);
  await requireOffline(s.login);
  return sql.begin(async tx => {
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
  await requireOffline(s.login);
  return sql.begin(async tx => {
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
