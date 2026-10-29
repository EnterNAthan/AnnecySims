// Messages échangés entre la page et le worker de simulation.
import type { Profile } from "./population";
import type { DayPlan, EventKind, Weather } from "./events";
import type { EventProposal } from "../shared/catalog";
import type { CohortResponse, CohortStat, EventSummary, Kpis } from "../shared/advisors";

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
  trips: { walk: number; bike: number; car: number; bus: number };
  /** stationnement : occupation maximale (0..1), automobilistes sans place, parkings pleins au pic */
  parking: { peak: number; refused: number; full: number } | null;
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
  events: { kind: EventKind; title: string; visits: number; icon: string; start: number; end: number; byPlayer: boolean; sid?: number }[];
}

export interface AgentInfo {
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
  /** porte-parole d'un groupe d'habitants (« Frontaliers · Les Fins ») */
  voice?: string;
}

/** Visiteurs venus de l'extérieur pour les grands événements (agents en réserve). */
export const VISITOR_POOL = 5000;
/** Véhicules de transit (traversée d'Annecy) et de livraison, par jour. */
export const TRANSIT_POOL = 3000;
/** Chaque voiture simulée en représente plusieurs (AGENT_SCALE) : on dessine aussi les suivantes. */
export const FRAME_CAPACITY_FACTOR = 2;

/** Bilan d'un événement à sa clôture (chiffres en personnes réelles et en €). */
export interface EventBilan {
  /** personnes venues au moins une fois, dont habitants et visiteurs extérieurs */
  attendees: number;
  residents: number;
  outsiders: number;
  peak: number;
  ticketRevenue: number;
  /** dépenses sur le site (boissons, restauration) */
  onsiteSpend: number;
  /** chiffre d'affaires des commerces de la zone pendant l'événement, et sans l'événement */
  zoneRevenue: number;
  zoneRevenueBefore: number;
  visitorCarTrips: number;
  visitorCarKm: number;
  co2Tonnes: number;
  /** temps moyen pour venir, visiteurs extérieurs (min) */
  visitorTravel: number;
  complaints: number;
  rerouted: number;
}

/** Ce qu'un événement change dans la ville : maintenant, comparé à la même heure sans l'événement. */
export interface Impact {
  sid: number;
  title: string;
  kind: EventKind;
  minute: number;
  active: boolean;
  /** « hier à la même heure » ou « juste avant le début » */
  reference: string;
  before: Kpis;
  now: Kpis;
  /** automobilistes déviés depuis le début */
  rerouted: number;
  /** personnes présentes à l'événement (manifestants, coureurs, visiteurs) */
  participants: number;
  /** présents sur place toutes les 10 minutes depuis le début */
  timeline: number[];
  /** bilan, une fois l'événement terminé */
  bilan: EventBilan | null;
}

/** Aperçu d'un événement avant confirmation : rues et parcours concernés. */
export interface Preview {
  roads: number[];
  path: number[] | null;
  x: number;
  z: number;
  radius: number;
}

/** Calendrier d'une décision : premier jour et horaires (minutes depuis minuit), dernier jour. */
export interface EventSchedule {
  day: number;
  start: number;
  end: number;
  lastDay: number;
}

/** Messages produits par le moteur, relayés tels quels par le worker. */
export type EngineMessage =
  | { type: "cohortRequest"; sid: number; event: EventSummary; cohorts: CohortStat[]; schedule: EventSchedule }
  | { type: "analysisRequest"; sid: number; event: EventSummary; before: Kpis; after: Kpis; reference: string }
  | { type: "impact"; impact: Impact }
  | { type: "bilanRequest"; sid: number; event: EventSummary; bilan: EventBilan }
  /** événement courant de la ville, suivi comme une décision (impact, bilan) */
  | { type: "cityEvent"; sid: number; event: EventSummary; day: number };

export type ToWorker =
  | { type: "init"; residents: number; tourists: number; commuters: number; seed: number; startDate: string }
  /** avance jusqu'à `minute` du jour `day` ; renvoie le buffer pour réutilisation */
  | { type: "tick"; day: number; minute: number; buffer: ArrayBuffer }
  | { type: "inspect"; id: number }
  | { type: "addEvent"; proposal: EventProposal }
  | { type: "preview"; proposal: EventProposal | null }
  | { type: "cohortPlan"; sid: number; responses: CohortResponse[] }
  | { type: "cancelEvent"; sid: number };

export type FromWorker =
  | { type: "ready"; agents: number; places: Record<string, number> }
  | { type: "frame"; buffer: ArrayBuffer; count: number; counts: LiveCounts; day: number; minute: number; thoughts: Thought[] }
  | { type: "day"; report: DayReport }
  | { type: "dayStart"; day: number; plan: DayPlan }
  /** le plan du jour a changé (événement ajouté par le joueur) */
  | { type: "planUpdate"; plan: DayPlan; added: number }
  | { type: "agent"; info: AgentInfo | null }
  | { type: "preview"; preview: Preview | null }
  /** état du trafic par rue : 0 vide, 1 fermée, 2..255 fluidité (255 = fluide) */
  | { type: "traffic"; data: Uint8Array; /** occupation de chaque parking, ‰ */ parking: Uint16Array }
  /** tracés des lignes de bus et navettes (x, z à plat) */
  | { type: "transit"; lines: { ref: string; colour: string; line: number; name: string; stops: { name: string; x: number; z: number }[]; path: number[] }[] }
  | EngineMessage;

export const FRAME_STRIDE = 6;
