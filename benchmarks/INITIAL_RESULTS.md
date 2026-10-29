# Premiers résultats Arkane — 29 octobre 2026

Modèle : `qwen38-27b-turbo-v2`. Mesures réalisées avec les profils reproductibles du laboratoire, sans rendu 3D. Ce sont des essais courts, pas un engagement de capacité.

| Scénario | Appels réussis | Durée par appel | Décisions par appel |
| --- | --- | --- | --- |
| Individuel compact, raisonnement laissé au provider | 2/2 | 24,5–24,8 s | 1 |
| Lot compact, raisonnement laissé au provider | 2/2 | 27,5–30,9 s | 5 |
| Lot allégé, raisonnement laissé au provider | 2/2 | 38,6–44,9 s | 5 |
| Deux lots simultanés | 1/2 | 31,7 s pour le succès ; échec 503 immédiat pour l'autre | 5 |
| Lot compact, `reasoning_effort: none` | 5/5 | 4,7–6,8 s | 5 |

Les cinq essais sans raisonnement ont été réalisés en deux séries successives. Dans la seconde série, le débit observé était d'environ 55 décisions/minute. Le modèle a produit des JSON valides avec les bons identifiants et des cibles autorisées ; cela ne mesure pas la qualité sociale à long terme.

Le contexte plus court n'a pas suffi à accélérer les réponses lors de cet essai. La désactivation explicite du raisonnement a donné le meilleur résultat observé. L'ordre des scénarios, la charge du service, le cache et le nombre réduit d'échantillons empêchent d'attribuer une garantie de performance à ces différences.

## Profil retenu

- Groupes de cinq, un appel en cours maximum.
- Raisonnement désactivé, température 0,3 et contexte compact.
- Au maximum un nouveau départ toutes les cinq secondes.
- Intervalle individuel minimum de 60 secondes ; les personnes attendent leur tour si le débit ne suffit pas.
- Timeout 60 secondes, aucun retry immédiat ; pause globale de 30 secondes après trois échecs consécutifs.

Pour 100 habitants, ce débit suggère environ deux minutes pour renouveler toutes les décisions dans les conditions mesurées, et davantage avec une marge de sécurité ou des erreurs. Ce n'est pas une décision par habitant toutes les 60 secondes. Augmenter la population espace les décisions ; cela ne nécessite pas d'augmenter les appels simultanés.

## Reproduire

```powershell
npm.cmd run bench:arkane -- --quick --samples=2
npm.cmd run bench:arkane -- --scenario=lot5-sans-raisonnement --samples=3
```

Les données originales sont disponibles localement dans `results/2026-10-29T18-47-48-222Z/`, `results/2026-10-29T18-54-46-163Z/` et `results/2026-10-29T18-56-17-112Z/`. Elles sont ignorées par Git. Consulter `README.md` pour les limites de mesure et la matrice complète.
