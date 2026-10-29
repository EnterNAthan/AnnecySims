# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projet

Simulation 3D (Three.js + Vite, TypeScript strict, ESM) du centre d'Annecy construite à partir d'OpenStreetMap : 50 habitants simulés par défaut, événements déclenchés en langage naturel (interprétés par Claude), bilans quotidiens. Les textes visibles par le joueur sont en français.

## Commandes

```bash
npm run dev            # serveur Vite + endpoint /api/interpret
npm run typecheck      # tsc (noEmit) — seul contrôle automatique, pas de tests ni de linter
npm run build          # tsc && vite build
npm run sim:headless -- 5000 2   # moteur sans rendu : [habitants] [jours], affiche perf + DayReport
npx tsx scripts/check-demographics.ts 10000   # population générée vs cibles INSEE (src/sim/demographics.ts)
npm run fetch-osm      # Overpass → data/osm-raw.json (gitignoré, à lancer une fois)
npm run build-city     # data/osm-raw.json → public/city.json (versionné, ~2,6 Mo)
```

`sim:headless` sert de test de non-régression du moteur : vérifier les temps et la cohérence du bilan après une modif dans `src/sim/`.

Paramètres d'URL de la page : `?pop=N` (2 550 résidents par défaut : 50 suivis par IA et 2 500 automatiques), `?h=N` (heure de départ), `?paused`, `?debug` (expose `window.sim`), `?ai=off` (désactive les décisions individuelles).

## Intelligence individuelle

Seuls 50 habitants sélectionnés de façon stable utilisent Arkane/Qwen via `server/intelligence.ts`, séparément des routes municipales Claude Code et de leur repli local. Les 2 500 autres résidents conservent les plannings automatiques. La limite IA est réglable dans `/stats` et les personnes suivies sont accessibles dans le menu d'affichage. `src/sim/intelligence.ts` orchestre les décisions sans bloquer les ticks ; `aiContext.ts` transmet les besoins, souvenirs, contraintes, mobilité et événements proches actifs du nouveau moteur. Les visiteurs des événements et véhicules de transit restent gérés par le moteur : ils ne sont pas ajoutés aux appels Qwen des résidents.

`/stats` expose les mesures et la configuration (`/api/ai-config`). Profil stable : groupes de cinq, un appel en cours, `reasoning_effort: none`, un agent = une personne (`AGENT_SCALE = 1`). La clé `ARKANE_API_KEY` reste côté serveur. `npm run test:ai` vérifie aussi le raccordement aux événements, bus et parkings. Voir `benchmarks/README.md` pour les mesures Arkane isolées. Les endpoints sont disponibles uniquement avec le serveur de développement.

`ANTHROPIC_API_KEY` dans `.env` (voir `.env.example`) ; sans clé, l'interprétation retombe sur les mots-clés.

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

- L'endpoint est un **middleware Vite** (`vite.config.ts`, `configureServer`) : il n'existe qu'avec `npm run dev`, pas dans `vite preview` ni le build statique.
- La clé reste côté serveur (pas de préfixe `VITE_`).
- `server/interpret.ts` utilise sortie structurée Zod (`betaZodOutputFormat`) contrainte par `EVENT_KINDS` et les noms de `LOCATIONS`, avec prompt système en cache. Tout échec retombe sur `interpretLocally`.
- **Ajouter un type d'événement** : une entrée dans `EVENT_KINDS` + `EVENT_SPECS` (`src/shared/catalog.ts`, avec `keywords` sans accents pour le mode hors ligne) — le prompt, le schéma et le moteur en dérivent ; prévoir le rendu dans `render/events.ts` ou `render/disasters.ts`. Un nouveau lieu se déclare dans `src/shared/locations.ts`.

### Données de la ville

`scripts/build-city.ts` projette en mètres (x, z) les bâtiments (hauteurs), routes (avec `ROAD_FLAGS` : voiture/vélo/piéton…), eau, espaces verts et POI. Modifier le format `City` implique de régénérer `public/city.json` (nécessite `data/osm-raw.json`, donc `fetch-osm` au préalable).

## Conventions

- Commentaires du code existant en français.
- Aléa du moteur via `this.rand` (`mulberry32(seed)`, seed 2026) — pas de `Math.random` dans `src/sim/` pour garder les runs reproductibles. La page démarre à la date du jour, le headless au 2026-10-29.
