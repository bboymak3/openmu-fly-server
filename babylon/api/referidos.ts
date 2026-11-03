// BarrioMU: sistema de referidos.
//
// - Cada cuenta tiene un codigo (barrio.referral_code) y su link
//   https://barriomu.makeseo.app/?ref=CODIGO.
// - El invitado pone el codigo en "Mi cuenta" (la landing lo recuerda si llego con el link).
//   Solo cuentas nuevas: de menos de NEW_ACCOUNT_DAYS dias y sin personaje en la meta todavia.
//   Desde una misma casa (IP) cuentan como maximo HOUSE_LIMIT cuentas invitadas.
// - Un invitado cuenta cuando un personaje suyo llega a nivel GOAL_LEVEL (o hace un reset).
//   Cada invitador suma como maximo MONTH_LIMIT invitados por mes; los que pasen del tope
//   quedan esperando y cuentan el mes siguiente.
// - Los premios se piden desde la web: van al baul de la cuenta, que debe estar vacio,
//   con la cuenta desconectada (igual que el resto del panel).
//
// Las tablas viven en el esquema "barrio" de la base de OpenMU (OpenMU no lo toca).

import type { Sql } from "postgres";
import { createHash } from "node:crypto";
import { PanelError, body, clientIp, json, requireOffline, session } from "./panel";

const LEVEL = "560931ad-0901-4342-b7f4-fd2e2fcc0563";
const RESETS = "89a891a7-f9f9-4ab5-af36-12056e53a5f7";
const HIDDEN_ACCOUNT_STATES = [2, 3, 4, 5];

export const GOAL_LEVEL = 200;
export const HOUSE_LIMIT = 8;
export const MONTH_LIMIT = 10;
export const NEW_ACCOUNT_DAYS = 30;
const SITE = process.env.SITE_URL ?? "https://barriomu.makeseo.app";
const IP_SALT = process.env.REFERRAL_SALT ?? "barriomu-referidos";

type Item = { group: number; number: number; count: number; name: string };
type Reward = { key: string; at: number; label: string; items: Item[]; zen: number; wings?: 1 | 3 };

const BLESS = { group: 14, number: 13, name: "Jewel of Bless" };
const SOUL = { group: 14, number: 14, name: "Jewel of Soul" };
const CHAOS = { group: 12, number: 15, name: "Jewel of Chaos" };

/** Premios del que invita, por cantidad de invitados que llegaron a la meta. */
export const MILESTONES: Reward[] = [
  { key: "m1", at: 1, label: "5 Bless + 5 Soul", items: [{ ...BLESS, count: 5 }, { ...SOUL, count: 5 }], zen: 0 },
  { key: "m3", at: 3, label: "10 Chaos + 10.000.000 de zen", items: [{ ...CHAOS, count: 10 }], zen: 10_000_000 },
  { key: "m5", at: 5, label: "Alas de 1ra (de la clase que elijas)", items: [], zen: 0, wings: 1 },
  { key: "m10", at: 10, label: "Alas de 3ra (de la clase que elijas)", items: [], zen: 0, wings: 3 },
];

/** Premio del invitado cuando llega a la meta. */
export const WELCOME: Reward = {
  key: "bienvenida",
  at: 0,
  label: "3 Bless + 3 Soul + 5.000.000 de zen",
  items: [{ ...BLESS, count: 3 }, { ...SOUL, count: 3 }],
  zen: 5_000_000,
};

