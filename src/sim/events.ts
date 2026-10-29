// Événements et météo du jour. Pour l'instant un « directeur » à règles les génère ;
// le narrateur Claude produira plus tard des événements au même format.
import type { City } from "../shared/city";
import { project } from "../shared/geo";
import { EVENT_KINDS, EVENT_SPECS, type EventKind } from "../shared/catalog";

export type { EventKind };
export type WeatherKind = "soleil" | "nuageux" | "pluie" | "neige";

export interface Weather {
  kind: WeatherKind;
  tempC: number;
}

export interface CityEvent {
  id: number;
  kind: EventKind;
  title: string;
  description: string;
  x: number;
  z: number;
  /** minutes depuis minuit */
  start: number;
  end: number;
  /** part des habitants disponibles qui s'y rendent (0..1) */
  attraction: number;
  /** rues (index city.roads) fermées aux voitures pendant l'événement */
  closedRoads: number[];
  /** rayon d'effet en m (fuite, curieux, visuels) */
  radius: number;
  /** 1 = léger, 2 = moyen, 3 = extrême */
  intensity: number;
  /** créé par le joueur (commande en langage naturel) */
  byPlayer?: boolean;
  /** identifiant de la décision du joueur (identique sur tous les jours d'un événement de plusieurs jours) */
  sid?: number;
  /** jour n sur m pour un événement de plusieurs jours */
  dayIndex?: number;
  days?: number;
  /** rues nommées concernées */
  streets?: string[];
  /** comportement résolu (événements du joueur) : icône, nature, fréquentation, décor… */
  traits?: import("../shared/catalog").EventTraits;
  /** parcours (cortège, course), aplati [x0, z0, x1, z1…], et sa longueur en m */
  path?: number[];
  pathLength?: number;
}

/**
 * Cortège d'une manifestation : rassemblement au départ, puis marche au pas jusqu'à l'arrivée.
 * Renvoie la position de la tête et de la queue sur le parcours, en m.
 */
export function cortege(ev: CityEvent, length: number, minute: number): [number, number] {
  const gather = Math.min(20, (ev.end - ev.start) / 4);
  const tail = 100 + 70 * ev.intensity;
  // 1,5 à 3 km/h, pour finir un quart d'heure avant la dispersion
  const speed = Math.min(50, Math.max(25, length / Math.max(10, ev.end - ev.start - gather - 15)));
  const head = Math.max(0, Math.min(length, (minute - ev.start - gather) * speed));
  return [head, Math.max(0, head - tail)];
}

export interface DayPlan {
  weather: Weather;
  events: CityEvent[];
}

export const EVENT_ICON = Object.fromEntries(EVENT_KINDS.map((k) => [k, EVENT_SPECS[k].icon])) as Record<EventKind, string>;

export const WEATHER_ICON: Record<WeatherKind, string> = { soleil: "☀️", nuageux: "☁️", pluie: "🌧️", neige: "🌨️" };

/** Climat simplifié d'Annecy par mois : [P(soleil), P(nuageux), P(pluie), T min, T max]. */
const CLIMATE: [number, number, number, number, number][] = [
  [0.3, 0.35, 0.2, -3, 5], [0.35, 0.35, 0.2, -2, 7], [0.4, 0.3, 0.3, 1, 12], [0.4, 0.3, 0.3, 4, 16],
  [0.45, 0.25, 0.3, 8, 20], [0.55, 0.2, 0.25, 12, 25], [0.65, 0.15, 0.2, 14, 28], [0.6, 0.2, 0.2, 14, 27],
  [0.5, 0.25, 0.25, 10, 22], [0.35, 0.35, 0.3, 6, 16], [0.25, 0.4, 0.3, 2, 10], [0.25, 0.4, 0.2, -2, 6],
];

function roadsNamed(city: City, name: string): number[] {
  const out: number[] = [];
  city.roads.forEach((r, i) => r.name === name && out.push(i));
  return out;
}

/** Point milieu d'une rue (premier tronçon trouvé). */
function roadMiddle(city: City, roadIdx: number): [number, number] {
  const n = city.roads[roadIdx].n[Math.floor(city.roads[roadIdx].n.length / 2)];
  return [city.nodes[2 * n], city.nodes[2 * n + 1]];
}

