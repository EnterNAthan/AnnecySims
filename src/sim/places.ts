// Lieux de la simulation (logements, travail, commerces, loisirs…) rattachés au graphe routier.
import type { City } from "../shared/city";
import { project } from "../shared/geo";
import { Graph, Mode } from "./graph";

export type PlaceKind =
  | "home" | "work" | "school" | "food" | "bar" | "grocery" | "shop" | "culture" | "sport"
  | "health" | "hotel" | "park" | "lake" | "exit" | "station" | "event";

/** Lieux en plein air : les habitants y restent visibles. */
export const OUTDOOR: ReadonlySet<PlaceKind> = new Set(["park", "lake", "event"]);

export const PLACE_LABEL: Record<PlaceKind, string> = {
  home: "Domicile", work: "Travail", school: "École", food: "Restaurant", bar: "Bar", grocery: "Alimentation",
  shop: "Commerce", culture: "Culture", sport: "Sport", health: "Santé", hotel: "Hôtel", park: "Parc", lake: "Bord du lac",
  exit: "Hors d'Annecy", station: "Gare d'Annecy", event: "Événement",
};

export interface Place {
  id: number;
  kind: PlaceKind;
  x: number;
  z: number;
  name?: string;
  /** poids pour le tirage (surface habitable, taille du lieu…) */
  weight: number;
  walk: number;
  bike: number;
  car: number;
  /** chiffre d'affaires du jour, en € */
  revenue: number;
  visits: number;
}

const POI_TO_PLACE: Record<string, PlaceKind> = {
  food: "food", bar: "bar", grocery: "grocery", shop: "shop", school: "school", health: "health",
  office: "work", culture: "culture", hotel: "hotel", sport: "sport",
};

// Promenades et rives où l'on va « au lac ».
const LAKE_SPOTS: [string, number, number][] = [
  ["Le Pâquier", 45.90158, 6.13194],
  ["Jardins de l'Europe", 45.89935, 6.13082],
  ["Pont des Amours", 45.9002, 6.13136],
  ["Quai de la Tournette", 45.89809, 6.13182],
  ["Plage de l'Impérial", 45.9053, 6.1437],
  ["Plage d'Albigny", 45.9063, 6.1461],
  ["Les Marquisats", 45.8932, 6.1359],
];

function ringArea(p: number[]) {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1];
  }
  return Math.abs(a) / 2;
}

function ringCentroid(p: number[]): [number, number] {
  let x = 0, z = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) { x += p[2 * i]; z += p[2 * i + 1]; }
  return [x / n, z / n];
}

export class Places {
  readonly all: Place[] = [];
  readonly byKind = new Map<PlaceKind, Place[]>();
  private readonly cumWeights = new Map<PlaceKind, Float64Array>();

  constructor(city: City, readonly graph: Graph) {
    for (const b of city.buildings) {
      const area = ringArea(b.p);
      if (area < 25) continue;
      const floors = Math.max(1, Math.round(b.h / 3.1));
      const [x, z] = ringCentroid(b.p);
      if (["house", "apartments", "generic"].includes(b.k) && b.h > 4) this.add("home", x, z, area * floors, b.n);
      if (["commercial", "public", "industrial"].includes(b.k)) this.add("work", x, z, area * floors, b.n);
      else if (b.k === "generic" && area > 300) this.add("work", x, z, area * 0.6, b.n); // rez-de-chaussée d'activités
    }
    for (const p of city.pois) {
      const kind = POI_TO_PLACE[p.k];
      if (!kind) continue;
      const w = kind === "school" ? 800 : kind === "hotel" ? 300 : 100;
      this.add(kind, p.x, p.z, w, p.n);
      if (kind !== "work" && kind !== "school") this.add("work", p.x, p.z, 120, p.n); // on y travaille aussi
    }
    for (const [name, lat, lon] of LAKE_SPOTS) {
      const [x, z] = project(lat, lon);
      this.add("lake", x, z, 1000, name);
    }
    const [gx, gz] = project(45.9016, 6.1221);
    this.add("station", gx, gz, 1, "Gare d'Annecy");
    for (const g of city.greens) {
      if (g.k !== "park") continue;
      const area = ringArea(g.p);
      if (area < 1500) continue;
      const [x, z] = ringCentroid(g.p);
      this.add("park", x, z, Math.sqrt(area));
    }
    this.addExits(city);
    for (const [kind, list] of this.byKind) {
      const cum = new Float64Array(list.length);
      let s = 0;
      list.forEach((p, i) => (cum[i] = s += p.weight));
      this.cumWeights.set(kind, cum);
    }
  }

  /** Points d'entrée/sortie de la zone sur les grands axes (vers Genève, Chambéry, Thônes…). */
  private addExits(city: City) {
    const { minX, maxX, minZ, maxZ } = city.bounds;
    const MARGIN = 120;
    const seen = new Set<number>();
    for (const r of city.roads) {
      if (!["trunk", "primary", "secondary"].includes(r.t)) continue;
      for (const n of [r.n[0], r.n[r.n.length - 1]]) {
        const x = city.nodes[2 * n], z = city.nodes[2 * n + 1];
        const nearEdge = x < minX + MARGIN || x > maxX - MARGIN || z < minZ + MARGIN || z > maxZ - MARGIN;
        if (!nearEdge) continue;
        const key = Math.round(x / 200) * 1000 + Math.round(z / 200);
        if (seen.has(key)) continue;
        seen.add(key);
        // les sorties nord-ouest (vers Genève) pèsent plus lourd
        const w = 1 + Math.max(0, -z / 1000) + Math.max(0, -x / 1000);
        this.add("exit", x, z, w);
      }
    }
  }

  private add(kind: PlaceKind, x: number, z: number, weight: number, name?: string) {
    const walk = this.graph.nearest(x, z, Mode.Walk);
    const car = this.graph.nearest(x, z, Mode.Car);
    const bike = this.graph.nearest(x, z, Mode.Bike);
    if (walk < 0 || car < 0) return;
    const place: Place = { id: this.all.length, kind, x, z, weight, walk, bike, car, revenue: 0, visits: 0, ...(name ? { name } : {}) };
    this.all.push(place);
    let list = this.byKind.get(kind);
    if (!list) this.byKind.set(kind, (list = []));
    list.push(place);
  }

  /** Lieu temporaire (événement), non listé dans les tirages. */
  transient(kind: PlaceKind, x: number, z: number, name: string): Place {
    return {
      id: -1, kind, x, z, name, weight: 0, revenue: 0, visits: 0,
      walk: this.graph.nearest(x, z, Mode.Walk), bike: this.graph.nearest(x, z, Mode.Bike), car: this.graph.nearest(x, z, Mode.Car),
    };
  }

  list(kind: PlaceKind): Place[] {
    return this.byKind.get(kind) ?? [];
  }

  /** Tirage pondéré par la taille du lieu. */
  pick(kind: PlaceKind, rand: () => number): Place {
    const list = this.list(kind), cum = this.cumWeights.get(kind)!;
    const r = rand() * cum[cum.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return list[lo];
  }

  /** Un lieu proche de (x, z) : meilleur de quelques candidats, distance bruitée. */
  near(kind: PlaceKind, x: number, z: number, rand: () => number, candidates = 10): Place {
    const list = this.list(kind);
    let best = list[0], bestScore = Infinity;
    for (let i = 0; i < candidates; i++) {
      const p = list[Math.floor(rand() * list.length)];
      const score = Math.hypot(p.x - x, p.z - z) * (0.6 + rand() * 0.8);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }
}
