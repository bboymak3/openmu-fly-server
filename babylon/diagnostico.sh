#!/bin/bash
# Diagnostico de BarrioMU: prueba cada tramo de la conexion del juego.
# Correr dentro de Ubuntu (proot-distro login ubuntu), con todo prendido.
BUN=~/babylon/proxy/bun

echo "1) OpenMU Connect Server directo (127.0.0.1:44405):"
R=$(timeout 5 bash -c 'exec 3<>/dev/tcp/127.0.0.1/44405 && head -c 4 <&3 | od -An -tx1' 2>&1)
echo "   ${R:-SIN RESPUESTA}"

probe() {
  URL="$1" timeout 12 "$BUN" -e '
const s = new WebSocket(process.env.URL + "?host=127.0.0.1&port=44405");
s.binaryType = "arraybuffer";
const done = m => { console.log("   " + m); process.exit(0); };
s.onmessage = e => {
  const b = new Uint8Array(e.data);
  if (b[2] === 0x0f) return; // clima del proxy, no es OpenMU
  done("OK, respondio: " + Array.from(b.slice(0, 4), x => x.toString(16).padStart(2, "0")).join(" "));
};
s.onclose = e => done("CERRADO codigo=" + e.code + " " + (e.reason || ""));
s.onerror = () => done("ERROR al conectar");
setTimeout(() => done("SIN RESPUESTA en 8s"), 8000);
' || echo "   (no se pudo ejecutar la prueba)"
}

echo "2) Proxy en la tablet (ws://127.0.0.1:3000):"
probe ws://127.0.0.1:3000

echo "3) Proxy por Cloudflare (wss://mu-ws.makeseo.app):"
probe wss://mu-ws.makeseo.app
