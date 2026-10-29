# Pièges et conventions

## Pièges du code

- **`FRAME_STRIDE = 6` est dupliqué en dur** dans `Engine.snapshot` (`STRIDE = 6`).
  Les deux doivent rester synchronisés — rien ne le vérifie.
- **Le buffer de frame est transferable** : il fait l'aller-retour page → worker → page.
  Le copier ou l'oublier côté retour casse le rendu silencieusement.
- **Pas de `Math.random` dans `src/sim/`**. Tout l'aléa passe par `this.rand`
  (`mulberry32(seed)`, graine 2026), sinon les runs ne sont plus reproductibles et
  `sim:headless` ne sert plus de test de non-régression.
- **`src/sim/` ne doit importer ni DOM ni Three.js** : il tourne dans Node et dans le worker.
- **Les endpoints `/api/*` n'existent qu'en `npm run dev`** (middlewares Vite dans
  `vite.config.ts`). `vite preview` et le build statique n'en ont aucun.
- **Date de départ différente** : la page démarre à la date du jour, `sim:headless` au
  2026-10-29. Un écart de comportement peut venir de là (jour de semaine, météo).
- **`keywords` du catalogue sans accents** : l'interpréteur local normalise sans accents.
- `public/city.json` est **versionné** (~2,6 Mo) ; `data/osm-raw.json` et
  `benchmarks/results/` sont gitignorés.

## Vérifications disponibles

Pas de tests unitaires, pas de linter. Ce qui existe :

```bash
npm run typecheck                            # seul contrôle automatique (vert au 2026-10-29)
npm run sim:headless -- 5000 2               # non-régression du moteur : perf + DayReport
npx tsx scripts/check-demographics.ts 10000  # population générée vs cibles INSEE
npm run test:ai                              # 7 scripts check-* de la couche IA
npm run bench:arkane -- --quick --samples=2  # laboratoire Arkane isolé
npm run build                                # tsc && vite build
```

Après une modification de `src/sim/`, lancer `sim:headless` et comparer temps **et**
cohérence du bilan. Après une modification du rendu ou de l'UI, vérifier dans le navigateur.

## Documentation périmée — attention

- **`agents/*.md` décrit une architecture qui n'existe pas.** `agents/CONTRAT.md` parle de
  Next.js (`app/page.tsx`, `components/map/`, `lib/useSim.ts`), de WebSocket (`server/hub.ts`),
  de `sim/types.ts`, `sim/monde.ts`, `sim/tick.ts`, de `npm test`. Aucun de ces fichiers
  n'existe. C'était un plan de départ multi-agents, abandonné au profit de
  Vite + Three.js + Web Worker. **Ne pas s'y fier**, c'est `CLAUDE.md` qui fait foi.
- `AGENTS.md` (racine du projet) décrit, lui, bien la stack réelle, mais mentionne
  « commits en français sans préfixe conventionnel » — l'historique récent confirme
  (`intelligence stable`, `configurateur IA`). Les guidelines personnelles de Nicolas
  demandent au contraire des préfixes conventionnels : à arbitrer avec lui.

## Conventions

- Commentaires du code existant **en français**, identifiants en anglais.
- Deux espaces d'indentation, guillemets doubles, point-virgules, ES modules.
- camelCase (fonctions, variables), PascalCase (classes, interfaces), MAJUSCULES
  (constantes : `DEFAULT_POLICY`, `AGENT_SCALE`, `EVENT_SPECS`…).
- Textes visibles par le joueur en français, tutoiement dans les questions de confirmation.
- Secrets côté serveur uniquement, jamais de préfixe `VITE_`.
