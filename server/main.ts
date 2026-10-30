// Production server: the built site (dist/) plus the API, on a single port.
// Bundled by `npm run build:server` into dist-server/main.mjs; run with `node dist-server/main.mjs`.
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { handleApi } from "./api";

const PORT = Number(process.env.PORT || 8080);
const STATIC_DIR = resolve(process.env.STATIC_DIR || "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

if (!process.env.ARKANE_API_KEY) console.warn("[server] ARKANE_API_KEY absente : interprétation par mots-clés uniquement");

createServer((req, res) => {
  if (req.url === "/healthz") {
    res.end("ok");
    return;
  }
  if (handleApi(req, res)) return;
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.end();
    return;
  }
  // path traversal guard: the resolved file must stay inside STATIC_DIR
  const requestedPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = join(STATIC_DIR, normalize(requestedPath));
  if (!file.startsWith(STATIC_DIR)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, "index.html");
  // hashed bundles never change; everything else is revalidated
  const immutable = file.includes(`${join(STATIC_DIR, "assets")}/`) && /-[\w-]{8,}\.\w+$/.test(file);
  res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
  res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`[server] http://0.0.0.0:${PORT} (static: ${STATIC_DIR})`));
