import { defineConfig, loadEnv, type Plugin } from "vite";
import { decide, type RequestMetrics } from "./server/intelligence";
import { createModelStats } from "./server/modelStats";
import { AiConfigSchema, DEFAULT_AI_CONFIG } from "./src/shared/aiConfig";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { analyze, cohortResponses, finalReport, interpret, warm } from "./server/interpret";
import { assetFile } from "./server/assets";

type Handler = (body: any) => Promise<unknown>;

/** Routes IA (Claude via Claude Code) servies par le serveur de développement. */
function aiApi(): Plugin {
  const routes: Record<string, Handler> = {
    "/api/interpret": (b) => interpret(String(b.text).slice(0, 600), b.context, !!b.extreme),
    "/api/warm": (b) => warm((b.texts as unknown[]).map(String).slice(0, 12), b.context, !!b.extreme),
    "/api/cohorts": (b) => cohortResponses(b.event, b.cohorts),
    "/api/analyze": (b) => analyze(b.event, b.before, b.after, b.cohorts, b.responses),
    "/api/bilan": (b) => finalReport(b.event, b.bilan),
  };
  return {
    name: "annecy-ai-api",
    configureServer(server) {
      // modèles 3D de la banque : téléchargés à la première demande, puis servis depuis le cache
      server.middlewares.use("/models/", async (req: IncomingMessage, res: ServerResponse) => {
        const id = decodeURIComponent((req.url ?? "").replace(/^\//, "").replace(/\.glb$/, ""));
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
      });
      for (const [path, handler] of Object.entries(routes)) {
        server.middlewares.use(path, (req: IncomingMessage, res: ServerResponse) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end();
            return;
          }
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", async () => {
            res.setHeader("Content-Type", "application/json");
            try {
              res.end(JSON.stringify(await handler(JSON.parse(body))));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // la clé reste côté serveur : jamais exposée au navigateur (pas de préfixe VITE_)
  const env = loadEnv(mode, process.cwd(), "");
  const intelligence: Plugin = {
    name: "annecy-intelligence",
    configureServer(server) {
      let active = 0;
      const stats = createModelStats();
      let config = { ...DEFAULT_AI_CONFIG };
      server.middlewares.use("/api/ai-config", (req, res) => {
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
      server.middlewares.use((req, _res, next) => {
        if (req.url?.split("?")[0] === "/stats") req.url = req.url.replace("/stats", "/stats.html");
        next();
      });
      server.middlewares.use("/api/model-stats", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
        res.end(JSON.stringify(stats.snapshot(active, config.model)));
      });
      server.middlewares.use("/api/agents/decide", (req, res) => {
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
    },
  };
  return { plugins: [aiApi(), intelligence],
    build: { rollupOptions: { input: { main: "index.html", stats: "stats.html" } } } };
});
