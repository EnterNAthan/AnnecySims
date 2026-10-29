// Transports en commun (lignes Sibra, navettes d'événement) et stationnement (parkings publics).
import type { Transit } from "../shared/city";
import { Graph, Mode, WALK_SPEED, type Path } from "./graph";

/** vitesse commerciale d'un bus entre deux arrêts (m/s) et temps d'arrêt (min) */
const BUS_SPEED = 5.5;
const DWELL = 0.4;
/** au-delà, on ne marche pas jusqu'à l'arrêt */
const MAX_WALK = 650;

export interface BusDir {
  ref: string;
  colour: string;
  /** index de la ligne (couleur au rendu) */
  line: number;
  name: string;
  stops: { name: string; x: number; z: number; walk: number }[];
  path: Path | null;
  /** distance le long du trajet et minutes depuis le départ, à chaque arrêt */
  stopD: number[];
  stopT: number[];
  total: number;
  /** décalage des départs pour ne pas faire partir toutes les lignes en même temps */
  offset: number;
  /** navette d'événement : active seulement entre `from` et `to` (minutes) */
  window?: [number, number];
  headway?: number;
}

export interface BusTrip {
  dir: number;
  /** départ du terminus (minutes) */
  t0: number;
  from: number;
  to: number;
  board: number;
  alight: number;
}

/** Intervalle entre deux bus selon l'heure (minutes), null la nuit. */
export function headway(minute: number): number | null {
  const h = minute / 60;
  if (h < 5.75 || h >= 22.5) return null;
  if ((h >= 7 && h < 9) || (h >= 16.5 && h < 19)) return 8;
  if (h >= 20.5) return 20;
  return 12;
}

export class BusNetwork {
  readonly dirs: BusDir[] = [];
  /** grève : plus aucun bus */
  private stopped = false;
  /** horaires de la journée par direction (recalculés si le réseau change) */
  private deps = new Map<number, number[]>();
  get suspended() {
    return this.stopped;
  }
  set suspended(v: boolean) {
    if (v !== this.stopped) this.deps.clear();
    this.stopped = v;
  }
  /** voyageurs à bord de chaque course (clé dir:t0) */
  readonly riders = new Map<string, number>();

  constructor(transit: Transit, private readonly graph: Graph) {
    transit.lines.forEach((l, line) => {
      for (const d of l.dirs) {
        this.dirs.push({
          ref: l.ref, colour: l.colour, line, name: d.name,
          stops: d.stops.map((s) => ({ ...s, walk: graph.nearest(s.x, s.z, Mode.Walk) })),
          path: null, stopD: [], stopT: [], total: 0, offset: (this.dirs.length * 3.7) % 8,
        });
      }
    });
    this.rebuild();
  }

  /** Recalcule les itinéraires sur le réseau routier (après une fermeture de rue : les bus sont déviés). */
  rebuild() {
    for (const d of this.dirs) this.build(d);
    this.deps.clear();
  }

  private build(d: BusDir) {
    const g = this.graph;
    const nodes: number[] = [], edges: number[] = [], stopD: number[] = [];
    let len = 0;
    const cars = d.stops.map((s) => g.nearest(s.x, s.z, Mode.Car));
    // on repart toujours du dernier point atteint : si un arrêt est inaccessible (rue fermée),
    // le bus ne le dessert pas et poursuit sa déviation jusqu'à l'arrêt suivant
    let last = cars[0];
    nodes.push(last);
    for (let i = 0; i < d.stops.length; i++) {
      if (i > 0) {
        const p = g.route(last, cars[i], Mode.Car);
        if (p) {
          for (let k = 0; k < p.edges.length; k++) {
            edges.push(p.edges[k]);
            nodes.push(p.nodes[k + 1]);
            len += g.len[p.edges[k]];
          }
          last = cars[i];
        }
      }
      stopD.push(len);
    }
    const cum = new Float32Array(nodes.length);
    for (let k = 0; k < edges.length; k++) cum[k + 1] = cum[k] + g.len[edges[k]];
    d.path = edges.length ? { nodes: Int32Array.from(nodes), edges: Int32Array.from(edges), cum, length: len } : null;
    d.stopD = stopD;
    d.stopT = stopD.map((x, i) => x / BUS_SPEED / 60 + i * DWELL);
    d.total = d.stopT.at(-1) ?? 0;
  }

  /** Navette temporaire (gare → site d'un événement), toutes les `every` minutes. */
  addShuttle(name: string, stops: { name: string; x: number; z: number }[], from: number, to: number, every = 5): number {
    const d: BusDir = {
      ref: "N", colour: "#ffd84d", line: -1, name,
      stops: stops.map((s) => ({ ...s, walk: this.graph.nearest(s.x, s.z, Mode.Walk) })),
      path: null, stopD: [], stopT: [], total: 0, offset: 0, window: [from, to], headway: every,
    };
    this.build(d);
    this.dirs.push(d);
    this.deps.clear();
    return this.dirs.length - 1;
  }

  /** Retire les navettes (nouvelle journée). */
  clearShuttles() {
    for (let i = this.dirs.length - 1; i >= 0; i--) if (this.dirs[i].window) this.dirs.splice(i, 1);
    this.deps.clear();
  }

  private interval(d: BusDir, minute: number) {
    if (this.suspended && !d.window) return null;
    if (d.window) return minute >= d.window[0] - 30 && minute < d.window[1] + 30 ? d.headway! : null;
    return headway(minute);
  }

