# Données de la ville

## Chaîne de préparation

```
Overpass API  --npm run fetch-osm-->  data/osm-raw.json   (gitignoré, à lancer une fois)
                --npm run build-city-->  public/city.json  (versionné, ~2,6 Mo)
Overpass/GTFS --npm run fetch-transit--> …
                --npm run build-transit--> public/transit.json
Kenney/Quaternius --npm run build-asset-index--> public/assets/index.json
```

`scripts/build-city.ts` projette tout en **mètres locaux** (`project()` dans
`src/shared/geo.ts`, x = est, z = sud comme Three.js) : bâtiments avec hauteurs, routes
avec `ROAD_FLAGS` (voiture / vélo / piéton…), eau, espaces verts, POI. Coordonnées
aplaties `[x0, z0, x1, z1, …]`.

**Modifier le format `City` oblige à régénérer `public/city.json`**, donc à avoir
`data/osm-raw.json`, donc à relancer `fetch-osm` au préalable.

## Lieux nommés

`src/shared/locations.ts` — liste manuelle des lieux emblématiques (Pâquier, Vieille ville,
Gare, Hôtel de Ville, Marquisats…). Ce sont à la fois les étiquettes de la carte et les
**cibles possibles des événements** : le schéma Zod de `/api/interpret` contraint
`location` à cette énumération. Ajouter un lieu = une entrée ici.

`src/shared/streets.ts` — `streetNames(city)` et `matchStreet()` : rapprochement d'une
désignation approximative (« avenue de Genève ») vers le nom OSM exact. Ce qui n'est pas
trouvé est signalé au joueur dans la `note`.

## Transports

`public/transit.json` : lignes Sibra (ref, couleur, nom, arrêts, tracé) et parkings
publics. Consommé par `BusNetwork` / `Parkings` (simulation) et `TransitView` (rendu).
Absent ⇒ la simulation tourne sans bus ni parkings (`opts.transit` optionnel).

## Banque de modèles 3D

`public/assets/index.json` : catalogue CC0 (Kenney, Quaternius) — id `pack/nom`, tags, URL,
taille. `server/assets.ts` fait la recherche par recouvrement de mots-clés
(`findAsset`, seuil de score 0,5) et **télécharge à la demande** dans `data/asset-cache/`,
servi par le middleware `/models/<id>.glb`. Claude choisit les `assets` à poser
(1 à 8 objets, placement `centre`/`cercle`/`ligne`/`disperse`/`ciel`/`lac`, mouvement,
altitude) pour rendre tout événement visible.

## Ajouter un type d'événement

1. Une entrée dans `EVENT_KINDS` **et** `EVENT_SPECS` (`src/shared/catalog.ts`), avec des
   `keywords` **sans accents** pour le mode hors ligne.
2. Le prompt, le schéma Zod et le moteur en dérivent automatiquement.
3. Prévoir le rendu dans `src/render/events.ts` ou `src/render/disasters.ts`.

Le type générique `evenement` existe pour tout ce qui n'entre dans aucune case : Claude le
décrit alors par ses `EventTraits` (nature, fréquentation, prix, décor, public, navettes,
danger, fermeture de rues, humeur).
