// BarrioMU: voz por proximidad — la parte de la tablet.
//
// - Solo SEÑALIZA: dice quién está conectado y pasa las ofertas/respuestas de
//   WebRTC entre dos jugadores. El audio va directo de un navegador al otro
//   (malla P2P): no pasa por aquí, no gasta datos de la tablet y no toca OpenMU.
// - La identidad no se cree al cliente: el navegador manda el *nonce* de su
//   sesión de juego (el mismo que usa el cash shop) y aquí se pregunta al proxy,
//   en loopback, qué cuenta inició sesión con ese nonce
//   (`GET http://127.0.0.1:3001/ticket/<nonce>`). Con la cuenta se comprueba que
//   el personaje que dice ser sea suyo. Sin eso, no hay ticket y no hay voz.
// - El ticket es un HMAC de 5 minutos con un secreto propio de la tablet
//   (~/openmu/data/voz-secreto.txt, se crea solo). El WebSocket entra por el
//   túnel como wss://mu-api.makeseo.app/voice?ticket=...
// - Una sola sala para todo el servidor: cada cliente solo abre conexiones con
//   los jugadores que VE en el mapa (los que le manda el juego), y el volumen
//   lo pone la distancia. Así el número de conexiones no crece con la gente
//   conectada, solo con la que está al lado.
// - Si hay NAT difícil (datos del celular, wifi con firewall) la voz no pasa:
//   para eso está el TURN de Cloudflare. La llave vive en
//   ~/openmu/data/cf-voz.json y aquí se piden credenciales temporales (24 h) en
//   /voice/ice. Sin llave, o si Cloudflare falla, se sigue con STUN sin romper
//   nada. El costo entra en los 1 TB gratis al mes de Cloudflare.
// - /voice/estado devuelve, sin secretos, de dónde salen los ICE, quiénes están
//   en la sala y cómo van los tickets: sirve para diagnosticar sin adivinar.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import type { Sql } from "postgres";

const PRESENCE_URL = process.env.PRESENCE_URL ?? "http://127.0.0.1:3001";
const SECRET_FILE = process.env.VOICE_SECRET_FILE ?? `${homedir()}/openmu/data/voz-secreto.txt`;
/**
 * Servidores ICE que usa el navegador. Se leen de este archivo para poder
 * agregar un TURN (redes con NAT dificil) sin recompilar el cliente: basta
 * escribir la lista y reiniciar la API.
 */
const ICE_FILE = process.env.VOICE_ICE_FILE ?? `${homedir()}/openmu/data/voz-ice.json`;
/**
 * Llave TURN de Cloudflare ({keyId, token}). Con ella se piden credenciales
 * temporales (1 h) para cada cliente: el TURN es gratis hasta 1 TB al mes y
 * atraviesa redes cerradas (datos del celular, wifi con firewall). El archivo
 * es secreto, solo lo lee la API en la tablet.
 */
const CF_FILE = process.env.VOICE_CF_FILE ?? `${homedir()}/openmu/data/cf-voz.json`;
const CF_API = "https://rtc.live.cloudflare.com/v1/turn/keys";
/**
 * Credenciales de 24 h (Cloudflare las acepta) que se renuevan a las 12 h: así
 * una partida larga no se queda sin TURN a mitad de camino.
 */
const CF_TTL_SEC = 86_400;
const CF_RENEW_MS = 12 * 60 * 60 * 1000;
/** Si Cloudflare falla no se insiste en cada visita: 1 min de espera. */
const CF_RETRY_MS = 60_000;
const DEFAULT_ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
/** Cuánto vale un ticket. El cliente lo pide justo antes de entrar. */
const TICKET_MS = 5 * 60 * 1000;
/** Tope de sockets de señalización (no de voces: cada uno es una persona). */
const MAX_SOCKETS = 80;
/** Un SDP con muchas líneas ronda los 8 KB; 24 KB deja aire y corta abusos. */
const MAX_SIGNAL_BYTES = 24 * 1024;
/** Freno por socket: 150 mensajes cada 10 segundos. */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 150;
/** El túnel corta los WebSocket mudos a los ~100 s; el cliente manda ping. */
const PING_GRACE_MS = 120_000;

