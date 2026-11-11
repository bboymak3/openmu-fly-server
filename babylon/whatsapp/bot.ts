// BarrioMU: el WhatsApp del servidor, corriendo en la tablet (sin Railway ni Evolution).
//
// Es "WhatsApp Web" sin pantalla (libreria Baileys). Cada mensaje de texto que llega a un
// chat privado se le pasa a la API de BarrioMU (http://127.0.0.1:3400/whatsapp) con el
// secreto que comparten OpenMU y la API; lo que la API contesta se manda de vuelta.
// La API decide todo (vincular el numero con la cuenta, la IA, los limites): este
// programa solo lleva y trae mensajes.
//
// Uso:
//   bun bot.ts                    prende el bot (necesita estar vinculado)
//   bun bot.ts --vincular 58412…  pide el codigo para vincular el numero del bot
//                                 (WhatsApp > Dispositivos vinculados > Vincular con numero)
//
// La sesion queda en ~/barriomu-wa/auth: si se borra, hay que vincular de nuevo.
// Ademas escucha en 127.0.0.1:3410 (POST /send, con el chat completo: 58412...@s.whatsapp.net)
// para que la API mande avisos.

import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState, type WASocket } from "baileys";
import pino from "pino";
import { readFileSync } from "node:fs";

const HOME = process.env.HOME ?? "/root";
const AUTH_DIR = process.env.WA_AUTH_DIR ?? `${HOME}/barriomu-wa/auth`;
const SECRET_FILE = process.env.SABIO_SECRET_FILE ?? `${HOME}/openmu/data/sabio-secreto.txt`;
const API_URL = process.env.WA_API_URL ?? "http://127.0.0.1:3400/whatsapp";
const SEND_PORT = Number(process.env.WA_SEND_PORT ?? 3410);
/** Un mensaje a la vez por persona, y no mas de esto por minuto (protege el numero del bot). */
const PER_MINUTE = 6;

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function secret(): string {
  try {
    return readFileSync(SECRET_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

const args = process.argv.slice(2);
const pairIndex = args.indexOf("--vincular");
const pairNumber = pairIndex >= 0 ? (args[pairIndex + 1] ?? "").replace(/\D/g, "") : "";
if (pairIndex >= 0 && !/^\d{10,15}$/.test(pairNumber)) {
  console.log("Escribe el numero del bot con codigo de pais, solo numeros. Ej: 584121234567");
  process.exit(1);
}

let sock: WASocket | null = null;
let pairingAsked = false;
/** Cierres seguidos sin llegar a conectar: para esperar cada vez mas y avisar si la sesion se daño. */
let failures = 0;
const MAX_FAILURES = 12;
const busy = new Set<string>();
const recent = new Map<string, number[]>();

function tooMany(jid: string): boolean {
  const now = Date.now();
  const times = (recent.get(jid) ?? []).filter(t => now - t < 60_000);
  times.push(now);
  recent.set(jid, times);
  return times.length > PER_MINUTE;
}

/** El texto de un mensaje (normal, con formato o respuesta a otro). */
function textOf(message: Record<string, any> | null | undefined): string {
  if (!message) return "";
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.ephemeralMessage?.message?.extendedTextMessage?.text ??
    message.ephemeralMessage?.message?.conversation ??
    ""
  );
}

async function ask(from: string, text: string): Promise<string[]> {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: secret(), from, text: text.slice(0, 500) }),
    signal: AbortSignal.timeout(45_000),
  });
  const data = (await res.json().catch(() => ({}))) as { messages?: unknown };
  return Array.isArray(data.messages) ? data.messages.filter((m): m is string => typeof m === "string" && !!m.trim()) : [];
}

