import type { IncomingMessage, ServerResponse } from "node:http";
import { decide, type RequestMetrics } from "./intelligence";
import { chat } from "./chat";
import { createModelStats } from "./modelStats";
import { AiConfigSchema, DEFAULT_AI_CONFIG } from "../src/shared/aiConfig";

/** Routes personnelles communes à Vite et au serveur Docker. */
export function createIntelligenceApi(env: Record<string, string>) {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  const routes = new Map<string, Handler>();
  const use = (path: string, handler: Handler) => routes.set(path, handler);
  let active = 0;
  const stats = createModelStats();
  let config = { ...DEFAULT_AI_CONFIG };
  let chatting = false;
  use("/api/agents/chat", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    if (!config.enabled || chatting) { res.statusCode = 409; res.end(JSON.stringify({ error: chatting ? "Une conversation est déjà en cours. Réessaie dans quelques secondes." : "IA suspendue dans la configuration" })); return; }
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 140000) req.destroy(); });
    req.on("end", async () => {
      if (chatting) { res.statusCode = 409; res.end(JSON.stringify({ error: "Une conversation est déjà en cours" })); return; }
      chatting = true;
      const at = Date.now();
      const settings = { ...config };
      let agent = "Conversation";
      try {
        const input = JSON.parse(body);
        agent = `Discussion · ${JSON.parse(input.context).person?.name ?? "Habitant"}`;
        const result = await chat(input, env, settings);
        stats.record({ at, agent, model: settings.model, status: 200, duration: Date.now() - at, result: { ...result, decisions: [] } });
        res.end(JSON.stringify(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Conversation indisponible";
        stats.record({ at, agent, model: settings.model, status: 502, duration: Date.now() - at, error: message });
        res.statusCode = 502; res.end(JSON.stringify({ error: message }));
      } finally { chatting = false; }
    });
  });
  use("/api/ai-config", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") { res.end(JSON.stringify(config)); return; }
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 8000) req.destroy(); });
    req.on("end", () => {
      try { config = AiConfigSchema.parse(JSON.parse(body)); res.end(JSON.stringify(config)); }
      catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Configuration invalide" })); }
    });
  });
  use("/api/model-stats", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
    res.end(JSON.stringify(stats.snapshot(active + Number(chatting), config.model)));
  });
  use("/api/agents/decide", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    const settings = { ...config };
    const model = settings.model;
    if (!settings.enabled) { res.statusCode = 409; res.end(JSON.stringify({ error: "IA suspendue dans la configuration" })); return; }
    if (active >= settings.concurrency) {
      stats.record({ at: Date.now(), agent: "Non identifié", model, status: 429, duration: 0, error: "File pleine" });
      res.statusCode = 429; res.end(JSON.stringify({ error: "File pleine" })); return;
    }
    active++;
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 180000) req.destroy(); });
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    req.on("aborted", release);
    req.on("end", async () => {
      const at = Date.now();
      let agent = "Non identifié";
      let metrics: RequestMetrics | undefined;
      try {
        const input = JSON.parse(body);
        try { agent = input.contexts ? input.contexts.map((entry: { context: string }) => JSON.parse(entry.context).person?.name ?? "?").join(", ") : String(JSON.parse(input.context).person?.name ?? agent); } catch { /* validation dans decide */ }
        const result = await decide(input, env, settings, (value) => { metrics = value; });
        stats.record({ at, agent, model, status: 200, duration: Date.now() - at, result, metrics });
        res.end(JSON.stringify(result));
      }
      catch (error) {
        const message = error instanceof Error ? error.message : "Erreur IA";
        stats.record({ at, agent, model, status: 502, duration: Date.now() - at, error: message, metrics });
        res.statusCode = 502;
        res.end(JSON.stringify({ error: message }));
      }
      finally { release(); }
    });
  });
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const handler = routes.get((req.url ?? "/").split("?")[0]);
    if (!handler) return false;
    handler(req, res);
    return true;
  };
}
