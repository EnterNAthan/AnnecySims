import type { IncomingMessage, ServerResponse } from "node:http";
import { decide } from "./intelligence";
import { chat } from "./chat";
import { DEFAULT_AI_CONFIG, type AiConfig } from "../src/shared/aiConfig";

/** Routes personnelles communes à Vite et au serveur Docker. */
export function createIntelligenceApi(env: Record<string, string>) {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  const routes = new Map<string, Handler>();
  const use = (path: string, handler: Handler) => routes.set(path, handler);
  let active = 0;
  // Configuration figée : habitants toujours sur Qwen, non modifiable (ARKANE_MODEL ne concerne que les événements)
  const config = (): AiConfig => DEFAULT_AI_CONFIG;
  let chatting = false;
  use("/api/agents/chat", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    if (chatting) { res.statusCode = 409; res.end(JSON.stringify({ error: "Une conversation est déjà en cours. Réessaie dans quelques secondes." })); return; }
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 140000) req.destroy(); });
    req.on("end", async () => {
      if (chatting) { res.statusCode = 409; res.end(JSON.stringify({ error: "Une conversation est déjà en cours" })); return; }
      chatting = true;
      try {
        const result = await chat(JSON.parse(body), env, config());
        res.end(JSON.stringify(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Conversation indisponible";
        res.statusCode = 502; res.end(JSON.stringify({ error: message }));
      } finally { chatting = false; }
    });
  });
  use("/api/ai-config", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
    res.end(JSON.stringify(config()));
  });
  use("/api/agents/decide", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
    const settings = config();
    if (active >= settings.concurrency) {
      res.statusCode = 429; res.end(JSON.stringify({ error: "File pleine" })); return;
    }
    active++;
    let body = "";
    req.on("data", (chunk) => { body += chunk; if (body.length > 180000) req.destroy(); });
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    req.on("aborted", release);
    req.on("end", async () => {
      try {
        const result = await decide(JSON.parse(body), env, settings);
        res.end(JSON.stringify(result));
      }
      catch (error) {
        const message = error instanceof Error ? error.message : "Erreur IA";
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