function loadSecret(): string {
  try {
    const saved = readFileSync(SECRET_FILE, "utf8").trim();
    if (saved) return saved;
  } catch {
    /* primera vez: se crea abajo */
  }
  const made = randomBytes(32).toString("hex");
  try {
    mkdirSync(dirname(SECRET_FILE), { recursive: true });
    writeFileSync(SECRET_FILE, `${made}\n`, { mode: 0o600 });
  } catch (error) {
    console.error("voz: no se pudo guardar el secreto, se usa uno de esta corrida:", error);
  }
  return made;
}

const SECRET = loadSecret();

function b64url(bytes: Buffer): string {
  return bytes.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", SECRET).update(payload).digest());
}

type Ticket = { name: string; account: string; exp: number };

function ticketFor(name: string, account: string): { ticket: string; name: string; exp: number } {
  const exp = Date.now() + TICKET_MS;
  const payload = b64url(Buffer.from(JSON.stringify({ n: name, a: account, e: exp })));
  return { ticket: `${payload}.${sign(payload)}`, name, exp };
}

function verifyTicket(value: string): Ticket | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let parsed: { n?: unknown; a?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const name = typeof parsed.n === "string" ? parsed.n.trim() : "";
  const account = typeof parsed.a === "string" ? parsed.a.trim() : "";
  const exp = typeof parsed.e === "number" ? parsed.e : 0;
  if (!name || !account || exp < Date.now()) return null;
  return { name, account, exp };
}

/** Nombres de personaje válidos en OpenMU: letras, números, guion y guion bajo. */
const NAME_RE = /^[A-Za-z0-9_-]{1,20}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;

/** Freno por IP para pedir tickets (cada uno cuesta una consulta al proxy y a la base). */
const TICKET_WINDOW_MS = 60_000;
const TICKET_MAX = 20;
const ticketWindow = new Map<string, { start: number; count: number }>();

function ticketAllowed(ip: string): boolean {
  const now = Date.now();
  const seen = ticketWindow.get(ip);
  if (!seen || now - seen.start > TICKET_WINDOW_MS) {
    ticketWindow.set(ip, { start: now, count: 1 });
    if (ticketWindow.size > 2000) ticketWindow.clear();
    return true;
  }
  if (++seen.count > TICKET_MAX) return false;
  return true;
}

function corsFor(cors: Record<string, string>): Record<string, string> {
  return { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors };
}

/* ------------------------------------------------------------------- ICE */

type IceServer = { urls: string | string[]; username?: string; credential?: string };
type IceState = {
  servers: IceServer[];
  /** De dónde salieron: credenciales de Cloudflare, archivo manual o STUN público. */
  source: "cloudflare" | "archivo" | "stun";
  until: number;
  error: string;
};

let iceCache: { state: IceState } | null = null;

/** La llave TURN de Cloudflare, si el dueño la guardó. Nunca sale al navegador. */
function readCloudflareKey(): { keyId: string; token: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(CF_FILE, "utf8")) as { keyId?: unknown; token?: unknown };
    const keyId = typeof parsed.keyId === "string" ? parsed.keyId.trim() : "";
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    if (/^[0-9a-f]{32}$/i.test(keyId) && token.length >= 20) return { keyId, token };
    console.error("voz: cf-voz.json existe pero no tiene keyId/token válidos");
  } catch {
    /* sin llave: se sigue con STUN */
  }
  return null;
}

/** Lista manual de ICE (escape: un TURN propio sin tocar código). */
function readIceFile(): IceServer[] | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(ICE_FILE, "utf8"));
    if (Array.isArray(parsed) && parsed.length) return parsed as IceServer[];
  } catch {
    /* sin archivo */
  }
  return null;
}

