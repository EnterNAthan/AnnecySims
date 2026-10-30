import { defineConfig, loadEnv, type Plugin } from "vite";
import { handleApi } from "./server/api";

/** Routes IA (Arkane) et banque de modèles 3D, servies par le serveur de développement. */
function aiApi(): Plugin {
  return {
    name: "annecy-ai-api",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handleApi(req, res)) next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // ARKANE_* du .env : lues côté serveur par server/llm.ts, jamais exposées au navigateur (pas de préfixe VITE_)
  Object.assign(process.env, loadEnv(mode, process.cwd(), "ARKANE_"));
  return { plugins: [aiApi()], build: { rollupOptions: { input: { main: "index.html" } } } };
});