  /** Départs du terminus de la journée, pour une direction. */
  departures(i: number): number[] {
    const cached = this.deps.get(i);
    if (cached) return cached;
    const d = this.dirs[i], out: number[] = [];
    for (let t = d.window ? d.window[0] - 30 : 5.75 * 60 + d.offset; t < (d.window ? d.window[1] + 30 : 22.5 * 60); ) {
      const h = this.interval(d, t);
      if (!h) {
        t += 5;
        continue;
      }
      out.push(t);
      t += h;
    }
    this.deps.set(i, out);
    return out;
  }

  /** Premier bus qui passe à l'arrêt `stop` après `minute`. */
  nextRun(i: number, stop: number, minute: number): number | null {
    const d = this.dirs[i];
    for (const t0 of this.departures(i)) if (t0 + d.stopT[stop] >= minute) return this.interval(d, t0) ? t0 : null;
    return null;
  }

  /** Position du bus parti à t0, à la minute donnée : [x, z, cap], ou null s'il ne roule pas. */
  position(i: number, t0: number, minute: number): [number, number, number] | null {
    const d = this.dirs[i], p = d.path;
    const s = minute - t0;
    if (!p || s < 0 || s > d.total) return null;
    // à l'arrêt ou entre deux arrêts
    let k = 0;
    while (k < d.stopT.length - 1 && d.stopT[k + 1] <= s) k++;
    const leave = d.stopT[k] + DWELL;
    const dist = k >= d.stopT.length - 1 || s <= leave ? d.stopD[k] : d.stopD[k] + (s - leave) * BUS_SPEED * 60;
    const x = Math.min(dist, p.length);
    let lo = 0, hi = p.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (p.cum[mid] <= x) lo = mid;
      else hi = mid;
    }
    const g = this.graph, n0 = p.nodes[lo], n1 = p.nodes[Math.min(lo + 1, p.nodes.length - 1)];
    const seg = p.cum[Math.min(lo + 1, p.cum.length - 1)] - p.cum[lo] || 1;
    const f = Math.min(1, (x - p.cum[lo]) / seg);
    return [g.x[n0] + (g.x[n1] - g.x[n0]) * f, g.z[n0] + (g.z[n1] - g.z[n0]) * f, Math.atan2(g.x[n1] - g.x[n0], g.z[n1] - g.z[n0])];
  }

  /** Bus en circulation à cette minute. */
  *active(minute: number): Generator<{ dir: number; t0: number }> {
    for (let i = 0; i < this.dirs.length; i++) {
      const d = this.dirs[i];
      if (!d.path) continue;
      for (const t0 of this.departures(i)) if (t0 <= minute && t0 + d.total >= minute) yield { dir: i, t0 };
    }
  }

  /**
   * Meilleur trajet direct (sans correspondance) : marche jusqu'à l'arrêt, attente, trajet, marche finale.
   * Renvoie aussi son coût en minutes ressenties (attente et marche comptent davantage).
   */
  best(fx: number, fz: number, tx: number, tz: number, minute: number): (BusTrip & { cost: number }) | null {
    let best: (BusTrip & { cost: number }) | null = null;
    for (let i = 0; i < this.dirs.length; i++) {
      const d = this.dirs[i];
      if (!d.path) continue;
      let a = -1, b = -1, da = MAX_WALK, db = MAX_WALK;
      d.stops.forEach((s, k) => {
        const ea = Math.hypot(s.x - fx, s.z - fz), eb = Math.hypot(s.x - tx, s.z - tz);
        if (ea < da) [a, da] = [k, ea];
        if (eb < db) [b, db] = [k, eb];
      });
      if (a < 0 || b <= a) continue;
      const walkMin = (da + db) * 1.3 / WALK_SPEED / 60;
      const arrive = minute + (da * 1.3) / WALK_SPEED / 60;
      const t0 = this.nextRun(i, a, arrive);
      if (t0 === null) continue;
      const wait = t0 + d.stopT[a] - arrive;
      const ride = d.stopT[b] - d.stopT[a];
      const cost = walkMin * 1.6 + wait * 1.8 + ride + 3;
      if (!best || cost < best.cost) best = { dir: i, t0, from: a, to: b, board: t0 + d.stopT[a], alight: t0 + d.stopT[b], cost };
    }
    return best;
  }
}

/** Parkings publics : occupation, choix d'une place près de la destination. */
export class Parkings {
  readonly occupied: Float32Array;
  readonly car: Int32Array;
  readonly walk: Int32Array;
  /** automobilistes qui n'ont pas trouvé de place aujourd'hui (stationnement sauvage) */
  refused = 0;

  constructor(readonly list: Transit["parkings"], graph: Graph) {
    this.occupied = new Float32Array(list.length);
    this.car = Int32Array.from(list, (p) => graph.nearest(p.x, p.z, Mode.Car));
    this.walk = Int32Array.from(list, (p) => graph.nearest(p.x, p.z, Mode.Walk));
  }

  /** Parking libre le plus proche de (x, z), à moins de `max` m ; -1 sinon. */
  find(x: number, z: number, max: number, need: number): number {
    let best = -1, bd = max;
    this.list.forEach((p, i) => {
      if (this.occupied[i] + need > p.capacity) return;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) [best, bd] = [i, d];
    });
    return best;
  }

  /** Y a-t-il des parkings (même pleins) près de ce point ? Sinon on se gare dans la rue. */
  near(x: number, z: number, max: number) {
    return this.list.some((p) => Math.hypot(p.x - x, p.z - z) < max);
  }

  reset() {
    this.occupied.fill(0);
    this.refused = 0;
  }

  /** Taux d'occupation (0..1) de chaque parking, ×1000 pour l'envoi à la page. */
  snapshot(): Uint16Array {
    return Uint16Array.from(this.list, (p, i) => Math.round(Math.min(1, this.occupied[i] / p.capacity) * 1000));
  }
}
