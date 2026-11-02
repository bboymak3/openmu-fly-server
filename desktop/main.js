// BarrioMU para PC: el mismo cliente web (Babylon) con los graficos completos
// dentro del programa. Un servidor web pequeno en 127.0.0.1 sirve los archivos
// del disco; el juego se conecta al mismo servidor de siempre por
// wss://mu-ws.makeseo.app (serverlist.md) y el registro pasa a mu.makeseo.app.

const { app, BrowserWindow, Menu, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

/** Puerto fijo: el navegador guarda las opciones del jugador por puerto. */
const PORT = 47801;
/** Adonde van las llamadas /api/* (registro de cuentas). */
const REMOTE = "https://mu.makeseo.app";
const ROOT = app.isPackaged ? path.join(process.resourcesPath, "client") : path.join(__dirname, "client");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
};

/** El archivo de ROOT para una ruta, o null si se sale de ROOT. */
function fileFor(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const file = path.resolve(ROOT, "." + path.posix.normalize("/" + decoded));
  return file === ROOT || file.startsWith(ROOT + path.sep) ? file : null;
}

function statFile(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/** Un archivo, con pedidos por partes (la musica los usa). */
function sendFile(req, res, file, st) {
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": path.basename(file) === "index.html" ? "no-cache" : "public, max-age=3600",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) {
      res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
      res.end();
      return;
    }
    res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, "Content-Length": st.size });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

/** /api/* -> mu.makeseo.app (el registro de cuentas de la tablet). */
function proxyApi(req, res) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;
  const upstream = https.request(REMOTE + req.url, { method: req.method, headers, timeout: 20000 }, up => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No se pudo conectar con BarrioMU. Revisa tu internet." }));
  });
  req.pipe(upstream);
}

function handle(req, res) {
  const urlPath = (req.url ?? "/").split("?")[0];
  if (urlPath.startsWith("/api/")) return proxyApi(req, res);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }
  const file = fileFor(urlPath === "/" ? "/index.html" : urlPath);
  const st = file && statFile(file);
  if (st) return sendFile(req, res, file, st);
  // Rutas de la pagina (sin extension): la pagina principal.
  if (!path.extname(urlPath)) {
    const index = path.join(ROOT, "index.html");
    return sendFile(req, res, index, fs.statSync(index));
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
}

/** Arranca el servidor en PORT; si esta ocupado, en otro puerto libre. */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.once("error", err => {
      if (err.code !== "EADDRINUSE") return reject(err);
      server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server.address().port));
  });
}

let win = null;

function createWindow(port) {
  const base = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: "BarrioMU",
    backgroundColor: "#000000",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: { backgroundThrottling: false, spellcheck: false },
  });
  win.maximize();

  // Los links de afuera (registro, landing, Discord...) abren en el navegador.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(base)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(base)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // F11: pantalla completa. Ctrl+R / F5: recargar.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) {
      win.webContents.reload();
      event.preventDefault();
    }
  });

  win.on("closed", () => (win = null));
  win.loadURL(base + "/");
}

// Sin la lista negra de tarjetas de video: el juego necesita WebGL.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const port = await startServer();
    createWindow(port);
  });

  app.on("window-all-closed", () => app.quit());
}