/** Alas (grupo 12) por familia de clase: [1ra, 3ra]. */
const WINGS: Record<string, { first: number; third: number; firstName: string; thirdName: string }> = {
  dw: { first: 1, third: 37, firstName: "Wings of Heaven", thirdName: "Wing of Eternal" },
  dk: { first: 2, third: 36, firstName: "Wings of Satan", thirdName: "Wing of Storm" },
  elf: { first: 0, third: 38, firstName: "Wings of Elf", thirdName: "Wing of Illusion" },
  mg: { first: 2, third: 39, firstName: "Wings of Satan", thirdName: "Wing of Ruin" },
  dl: { first: 30, third: 40, firstName: "Cape of Lord", thirdName: "Cape of Emperor" },
  sum: { first: 41, third: 43, firstName: "Wings of Curse", thirdName: "Wing of Dimension" },
  rf: { first: 49, third: 50, firstName: "Cape of Fighter", thirdName: "Cape of Overrule" },
};

function familyOf(classNumber: number): keyof typeof WINGS | null {
  if (classNumber >= 0 && classNumber <= 3) return "dw";
  if (classNumber >= 4 && classNumber <= 7) return "dk";
  if (classNumber >= 8 && classNumber <= 11) return "elf";
  if (classNumber >= 12 && classNumber <= 15) return "mg";
  if (classNumber >= 16 && classNumber <= 19) return "dl";
  if (classNumber >= 20 && classNumber <= 23) return "sum";
  if (classNumber >= 24 && classNumber <= 27) return "rf";
  return null;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[A-Z2-9]{6}$/;

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function ipHash(ip: string): string {
  return createHash("sha256").update(IP_SALT + "|" + ip).digest("hex").slice(0, 32);
}

const normalizeCode = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

let ready: Promise<void> | null = null;

/** Crea las tablas la primera vez. */
function ensureTables(sql: Sql): Promise<void> {
  ready ??= (async () => {
    await sql`create schema if not exists barrio`;
    await sql`
      create table if not exists barrio.referral_code (
        account uuid primary key,
        code text not null unique,
        created_at timestamptz not null default now())`;
    await sql`
      create table if not exists barrio.referral (
        invitee uuid primary key,
        inviter uuid not null,
        ip_hash text not null,
        linked_at timestamptz not null default now(),
        qualified_at timestamptz,
        counted_at timestamptz)`;
    await sql`create index if not exists referral_inviter on barrio.referral (inviter)`;
    await sql`create index if not exists referral_ip on barrio.referral (ip_hash)`;
    await sql`
      create table if not exists barrio.referral_claim (
        account uuid not null,
        reward text not null,
        detail text,
        claimed_at timestamptz not null default now(),
        primary key (account, reward))`;
  })().catch(error => {
    ready = null;
    throw error;
  });
  return ready;
}

async function codeOf(sql: Sql, accountId: string): Promise<string> {
  const [row] = await sql`select code from barrio.referral_code where account = ${accountId}`;
  if (row) return row.code;
  for (let i = 0; i < 5; i++) {
    const [created] = await sql`
      insert into barrio.referral_code (account, code) values (${accountId}, ${newCode()})
      on conflict do nothing returning code`;
    if (created) return created.code;
    const [again] = await sql`select code from barrio.referral_code where account = ${accountId}`;
    if (again) return again.code;
  }
  throw new PanelError(503, "No se pudo crear tu codigo. Intenta en un rato.");
}

/** Lo mas alto que llego la cuenta: nivel y resets del mejor personaje. */
async function progressOf(sql: Sql, accountId: string) {
  const [row] = await sql`
    select coalesce(max(lv."Value"), 0)::int as level, coalesce(max(rs."Value"), 0)::int as resets
    from data."Character" c
    left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
    left join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = ${RESETS}
    where c."AccountId" = ${accountId}`;
  return { level: row?.level ?? 0, resets: row?.resets ?? 0 };
}

const reachedGoal = (p: { level: number; resets: number }) => p.level >= GOAL_LEVEL || p.resets > 0;

/**
 * Pone al dia los invitados: marca los que llegaron a la meta y los cuenta para su
 * invitador mientras no pase de MONTH_LIMIT en el mes. Los demas esperan al mes siguiente.
 */
export async function refreshReferrals(sql: Sql, inviter?: string): Promise<void> {
  await ensureTables(sql);
  // 1. Los que llegaron a la meta.
  await sql`
    update barrio.referral r set qualified_at = now()
    where r.qualified_at is null
      ${inviter ? sql`and r.inviter = ${inviter}` : sql``}
      and exists (
        select 1 from data."Character" c
        left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
        left join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = ${RESETS}
        where c."AccountId" = r.invitee and (coalesce(lv."Value", 0) >= ${GOAL_LEVEL} or coalesce(rs."Value", 0) > 0))`;
  // 2. Contarlos, con el tope del mes (en UTC), del mas antiguo al mas nuevo.
  await sql`
    with mes as (
      select inviter, count(*)::int as n from barrio.referral
      where counted_at >= date_trunc('month', now()) group by inviter),
    espera as (
      select r.invitee, r.inviter,
             row_number() over (partition by r.inviter order by r.qualified_at, r.invitee) as fila
      from barrio.referral r
      where r.qualified_at is not null and r.counted_at is null
        ${inviter ? sql`and r.inviter = ${inviter}` : sql``})
    update barrio.referral r set counted_at = now()
    from espera e left join mes m on m.inviter = e.inviter
    where r.invitee = e.invitee and e.fila + coalesce(m.n, 0) <= ${MONTH_LIMIT}`;
}

/** El nombre publico de una cuenta: su personaje de mas nivel (nunca el usuario). */
async function publicName(sql: Sql, accountId: string): Promise<string> {
  const [row] = await sql`
    select c."Name" as name
    from data."Character" c
    left join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = ${RESETS}
    left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
    where c."AccountId" = ${accountId}
    order by coalesce(rs."Value", 0) desc, coalesce(lv."Value", 0) desc, c."CharacterSlot"
    limit 1`;
  return row?.name ?? "Un jugador";
}

async function status(req: Request, sql: Sql) {
  const s = session(req);
  await refreshReferrals(sql, s.accountId);
  const code = await codeOf(sql, s.accountId);

  const [account] = await sql`select "RegistrationDate" as registered from data."Account" where "Id" = ${s.accountId}`;
  const [link] = await sql`select inviter, qualified_at from barrio.referral where invitee = ${s.accountId}`;
  const own = await progressOf(sql, s.accountId);
  const registered = account?.registered ? new Date(account.registered) : null;
  const deadline = registered ? new Date(registered.getTime() + NEW_ACCOUNT_DAYS * 86400000) : null;
  const canLink = !link && !reachedGoal(own) && !!deadline && deadline.getTime() > Date.now();

  const friends = await sql`
    select r.invitee::text as id, r.qualified_at as qualified, r.counted_at as counted, r.linked_at as linked,
           (select c."Name" from data."Character" c
              left join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
              where c."AccountId" = r.invitee order by coalesce(lv."Value", 0) desc limit 1) as name,
           (select coalesce(max(lv."Value"), 0)::int from data."Character" c
              join data."StatAttribute" lv on lv."CharacterId" = c."Id" and lv."DefinitionId" = ${LEVEL}
              where c."AccountId" = r.invitee) as level,
           (select coalesce(max(rs."Value"), 0)::int from data."Character" c
              join data."StatAttribute" rs on rs."CharacterId" = c."Id" and rs."DefinitionId" = ${RESETS}
              where c."AccountId" = r.invitee) as resets
    from barrio.referral r where r.inviter = ${s.accountId}
    order by r.linked_at desc`;

  const counted = friends.filter(f => f.counted).length;
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const monthCounted = friends.filter(f => f.counted && new Date(f.counted) >= monthStart).length;
  const claims = await sql`select reward, detail, claimed_at from barrio.referral_claim where account = ${s.accountId}`;
  const claimed = new Map(claims.map(c => [c.reward, c]));

  const characters = await sql`
    select c."Name" as name, cc."Number" as class
    from data."Character" c join config."CharacterClass" cc on cc."Id" = c."CharacterClassId"
    where c."AccountId" = ${s.accountId} order by c."CharacterSlot"`;

  return {
    code,
    link: `${SITE}/?ref=${code}`,
    goalLevel: GOAL_LEVEL,
    monthLimit: MONTH_LIMIT,
    houseLimit: HOUSE_LIMIT,
    counted,
    monthCounted,
    invitedBy: link ? { name: await publicName(sql, link.inviter) } : null,
    canLink,
    linkDeadline: canLink ? deadline?.toISOString() : null,
    own: { ...own, reached: reachedGoal(own) },
    friends: friends.map(f => ({
      name: f.name ?? "(sin personaje todavia)",
      level: f.level ?? 0,
      resets: f.resets ?? 0,
      state: f.counted ? "cuenta" : f.qualified ? "espera" : "jugando",
    })),
    milestones: MILESTONES.map(m => ({
      key: m.key,
      at: m.at,
      label: m.label,
      wings: m.wings ?? null,
      unlocked: counted >= m.at,
      claimed: claimed.has(m.key) ? { at: claimed.get(m.key)!.claimed_at, detail: claimed.get(m.key)!.detail } : null,
    })),
    welcome: link
      ? {
          key: WELCOME.key,
          label: WELCOME.label,
          unlocked: reachedGoal(own),
          claimed: claimed.has(WELCOME.key) ? { at: claimed.get(WELCOME.key)!.claimed_at } : null,
        }
      : null,
    characters: characters.map(c => ({ name: c.name, class: c.class })),
  };
}

async function linkCode(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const code = normalizeCode(b.code);
  if (!CODE_RE.test(code)) throw new PanelError(400, "Ese codigo no es valido. Son 6 letras o numeros.");
  await ensureTables(sql);

  const [inviter] = await sql`
    select rc.account::text as id, a."State" as state
    from barrio.referral_code rc join data."Account" a on a."Id" = rc.account
    where rc.code = ${code}`;
  if (!inviter) throw new PanelError(404, "No existe ningun jugador con ese codigo.");
  if (inviter.id === s.accountId) throw new PanelError(400, "No puedes invitarte a ti mismo.");
  if (inviter.state === 4 || inviter.state === 5) throw new PanelError(400, "Ese codigo ya no se puede usar.");

  const [account] = await sql`select "RegistrationDate" as registered from data."Account" where "Id" = ${s.accountId}`;
  const registered = account?.registered ? new Date(account.registered).getTime() : 0;
  if (!registered || Date.now() - registered > NEW_ACCOUNT_DAYS * 86400000) {
    throw new PanelError(400, `Solo las cuentas de menos de ${NEW_ACCOUNT_DAYS} dias pueden poner un codigo.`);
  }
  if (reachedGoal(await progressOf(sql, s.accountId))) {
    throw new PanelError(400, `Tu cuenta ya llego a nivel ${GOAL_LEVEL}: el codigo se pone antes, al empezar.`);
  }

  const hash = ipHash(clientIp(req));
  return sql.begin(async tx => {
    // Un cerrojo por casa, para que dos cuentas a la vez no pasen el tope.
    await tx`select pg_advisory_xact_lock(hashtext(${"referral:" + hash}))`;
    const [already] = await tx`select 1 from barrio.referral where invitee = ${s.accountId}`;
    if (already) throw new PanelError(400, "Ya pusiste un codigo de invitacion.");
    // Nadie invita a quien lo invito a el.
    const [loop] = await tx`select 1 from barrio.referral where invitee = ${inviter.id} and inviter = ${s.accountId}`;
    if (loop) throw new PanelError(400, "Ese jugador entro con tu invitacion: no puede invitarte a ti.");
    const [house] = await tx`select count(*)::int as n from barrio.referral where ip_hash = ${hash}`;
    if (house.n >= HOUSE_LIMIT) {
      throw new PanelError(400, `Desde tu conexion ya se invitaron ${HOUSE_LIMIT} cuentas, el maximo por casa.`);
    }
    await tx`insert into barrio.referral (invitee, inviter, ip_hash) values (${s.accountId}, ${inviter.id}, ${hash})`;
    return {
      ok: true,
      message: `¡Listo! Entraste invitado por ${await publicName(tx, inviter.id)}. Cuando llegues a nivel ${GOAL_LEVEL}, los dos ganan premios.`,
    };
  });
}

/** El baul de la cuenta (lo crea si no tiene) y si esta vacio. */
async function vaultOf(tx: Sql, accountId: string): Promise<string> {
  const [account] = await tx`select "VaultId"::text as vault from data."Account" where "Id" = ${accountId} for update`;
  if (!account) throw new PanelError(404, "No se encontro la cuenta.");
  let vault = account.vault as string | null;
  if (!vault) {
    const [created] = await tx`insert into data."ItemStorage" ("Id", "Money") values (gen_random_uuid(), 0) returning "Id"::text as id`;
    vault = created.id as string;
    await tx`update data."Account" set "VaultId" = ${vault} where "Id" = ${accountId}`;
  }
  const [items] = await tx`select count(*)::int as n from data."Item" where "ItemStorageId" = ${vault}`;
  if (items.n > 0) throw new PanelError(409, "Tu baul debe estar vacio para recibir el premio. Saca todo del baul y vuelve a intentar.");
  return vault;
}

async function putItem(tx: Sql, vault: string, group: number, number: number, slot: number): Promise<void> {
  const [def] = await tx`
    select "Id"::text as id, "Durability" as durability from config."ItemDefinition"
    where "Group" = ${group} and "Number" = ${number} limit 1`;
  if (!def) throw new PanelError(500, "No se encontro un item del premio. Avisa al staff.");
  await tx`
    insert into data."Item" ("Id", "DefinitionId", "Durability", "HasSkill", "ItemSlot", "ItemStorageId", "Level", "PetExperience", "SocketCount")
    values (gen_random_uuid(), ${def.id}, ${def.durability}, false, ${slot}, ${vault}, 0, 0, 0)`;
}

async function claim(req: Request, sql: Sql) {
  const s = session(req);
  const b = await body(req);
  const key = typeof b.reward === "string" ? b.reward : "";
  const reward = key === WELCOME.key ? WELCOME : MILESTONES.find(m => m.key === key);
  if (!reward) throw new PanelError(400, "Ese premio no existe.");

  await refreshReferrals(sql, s.accountId);
  if (reward === WELCOME) {
    const [link] = await sql`select 1 from barrio.referral where invitee = ${s.accountId}`;
    if (!link) throw new PanelError(400, "Este premio es para quien entro con un codigo de invitacion.");
    if (!reachedGoal(await progressOf(sql, s.accountId))) {
      throw new PanelError(400, `Llega a nivel ${GOAL_LEVEL} con un personaje para pedir este premio.`);
    }
  } else {
    const [n] = await sql`select count(*)::int as n from barrio.referral where inviter = ${s.accountId} and counted_at is not null`;
    if (n.n < reward.at) throw new PanelError(400, `Necesitas ${reward.at} invitados en nivel ${GOAL_LEVEL} (tienes ${n.n}).`);
  }

  // Alas: de la clase del personaje que eligio.
  let wing: { number: number; name: string } | null = null;
  if (reward.wings) {
    const [c] = await sql`
      select cc."Number" as class from data."Character" c join config."CharacterClass" cc on cc."Id" = c."CharacterClassId"
      where c."AccountId" = ${s.accountId} and c."Name" = ${typeof b.character === "string" ? b.character : ""}`;
    const family = c ? familyOf(c.class) : null;
    if (!family) throw new PanelError(400, "Elige el personaje para el que quieres las alas.");
    const w = WINGS[family];
    wing = reward.wings === 1 ? { number: w.first, name: w.firstName } : { number: w.third, name: w.thirdName };
  }

  await requireOffline(s.login);
  return sql.begin(async tx => {
    const [done] = await tx`
      insert into barrio.referral_claim (account, reward, detail) values (${s.accountId}, ${reward.key}, ${wing?.name ?? null})
      on conflict do nothing returning 1`;
    if (!done) throw new PanelError(400, "Ya pediste este premio.");
    const vault = await vaultOf(tx, s.accountId);
    let slot = 0;
    if (wing) await putItem(tx, vault, 12, wing.number, slot++);
    for (const item of reward.items) {
      for (let i = 0; i < item.count; i++) await putItem(tx, vault, item.group, item.number, slot++);
    }
    if (reward.zen) await tx`update data."ItemStorage" set "Money" = "Money" + ${reward.zen} where "Id" = ${vault}`;
    const what = wing ? wing.name : reward.label;
    return { ok: true, message: `¡Premio entregado! ${what} ya esta en tu baul. Entra al juego y abrelo con un NPC del baul.` };
  });
}

/** Top de reclutadores: del mes (invitados contados este mes) y de siempre. */
async function ranking(sql: Sql) {
  await refreshReferrals(sql);
  const rows = await sql`
    select r.inviter::text as id,
           count(*) filter (where r.counted_at >= date_trunc('month', now()))::int as month,
           count(*)::int as total
    from barrio.referral r
    join data."Account" a on a."Id" = r.inviter
    where r.counted_at is not null and a."State" <> all(${HIDDEN_ACCOUNT_STATES}::int[])
    group by r.inviter`;
  const named = await Promise.all(rows.map(async r => ({ ...r, name: await publicName(sql, r.id) })));
  const top = (key: "month" | "total") =>
    named
      .filter(r => r[key] > 0)
      .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name))
      .slice(0, 20)
      .map((r, i) => ({ rank: i + 1, name: r.name, count: r[key] }));
  return { month: top("month"), total: top("total"), goalLevel: GOAL_LEVEL };
}

