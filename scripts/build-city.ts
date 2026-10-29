// Convertit data/osm-raw.json en public/city.json : géométries projetées en mètres,
// hauteurs de bâtiments, lac découpé à la zone, graphe des rues et lieux d'intérêt.
import { readFileSync, writeFileSync } from "node:fs";
import { BBOX, project } from "../src/shared/geo";
import type { City, Building, Road, Poi, WaterPoly, Green, Line } from "../src/shared/city";
import { ROAD_FLAGS } from "../src/shared/city";

type Pt = [number, number];
type OsmGeom = { lat: number; lon: number }[];
type OsmEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: OsmGeom;
  members?: { type: string; role: string; geometry?: OsmGeom }[];
};

const elements: OsmEl[] = JSON.parse(readFileSync("data/osm-raw.json", "utf8")).elements;

const [minX, maxZ] = project(BBOX.south, BBOX.west);
const [maxX, minZ] = project(BBOX.north, BBOX.east);

const r1 = (v: number) => Math.round(v * 10) / 10;
const toPts = (g: OsmGeom): Pt[] => g.map((p) => project(p.lat, p.lon));
const flat = (pts: Pt[]) => pts.flatMap(([x, z]) => [r1(x), r1(z)]);
const inside = ([x, z]: Pt) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;

