// Servidor web minimo para el cliente Babylon compilado (carpeta client/)
// y para la pagina de registro (carpeta register/).
// Se compila a un binario linux-arm64 en el workflow build-babylon.yml.
//
// Variables:
//   ROOT           carpeta a servir
//   PORT           puerto (por defecto 8081)
//   FALLBACK_ROOT  carpeta donde buscar lo que no esta en ROOT (el registro
//                  toma de aqui los graficos de client/Data)
//   API_TARGET     si esta, /api/* se reenvia ahi (el servicio de registro)
//
// Cache: los graficos y el codigo llevan Cache-Control para que Cloudflare los
// guarde (regla de cache en el panel de Cloudflare) y no salgan otra vez del
// internet de la casa. Lo que cambia con cada version (index.html, sw.js, la
// lista de servidores, los indices) se revisa siempre.

import { join, normalize, sep } from "node:path";

const ROOT = normalize(process.env.ROOT ?? join(process.cwd(), "client"));
const FALLBACK_ROOT = process.env.FALLBACK_ROOT ? normalize(process.env.FALLBACK_ROOT) : null;
const PORT = Number(process.env.PORT ?? 8081);
const API_TARGET = process.env.API_TARGET?.replace(/\/$/, "") || null;

/** Se revisan en cada visita: cambian cuando se actualiza el cliente. */
const ALWAYS_CHECK = /(^|\/)(index\.html|sw\.js|serverlist\.md|manifest\.webmanifest|build\.json|assets-index[^/]*\.json)$/;
/** El codigo de Vite lleva un hash en el nombre: nunca cambia. */
const HASHED = /^\/(assets|js)\/.+-[A-Za-z0-9_-]{8,}\.(js|css|wasm)$/;

function cacheControl(path: string): string {
  if (ALWAYS_CHECK.test(path)) return "no-cache";
  if (HASHED.test(path)) return "public, max-age=31536000, immutable";
  // Graficos, musica, mapas: 1 dia en el navegador, 30 dias en Cloudflare.
  return "public, max-age=86400, s-maxage=2592000";
}

/** Un archivo con su Cache-Control. */
function sendFile(file: ReturnType<typeof Bun.file>, path: string): Response {
  return new Response(file, { headers: { "Cache-Control": cacheControl(path) } });
}

/** El archivo pedido dentro de root, o null si se sale de la carpeta. */
function inside(root: string, path: string): string | null {
  const full = normalize(join(root, path));
  return full === root || full.startsWith(root + sep) ? full : null;
}

async function proxyApi(req: Request, url: URL): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete("host");
  // Cloudflare dice quien es el jugador; el servicio de registro lo lee de
  // X-Forwarded-For porque esta peticion le llega desde loopback.
  const client = req.headers.get("cf-connecting-ip");
  if (client) headers.set("x-forwarded-for", client);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  try {
    return await fetch(API_TARGET + url.pathname + url.search, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch {
    return new Response(JSON.stringify({ error: "Registro no disponible" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);

    if (API_TARGET && path.startsWith("/api/")) return proxyApi(req, url);

    if (path.endsWith("/")) path += "index.html";

    for (const root of FALLBACK_ROOT ? [ROOT, FALLBACK_ROOT] : [ROOT]) {
      const full = inside(root, path);
      if (!full) return new Response("Forbidden", { status: 403 });
      const file = Bun.file(full);
      if (await file.exists()) return sendFile(file, path);
    }

    // Rutas de la app como /online u /offline: devolver index.html.
    if (!path.slice(path.lastIndexOf("/")).includes(".")) {
      return sendFile(Bun.file(join(ROOT, "index.html")), "/index.html");
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Sirviendo ${ROOT} en http://0.0.0.0:${server.port}`);
