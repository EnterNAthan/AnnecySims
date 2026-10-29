# Laboratoire Arkane

Le laboratoire s'exécute sans navigateur et sans modifier la ville ou ses réglages. Les profils sont reproductibles (100 habitants, graine 2026), avec cinq personnes, contraintes, proches et souvenirs. La clé vient de `.env` et n'est jamais écrite dans les rapports.

```powershell
npm.cmd run bench:arkane -- --dry-run
npm.cmd run bench:arkane -- --quick
npm.cmd run bench:arkane -- --samples=3
npm.cmd run bench:arkane -- --samples=3 --model=qwen38-27b-turbo-v2
npm.cmd run bench:arkane -- --scenario=lot5-sans-raisonnement --samples=3
npm.cmd run test:ai
```

- `--dry-run` : inspecte les tailles sans appeler Arkane.
- `--quick` : quatre scénarios, un échantillon chacun. Pour comparer la concurrence, ajouter `--samples=2` au minimum.
- Essai complet : sept scénarios, trois échantillons chacun par défaut. Compare individuel/lot de cinq, contexte complet/compact/allégé, concurrence 1/2, budgets 1 500/3 000 tokens et raisonnement désactivé.
- Les scénarios de référence laissent le provider choisir le raisonnement ; `lot5-sans-raisonnement` envoie explicitement `reasoning_effort: none`. Ce dernier correspond au réglage retenu dans la ville.
- `--samples=1..10` : répétitions par scénario. Aucun retry caché.

Les rapports Markdown et JSON sont enregistrés dans `benchmarks/results/` (ignoré par Git), avec sauvegarde après chaque appel. Ils contiennent délais jusqu'aux en-têtes et réponse complète, statut HTTP, tokens quand fournis, validation JSON/identifiants/cibles et décisions par minute. Ne pas confondre en-têtes et premier token : l'API est appelée sans streaming.

Les projections de population concernent un renouvellement des décisions en 60 secondes, avec marge de 30 % et plafond de départs du profil stable. Elles ne mesurent pas la capacité du rendu 3D. Un test court ne suffit pas pour annoncer une capacité maximale ou un p95 fiable. Répéter à plusieurs heures, avec la ville fermée pour isoler la charge du laboratoire.

Le profil par défaut privilégie la stabilité : Qwen sans raisonnement, cinq personnes/appel, une requête en cours, un départ toutes les cinq secondes au maximum, 60 secondes minimum par personne, mémoire de 16 souvenirs et timeout de 60 secondes. Trois échecs consécutifs déclenchent une pause de 30 secondes dans le moteur ; les habitants poursuivent leur planning. Le bouton « Valeurs prudentes » de `/stats` restaure ce profil.