// Hachage déterministe pour varier les hauteurs sans aléa entre deux builds.
function hash01(n: number) {
  let h = n ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function centroid(pts: Pt[]): Pt {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
}

function openRing(pts: Pt[]): Pt[] {
  const a = pts[0], b = pts[pts.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? pts.slice(0, -1) : pts;
}

type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
const ZONE: Rect = { minX, maxX, minZ, maxZ };
// Le paysage (lac entier, montagnes) s'étend bien au-delà de la zone simulée.
const TERRAIN_HALF = 16_000;
const TERRAIN: Rect = { minX: -TERRAIN_HALF, maxX: TERRAIN_HALF, minZ: -TERRAIN_HALF, maxZ: TERRAIN_HALF };

// Sutherland–Hodgman contre un rectangle (la zone simulée par défaut).
function clipToBBox(poly: Pt[], { minX, maxX, minZ, maxZ }: Rect = ZONE): Pt[] {
  const edges: [(p: Pt) => boolean, (a: Pt, b: Pt) => Pt][] = [
    [(p) => p[0] >= minX, (a, b) => lerpX(a, b, minX)],
    [(p) => p[0] <= maxX, (a, b) => lerpX(a, b, maxX)],
    [(p) => p[1] >= minZ, (a, b) => lerpZ(a, b, minZ)],
    [(p) => p[1] <= maxZ, (a, b) => lerpZ(a, b, maxZ)],
  ];
  let out = poly;
  for (const [ins, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (ins(cur)) {
        if (!ins(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (ins(prev)) out.push(cut(prev, cur));
    }
    if (out.length === 0) break;
  }
  return out;
}
const lerpX = (a: Pt, b: Pt, x: number): Pt => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
const lerpZ = (a: Pt, b: Pt, z: number): Pt => [a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]), z];

// Assemble les membres d'un multipolygone en anneaux fermés.
function stitch(ways: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const rest = ways.map((w) => w.slice());
  const rings: Pt[][] = [];
  while (rest.length) {
    let ring = rest.shift()!;
    let grown = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grown) {
      grown = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < rest.length; i++) {
        const w = rest[i];
        if (key(w[0]) === end) ring = ring.concat(w.slice(1));
        else if (key(w[w.length - 1]) === end) ring = ring.concat(w.slice().reverse().slice(1));
        else continue;
        rest.splice(i, 1);
        grown = true;
        break;
      }
    }
    rings.push(openRing(ring));
  }
  return rings;
}

// ---------- Bâtiments ----------
const TYPE_HEIGHT: Record<string, [number, number]> = {
  house: [6, 9], detached: [6, 9], semidetached_house: [6, 9], terrace: [8, 12], bungalow: [3.5, 5],
  apartments: [12, 22], residential: [10, 18], commercial: [8, 16], retail: [5, 9], office: [12, 20],
  industrial: [7, 11], warehouse: [7, 10], church: [16, 24], cathedral: [24, 32], chapel: [8, 12],
  school: [8, 13], university: [10, 16], hospital: [14, 24], hotel: [12, 20], train_station: [9, 12],
  garage: [2.6, 3.2], garages: [2.6, 3.2], shed: [2.4, 3], roof: [4, 6], carport: [2.5, 3], kiosk: [3, 3.5],
  civic: [10, 15], public: [10, 15], government: [10, 16], castle: [16, 24], parking: [8, 14],
};

function buildingHeight(tags: Record<string, string>, id: number): number {
  const num = (s?: string) => (s ? parseFloat(s.replace(",", ".")) : NaN);
  const h = num(tags.height);
  if (!isNaN(h)) return h;
  const lv = num(tags["building:levels"]);
  if (!isNaN(lv)) return lv * 3.1 + 1.2 + hash01(id) * 1.5;
  const [lo, hi] = TYPE_HEIGHT[tags.building] ?? [9, 17];
  return lo + (hi - lo) * hash01(id);
}

function buildingKind(tags: Record<string, string>): string {
  const b = tags.building;
  if (tags.amenity === "place_of_worship" || ["church", "cathedral", "chapel"].includes(b)) return "religious";
  if (tags.historic || b === "castle" || tags.tourism === "attraction") return "historic";
  if (["house", "detached", "semidetached_house", "terrace", "bungalow"].includes(b)) return "house";
  if (["apartments", "residential"].includes(b)) return "apartments";
  if (["commercial", "retail", "office", "hotel", "supermarket"].includes(b) || tags.shop) return "commercial";
  if (["industrial", "warehouse"].includes(b)) return "industrial";
  if (["school", "university", "college", "kindergarten", "hospital", "civic", "public", "government", "train_station"].includes(b)) return "public";
  if (["garage", "garages", "shed", "roof", "carport", "kiosk", "parking"].includes(b)) return "small";
  return "generic";
}

const buildings: Building[] = [];
for (const el of elements) {
  if (!el.tags?.building || el.tags.building === "no") continue;
  let outer: Pt[] | undefined;
  if (el.type === "way" && el.geometry) outer = openRing(toPts(el.geometry));
  else if (el.type === "relation" && el.members) {
    const rings = stitch(el.members.filter((m) => m.role === "outer" && m.geometry).map((m) => toPts(m.geometry!)));
    outer = rings.sort((a, b) => b.length - a.length)[0];
  }
  if (!outer || outer.length < 3 || !inside(centroid(outer))) continue;
  buildings.push({
    id: el.id,
    p: flat(outer),
    h: r1(buildingHeight(el.tags, el.id)),
    k: buildingKind(el.tags),
    ...(el.tags.name ? { n: el.tags.name } : {}),
  });
}

// ---------- Eau ----------
const water: WaterPoly[] = [];
for (const el of elements) {
  if (el.tags?.natural !== "water") continue;
  let outers: Pt[][] = [], inners: Pt[][] = [];
  if (el.type === "way" && el.geometry) outers = [openRing(toPts(el.geometry))];
  else if (el.type === "relation" && el.members) {
    outers = stitch(el.members.filter((m) => m.role === "outer" && m.geometry).map((m) => toPts(m.geometry!)));
    inners = stitch(el.members.filter((m) => m.role === "inner" && m.geometry).map((m) => toPts(m.geometry!)));
  }
  const rect = el.tags.water === "lake" ? TERRAIN : ZONE;
  for (const o of outers) {
    const c = clipToBBox(o, rect);
    if (c.length < 3) continue;
    const holes = inners.map((h) => clipToBBox(h, rect)).filter((h) => h.length >= 3);
    water.push({ outer: flat(c), holes: holes.map(flat), ...(el.tags.name ? { n: el.tags.name } : {}) });
  }
}

const waterways: Line[] = [];
for (const el of elements) {
  const ww = el.tags?.waterway;
  if (el.type !== "way" || !el.geometry || !ww || !["river", "canal", "stream"].includes(ww)) continue;
  const pts = toPts(el.geometry);
  if (!pts.some(inside)) continue;
  waterways.push({ p: flat(pts), w: ww === "stream" ? 2 : ww === "canal" ? 6 : 10, ...(el.tags!.name ? { n: el.tags!.name } : {}) });
}

// ---------- Espaces verts ----------
const greens: Green[] = [];
for (const el of elements) {
  if (el.type !== "way" || !el.geometry || !el.tags) continue;
  const t = el.tags;
  const k =
    t.leisure === "park" || t.leisure === "garden" ? "park" :
    t.leisure === "pitch" ? "pitch" :
    t.leisure === "playground" ? "park" :
    t.landuse === "forest" || t.natural === "wood" ? "forest" :
    ["grass", "meadow", "recreation_ground"].includes(t.landuse ?? "") ? "grass" : null;
  if (!k) continue;
  const c = clipToBBox(openRing(toPts(el.geometry)));
  if (c.length >= 3) greens.push({ p: flat(c), k });
}

// ---------- Rues + graphe ----------
const ROAD_SPEC: Record<string, { w: number; f: number }> = {
  trunk: { w: 14, f: ROAD_FLAGS.CAR }, trunk_link: { w: 8, f: ROAD_FLAGS.CAR },
  primary: { w: 12, f: ROAD_FLAGS.ALL }, primary_link: { w: 7, f: ROAD_FLAGS.ALL },
  secondary: { w: 10, f: ROAD_FLAGS.ALL }, secondary_link: { w: 7, f: ROAD_FLAGS.ALL },
  tertiary: { w: 8, f: ROAD_FLAGS.ALL }, tertiary_link: { w: 6, f: ROAD_FLAGS.ALL },
  unclassified: { w: 7, f: ROAD_FLAGS.ALL }, residential: { w: 7, f: ROAD_FLAGS.ALL },
  living_street: { w: 6, f: ROAD_FLAGS.ALL }, service: { w: 4.5, f: ROAD_FLAGS.ALL },
  pedestrian: { w: 6, f: ROAD_FLAGS.FOOT | ROAD_FLAGS.BIKE },
  footway: { w: 2.2, f: ROAD_FLAGS.FOOT }, path: { w: 2, f: ROAD_FLAGS.FOOT | ROAD_FLAGS.BIKE },
  steps: { w: 2, f: ROAD_FLAGS.FOOT }, cycleway: { w: 2.5, f: ROAD_FLAGS.BIKE | ROAD_FLAGS.FOOT },
  track: { w: 3, f: ROAD_FLAGS.FOOT | ROAD_FLAGS.BIKE },
};

const nodeIndex = new Map<number, number>();
const nodes: number[] = [];
const roads: Road[] = [];
for (const el of elements) {
  const hw = el.tags?.highway;
  if (el.type !== "way" || !hw || !el.geometry || !el.nodes) continue;
  const spec = ROAD_SPEC[hw];
  if (!spec) continue;
  const pts = toPts(el.geometry);
  if (!pts.some(inside)) continue;
  let f = spec.f;
  if (el.tags!.bicycle === "yes" || el.tags!.bicycle === "designated") f |= ROAD_FLAGS.BIKE;
  if (el.tags!.oneway === "yes" && f & ROAD_FLAGS.CAR) f |= ROAD_FLAGS.ONEWAY;
  if (el.tags!.bridge === "yes") f |= ROAD_FLAGS.BRIDGE;
  const n = el.nodes.map((id, i) => {
    let idx = nodeIndex.get(id);
    if (idx === undefined) {
      idx = nodes.length / 2;
      nodeIndex.set(id, idx);
      nodes.push(r1(pts[i][0]), r1(pts[i][1]));
    }
    return idx;
  });
  roads.push({ id: el.id, t: hw, w: spec.w, f, n, ...(el.tags!.name ? { name: el.tags!.name } : {}) });
}

const rail: Line[] = [];
for (const el of elements) {
  if (el.type === "way" && el.tags?.railway === "rail" && el.geometry) rail.push({ p: flat(toPts(el.geometry)), w: 3 });
}

// ---------- Lieux ----------
const POI_KIND: [string, (t: Record<string, string>) => boolean][] = [
  ["food", (t) => ["restaurant", "fast_food", "cafe", "ice_cream", "food_court"].includes(t.amenity)],
  ["bar", (t) => ["bar", "pub", "nightclub", "biergarten"].includes(t.amenity)],
  ["grocery", (t) => ["supermarket", "convenience", "bakery", "butcher", "greengrocer", "cheese", "deli"].includes(t.shop)],
  ["shop", (t) => !!t.shop],
  ["school", (t) => ["school", "kindergarten", "college", "university"].includes(t.amenity)],
  ["health", (t) => ["pharmacy", "doctors", "hospital", "clinic", "dentist"].includes(t.amenity)],
  ["office", (t) => !!t.office || ["bank", "townhall", "post_office", "police", "courthouse"].includes(t.amenity)],
  ["culture", (t) => ["museum", "gallery", "attraction"].includes(t.tourism) || ["theatre", "cinema", "arts_centre", "library"].includes(t.amenity)],
  ["hotel", (t) => ["hotel", "hostel", "guest_house", "apartment", "camp_site"].includes(t.tourism)],
  ["sport", (t) => ["sports_centre", "fitness_centre", "swimming_pool", "stadium"].includes(t.leisure)],
  ["boat", (t) => t.amenity === "ferry_terminal" || t.leisure === "marina" || t.amenity === "boat_rental"],
  ["worship", (t) => t.amenity === "place_of_worship"],
];

const pois: Poi[] = [];
for (const el of elements) {
  if (!el.tags || el.tags.building) continue;
  let pos: Pt | undefined;
  if (el.type === "node" && el.lat !== undefined) pos = project(el.lat, el.lon!);
  else if (el.type === "way" && el.geometry && (el.tags.amenity || el.tags.shop || el.tags.tourism)) pos = centroid(toPts(el.geometry));
  if (!pos || !inside(pos)) continue;
  const kind = POI_KIND.find(([, test]) => test(el.tags!))?.[0];
  if (!kind) continue;
  pois.push({ k: kind, x: r1(pos[0]), z: r1(pos[1]), ...(el.tags.name ? { n: el.tags.name } : {}) });
}

// ---------- Relief ----------
// Pas de MNT : on modélise les massifs autour d'Annecy par des crêtes gaussiennes,
// aplaties sur la ville et sous le lac.
const lake = water.find((w) => w.n === "Lac d'Annecy");
const lakeRing: Pt[] = [];
if (lake) for (let i = 0; i < lake.outer.length; i += 2) lakeRing.push([lake.outer[i], lake.outer[i + 1]]);

function inPoly(x: number, z: number, ring: Pt[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// [lat, lon] début et fin de crête, altitude au-dessus du lac (447 m), demi-largeur en m.
const RIDGES: [[number, number], [number, number], number, number][] = [
  [[45.905, 6.168], [45.895, 6.192], 840, 1100], // Mont Veyrier – Mont Baron
  [[45.86, 6.105], [45.785, 6.095], 1230, 2600], // Semnoz
  [[45.836, 6.283], [45.815, 6.29], 1900, 2600], // La Tournette
  [[45.935, 6.255], [45.94, 6.28], 1380, 2000], // Parmelan
  [[45.87, 6.21], [45.84, 6.235], 700, 1400], // Dents de Lanfon
  [[45.955, 6.075], [45.935, 6.04], 550, 2500], // Mandallaz
  [[45.79, 6.17], [45.76, 6.2], 1000, 2500], // Taillefer
];
const ridges = RIDGES.map(([a, b, h, w]) => ({ a: project(a[0], a[1]), b: project(b[0], b[1]), h, w }));

function rawHeight(x: number, z: number) {
  let h = 0;
  for (const { a, b, h: hh, w } of ridges) {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz)));
    const d2 = (x - a[0] - t * dx) ** 2 + (z - a[1] - t * dz) ** 2;
    h = Math.max(h, hh * Math.exp(-d2 / (2 * w * w)));
  }
  // ravines et irrégularités, plus marquées en altitude
  return h * (0.82 + 0.3 * fbm(x / 1400, z / 1400)) + 70 * fbm(x / 700 + 9, z / 700 - 4);
}

