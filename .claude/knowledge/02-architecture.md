# Architecture

Stack : **Vite 5 + TypeScript strict (ESM) + Three.js 0.169 + Zod 4**. Aucun framework
UI : DOM à la main. Node pour les scripts (`tsx`). ~12 400 lignes de TS.

## Trois zones, séparées par *ce qui peut tourner où*

| Zone | Contrainte | Contenu |
|---|---|---|
| `src/sim/` | **ni DOM ni Three.js** — tourne dans Node et dans le Web Worker | moteur de simulation |
| `src/render/` + `src/main.ts` + `src/ui/` | thread principal, navigateur | scène 3D, horloge, panneaux |
| `src/shared/` | importé **partout, serveur compris** | format `City`, géo, catalogue, lieux, schémas Zod |
| `server/` | Node, middlewares Vite de dev uniquement | appels LLM, banque de modèles |

C'est la règle structurante : si un module de `src/sim/` importe Three.js ou `document`,
`sim:headless` et le worker cassent.

## Le moteur (`src/sim/`)

`engine.ts` (~2 000 lignes) est le cœur, entouré de modules spécialisés :

- `graph.ts` — graphe routier orienté en **CSR** + A* par mode (`Mode`), vitesses
  marche 1,35 m/s, vélo 4,5 m/s.
- `places.ts` — lieux (`PlaceKind` : home, work, shop, food, park, lake, station, exit…)
  rattachés aux nœuds du graphe ; `transient()` crée le lieu d'un événement.
- `population.ts` + `demographics.ts` — génération des habitants et des **ménages**
  calibrée INSEE (`PROFILES` : salarie, frontalier, etudiant, retraite, commercant,
  enfant, chomeur, inactif, touriste, pendulaire, visiteur, transit).
- `planner.ts` — planning journalier, par **foyer** (`planHousehold`) puis ajustements
  individuels ; `insertOuting()` glisse une sortie dans une plage libre à domicile.
- `events.ts` — météo et événements du jour (`DayPlan`), générateur à règles.
- `eventGeometry.ts` / `venue.ts` — zone d'effet, rues fermées, parcours ;
  aménagement (scène, zone du public, stands) calculé **une seule fois** et partagé
  entre simulation (placement de la foule) et rendu 3D.
- `transit.ts` — lignes Sibra, navettes, parkings publics avec occupation.
- `cohorts.ts` — regroupement profil × quartier, stats mesurées, application des réactions.
- `kpis.ts` (`DayLog`) — journal minute par minute pour comparer avant/pendant.
- `water.ts` — masque d'eau (rien ne se pose dans le lac).

Réserves d'agents en plus des résidents : `VISITOR_POOL = 5000` (visiteurs extérieurs
mobilisés par les grands événements) et `TRANSIT_POOL = 3000` (traversée, livraisons).
`AGENT_SCALE = 1` : un agent = une personne réelle (le fichier a connu 4, les commentaires
le rappellent).

## Flux page ↔ worker (`src/sim/protocol.ts`)

Messages typés `ToWorker` / `FromWorker`. À chaque frame la page envoie
`tick { day, minute, buffer }` ; le worker :

1. rattrape les **jours entiers** (un `day` + `dayStart` par minuit),
2. avance au plus **45 minutes simulées** par tick (évite le long silence au démarrage
   en milieu de journée),
3. remplit le `Float32Array` (`FRAME_STRIDE = 6` floats par agent) et le **renvoie en
   transferable** — le buffer fait l'aller-retour, on ne le copie jamais,
4. relaie `engine.outbox` (demandes de cohortes, impacts, bilans),
5. émet la couche **trafic** toutes les 5 minutes simulées, et les tracés de bus
   quand `transitChanged`.

Page et worker chargent **chacun** `/city.json` et `/transit.json` séparément.

## Rendu (`src/render/`)

- `agents.ts` — `InstancedMesh` ; l'animation (jambes, bras, pédalage) est dans le
  **vertex shader** : coût CPU nul. Capacité `total × FRAME_CAPACITY_FACTOR`.
- `scene.ts` — caméra `MapControls`, ciel et éclairage jour/nuit.
- `cityMeshes.ts`, `landmarks.ts`, `traffic.ts`, `transit.ts` — ville, étiquettes, calques.
- `events.ts`, `venue.ts`, `disasters.ts`, `model.ts`, `assets.ts` — décor d'événement,
  effets spectaculaires, modèle improvisé par Claude, modèles .glb de la banque.
- `intro.ts`, `viewStyle.ts`, `thoughts.ts` — ouverture, style « verre » / « réaliste », bulles.

## UI (`src/ui/`, `index.html`)

Panneaux : barre de commande (`command.ts`), décisions et impacts (`decisions.ts`),
historique et bilans (`history.ts`), fiche habitant, « Voix de la ville », compteurs,
calques (trafic / bus / parkings). Configuration de l'IA individuelle figée (`src/shared/aiConfig.ts`), lue par la page via `GET /api/ai-config`.

## Paramètres d'URL

`?pop=N` · `?h=N` (heure de départ) · `?paused` · `?debug` (expose `window.sim`) ·
`?ai=off` · `?nointro` · `?view=`
