# Base de connaissance — AnnecySims

Notes de prise en main rédigées le 2026-10-29 à partir du code (branche `nathanDev`,
commit `109fd54`). `CLAUDE.md` reste la référence des commandes et conventions ;
ces fiches expliquent le *pourquoi* et les pièges.

- [Vision produit](01-vision-produit.md) — à quoi on joue, quelle est la boucle de jeu.
- [Architecture](02-architecture.md) — qui tourne où, les trois zones, le flux page ↔ worker.
- [Les deux IA](03-les-deux-ia.md) — Claude Code (ville) vs Arkane/Qwen (habitants).
- [Données de la ville](04-donnees-ville.md) — OSM → `city.json`, `transit.json`, banque de modèles.
- [Pièges et conventions](05-pieges.md) — ce qui casse sans prévenir, doc périmée, vérifications.

État constaté : `npm run typecheck` vert. Pas de tests unitaires ni de linter ;
`sim:headless` et `test:ai` jouent ce rôle.
