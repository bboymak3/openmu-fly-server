// BarrioMU: el WhatsApp del servidor, corriendo en la tablet (sin Railway ni Evolution).
//
// Es "WhatsApp Web" sin pantalla: libreria Baileys 7 (la misma que usa Evolution API por
// dentro), corriendo en Node.js (Baileys no se lleva bien con Bun). Cada mensaje de texto que
// llega a un chat privado se le pasa a la API de BarrioMU (http://127.0.0.1:3400/whatsapp)
// con el secreto que comparten OpenMU y la API; lo que la API contesta se manda de vuelta.
// La API decide todo (vincular el numero con la cuenta, la IA, los limites): este programa
// solo lleva y trae mensajes.
//
// Uso (desde ~/babylon/proxy):
//   whatsapp/node whatsapp/bot.mjs                    prende el bot (necesita estar vinculado)
//   whatsapp/node whatsapp/bot.mjs --vincular 58412…  pide el codigo para vincular el numero
//                                 (WhatsApp > Dispositivos vinculados > Vincular con numero)
//
// La sesion queda en ~/barriomu-wa/auth: si se borra, hay que vincular de nuevo.
// Ademas escucha en 127.0.0.1:3410 (POST /send, con el chat completo: 58412...@s.whatsapp.net)
// para que la API mande avisos.

import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "baileys";
import pino from "pino";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const HOME = process.env.HOME ?? "/root";
const AUTH_DIR = process.env.WA_AUTH_DIR ?? `${HOME}/barriomu-wa/auth`;
const SECRET_FILE = process.env.SABIO_SECRET_FILE ?? `${HOME}/openmu/data/sabio-secreto.txt`;
const API_URL = process.env.WA_API_URL ?? "http://127.0.0.1:3400/whatsapp";
const SEND_PORT = Number(process.env.WA_SEND_PORT ?? 3410);
/** Un mensaje a la vez por persona, y no mas de esto por minuto (protege el numero del bot). */
const PER_MINUTE = 6;
/** Cierres seguidos sin llegar a conectar: se espera cada vez mas y, al final, se avisa. */
const MAX_FAILURES = 12;

const log = (...a) => console.log(new Date().toISOString(), ...a);

function secret() {
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

let sock = null;
let pairingAsked = false;
let failures = 0;
const busy = new Set();
const recent = new Map();

function tooMany(jid) {
  const now = Date.now();
  const times = (recent.get(jid) ?? []).filter(t => now - t < 60_000);
  times.push(now);
  recent.set(jid, times);
  return times.length > PER_MINUTE;
}

/** El texto de un mensaje (normal, con formato o respuesta a otro). */
function textOf(message) {
  if (!message) return "";
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.ephemeralMessage?.message?.extendedTextMessage?.text ??
    message.ephemeralMessage?.message?.conversation ??
    ""
  );
}

async function ask(from, text) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: secret(), from, text: text.slice(0, 500) }),
    signal: AbortSignal.timeout(45_000),
  });
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.messages) ? data.messages.filter(m => typeof m === "string" && m.trim()) : [];
}

async function start() {
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
        const code = await sock.requestPairingCode(pairNumber);
        console.log("");
        console.log(`CODIGO PARA VINCULAR: ${code.match(/.{1,4}/g)?.join("-") ?? code}`);
        console.log("En el telefono del bot: WhatsApp > Dispositivos vinculados > Vincular un dispositivo >");
        console.log("'Vincular con numero de telefono' y escribe ese codigo. Tienes unos 2 minutos.");
        console.log("");
      } catch (error) {
        console.log("No se pudo pedir el codigo:", error?.message ?? error);
        process.exit(1);
      }
    }
    if (connection === "open") {
      failures = 0;
      log("WhatsApp conectado");
      if (pairNumber) {
        // WhatsApp sigue mandando llaves y datos de la sesion un rato despues de conectar:
        // cerrar antes deja la sesion a medio guardar (y despues no vuelve a entrar, error 428).
        console.log("Vinculado. Guardando la sesion, espera 40 segundos y no cierres Termux...");
        setTimeout(() => {
          console.log("Listo: el WhatsApp del bot quedo vinculado.");
          process.exit(0);
        }, 40_000);
      }
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
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
        log("En el telefono del bot borra el dispositivo vinculado viejo y vuelve a vincular: bash ~/barriomu.sh whatsapp");
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
        const replies = await ask(jid, text);
        // En pausa (o sin nada que decir) no se marca como leido ni se contesta.
        if (replies.length) {
          await sock.readMessages([m.key]).catch(() => {});
          for (const reply of replies.slice(0, 4)) await sock.sendMessage(jid, { text: reply.slice(0, 3000) });
        }
      } catch (error) {
        log("mensaje", error?.message ?? error);
        await sock.sendMessage(jid, { text: "Se me cruzaron los cables, pana. Intenta en un rato." }).catch(() => {});
      } finally {
        busy.delete(jid);
      }
    }
  });
}

// Avisos que manda la API (vendiste en La Plaza, subiste de nivel...): solo desde la tablet.
if (!pairNumber) {
  const reply = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/send") return reply(res, 404, { ok: false });
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 8192) req.destroy();
    });
    req.on("end", async () => {
      let b = {};
      try {
        b = JSON.parse(raw);
      } catch {
        // cuerpo invalido
      }
      const want = secret();
      if (!want || b.secret !== want) return reply(res, 404, { ok: false });
      const to = String(b.to ?? "");
      if (!sock || !/^\d{5,20}@(s\.whatsapp\.net|lid)$/.test(to) || !b.text) return reply(res, 400, { ok: false });
      try {
        await sock.sendMessage(to, { text: String(b.text).slice(0, 3000) });
        reply(res, 200, { ok: true });
      } catch (error) {
        reply(res, 500, { ok: false, error: error?.message ?? String(error) });
      }
    });
  }).listen(SEND_PORT, "127.0.0.1");
}

void start();
