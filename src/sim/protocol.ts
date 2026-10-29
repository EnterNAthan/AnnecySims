// Messages échangés entre la page et le worker de simulation.
import type { Profile } from "./population";
import type { AiLog } from "../shared/intelligence";
import type { AiConfig } from "../shared/aiConfig";
import type { DayPlan, EventKind, Weather } from "./events";
import type { EventProposal } from "../shared/catalog";

/** Leviers municipaux appliqués à la simulation (enrichis aux étapes suivantes). */
export interface Policy {
  /** €/h de stationnement en centre-ville */
  parkingPrice: number;
  /** confort cyclable (1 = actuel, >1 = pistes, <1 = dégradé) */
  bikeComfort: number;
  /** frein à la voiture (1 = actuel, >1 = zones 30, plans de circulation…) */
  carFriction: number;
}

export interface DayReport {
  day: number;
  date: string;
  dow: number;
  population: number;
  trips: { walk: number; bike: number; car: number };
  carKm: number;
  co2Tonnes: number;
  /** retard moyen en voiture / temps à vide (0 = fluide) */
  congestion: number;
  revenue: Record<string, number>;
  revenueTotal: number;
  satisfaction: number;
  satisfactionByProfile: Record<Profile, number>;
  /** minutes-personnes en déplacement par heure : [marche, vélo, voiture] */
  hourly: number[][];
  topPlaces: { name: string; kind: string; visits: number }[];
  /** rues les plus ralenties : perte moyenne de vitesse quand on y circule (0..1) */
  jams: { name: string; slowdown: number }[];
  policy: Policy;
  weather: Weather;
  households: number;
  meanHouseholdSize: number;
  events: { kind: EventKind; title: string; visits: number }[];
}

export interface AgentInfo {
  intelligence?: { status: string; memories: string[]; goal?: string; plan?: string[] };
  id: number;
  name: string;
  age: number;
  sex: "M" | "F";
  /** libellé de la catégorie socioprofessionnelle, null si sans objet */
  csp: string | null;
  partTime: boolean;
  /** revenu mensuel par unité de consommation du foyer, arrondi à 10 € */
  monthlyIncome: number;
  household: { kind: string; cars: number; members: { id: number; name: string; age: number; relation: string }[] };
  profile: Profile;
  hasCar: boolean;
  hasBike: boolean;
  needs: { energy: number; social: number; fun: number };
  satisfaction: number;
  x: number;
  z: number;
  /** visible dans la scène (en déplacement ou dehors) */
  visible: boolean;
  now: string;
  schedule: { from: string; place: string; done: boolean; current: boolean }[];
  travelMinutes: number;
  spentToday: number;
  /** ce qu'il a en tête à cet instant */
  mind: { icon: string; text: string };
  /** dernières pensées exprimées, la plus récente d'abord */
  thoughts: { icon: string; text: string; when: string }[];
}

export interface LiveCounts {
  walk: number;
  bike: number;
  car: number;
  outdoor: number;
  outside: number;
  run: number;
  dog: number;
  /** satisfaction moyenne en direct, 0..1 */
  satisfaction: number;
}

/** Ce qu'un habitant pense à un instant donné (bulle + fil d'actualité). */
export interface Thought {
  id: number;
  name: string;
  profile: Profile;
  icon: string;
  text: string;
  minute: number;
}

export type ToWorker =
  | { type: "aiConfig"; config: AiConfig }
  | { type: "init"; residents: number; tourists: number; commuters: number; seed: number; startDate: string; aiEnabled?: boolean }
  /** avance jusqu'à `minute` du jour `day` ; renvoie le buffer pour réutilisation */
  | { type: "tick"; day: number; minute: number; buffer: ArrayBuffer }
  | { type: "inspect"; id: number }
  | { type: "addEvent"; proposal: EventProposal };

export type FromWorker =
  | { type: "aiLog"; entry: AiLog }
  | { type: "ready"; agents: number; places: Record<string, number> }
  | { type: "frame"; buffer: ArrayBuffer; count: number; counts: LiveCounts; day: number; minute: number; thoughts: Thought[] }
  | { type: "day"; report: DayReport }
  | { type: "dayStart"; day: number; plan: DayPlan }
  /** le plan du jour a changé (événement ajouté par le joueur) */
  | { type: "planUpdate"; plan: DayPlan; added: number }
  | { type: "agent"; info: AgentInfo | null };

export const FRAME_STRIDE = 6;
