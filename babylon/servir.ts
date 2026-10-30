// Servidor web minimo para el cliente Babylon compilado (carpeta client/).
// Se compila a un binario linux-arm64 en el workflow build-babylon.yml.

import { join, normalize, sep } from "node:path";

const ROOT = normalize(process.env.ROOT ?? join(process.cwd(), "client"));
const PORT = Number(process.env.PORT ?? 8081);

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith("/")) path += "index.html";

    const full = normalize(join(ROOT, path));
    if (full !== ROOT && !full.startsWith(ROOT + sep)) {
      return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(full);
    if (await file.exists()) return new Response(file);

    // Rutas de la app como /online u /offline: devolver index.html.
    if (!path.slice(path.lastIndexOf("/")).includes(".")) {
      return new Response(Bun.file(join(ROOT, "index.html")));
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Cliente Babylon en http://0.0.0.0:${server.port} (carpeta ${ROOT})`);