async function askCloudflare(key: { keyId: string; token: string }): Promise<IceServer[]> {
  const res = await fetch(`${CF_API}/${key.keyId}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: CF_TTL_SEC }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Cloudflare respondió ${res.status}`);
  const body = (await res.json()) as { iceServers?: unknown };
  if (!Array.isArray(body.iceServers) || !body.iceServers.length) throw new Error("Cloudflare no mandó servidores");
  return body.iceServers as IceServer[];
}

/**
 * ICE vigente para los clientes. Cloudflare firma credenciales de 24 h: se
 * cachean 12 h. Si falla, no se rompe la voz: se usa el archivo manual o STUN
 * y se reintenta en un minuto.
 */
async function resolveIce(): Promise<IceState> {
  const now = Date.now();
  if (iceCache && iceCache.state.until > now) return iceCache.state;

  const fallback = (error: string): IceState => {
    const file = readIceFile();
    const state: IceState = {
      servers: file ?? (DEFAULT_ICE as IceServer[]),
      source: file ? "archivo" : "stun",
      until: Date.now() + CF_RETRY_MS,
      error,
    };
    iceCache = { state };
    return state;
  };

  const key = readCloudflareKey();
  if (!key) return fallback("");
  try {
    const servers = await askCloudflare(key);
    const state: IceState = { servers, source: "cloudflare", until: now + CF_RENEW_MS, error: "" };
    iceCache = { state };
    console.log(`voz: TURN de Cloudflare listo (${servers.length} entradas)`);
    return state;
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.error("voz: Cloudflare TURN falló, se sigue con STUN/archivo:", why);
    return fallback(why);
  }
}

/* ------------------------------------------------------- contadores de apoyo */

type TicketEvent = { at: number; ok: boolean; why: string };
const ticketEvents: TicketEvent[] = [];

function noteTicket(ok: boolean, why = ""): void {
  ticketEvents.push({ at: Date.now(), ok, why });
  if (ticketEvents.length > 400) ticketEvents.splice(0, ticketEvents.length - 400);
}

/** Lo que pasó con los tickets en los últimos 5 minutos (para /voice/estado). */
function ticketSummary(): { ok: number; rechazados: number; motivos: Record<string, number> } {
  const from = Date.now() - 5 * 60 * 1000;
  let ok = 0;
  let rechazados = 0;
  const motivos: Record<string, number> = {};
  for (const ev of ticketEvents) {
    if (ev.at < from) continue;
    if (ev.ok) ok++;
    else {
      rechazados++;
      motivos[ev.why || "otro"] = (motivos[ev.why || "otro"] ?? 0) + 1;
    }
  }
  return { ok, rechazados, motivos };
}

let signalCount = 0;
let talkCount = 0;

