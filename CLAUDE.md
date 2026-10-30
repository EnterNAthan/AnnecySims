# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

Simulation 3D (Three.js + Vite, TypeScript strict, ESM) d'Annecy construite à partir d'OpenStreetMap : 2 550 habitants par défaut, dont 50 IA et 2 500 automatiques. Les événements, leur interface et le déploiement Docker/Helm viennent de main. Les textes visibles par le joueur sont en français.

## Commandes

```bash
npm run dev            # serveur Vite + API (/api/*, /models/)
npm run typecheck      # tsc (noEmit)
npm run test:ai        # régressions IA, chat, population mixte et routes HTTP (fournisseur simulé)
npm run build          # tsc && vite build → dist/
npm run build:server   # esbuild server/main.ts → dist-server/main.mjs (autonome, zod inclus)
npm start              # serveur de prod : dist/ + API sur $PORT (8080)
docker build -t ane-sims .   # image de prod (Dockerfile), données/caches dans le volume /app/data
npm run sim:headless -- 5000 2   # moteur sans rendu : [habitants] [jours], affiche perf + DayReport
npx tsx scripts/check-demographics.ts 10000   # population générée vs cibles INSEE (src/sim/demographics.ts)
npm run fetch-osm      # Overpass → data/osm-raw.json (gitignoré, à lancer une fois)
npm run build-city     # data/osm-raw.json → public/city.json (versionné, ~2,6 Mo)
```

`sim:headless` sert de test de non-régression du moteur : vérifier les temps et la cohérence du bilan après une modif dans `src/sim/`.

Paramètres d'URL de la page : `?pop=N` (2 550 résidents par défaut : 50 suivis par IA et 2 500 automatiques), `?h=N` (heure de départ), `?paused`, `?debug` (expose `window.sim`), `?ai=off` (désactive les décisions individuelles).

## Intelligence individuelle

Seuls 50 habitants sélectionnés de façon stable utilisent Arkane/Qwen via `server/intelligence.ts`, séparément des routes municipales Arkane de main et de leur repli local. Les 2 500 autres résidents conservent les plannings automatiques. Leur modèle (Qwen) et leurs réglages sont figés dans `src/shared/aiConfig.ts`, non modifiables à l'exécution ; `ARKANE_MODEL` ne concerne que les événements. Les personnes suivies sont accessibles dans le menu d'affichage. `src/sim/intelligence.ts` orchestre les décisions sans bloquer les ticks ; `aiContext.ts` transmet les besoins, souvenirs, contraintes, mobilité et événements proches actifs du moteur. Les visiteurs des événements et véhicules de transit restent automatiques. `server/intelligenceApi.ts` expose décisions, chat et configuration (lecture seule) en dev comme en production. Les discussions et biographies sont conservées dans le worker pendant la session. Un habitant simulé représente une personne (`AGENT_SCALE = 1`).

`/api/ai-config` (lecture seule) transmet cette configuration à la page. Profil stable : groupes de cinq, un appel en cours, `reasoning_effort: none`, un agent = une personne (`AGENT_SCALE = 1`). La clé `ARKANE_API_KEY` reste côté serveur. `npm run test:ai` vérifie aussi le raccordement aux événements, bus et parkings. Voir `benchmarks/README.md` pour les mesures Arkane isolées. Les endpoints sont disponibles uniquement avec le serveur de développement.

`ARKANE_API_KEY` (+ `ARKANE_BASE_URL`, `ARKANE_MODEL`) dans `.env` en dev, en variables d'environnement en prod (voir `.env.example`) ; sans clé, l'interprétation retombe sur les mots-clés.

## Architecture

Trois zones, séparées par ce qui peut tourner où :

- **`src/sim/`** — moteur pur, sans DOM ni Three.js, exécutable dans Node (`scripts/sim-headless.ts`) comme dans le Web Worker (`worker.ts`). `engine.ts` est le cœur : agents, graphe routier (`graph.ts`), lieux (`places.ts`), planning journalier (`planner.ts`), événements/météo (`events.ts`). Un agent représente `AGENT_SCALE` = 1 personne réelle pour le trafic, le CA et le CO₂.
- **`src/render/` + `src/main.ts` + `src/ui/`** — thread principal : scène Three.js, horloge (`SimClock`), UI. `main.ts` pilote le worker.
- **`src/shared/`** — importé partout, y compris par le serveur : format `City`, projection géo (`BBOX`, `project`), catalogue d'événements, lieux nommés, interpréteur par mots-clés.

### Flux page ↔ worker (`src/sim/protocol.ts`)

Messages typés `ToWorker` / `FromWorker`. À chaque frame, la page envoie `tick { day, minute, buffer }` ; le worker rattrape les jours entiers (émet `day` + `dayStart` à chaque minuit), avance jusqu'à la minute, remplit le `Float32Array` et le **renvoie en transferable** (le buffer fait l'aller-retour, ne pas le copier). Chaque agent occupe `FRAME_STRIDE` = 6 floats ; la constante est dupliquée en dur dans `Engine.snapshot` (`STRIDE = 6`) : les garder synchronisées.

La page et le worker chargent chacun `/city.json` séparément.

### Commandes en langage naturel

`ui/command.ts` → `POST /api/interpret` → `server/interpret.ts` → `EventProposal` → confirmation du joueur → message `addEvent` au worker → `engine.addEvent`.

- Les routes sont dans `server/api.ts`, montées par Vite en dev (`vite.config.ts`) et par `server/main.ts` en prod (pas par `vite preview`).
- La clé reste côté serveur (pas de préfixe `VITE_`).
- `server/llm.ts` (`askLlm`) appelle Arkane (`/chat/completions`, `json_object`) avec le schéma Zod converti en JSON Schema dans le prompt système, puis valide la sortie ; `/no_think` est ajouté pour les modèles Qwen. Tout échec retombe sur `interpretLocally`.
- **Ajouter un type d'événement** : une entrée dans `EVENT_KINDS` + `EVENT_SPECS` (`src/shared/catalog.ts`, avec `keywords` sans accents pour le mode hors ligne) — le prompt, le schéma et le moteur en dérivent ; prévoir le rendu dans `render/events.ts` ou `render/disasters.ts`. Un nouveau lieu se déclare dans `src/shared/locations.ts`.

### Données de la ville

`scripts/build-city.ts` projette en mètres (x, z) les bâtiments (hauteurs), routes (avec `ROAD_FLAGS` : voiture/vélo/piéton…), eau, espaces verts et POI. Modifier le format `City` implique de régénérer `public/city.json` (nécessite `data/osm-raw.json`, donc `fetch-osm` au préalable).

## Conventions

- Commentaires du code existant en français.
- Aléa du moteur via `this.rand` (`mulberry32(seed)`, seed 2026) — pas de `Math.random` dans `src/sim/` pour garder les runs reproductibles. La page démarre à la date du jour, le headless au 2026-10-29.
