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
    let servers: unknown = DEFAULT_ICE;
    try {
      const parsed: unknown = JSON.parse(readFileSync(ICE_FILE, "utf8"));
      if (Array.isArray(parsed) && parsed.length) servers = parsed;
    } catch {
      /* sin archivo: solo STUN */
    }
    return new Response(JSON.stringify({ iceServers: servers }), {
      status: 200,
      headers: { ...corsFor(cors), "Cache-Control": "no-store" },
    });
  }

  if (url.pathname !== "/voice/ticket") return null;
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsFor(cors) });

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local";
  if (!ticketAllowed(ip)) {
    return new Response(JSON.stringify({ error: "Demasiados intentos, espera un minuto." }), { status: 429, headers: corsFor(cors) });
  }

  let body: { nonce?: unknown; name?: unknown };
  try {
    body = (await req.json()) as { nonce?: unknown; name?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "Cuerpo inválido." }), { status: 400, headers: corsFor(cors) });
  }

  const nonce = typeof body.nonce === "string" ? body.nonce.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!NONCE_RE.test(nonce)) {
    return new Response(JSON.stringify({ error: "Nonce inválido." }), { status: 400, headers: corsFor(cors) });
  }
  if (!NAME_RE.test(name)) {
    return new Response(JSON.stringify({ error: "Nombre de personaje inválido." }), { status: 400, headers: corsFor(cors) });
  }

  const account = await accountOfNonce(nonce);
  if (!account) {
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
    return new Response(JSON.stringify({ error: "Ese personaje no es de esa cuenta." }), { status: 403, headers: corsFor(cors) });
  }

  return new Response(JSON.stringify(ticketFor(name, account)), { status: 200, headers: corsFor(cors) });
}

/* --------------------------------------------------------------- señalización */

export type VoiceData = {
  id: string;
  name: string;
  account: string;
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
      send(target.ws, { t: "signal", from: data.id, data: msg.data });
      return;
    }

    if (msg.t === "talk") {
      const on = msg.on === true;
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
