// Géométrie d'un événement du joueur : rues fermées, parcours d'un cortège, zone touchée.
import { ROAD_FLAGS, type City } from "../shared/city";
import { EVENT_SPECS, isProcession, traitsOf, type EventProposal } from "../shared/catalog";
import { crowdRadius } from "./venue";
import { LOCATIONS, locationXZ } from "../shared/locations";
import { roadsNamed } from "../shared/streets";
import { Graph, Mode } from "./graph";

const CELL = 40; // m

/** Zone touchée : un disque, ou une bande le long de rues / d'un parcours. */
export class Zone {
  private readonly cells: Set<number> | null;
  constructor(readonly x: number, readonly z: number, readonly radius: number, cells?: Set<number>) {
    this.cells = cells ?? null;
  }
  contains(x: number, z: number): boolean {
    if (this.cells) return this.cells.has(cellKey(x, z));
    return Math.hypot(x - this.x, z - this.z) < this.radius;
  }
}

// clé de cellule : décalée pour rester positive (la ville tient dans ±20 km)
const OFF = 1000;
export const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + OFF) * 100_000 + Math.floor(z / CELL) + OFF;
export const cellCenter = (k: number): [number, number] => [(Math.floor(k / 100_000) - OFF + 0.5) * CELL, ((k % 100_000) - OFF + 0.5) * CELL];

/** Cellules couvrant une polyligne, élargies d'une cellule de chaque côté (~±60 m). */
function corridor(xs: ArrayLike<number>, zs: ArrayLike<number>, into = new Set<number>()) {
  for (let i = 0; i < xs.length - 1; i++) {
    const len = Math.hypot(xs[i + 1] - xs[i], zs[i + 1] - zs[i]);
    for (let d = 0; d <= len; d += CELL / 2) {
      const k = len ? d / len : 0;
      const px = xs[i] + (xs[i + 1] - xs[i]) * k, pz = zs[i] + (zs[i + 1] - zs[i]) * k;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) into.add(cellKey(px + a * CELL, pz + b * CELL));
    }
  }
  return into;
}

export interface RoutePath {
  xs: number[];
  zs: number[];
  /** distance cumulée à chaque point */
  cum: number[];
  length: number;
  /** rue (city.roads) de chaque segment, -1 si aucune voie voiture */
  roads: number[];
}

export interface EventGeometry {
  x: number;
  z: number;
  radius: number;
  /** rues fermées pendant toute la durée */
  closedRoads: number[];
  path: RoutePath | null;
  zone: Zone;
}

function roadPoints(city: City, r: number): [number[], number[]] {
  const xs: number[] = [], zs: number[] = [];
  for (const n of city.roads[r].n) {
    xs.push(city.nodes[2 * n]);
    zs.push(city.nodes[2 * n + 1]);
  }
  return [xs, zs];
}

/** Point représentatif d'une étape : lieu nommé, sinon milieu du plus long tronçon de la rue. */
function waypoint(city: City, name: string): [number, number] | null {
  if (LOCATIONS.some((l) => l.name === name)) return locationXZ(name);
  const roads = roadsNamed(city, [name]);
  if (!roads.length) return null;
  const longest = roads.sort((a, b) => city.roads[b].n.length - city.roads[a].n.length)[0];
  const n = city.roads[longest].n[Math.floor(city.roads[longest].n.length / 2)];
  return [city.nodes[2 * n], city.nodes[2 * n + 1]];
}

/** Parcours piéton passant par les étapes, sur le vrai réseau. */
function buildRoute(city: City, graph: Graph, steps: string[]): RoutePath | null {
  const pts = steps.map((s) => waypoint(city, s)).filter((p): p is [number, number] => !!p);
  if (pts.length < 2) return null;
  const xs: number[] = [], zs: number[] = [], roads: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = graph.nearest(pts[i][0], pts[i][1], Mode.Walk), b = graph.nearest(pts[i + 1][0], pts[i + 1][1], Mode.Walk);
    const p = graph.route(a, b, Mode.Walk);
    if (!p) continue;
    p.nodes.forEach((n, k) => {
      if (k === 0 && xs.length) return;
      xs.push(graph.x[n]);
      zs.push(graph.z[n]);
    });
    p.edges.forEach((e) => roads.push(city.roads[graph.edgeRoad[e]].f & ROAD_FLAGS.CAR ? graph.edgeRoad[e] : -1));
  }
  if (xs.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < xs.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
  return { xs, zs, cum, length: cum[cum.length - 1], roads };
}

