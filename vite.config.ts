import { defineConfig, loadEnv, type Plugin } from "vite";
import { interpret } from "./server/interpret";
import { decide } from "./server/intelligence";
import { createModelStats } from "./server/modelStats";

/** POST /api/interpret { text, context } → proposition d'événement (Claude, ou mots-clés sans clé). */
function interpretApi(apiKey?: string): Plugin {
  return {
    name: "annecy-interpret-api",
    configureServer(server) {
      server.middlewares.use("/api/interpret", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            const { text, context } = JSON.parse(body);
            const result = await interpret(String(text).slice(0, 500), context, apiKey);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(result));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: String(err) }));
          }
        });
      });
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
      const model = env.ARKANE_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash";
      server.middlewares.use((req, _res, next) => {
        if (req.url?.split("?")[0] === "/stats") req.url = req.url.replace("/stats", "/stats.html");
        next();
      });
      server.middlewares.use("/api/model-stats", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
        res.end(JSON.stringify(stats.snapshot(active, model)));
      });
      server.middlewares.use("/api/agents/decide", (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        if (active >= 8) {
          stats.record({ at: Date.now(), agent: "Non identifié", model, status: 429, duration: 0, error: "File pleine" });
          res.statusCode = 429; res.end(JSON.stringify({ error: "File pleine" })); return;
        }
        active++;
        let body = "";
        req.on("data", (chunk) => { body += chunk; if (body.length > 40000) req.destroy(); });
        let released = false;
        const release = () => { if (!released) { released = true; active--; } };
        req.on("aborted", release);
        req.on("end", async () => {
          const at = Date.now();
          let agent = "Non identifié";
          try {
            const input = JSON.parse(body);
            try { agent = String(JSON.parse(input.context).person?.name ?? agent); } catch { /* contexte invalide : validation dans decide */ }
            const result = await decide(input, env);
            stats.record({ at, agent, model, status: 200, duration: Date.now() - at, result });
            res.end(JSON.stringify(result));
          }
          catch (error) {
            const message = error instanceof Error ? error.message : "Erreur IA";
            stats.record({ at, agent, model, status: 502, duration: Date.now() - at, error: message });
            res.statusCode = 502;
            res.end(JSON.stringify({ error: message }));
          }
          finally { release(); }
        });
      });
    },
  };
  return { plugins: [interpretApi(env.ANTHROPIC_API_KEY), intelligence],
    build: { rollupOptions: { input: { main: "index.html", stats: "stats.html" } } } };
});
