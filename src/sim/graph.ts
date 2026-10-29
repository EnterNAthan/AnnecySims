// Graphe routier orienté (format CSR) construit depuis city.json, avec A* par mode de transport.
import type { City } from "../shared/city";
import { ROAD_FLAGS } from "../shared/city";

export enum Mode {
  Walk = 1,
  Bike = 2,
  Car = 3,
}

const MODE_FLAG: Record<Mode, number> = {
  [Mode.Walk]: ROAD_FLAGS.FOOT,
  [Mode.Bike]: ROAD_FLAGS.BIKE,
  [Mode.Car]: ROAD_FLAGS.CAR,
};

export const WALK_SPEED = 1.35;
export const BIKE_SPEED = 4.5;
const CAR_SPEED: Record<string, number> = {
  trunk: 19.4, trunk_link: 13.9, primary: 13.9, primary_link: 11, secondary: 12.5, secondary_link: 10,
  tertiary: 11, tertiary_link: 9, unclassified: 9, residential: 8.3, living_street: 4.2, service: 5.5,
};
// vitesse de l'heuristique A* : un peu sous le maximum pour explorer moins (chemins quasi optimaux)
const HEURISTIC_CAR_SPEED = 14;
const LANES: Record<string, number> = { trunk: 2, primary: 2, secondary: 1.5 };

export interface Path {
  nodes: Int32Array;
  edges: Int32Array;
  /** distance cumulée au début de chaque nœud */
  cum: Float32Array;
  length: number;
}

export class Graph {
  readonly n: number;
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** CSR : arêtes sortantes du nœud i dans [offset[i], offset[i+1]) */
  readonly offset: Int32Array;
  readonly to: Int32Array;
  readonly len: Float32Array;
  readonly flags: Uint8Array;
  readonly carSpeed: Float32Array;
  /** places de voitures sur l'arête (stockage), pour la congestion */
  readonly storage: Float32Array;
  /** facteur de vitesse observé la veille (1 = fluide), utilisé par le routage voiture */
  readonly learnedFactor: Float32Array;
  /** index de la rue (city.roads) de chaque arête */
  readonly edgeRoad: Int32Array;
  /** arêtes fermées par décision municipale */
  readonly closed: Uint8Array;
  /** nœuds de la plus grande composante, par mode */
  private readonly usable: Record<Mode, Uint8Array>;
  private readonly grid: Record<Mode, Map<number, number[]>>;
  private readonly cache = new Map<string, { path: Path | null; epoch: number }>();
  /** incrémenté quand les temps de parcours voiture changent */
  private carEpoch = 0;

  constructor(city: City) {
    this.n = city.nodes.length / 2;
    this.x = new Float32Array(this.n);
    this.z = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.x[i] = city.nodes[2 * i];
      this.z[i] = city.nodes[2 * i + 1];
    }

    const edges: [number, number, number, number, number, number, number][] = []; // from, to, len, flags, speed, lanes, rue
    city.roads.forEach((r, ri) => {
      const speed = CAR_SPEED[r.t] ?? 8, lanes = LANES[r.t] ?? 1;
      for (let k = 0; k < r.n.length - 1; k++) {
        const a = r.n[k], b = r.n[k + 1];
        if (a === b) continue;
        const l = Math.hypot(this.x[b] - this.x[a], this.z[b] - this.z[a]);
        const f = r.f & ROAD_FLAGS.ALL;
        edges.push([a, b, l, f, speed, lanes, ri]);
        edges.push([b, a, l, r.f & ROAD_FLAGS.ONEWAY ? f & ~ROAD_FLAGS.CAR : f, speed, lanes, ri]);
      }
    });

    edges.sort((a, b) => a[0] - b[0]);
    const m = edges.length;
    this.offset = new Int32Array(this.n + 1);
    this.to = new Int32Array(m);
    this.len = new Float32Array(m);
    this.flags = new Uint8Array(m);
    this.carSpeed = new Float32Array(m);
    this.storage = new Float32Array(m);
    this.learnedFactor = new Float32Array(m).fill(1);
    this.closed = new Uint8Array(m);
    this.edgeRoad = new Int32Array(m);
    edges.forEach(([a, b, l, f, speed, lanes, ri], i) => {
      this.edgeRoad[i] = ri;
      this.offset[a + 1]++;
      this.to[i] = b;
      this.len[i] = l;
      this.flags[i] = f;
      this.carSpeed[i] = speed;
      this.storage[i] = Math.max(1, (l * lanes) / 7.5);
    });
    for (let i = 0; i < this.n; i++) this.offset[i + 1] += this.offset[i];