export function eventGeometry(city: City, graph: Graph, p: EventProposal): EventGeometry {
  const spec = EVENT_SPECS[p.kind];
  const traits = traitsOf(p);
  const intensity = Math.max(1, Math.min(3, p.intensity));
  // un grand rassemblement occupe la place de son public
  const radius = Math.max(spec.radius * [0, 0.6, 1, 1.7][intensity], traits.attendance > 0 && traits.needs === "place" ? crowdRadius(traits.attendance) + 45 : 0);
  // une vague ou une crue frappe la rive, pas le milieu du lac
  const onShore = (p.kind === "tsunami" || p.kind === "inondation") && p.location === "Lac d'Annecy";
  let [x, z] = locationXZ(onShore ? "Le Pâquier" : p.location);

  if (traits.needs === "streets" && p.streets.length) {
    const roads = roadsNamed(city, p.streets);
    const carRoads = roads.filter((r) => city.roads[r].f & ROAD_FLAGS.CAR);
    const cells = new Set<number>();
    let sx = 0, sz = 0, n = 0;
    for (const r of roads) {
      const [xs, zs] = roadPoints(city, r);
      corridor(xs, zs, cells);
      xs.forEach((v, i) => { sx += v; sz += zs[i]; n++; });
    }
    if (n) [x, z] = [sx / n, sz / n];
    return { x, z, radius, closedRoads: traits.closesRoads ? carRoads : [], path: null, zone: new Zone(x, z, radius, cells) };
  }

  if (traits.needs === "route") {
    const path = buildRoute(city, graph, p.route);
    if (path) {
      // la course ferme tout son parcours ; la manifestation ferme au passage du cortège (voir Engine)
      // une course ferme tout son parcours ; un défilé ferme au passage (voir Engine)
      const closed = !isProcession(p.kind, traits.nature) && traits.closesRoads ? [...new Set(path.roads.filter((r) => r >= 0))] : [];
      return { x: path.xs[0], z: path.zs[0], radius, closedRoads: closed, path, zone: new Zone(path.xs[0], path.zs[0], radius, corridor(path.xs, path.zs)) };
    }
  }

  // événement localisé : rues de la zone fermées pour les phénomènes dangereux
  const closedRoads: number[] = [];
  // rues nommées fermées autour d'un rassemblement (quai, parking…)
  if (traits.closesRoads && p.streets.length) closedRoads.push(...roadsNamed(city, p.streets).filter((r) => city.roads[r].f & ROAD_FLAGS.CAR));
  else if (traits.closesRoads) {
    city.roads.forEach((r, i) => {
      if (!(r.f & ROAD_FLAGS.CAR)) return;
      if (r.n.some((n) => Math.hypot(city.nodes[2 * n] - x, city.nodes[2 * n + 1] - z) < Math.max(radius, 40))) closedRoads.push(i);
    });
  }
  return { x, z, radius, closedRoads, path: null, zone: new Zone(x, z, radius) };
}

/** Rues à fermer autour du cortège en marche : de la queue à un peu devant la tête. */
export function rollingClosure(path: RoutePath, head: number, tail: number): number[] {
  const out = new Set<number>();
  for (let i = 0; i < path.roads.length; i++) {
    if (path.roads[i] < 0) continue;
    const a = path.cum[i], b = path.cum[i + 1];
    if (b >= tail - 80 && a <= head + 250) out.add(path.roads[i]);
  }
  return [...out];
}

/** Position et cap sur le parcours à la distance d. */
export function pointAt(path: RoutePath, d: number): [number, number, number] {
  d = Math.max(0, Math.min(path.length, d));
  let lo = 0, hi = path.cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (path.cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const seg = path.cum[lo + 1] - path.cum[lo] || 1;
  const k = (d - path.cum[lo]) / seg;
  const dx = path.xs[lo + 1] - path.xs[lo], dz = path.zs[lo + 1] - path.zs[lo];
  return [path.xs[lo] + dx * k, path.zs[lo] + dz * k, Math.atan2(dx, dz)];
}
