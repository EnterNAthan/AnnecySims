import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({ plugins: [aiApi()] });
