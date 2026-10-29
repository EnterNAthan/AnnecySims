// Construit public/transit.json : lignes de bus Sibra (arrêts ordonnés, couleurs officielles) et parkings publics.
// Entrées : data/transit-raw.json (scripts/fetch-transit.ts) et data/osm-raw.json (scripts/fetch-osm.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { BBOX, project } from "../src/shared/geo";
import type { Transit } from "../src/shared/city";

type El = { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string>; members?: { type: string; ref: number; role: string }[]; geometry?: { lat: number; lon: number }[] };

const inside = (lat: number, lon: number) => lat > BBOX.south && lat < BBOX.north && lon > BBOX.west && lon < BBOX.east;
const round = (v: number) => Math.round(v * 10) / 10;

// ---------- lignes ----------
const raw: El[] = JSON.parse(readFileSync("data/transit-raw.json", "utf8")).elements;
const nodes = new Map(raw.filter((e) => e.type === "node").map((n) => [n.id, n]));
const byRef = new Map<string, { colour: string; dirs: { name: string; stops: { name: string; x: number; z: number }[] }[] }>();
for (const r of raw) {
  if (r.type !== "relation" || r.tags?.network !== "Sibra" || !r.tags.ref) continue;
  const stops: { name: string; x: number; z: number }[] = [];
  for (const m of r.members ?? []) {
    if (m.type !== "node" || !/stop|platform/.test(m.role)) continue;
    const n = nodes.get(m.ref);
    if (!n?.lat || !inside(n.lat, n.lon!)) continue;
    const name = n.tags?.name ?? "Arrêt";
    // un arrêt figure souvent deux fois (poteau et quai)
    if (stops.at(-1)?.name === name) continue;
    const [x, z] = project(n.lat, n.lon!);
    stops.push({ name, x: round(x), z: round(z) });
  }
  if (stops.length < 4) continue;
  let line = byRef.get(r.tags.ref);
  if (!line) byRef.set(r.tags.ref, (line = { colour: r.tags.colour ?? "#2a6fd6", dirs: [] }));
  line.dirs.push({ name: r.tags.name ?? r.tags.ref, stops });
}
// par ligne, les deux variantes principales (aller et retour), les plus longues dans la zone
const lines: Transit["lines"] = [];
for (const [ref, l] of [...byRef].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const sorted = l.dirs.sort((a, b) => b.stops.length - a.stops.length);
  const first = sorted[0];
  // retour : celle qui commence près de la fin de l'aller
  const end = first.stops.at(-1)!;
  const back = sorted.slice(1).sort((a, b) => Math.hypot(a.stops[0].x - end.x, a.stops[0].z - end.z) - Math.hypot(b.stops[0].x - end.x, b.stops[0].z - end.z))[0];
  lines.push({ ref, colour: l.colour, dirs: back ? [first, back] : [first] });
}

// ---------- parkings ----------
const osm: El[] = JSON.parse(readFileSync("data/osm-raw.json", "utf8")).elements;
const parkings: Transit["parkings"] = [];
for (const e of osm) {
  const t = e.tags;
  if (t?.amenity !== "parking" || /private|customers|no/.test(t.access ?? "")) continue;
  let lat = e.lat, lon = e.lon, area = 0;
  if (e.geometry?.length) {
    const pts = e.geometry.map((g) => project(g.lat, g.lon));
    lat = e.geometry.reduce((s, g) => s + g.lat, 0) / e.geometry.length;
    lon = e.geometry.reduce((s, g) => s + g.lon, 0) / e.geometry.length;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
      area += x1 * z2 - x2 * z1;
    }
    area = Math.abs(area) / 2;
  }
  if (!lat || !lon || !inside(lat, lon)) continue;
  const kind = t.parking === "underground" || t.parking === "multi-storey" ? "ouvrage" : "surface";
  // ≈ 25 m² par place ; un parking en ouvrage a plusieurs niveaux
  const capacity = Number(t.capacity) || Math.round((area / 25) * (kind === "ouvrage" ? 3 : 1));
  if (capacity < 40) continue;
  const [x, z] = project(lat, lon);
  parkings.push({ name: t.name ?? (kind === "ouvrage" ? "Parking souterrain" : "Parking"), x: round(x), z: round(z), capacity, kind, paid: t.fee === "yes" });
}

writeFileSync("public/transit.json", JSON.stringify({ lines, parkings } satisfies Transit));
console.log(`${lines.length} lignes (${lines.map((l) => l.ref).join(", ")}), ${parkings.length} parkings, ${parkings.reduce((s, p) => s + p.capacity, 0)} places`);