    this.usable = {
      [Mode.Walk]: this.largestComponent(MODE_FLAG[Mode.Walk]),
      [Mode.Bike]: this.largestComponent(MODE_FLAG[Mode.Bike] | MODE_FLAG[Mode.Walk]),
      [Mode.Car]: this.largestComponent(MODE_FLAG[Mode.Car]),
    };
    this.grid = { [Mode.Walk]: this.buildGrid(Mode.Walk), [Mode.Bike]: this.buildGrid(Mode.Bike), [Mode.Car]: this.buildGrid(Mode.Car) };
    this.costs = { [Mode.Walk]: this.computeCosts(Mode.Walk), [Mode.Bike]: this.computeCosts(Mode.Bike), [Mode.Car]: this.computeCosts(Mode.Car) };
  }

  /** Les vélos peuvent emprunter les rues piétonnes à vitesse réduite : on accepte FOOT|BIKE. */
  private allowed(edge: number, mode: Mode) {
    if (this.closed[edge] && mode === Mode.Car) return false;
    const f = this.flags[edge];
    return mode === Mode.Bike ? (f & (ROAD_FLAGS.BIKE | ROAD_FLAGS.FOOT)) !== 0 : (f & MODE_FLAG[mode]) !== 0;
  }

  private largestComponent(mask: number): Uint8Array {
    const comp = new Int32Array(this.n).fill(-1);
    // non orienté : on ajoute aussi les arêtes entrantes
    const undirected: number[][] = Array.from({ length: this.n }, () => []);
    for (let a = 0; a < this.n; a++) {
      for (let e = this.offset[a]; e < this.offset[a + 1]; e++) {
        if (!(this.flags[e] & mask)) continue;
        undirected[a].push(this.to[e]);
        undirected[this.to[e]].push(a);
      }
    }
    let best = -1, bestSize = 0, id = 0;
    const stack: number[] = [];
    for (let s = 0; s < this.n; s++) {
      if (comp[s] !== -1 || undirected[s].length === 0) continue;
      let size = 0;
      comp[s] = id;
      stack.push(s);
      while (stack.length) {
        const v = stack.pop()!;
        size++;
        for (const w of undirected[v]) if (comp[w] === -1) { comp[w] = id; stack.push(w); }
      }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    const out = new Uint8Array(this.n);
    for (let i = 0; i < this.n; i++) out[i] = comp[i] === best ? 1 : 0;
    return out;
  }

  private static readonly CELL = 100;
  private cellKey(x: number, z: number) {
    return Math.floor(x / Graph.CELL) * 100_000 + Math.floor(z / Graph.CELL);
  }

  private buildGrid(mode: Mode) {
    const g = new Map<number, number[]>();
    for (let i = 0; i < this.n; i++) {
      if (!this.usable[mode][i]) continue;
      const k = this.cellKey(this.x[i], this.z[i]);
      let c = g.get(k);
      if (!c) g.set(k, (c = []));
      c.push(i);
    }
    return g;
  }

  /** Nœud utilisable le plus proche pour ce mode (recherche en anneaux), ou -1. */
  nearest(x: number, z: number, mode: Mode): number {
    const grid = this.grid[mode];
    const cx = Math.floor(x / Graph.CELL), cz = Math.floor(z / Graph.CELL);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= 12; r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cz - r; j <= cz + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cz)) !== r) continue;
          for (const v of grid.get(i * 100_000 + j) ?? []) {
            const d = (this.x[v] - x) ** 2 + (this.z[v] - z) ** 2;
            if (d < bestD) { bestD = d; best = v; }
          }
        }
      }
      if (best >= 0 && Math.sqrt(bestD) < r * Graph.CELL) break;
    }
    return best;
  }

  /** Coût de chaque arête pour le routage, en secondes (Infinity = interdit), par mode. */
  private readonly costs: Record<Mode, Float32Array>;

  private computeCosts(mode: Mode, out = new Float32Array(this.to.length)) {
    for (let e = 0; e < out.length; e++) {
      if (!this.allowed(e, mode)) out[e] = Infinity;
      else if (mode === Mode.Walk) out[e] = this.len[e] / WALK_SPEED;
      else if (mode === Mode.Bike) out[e] = this.len[e] / (this.flags[e] & ROAD_FLAGS.BIKE ? BIKE_SPEED : BIKE_SPEED * 0.6);
      else out[e] = this.len[e] / (this.carSpeed[e] * this.learnedFactor[e]);
    }
    return out;
  }

  /**
   * Recalcule les coûts voiture. Les itinéraires déjà connus deviennent « anciens » : ils restent
   * utilisables (habitudes) sauf si `hard`, par exemple après une fermeture de rue.
   */
  updateCarCosts(hard = false) {
    this.computeCosts(Mode.Car, this.costs[Mode.Car]);
    this.carEpoch++;
    if (hard) for (const k of this.cache.keys()) if (k.startsWith("3:")) this.cache.delete(k);
  }

  /**
   * Itinéraire du nœud `from` au nœud `to`. En voiture, `replan` force le recalcul d'un itinéraire
   * mémorisé avant la dernière mise à jour des temps de parcours.
   */
  route(from: number, to: number, mode: Mode, replan = false): Path | null {
    const key = `${mode}:${from}:${to}`;
    const hit = this.cache.get(key);
    if (hit && (mode !== Mode.Car || !replan || hit.epoch === this.carEpoch)) return hit.path;
    // à pied et à vélo, le réseau est symétrique : le retour est l'aller inversé
    if (mode !== Mode.Car) {
      const back = this.cache.get(`${mode}:${to}:${from}`);
      if (back) {
        const path = back.path && this.reverse(back.path);
        this.cache.set(key, { path, epoch: 0 });
        return path;
      }
    }
    const path = this.astar(from, to, mode);
    this.cache.set(key, { path, epoch: this.carEpoch });
    return path;
  }

  private reverse(p: Path): Path {
    const nodes = p.nodes.slice().reverse();
    const edges = new Int32Array(p.edges.length);
    const cum = new Float32Array(p.cum.length);
    for (let i = 0; i < edges.length; i++) {
      // arête inverse : celle qui part de nodes[i] vers nodes[i+1]
      const a = nodes[i], b = nodes[i + 1];
      let e = this.offset[a];
      while (e < this.offset[a + 1] && this.to[e] !== b) e++;
      edges[i] = e;
      cum[i + 1] = cum[i] + this.len[e];
    }
    return { nodes, edges, cum, length: cum[edges.length] };
  }

  // tampons réutilisés entre deux A*
  private gScore = new Float64Array(0);
  private cameFrom = new Int32Array(0);
  private visitedStamp = new Int32Array(0);
  private closedStamp = new Int32Array(0);
  private stamp = 0;

  private astar(start: number, goal: number, mode: Mode): Path | null {
    if (start < 0 || goal < 0) return null;
    if (this.gScore.length !== this.n) {
      this.gScore = new Float64Array(this.n);
      this.cameFrom = new Int32Array(this.n);
      this.visitedStamp = new Int32Array(this.n);
      this.closedStamp = new Int32Array(this.n);
    }
    const stamp = ++this.stamp;
    const g = this.gScore, came = this.cameFrom, seen = this.visitedStamp, closed = this.closedStamp;
    const cost = this.costs[mode], offset = this.offset, to = this.to, X = this.x, Z = this.z;
    const inv = 1 / (mode === Mode.Walk ? WALK_SPEED : mode === Mode.Bike ? BIKE_SPEED : HEURISTIC_CAR_SPEED);
    const gx = X[goal], gz = Z[goal];
    const h = (v: number) => {
      const dx = X[v] - gx, dz = Z[v] - gz;
      return Math.sqrt(dx * dx + dz * dz) * inv;
    };
    const heap = new MinHeap();
    g[start] = 0;
    came[start] = -1;
    seen[start] = stamp;
    heap.push(start, h(start));
    while (heap.size) {
      const v = heap.pop();
      if (v === goal) break;
      if (closed[v] === stamp) continue; // entrée périmée du tas
      closed[v] = stamp;
      const gv = g[v];
      for (let e = offset[v], end = offset[v + 1]; e < end; e++) {
        const c = cost[e];
        if (c === Infinity) continue;
        const w = to[e];
        const ng = gv + c;
        if (seen[w] === stamp && ng >= g[w]) continue;
        seen[w] = stamp;
        g[w] = ng;
        came[w] = e;
        heap.push(w, ng + h(w));
      }
    }
    if (seen[goal] !== stamp) return null;
    const edges: number[] = [];
    for (let v = goal; v !== start; ) {
      const e = came[v];
      edges.push(e);
      v = this.edgeFrom(e);
    }
    edges.reverse();
    const nodes = new Int32Array(edges.length + 1);
    const cum = new Float32Array(edges.length + 1);
    nodes[0] = start;
    edges.forEach((e, i) => {
      nodes[i + 1] = this.to[e];
      cum[i + 1] = cum[i] + this.len[e];
    });
    return { nodes, edges: Int32Array.from(edges), cum, length: cum[edges.length] };
  }

  private edgeSource?: Int32Array;
  edgeFrom(e: number): number {
    if (!this.edgeSource) {
      this.edgeSource = new Int32Array(this.to.length);
      for (let a = 0; a < this.n; a++) for (let k = this.offset[a]; k < this.offset[a + 1]; k++) this.edgeSource[k] = a;
    }
    return this.edgeSource[e];
  }
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const lastId = ids.pop()!, lastKey = keys.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= lastKey) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = lastId;
      keys[i] = lastKey;
    }
    return top;
  }
}