/** Quien invita con un codigo (para la landing: "Te invito X"). */
async function whoInvites(sql: Sql, code: string) {
  await ensureTables(sql);
  if (!CODE_RE.test(code)) return { valid: false };
  const [row] = await sql`select account::text as id from barrio.referral_code where code = ${code}`;
  return row ? { valid: true, name: await publicName(sql, row.id) } : { valid: false };
}

let rankingCache: { at: number; body: unknown } | null = null;

/** Rutas de referidos; null si la ruta no es de aqui. */
export async function handleReferidos(req: Request, url: URL, cors: Record<string, string>, sql: Sql): Promise<Response | null> {
  try {
    if (url.pathname === "/referidos/ranking" && req.method === "GET") {
      if (!rankingCache || Date.now() - rankingCache.at > 60_000) rankingCache = { at: Date.now(), body: await ranking(sql) };
      return new Response(JSON.stringify(rankingCache.body), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60", ...cors },
      });
    }
    if (url.pathname === "/referidos/codigo" && req.method === "GET") {
      return json(await whoInvites(sql, normalizeCode(url.searchParams.get("c"))), 200, cors);
    }
    const routes: Record<string, [string, (req: Request, sql: Sql) => Promise<unknown>]> = {
      "/me/referidos": ["GET", status],
      "/me/referidos/codigo": ["POST", linkCode],
      "/me/referidos/reclamar": ["POST", claim],
    };
    const route = routes[url.pathname];
    if (!route) return null;
    if (req.method !== route[0]) return json({ error: "Metodo no permitido." }, 405, cors);
    return json(await route[1](req, sql), 200, cors);
  } catch (error) {
    if (error instanceof PanelError) return json({ error: error.message }, error.status, cors);
    console.error(url.pathname, error);
    return json({ error: "Algo salio mal. Intenta en un rato." }, 500, cors);
  }
}
