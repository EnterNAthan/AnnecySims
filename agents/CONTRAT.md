# Contrat de territoires — AnnecySims

Un seul propriétaire par fichier. `sim/types.ts` et `lib/protocol.ts` appartiennent
au **chef d'orchestre** (Hermes) : aucun agent ne les modifie, tout le monde les
importe tels quels. En cas de besoin d'évolution de ces deux fichiers, remonter la
demande au chef d'orchestre plutôt que de les éditer.

Le domaine de simulation vit dans `sim/`, un dossier autonome : `sim/` n'importe
**rien** de `server/`, `components/` ni `lib/` (hors `lib/protocol.ts` si nécessaire).
Voir `sim/README.md` pour le détail.

| Agent         | Territoire                                                   | Interdits (ne jamais toucher)                                              | Vérification       |
|---------------|---------------------------------------------------------------|------------------------------------------------------------------------------|---------------------|
| sim-engine    | `sim/engine.ts`, `sim/tick.ts`, `sim/monde.ts`                 | `sim/types.ts`, `lib/protocol.ts`, `sim/llm/**`                              | `npx tsc --noEmit`  |
| llm-prompts   | `sim/llm/prompts.ts`, `sim/llm/moteur.ts`                      | `sim/types.ts`, `lib/protocol.ts`, `sim/contrat.ts`, `sim/llm/client.ts`, `server/**`, `components/**`, `app/**` | `npx tsc --noEmit`  |
| realtime-hub  | `server.ts`, `server/hub.ts`                                   | `sim/types.ts`, `lib/protocol.ts`, `sim/engine.ts`, `sim/tick.ts`, `sim/monde.ts`, `sim/llm/**`, `components/**` | `npx tsc --noEmit`  |
| map-layer     | `components/map/**`                                            | `sim/types.ts`, `lib/protocol.ts`, `server/**`, `sim/llm/**`, `components/panel/**`, `app/**` | `npx tsc --noEmit`  |
| ui-panels     | `components/panel/**`, `app/page.tsx`, `app/globals.css`      | `sim/types.ts`, `lib/protocol.ts`, `server/**`, `sim/llm/**`, `components/map/**` | `npx tsc --noEmit`  |
| test-writer   | `__tests__/**`                                                 | `lib/**`, `sim/**`, `server/**`, `components/**`, `app/**`                  | `npm test`          |
| reviewer      | aucun (lecture seule)                                          | tous les fichiers                                                            | `npx tsc --noEmit`  |
| fixtures      | `data/fixtures/**`, `sim/llm/cache.ts`                         | `sim/types.ts`, `lib/protocol.ts`, `sim/llm/client.ts`, `sim/llm/prompts.ts`, `sim/llm/moteur.ts`, `server/**`, `components/**`, `app/**` | `npx tsc --noEmit`  |

## Règle

- Un fichier appartient à au plus un agent (hors `sim/types.ts` et `lib/protocol.ts`,
  propriété du chef d'orchestre, en lecture pour tous).
- Un agent qui a besoin de toucher un fichier hors de son territoire s'arrête et le
  signale — il ne l'édite pas « juste cette fois ».
- Avant tout commit, `npx tsc --noEmit` doit être vert.

## Frontières figées entre territoires

Ces signatures sont un **contrat**. Un agent qui les implémente ne les change pas ;
un agent qui les consomme ne les suppose pas différentes.

### `sim/monde.ts` — produit par `sim-engine`, consommé par `realtime-hub`

```ts
export const monde: WorldState;                     // singleton mutable, autorité serveur
export function creerMonde(seed?: number): WorldState;
export function tick(): TickDelta;                  // avance d'un pas, renvoie le delta
export function snapshot(): WorldState;
export function commander(m: ClientMessage): void;  // pause, vitesse, suivre (pas evenement)
export function surMessage(cb: (m: ServeurMessage) => void): () => void;
```

Le monde n'appelle **jamais** le LLM lui-même. Il émet des événements de domaine
(`onRencontre(agentA, agentB, lieu)`, `onArrivee(agent, lieu)`) auxquels le hub branche
le moteur LLM. Si `lib/llm/moteur.ts` n'existe pas encore, le hub doit fonctionner
sans (import dynamique + no-op).

### `components/map/CarteMonde.tsx` — produit par `map-layer`, consommé par `ui-panels`

```ts
export interface CarteMondeProps {
  etat: WorldState;                        // état complet courant
  suivre: AgentId | null;                  // agent que la caméra suit
  onSuivre: (id: AgentId | null) => void;  // clic sur un marker ou sur le fond
}
export default function CarteMonde(props: CarteMondeProps): React.ReactElement;
```

### `lib/useSim.ts` — produit par `ui-panels`, consommé par `app/page.tsx`

```ts
export interface SimBridge {
  etat: WorldState | null;   // null tant que le snapshot n'est pas arrivé
  suivre: AgentId | null;
  setSuivre: (id: AgentId | null) => void;
  envoyer: (m: ClientMessage) => void;
  connecte: boolean;
}
export function useSim(): SimBridge;
```

La connexion WebSocket vit **uniquement** dans `lib/useSim.ts` (URL `ws://<host>/ws`),
avec reconnexion à backoff et `hello` à l'ouverture. Aucun autre fichier client ne
manipule `WebSocket`.