async function start(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  if (!pairNumber && !state.creds.registered) {
    console.log("El bot no esta vinculado. Corre: bash ~/barriomu.sh whatsapp");
    process.exit(1);
  }

  sock = makeWASocket({
    auth: state,
    browser: Browsers.ubuntu("Chrome"),
    logger: pino({ level: "silent" }),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async update => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && pairNumber && !pairingAsked) {
      pairingAsked = true;
      try {
        const code = await sock!.requestPairingCode(pairNumber);
        console.log("");
        console.log(`CODIGO PARA VINCULAR: ${code.match(/.{1,4}/g)?.join("-") ?? code}`);
        console.log("En el telefono del bot: WhatsApp > Dispositivos vinculados > Vincular un dispositivo >");
        console.log("'Vincular con numero de telefono' y escribe ese codigo. Tienes unos 2 minutos.");
        console.log("");
      } catch (error) {
        console.log("No se pudo pedir el codigo:", (error as Error).message);
        process.exit(1);
      }
    }
    if (connection === "open") {
      failures = 0;
      log("WhatsApp conectado");
      if (pairNumber) {
        // WhatsApp sigue mandando llaves y datos de la sesion un rato despues de conectar:
        // cerrar antes dejaba la sesion a medio guardar (y despues no volvia a entrar, error 428).
        console.log("Vinculado. Guardando la sesion, espera 40 segundos y no cierres Termux...");
        setTimeout(() => {
          console.log("Listo: el WhatsApp del bot quedo vinculado.");
          process.exit(0);
        }, 40_000);
      }
    }
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const why = lastDisconnect?.error?.message ?? "";
      if (code === DisconnectReason.loggedOut) {
        log("WhatsApp cerro la sesion (se desvinculo). Hay que vincular de nuevo: bash ~/barriomu.sh whatsapp");
        process.exit(2);
      }
      if (code === DisconnectReason.restartRequired) {
        setTimeout(() => void start(), 500);
        return;
      }
      failures++;
      if (failures >= MAX_FAILURES) {
        log(`WhatsApp rechazo la conexion ${failures} veces seguidas (${code ?? "?"} ${why}).`);
        log("La sesion del bot parece dañada. En el telefono del bot borra el dispositivo vinculado viejo y");
        log("vuelve a vincular: bash ~/barriomu.sh whatsapp");
        process.exit(2);
      }
      const wait = Math.min(60_000, 5_000 * 2 ** Math.min(failures - 1, 4));
      log(`WhatsApp desconectado (${code ?? "?"} ${why}), reconectando en ${wait / 1000} s... (intento ${failures})`);
      setTimeout(() => void start(), wait);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" || pairNumber) return;
    for (const m of messages) {
      const jid = m.key.remoteJid ?? "";
      // Solo chats privados (numero o "lid", el id nuevo de WhatsApp); nada de grupos,
      // estados ni lo que manda el propio bot.
      if (m.key.fromMe || !(jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid"))) continue;
      const text = textOf(m.message).trim();
      if (!text) continue;
      log("mensaje de", jid.split("@")[0].slice(-4), "->", text.slice(0, 40));
      if (busy.has(jid) || tooMany(jid)) continue;
      busy.add(jid);
      try {
        await sock!.readMessages([m.key]).catch(() => {});
        await sock!.sendPresenceUpdate("composing", jid).catch(() => {});
        const replies = await ask(jid, text);
        for (const reply of replies.slice(0, 4)) await sock!.sendMessage(jid, { text: reply.slice(0, 3000) });
      } catch (error) {
        log("mensaje", (error as Error).message);
        await sock!.sendMessage(jid, { text: "Se me cruzaron los cables, pana. Intenta en un rato." }).catch(() => {});
      } finally {
        busy.delete(jid);
        await sock!.sendPresenceUpdate("paused", jid).catch(() => {});
      }
    }
  });
}

// Avisos que manda la API (vendiste en La Plaza, subiste de nivel...): solo desde la tablet.
if (!pairNumber) {
  Bun.serve({
    port: SEND_PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (req.method !== "POST" || new URL(req.url).pathname !== "/send") return new Response("Not found", { status: 404 });
      const b = (await req.json().catch(() => ({}))) as { secret?: string; to?: string; text?: string };
      const want = secret();
      if (!want || b.secret !== want) return new Response("Not found", { status: 404 });
      const to = String(b.to ?? "");
      if (!sock || !/^\d{5,20}@(s\.whatsapp\.net|lid)$/.test(to) || !b.text) return Response.json({ ok: false }, { status: 400 });
      await sock.sendMessage(to, { text: String(b.text).slice(0, 3000) });
      return Response.json({ ok: true });
    },
  });
}

void start();