function roadLength(city: City, roadIdx: number) {
  const ns = city.roads[roadIdx].n;
  let l = 0;
  for (let i = 0; i < ns.length - 1; i++) {
    l += Math.hypot(city.nodes[2 * ns[i + 1]] - city.nodes[2 * ns[i]], city.nodes[2 * ns[i + 1] + 1] - city.nodes[2 * ns[i] + 1]);
  }
  return l;
}

export function generateDayPlan(city: City, date: Date, rand: () => number): DayPlan {
  const month = date.getMonth(), dow = date.getDay();
  const [pSun, pCloud, pRain, tMin, tMax] = CLIMATE[month];
  const r = rand();
  let kind: WeatherKind = r < pSun ? "soleil" : r < pSun + pCloud ? "nuageux" : r < pSun + pCloud + pRain ? "pluie" : "nuageux";
  const tempC = Math.round(tMin + (tMax - tMin) * (0.3 + rand() * 0.6));
  if (kind === "pluie" && tempC <= 1) kind = "neige";

  const events: CityEvent[] = [];
  const add = (e: Omit<CityEvent, "id" | "radius" | "intensity">) => events.push({ radius: EVENT_SPECS[e.kind].radius, intensity: 2, ...e, id: events.length });

  // Marché de la vieille ville : mardi, vendredi, dimanche matin
  if ([0, 2, 5].includes(dow)) {
    const [x, z] = roadMiddle(city, roadsNamed(city, "Rue Sainte-Claire")[0] ?? 0);
    add({
      kind: "marche", title: "Marché de la vieille ville", description: "Étals de fromages, fruits et légumes rue Sainte-Claire.",
      x, z, start: 7 * 60, end: 13 * 60, attraction: kind === "pluie" ? 0.08 : 0.18, closedRoads: [],
    });
  }

  // Concert au Pâquier les soirs de week-end (plus rare s'il pleut)
  if ((dow === 5 || dow === 6) && rand() < (kind === "pluie" ? 0.15 : 0.55)) {
    const [x, z] = project(45.90158, 6.13194);
    add({
      kind: "concert", title: "Concert au Pâquier", description: "Scène ouverte au bord du lac.",
      x, z, start: 19.5 * 60, end: 23 * 60, attraction: 0.12, closedRoads: [],
    });
  }

  // Brocante le samedi
  if (dow === 6 && rand() < 0.4) {
    const [x, z] = roadMiddle(city, roadsNamed(city, "Rue de la République")[0] ?? 0);
    add({
      kind: "brocante", title: "Brocante rue de la République", description: "Vide-greniers des commerçants.",
      x, z, start: 8 * 60, end: 17 * 60, attraction: 0.08, closedRoads: [],
    });
  }

  // Travaux sur une rue nommée assez longue
  const majorTypes = new Set(["primary", "secondary", "tertiary"]);
  const candidates = city.roads.map((r, i) => i).filter((i) => {
    const r = city.roads[i];
    if (!r.name || !majorTypes.has(r.t) || roadLength(city, i) < 120) return false;
    // près du centre, là où l'on regarde
    const [x, z] = roadMiddle(city, i);
    return Math.hypot(x, z) < 1300;
  });
  if (candidates.length && dow !== 0 && rand() < 0.4) {
    const road = candidates[Math.floor(rand() * candidates.length)];
    const name = city.roads[road].name!;
    const [x, z] = roadMiddle(city, road);
    add({
      kind: "travaux", title: `Travaux ${name}`, description: `Chaussée fermée pour réfection, déviation conseillée.`,
      x, z, start: 7.5 * 60, end: 17 * 60, attraction: 0, closedRoads: [road],
    });
  }

  // Accident (plus probable sous la pluie)
  if (candidates.length && rand() < (kind === "pluie" ? 0.45 : 0.2)) {
    const road = candidates[Math.floor(rand() * candidates.length)];
    const [x, z] = roadMiddle(city, road);
    const start = Math.round((7 + rand() * 12) * 60);
    add({
      kind: "accident", title: `Accident ${city.roads[road].name}`, description: "Accrochage, la voie est bloquée le temps de l'intervention.",
      x, z, start, end: start + 60 + Math.round(rand() * 90), attraction: 0, closedRoads: [road],
    });
  }

  return { weather: { kind, tempC }, events };
}
