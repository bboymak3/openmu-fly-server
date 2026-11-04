// BarrioMU: piezas que comparten la tienda (tienda.ts) y el mercado (mercado.ts).
//
// - Ajustes de la economia en barrio.settings, que el admin edita: cuantas WCoinP da cada
//   WCoinC al cambiar, y el impuesto del mercado.
// - El baul de una cuenta: crearlo si no tiene y buscar huecos (8 x 15, como en Season 6).

import type { Sql, TransactionSql } from "postgres";
import { PanelError } from "./panel";

export const VAULT_COLUMNS = 8;
export const VAULT_ROWS = 15;

export type Economy = { rate: number; tax: number };
export const ECONOMY_DEFAULTS: Economy = { rate: 2, tax: 25 };

let ready: Promise<void> | null = null;

export function ensureSettings(sql: Sql): Promise<void> {
  ready ??= (async () => {
    await sql`create schema if not exists barrio`;
    await sql`create table if not exists barrio.settings (key text primary key, value text not null)`;
  })().catch(error => {
    ready = null;
    throw error;
  });
  return ready;
}

export async function economy(sql: Sql | TransactionSql): Promise<Economy> {
  await ensureSettings(sql as Sql);
  const rows = await sql`select key, value from barrio.settings where key in ('rate_c_to_p', 'market_tax')`;
  const get = (k: string) => rows.find(r => r.key === k)?.value;
  const rate = Number(get("rate_c_to_p"));
  const tax = Number(get("market_tax"));
  return {
    rate: Number.isInteger(rate) && rate >= 1 && rate <= 100 ? rate : ECONOMY_DEFAULTS.rate,
    tax: Number.isInteger(tax) && tax >= 0 && tax <= 90 ? tax : ECONOMY_DEFAULTS.tax,
  };
}

export async function saveEconomy(sql: Sql, rate: number, tax: number): Promise<void> {
  await ensureSettings(sql);
  for (const [key, value] of [["rate_c_to_p", rate], ["market_tax", tax]] as const) {
    await sql`insert into barrio.settings (key, value) values (${key}, ${String(value)})
              on conflict (key) do update set value = excluded.value`;
  }
}

/** El baul de la cuenta (lo crea si no tiene). Bloquea la fila de la cuenta. */
export async function vaultOf(tx: Sql | TransactionSql, accountId: string): Promise<string> {
  const [account] = await tx`select "VaultId"::text as vault from data."Account" where "Id" = ${accountId} for update`;
  if (!account) throw new PanelError(404, "No se encontro la cuenta.");
  if (account.vault) return account.vault as string;
  const [created] = await tx`insert into data."ItemStorage" ("Id", "Money") values (gen_random_uuid(), 0) returning "Id"::text as id`;
  await tx`update data."Account" set "VaultId" = ${created.id} where "Id" = ${accountId}`;
  return created.id as string;
}

/** Las casillas ocupadas del baul. */
export async function vaultUsage(tx: Sql | TransactionSql, vault: string): Promise<boolean[]> {
  const items = await tx`
    select i."ItemSlot" as slot, coalesce(d."Width", 1) as w, coalesce(d."Height", 1) as h
    from data."Item" i left join config."ItemDefinition" d on d."Id" = i."DefinitionId"
    where i."ItemStorageId" = ${vault}`;
  const used = new Array<boolean>(VAULT_COLUMNS * VAULT_ROWS).fill(false);
  for (const it of items) occupy(used, it.slot, it.w, it.h);
  return used;
}

/** El primer hueco del baul para un item de w x h, o -1. */
export function freeSlot(used: boolean[], w: number, h: number): number {
  for (let row = 0; row + h <= VAULT_ROWS; row++) {
    for (let col = 0; col + w <= VAULT_COLUMNS; col++) {
      let fits = true;
      for (let y = row; y < row + h && fits; y++) {
        for (let x = col; x < col + w; x++) {
          if (used[y * VAULT_COLUMNS + x]) {
            fits = false;
            break;
          }
        }
      }
      if (fits) return row * VAULT_COLUMNS + col;
    }
  }
  return -1;
}

export function occupy(used: boolean[], slot: number, w: number, h: number): void {
  const row = Math.floor(slot / VAULT_COLUMNS);
  const col = slot % VAULT_COLUMNS;
  for (let y = row; y < row + h && y < VAULT_ROWS; y++) {
    for (let x = col; x < col + w && x < VAULT_COLUMNS; x++) used[y * VAULT_COLUMNS + x] = true;
  }
}
