// HTTP API shared by the Vite dev server (vite.config.ts) and the production server (server/main.ts).
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { analyze, cohortResponses, finalReport, interpret, warm } from "./interpret";
import { assetFile } from "./assets";
import { createIntelligenceApi } from "./intelligenceApi";

const handleIntelligence = createIntelligenceApi(process.env as Record<string, string>);

type Handler = (body: any) => Promise<unknown>;

const MAX_BODY = 1_000_000;

/** LLM routes (Arkane), all POST with a JSON body. */
const routes: Record<string, Handler> = {
  "/api/interpret": (b) => interpret(String(b.text).slice(0, 600), b.context, !!b.extreme),
  "/api/warm": (b) => warm((b.texts as unknown[]).map(String).slice(0, 12), b.context, !!b.extreme),
  "/api/cohorts": (b) => cohortResponses(b.event, b.cohorts),
  "/api/analyze": (b) => analyze(b.event, b.before, b.after, b.cohorts, b.responses),
  "/api/bilan": (b) => finalReport(b.event, b.bilan),
};

/** 3D models from the asset bank: downloaded on first request, then served from the disk cache. */
async function serveModel(id: string, res: ServerResponse) {
  try {
    const file = await assetFile(id);
    if (!file) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "model/gltf-binary");
    res.setHeader("Cache-Control", "max-age=86400");
    res.end(readFileSync(file));
  } catch (err) {
    res.statusCode = 502;
    res.end(String(err));
  }
}

function serveRoute(handler: Handler, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) req.destroy();
  });
  req.on("end", async () => {
    res.setHeader("Content-Type", "application/json");
    try {
      res.end(JSON.stringify(await handler(JSON.parse(body))));
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: String(err) }));
    }
  });
}

/** Handles the request if it targets the API; returns false to let the caller serve it. */
export function handleApi(req: IncomingMessage, res: ServerResponse): boolean {
  if (handleIntelligence(req, res)) return true;
  const path = (req.url ?? "/").split("?")[0];
  if (path.startsWith("/models/")) {
    void serveModel(decodeURIComponent(path.slice("/models/".length).replace(/\.glb$/, "")), res);
    return true;
  }
  const handler = routes[path];
  if (!handler) return false;
  serveRoute(handler, req, res);
  return true;
}