/** Lo que la sesión del juego dice: la cuenta que inició sesión con ese nonce. */
async function accountOfNonce(nonce: string): Promise<string | null> {
  try {
    const res = await fetch(`${PRESENCE_URL}/ticket/${nonce}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { account?: unknown };
    return typeof body.account === "string" ? body.account : null;
  } catch {
    return null;
  }
}

/** Rutas HTTP de la voz. Null si la ruta no es de aquí. */
export async function handleVoice(
  req: Request,
  url: URL,
  cors: Record<string, string>,
  sql: Sql,
): Promise<Response | null> {
  if (url.pathname === "/voice/ice") {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsFor(cors) });
    const ice = await resolveIce();
    return new Response(JSON.stringify({ iceServers: ice.servers, source: ice.source }), {
      status: 200,
      headers: { ...corsFor(cors), "Cache-Control": "no-store" },
    });
  }

  /**
   * Diagnóstico público y de solo lectura: qué ICE se está usando, quién está en
   * la sala y cómo van los tickets. Sirve para saber si el enlace va por `relay`
   * (TURN) o directo, sin pedir capturas de pantalla.
   */
  if (url.pathname === "/voice/estado") {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: corsFor(cors) });
    const ice = await resolveIce();
    const now = Date.now();
    const estado = {
      ok: true,
      version: "voz-2",
      hora: new Date(now).toISOString(),
      apiArribaHaceSeg: Math.round(process.uptime()),
      ice: {
        fuente: ice.source,
        servidores: ice.servers.map(s => s.urls),
        renuevaEnSeg: Math.max(0, Math.round((ice.until - now) / 1000)),
        llaveCloudflare: Boolean(readCloudflareKey()),
        archivoManual: Boolean(readIceFile()),
        error: ice.error || null,
      },
      voz: {
        conectados: peers.size,
        tope: MAX_SOCKETS,
        jugadores: [...peers.values()].map(p => ({
          nombre: p.name,
          conectadoHaceSeg: Math.round((now - p.ws.data.since) / 1000),
          ultimoMensajeHaceSeg: Math.round((now - p.ws.data.lastSeen) / 1000),
          mensajes: p.ws.data.msgs,
        })),
      },
      tickets: ticketSummary(),
      contadores: { senal: signalCount, charla: talkCount },
    };
    return new Response(JSON.stringify(estado, null, 2), { status: 200, headers: corsFor(cors) });
  }

  if (url.pathname !== "/voice/ticket") return null;
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsFor(cors) });

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local";
  if (!ticketAllowed(ip)) {
    noteTicket(false, "límite");
    return new Response(JSON.stringify({ error: "Demasiados intentos, espera un minuto." }), { status: 429, headers: corsFor(cors) });
  }

  let body: { nonce?: unknown; name?: unknown };
  try {
    body = (await req.json()) as { nonce?: unknown; name?: unknown };
  } catch {
    noteTicket(false, "cuerpo");
    return new Response(JSON.stringify({ error: "Cuerpo inválido." }), { status: 400, headers: corsFor(cors) });
  }

  const nonce = typeof body.nonce === "string" ? body.nonce.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!NONCE_RE.test(nonce)) {
    noteTicket(false, "nonce");
    return new Response(JSON.stringify({ error: "Nonce inválido." }), { status: 400, headers: corsFor(cors) });
  }
  if (!NAME_RE.test(name)) {
    noteTicket(false, "nombre");
    return new Response(JSON.stringify({ error: "Nombre de personaje inválido." }), { status: 400, headers: corsFor(cors) });
  }

  const account = await accountOfNonce(nonce);
  if (!account) {
    noteTicket(false, "sin sesión");
    return new Response(JSON.stringify({ error: "Ese personaje no está en el juego." }), { status: 403, headers: corsFor(cors) });
  }

  // El personaje tiene que ser de la cuenta que de verdad inició sesión.
  const rows = await sql`
    select 1 as ok
    from data."Character" c
    join data."Account" a on a."Id" = c."AccountId"
    where lower(a."LoginName") = lower(${account}) and lower(c."Name") = lower(${name})
    limit 1`;
  if (!rows.length) {
    noteTicket(false, "personaje ajeno");
    return new Response(JSON.stringify({ error: "Ese personaje no es de esa cuenta." }), { status: 403, headers: corsFor(cors) });
  }

  noteTicket(true);
  return new Response(JSON.stringify(ticketFor(name, account)), { status: 200, headers: corsFor(cors) });
}

/* --------------------------------------------------------------- señalización */

export type VoiceData = {
  id: string;
  name: string;
  account: string;
  /** Cuándo entró a la sala (para /voice/estado). */
  since: number;
  /** Mensajes recibidos en total. */
  msgs: number;
  /** Ventana del freno de mensajes. */
  windowStart: number;
  windowCount: number;
  /** Último mensaje, para soltar sockets mudos. */
  lastSeen: number;
};

type Peer = { id: string; name: string; ws: ServerWebSocket<VoiceData> };

const peers = new Map<string, Peer>();

function list(): { id: string; name: string }[] {
  return [...peers.values()].map(p => ({ id: p.id, name: p.name }));
}

function send(ws: ServerWebSocket<VoiceData>, body: unknown): void {
  try {
    ws.send(JSON.stringify(body));
  } catch {
    /* el socket ya se fue */
  }
}

function broadcastPeers(): void {
  const body = { t: "peers", peers: list() };
  for (const peer of peers.values()) send(peer.ws, body);
}

function sameName(name: string): Peer | undefined {
  const key = name.toLowerCase();
  for (const peer of peers.values()) if (peer.name.toLowerCase() === key) return peer;
  return undefined;
}

/**
 * Comprueba el ticket y pasa la petición a WebSocket.
 * Devuelve "upgraded" cuando Bun ya tomó la conexión, una Response de error, o
 * null si la ruta no es /voice.
 */
export function voiceUpgrade(req: Request, server: Server): Response | "upgraded" | null {
  const url = new URL(req.url);
  if (url.pathname !== "/voice") return null;

  const ticket = verifyTicket(url.searchParams.get("ticket") ?? "");
  if (!ticket) return new Response("Ticket inválido", { status: 401 });

  if (peers.size >= MAX_SOCKETS) return new Response("Sala llena", { status: 503 });

  // Un solo socket por personaje: si se reconectó, el viejo se va.
  const old = sameName(ticket.name);
  if (old) {
    peers.delete(old.id);
    try {
      old.ws.close();
    } catch {
      /* ya cerrado */
    }
  }

  const now = Date.now();
  const data: VoiceData = {
    id: randomBytes(6).toString("hex"),
    name: ticket.name,
    account: ticket.account,
    since: now,
    msgs: 0,
    windowStart: now,
    windowCount: 0,
    lastSeen: now,
  };

  if (server.upgrade(req, { data })) return "upgraded";
  return new Response("Upgrade failed", { status: 500 });
}

export const voiceSocket = {
  /** El cliente manda un ping cada 25 s; 60 s deja margen de sobra. */
  idleTimeout: 60,
  maxPayloadLength: 64 * 1024,

  open(ws: ServerWebSocket<VoiceData>): void {
    const data = ws.data;
    peers.set(data.id, { id: data.id, name: data.name, ws });
    console.log(`voz: ${data.name} conectado (${peers.size} en la sala)`);
    send(ws, { t: "welcome", id: data.id, name: data.name });
    broadcastPeers();
  },

  message(ws: ServerWebSocket<VoiceData>, raw: string | Buffer): void {
    const data = ws.data;
    const now = Date.now();
    data.lastSeen = now;
    data.msgs++;

    if (now - data.windowStart > RATE_WINDOW_MS) {
      data.windowStart = now;
      data.windowCount = 0;
    }
    if (++data.windowCount > RATE_MAX) {
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
      return;
    }

    if (typeof raw !== "string") return;
    if (raw.length > MAX_SIGNAL_BYTES) return;

    let msg: { t?: unknown; to?: unknown; data?: unknown; on?: unknown };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.t === "ping") {
      send(ws, { t: "pong" });
      return;
    }

    if (msg.t === "signal") {
      const to = typeof msg.to === "string" ? msg.to : "";
      const target = peers.get(to);
      if (!target) return;
      signalCount++;
      send(target.ws, { t: "signal", from: data.id, data: msg.data });
      return;
    }

    if (msg.t === "talk") {
      const on = msg.on === true;
      talkCount++;
      for (const peer of peers.values()) {
        if (peer.id !== data.id) send(peer.ws, { t: "talk", from: data.id, name: data.name, on });
      }
    }
  },

  close(ws: ServerWebSocket<VoiceData>): void {
    const data = ws.data;
    peers.delete(data.id);
    console.log(`voz: ${data.name} salió (${peers.size} en la sala)`);
    broadcastPeers();
  },
};

/** Suelta los sockets que no mandan ni un ping (el túnel ya los habría cortado). */
setInterval(() => {
  const now = Date.now();
  for (const peer of peers.values()) {
    if (now - peer.ws.data.lastSeen > PING_GRACE_MS) {
      try {
        peer.ws.close();
      } catch {
        /* ya cerrado */
      }
    }
  }
}, 30_000);