// Bruit de valeur lissé, sommé sur plusieurs octaves (résultat ≈ [-1, 1]).
function valueNoise(x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const v = (i: number, j: number) => hash01(Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) * 2 - 1;
  const a = v(xi, zi), b = v(xi + 1, zi), c = v(xi, zi + 1), d = v(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x: number, z: number) {
  let sum = 0, amp = 0.55, f = 1;
  for (let o = 0; o < 5; o++, amp *= 0.5, f *= 2.03) sum += amp * valueNoise(x * f, z * f);
  return sum;
}

function distToRing(x: number, z: number, ring: Pt[]) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2);
  }
  return Math.sqrt(best);
}

const TERRAIN_RES = 320;
const heights: number[] = [];
for (let j = 0; j <= TERRAIN_RES; j++) {
  for (let i = 0; i <= TERRAIN_RES; i++) {
    const x = -TERRAIN_HALF + (2 * TERRAIN_HALF * i) / TERRAIN_RES;
    const z = -TERRAIN_HALF + (2 * TERRAIN_HALF * j) / TERRAIN_RES;
    // distance au bord de la zone simulée : 0 dedans, monte progressivement dehors
    const ox = Math.max(minX - x, 0, x - maxX), oz = Math.max(minZ - z, 0, z - maxZ);
    const fade = Math.min(1, Math.hypot(ox, oz) / 1500);
    let h = Math.max(0, rawHeight(x, z)) * fade * fade;
    if (inPoly(x, z, lakeRing)) h = -8;
    else if (h > 0) {
      // les pentes rejoignent la rive au lieu de couper le plan d'eau
      const shore = Math.min(1, distToRing(x, z, lakeRing) / 450);
      h *= shore * (2 - shore);
    }
    heights.push(Math.round(h));
  }
}

const city: City = {
  bounds: { minX: r1(minX), maxX: r1(maxX), minZ: r1(minZ), maxZ: r1(maxZ) },
  buildings, water, waterways, greens, roads, rail, nodes, pois,
  terrain: { half: TERRAIN_HALF, res: TERRAIN_RES, h: heights },
};
writeFileSync("public/city.json", JSON.stringify(city));
console.log(
  `✓ public/city.json : ${buildings.length} bâtiments, ${roads.length} rues, ${nodes.length / 2} nœuds, ` +
  `${water.length} plans d'eau, ${greens.length} espaces verts, ${pois.length} lieux`,
);
