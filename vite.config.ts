import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import { analyze, cohortResponses, interpret } from "./server/interpret";

type Handler = (body: any) => Promise<unknown>;

/** Routes IA (Claude via Claude Code) servies par le serveur de développement. */
function aiApi(): Plugin {
  const routes: Record<string, Handler> = {
    "/api/interpret": (b) => interpret(String(b.text).slice(0, 600), b.context, !!b.extreme),
    "/api/cohorts": (b) => cohortResponses(b.event, b.cohorts),
    "/api/analyze": (b) => analyze(b.event, b.before, b.after, b.cohorts, b.responses),
  };
  return {
    name: "annecy-ai-api",
    configureServer(server) {
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

export default defineConfig({ plugins: [aiApi()] });
