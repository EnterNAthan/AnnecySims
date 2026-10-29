import { defineConfig, loadEnv, type Plugin } from "vite";
import { interpret } from "./server/interpret";

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
  return { plugins: [interpretApi(env.ANTHROPIC_API_KEY)] };
});
