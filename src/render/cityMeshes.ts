// Construit les maillages Three.js de la ville à partir de city.json.
import * as THREE from "three";
import type { City, Green } from "../shared/city";

type Pt = [number, number];

function pairs(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Bâtiments ----------

const FACADES: Record<string, string[]> = {
  house: ["#ece0c8", "#e8d3b8", "#f1e6d2", "#dcc9b0"],
  apartments: ["#e2d8ca", "#d8cbb8", "#e9dfcf", "#cfc6ba"],
  commercial: ["#cfc9c0", "#c2c6c8", "#d6cfc4"],
  industrial: ["#aeaca4", "#b8b4aa"],
  public: ["#ddd0b4", "#e2d6bf"],
  religious: ["#e9dcc0"],
  historic: ["#e8c08f", "#e4b88c"],
  small: ["#bdb5aa", "#a9a39b"],
  // façades pastel typiques de la vieille ville
  generic: ["#e9c9a0", "#eec6b5", "#f0dfb5", "#e3d9cc", "#d9c3a5", "#e7cfc0", "#f2e2c4"],
};
const ROOFS = ["#6f5f57", "#7d5240", "#5d6168", "#80614f", "#665a52"];

const WINDOW_CELLS = 8; // fenêtres par répétition de texture, dans chaque direction
const WINDOW_W = 4; // m de façade par fenêtre
const FLOOR_H = 3.1;

/** Textures de façade : diffuse (vitres sombres) et émissive (fenêtres allumées la nuit). */
function windowTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  const S = 512, c = S / WINDOW_CELLS;
  const rand = mulberry32(7);
  const diffuse = document.createElement("canvas");
  const glow = document.createElement("canvas");
  diffuse.width = diffuse.height = glow.width = glow.height = S;
  const d = diffuse.getContext("2d")!, g = glow.getContext("2d")!;
  d.fillStyle = "#fff";
  d.fillRect(0, 0, S, S);
  g.fillStyle = "#000";
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < WINDOW_CELLS; i++) {
    for (let j = 0; j < WINDOW_CELLS; j++) {
      if (i === 0 && j === WINDOW_CELLS - 1) continue; // cellule réservée aux toits (uv ≈ 0,0)
      const x = i * c + c * 0.3, y = j * c + c * 0.25, w = c * 0.4, h = c * 0.5;
      d.fillStyle = "#7d8792";
      d.fillRect(x, y, w, h);
      if (rand() < 0.38) {
        const warm = 200 + Math.floor(rand() * 55);
        g.fillStyle = `rgb(255, ${warm}, ${Math.floor(warm * 0.55)})`;
        g.fillRect(x, y, w, h);
      }
    }
  }
  const map = new THREE.CanvasTexture(diffuse);
  const emissive = new THREE.CanvasTexture(glow);
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
  }
  return { map, emissive };
}

export function buildBuildings(city: City) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [];
  const rand = mulberry32(42);
  const c = new THREE.Color();
  const ROOF_UV = [0.01, 0.01];

  for (const b of city.buildings) {
    const ring = pairs(b.p);
    if (ring.length < 3) continue;
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      area += x0 * z1 - x1 * z0;
    }
    const sign = area > 0 ? 1 : -1;
    const palette = FACADES[b.k] ?? FACADES.generic;
    c.set(palette[Math.floor(rand() * palette.length)]).offsetHSL(0, 0, (rand() - 0.5) * 0.06);
    const [fr, fg, fb] = [c.r, c.g, c.b];
    c.set(ROOFS[Math.floor(rand() * ROOFS.length)]);
    const [rr, rg, rb] = [c.r, c.g, c.b];
    const h = b.h;
    const vRepeat = h / (FLOOR_H * WINDOW_CELLS);

    // Murs : un quad par arête, normale sortante.
    let u0 = rand() * WINDOW_CELLS * WINDOW_W;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.05) continue;
      const nx = (sign * (z1 - z0)) / len, nz = (-sign * (x1 - x0)) / len;
      const ua = u0 / (WINDOW_W * WINDOW_CELLS), ub = (u0 + len) / (WINDOW_W * WINDOW_CELLS);
      u0 += len;
      // (x0,0) (x1,0) (x1,h) / (x0,0) (x1,h) (x0,h), sens choisi pour que la face regarde dehors
      const quad: [number, number, number, number, number][] = [
        [x0, 0, z0, ua, 0], [x1, 0, z1, ub, 0], [x1, h, z1, ub, vRepeat],
        [x0, 0, z0, ua, 0], [x1, h, z1, ub, vRepeat], [x0, h, z0, ua, vRepeat],
      ];
      // normale géométrique de (a,b,c) = (b-a)×(c-a) ; y = 0, on teste le signe en xz
      const gx = -(z1 - z0) * h, gz = (x1 - x0) * h;
      const order = gx * nx + gz * nz >= 0 ? [0, 1, 2, 3, 4, 5] : [0, 2, 1, 3, 5, 4];
      for (const k of order) {
        const [x, y, z, u, v] = quad[k];
        pos.push(x, y, z);
        nor.push(nx, 0, nz);
        col.push(fr, fg, fb);
        uv.push(u, v);
      }
    }

    // Toit plat.
    const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [a, bb, cc] of tris) {
      const pa = ring[a], pb = ring[bb], pc = ring[cc];
      // y de (b-a)×(c-a) = dz1*dx2 - dx1*dz2 ; doit être > 0 pour regarder vers le haut
      const ny = (pb[1] - pa[1]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[1] - pa[1]);
      for (const p of ny >= 0 ? [pa, pb, pc] : [pa, pc, pb]) {
        pos.push(p[0], h, p[1]);
        nor.push(0, 1, 0);
        col.push(rr, rg, rb);
        uv.push(ROOF_UV[0], ROOF_UV[1]);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  const { map, emissive } = windowTextures();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map,
    emissiveMap: emissive,
    emissive: new THREE.Color("#ffffff"),
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.name = "buildings";
  return { mesh, material: mat };
}

// ---------- Rubans (rues, rivières, rail) ----------

export function ribbon(lines: { pts: Pt[]; w: number }[], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const { pts, w } of lines) {
    if (pts.length < 2) continue;
    const half = w / 2;
    const left: Pt[] = [], right: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next[0] - prev[0], dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      // miter limité pour éviter les pointes sur les virages serrés
      let scale = 1;
      if (i > 0 && i < pts.length - 1) {
        const ax = pts[i][0] - prev[0], az = pts[i][1] - prev[1];
        const al = Math.hypot(ax, az) || 1;
        const cos = (ax / al) * dx + (az / al) * dz;
        scale = Math.min(1 / Math.max(cos, 0.35), 2.5);
      }
      left.push([pts[i][0] - dz * half * scale, pts[i][1] + dx * half * scale]);
      right.push([pts[i][0] + dz * half * scale, pts[i][1] - dx * half * scale]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = left[i], b = right[i], c = right[i + 1], d = left[i + 1];
      // vers le haut : (b-a)×(c-a) doit avoir y > 0
      const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) >= 0;
      const tri = up ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
      for (const p of tri) pos.push(p[0], y, p[1]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  geo.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  return geo;
}

const ROAD_GROUPS: { types: string[]; color: string; y: number }[] = [
  { types: ["footway", "path", "steps", "track"], color: "#d6cbb5", y: 0.25 },
  { types: ["cycleway"], color: "#b77b67", y: 0.3 },
  { types: ["pedestrian", "living_street"], color: "#cdbb9c", y: 0.35 },
  { types: ["service", "residential", "unclassified", "tertiary", "tertiary_link"], color: "#62656b", y: 0.4 },
  { types: ["secondary", "secondary_link", "primary", "primary_link", "trunk", "trunk_link"], color: "#4b4e54", y: 0.45 },
];

/** Matériaux des rues, éclairés par les lampadaires la nuit. */
export const streetMaterials: THREE.MeshStandardMaterial[] = [];

export function buildRoads(city: City): THREE.Group {
  const group = new THREE.Group();
  group.name = "roads";
  const node = (i: number): Pt => [city.nodes[2 * i], city.nodes[2 * i + 1]];
  for (const g of ROAD_GROUPS) {
    const lines = city.roads.filter((r) => g.types.includes(r.t)).map((r) => ({ pts: r.n.map(node), w: r.w }));
    const mat = new THREE.MeshStandardMaterial({
      color: g.color, roughness: 0.95, emissive: "#ffb766", emissiveIntensity: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -g.y * 10,
    });
    streetMaterials.push(mat);
    const mesh = new THREE.Mesh(ribbon(lines, g.y), mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const rail = new THREE.Mesh(
    ribbon(city.rail.map((l) => ({ pts: pairs(l.p), w: l.w })), 0.3),
    new THREE.MeshStandardMaterial({ color: "#6b5d52", roughness: 1 }),
  );
  rail.receiveShadow = true;
  group.add(rail);
  return group;
}

// ---------- Surfaces plates ----------

function flatShape(outer: Pt[], holes: Pt[][], y: number): THREE.BufferGeometry {
  // ShapeGeometry est dans le plan XY : on passe (x, -z) puis on bascule de -90° autour de X.
  const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

export const waterMaterial = new THREE.MeshStandardMaterial({ color: "#3a7ca3", roughness: 0.12, metalness: 0.25 });

export function buildWater(city: City): THREE.Group {
  const group = new THREE.Group();
  group.name = "water";
  for (const w of city.water) {
    const mesh = new THREE.Mesh(flatShape(pairs(w.outer), w.holes.map(pairs), 0.15), waterMaterial);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const rivers = new THREE.Mesh(ribbon(city.waterways.map((l) => ({ pts: pairs(l.p), w: l.w })), 0.18), waterMaterial);
  group.add(rivers);
  return group;
}

const GREEN_COLORS: Record<string, string> = { park: "#7fa257", grass: "#8bab62", forest: "#5b7d42", pitch: "#6aa04c" };

export function buildGreens(city: City): THREE.Group {
  const group = new THREE.Group();
  group.name = "greens";
  for (const [k, color] of Object.entries(GREEN_COLORS)) {
    const geos = city.greens.filter((g) => g.k === k).map((g) => flatShape(pairs(g.p), [], 0.08));
    if (!geos.length) continue;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    for (const geo of geos) {
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }
  return group;
}

// ---------- Arbres ----------

function pointInRing(x: number, z: number, ring: Pt[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const TREE_DENSITY: Record<string, number> = { forest: 1 / 90, park: 1 / 350, grass: 1 / 900, pitch: 0 };

export function buildTrees(greens: Green[]): THREE.Group {
  const rand = mulberry32(3);
  const spots: [number, number, number][] = [];
  for (const g of greens) {
    const ring = pairs(g.p);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x, z] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      area += x * z1 - x1 * z;
    }
    const count = Math.min(1500, Math.round((Math.abs(area) / 2) * TREE_DENSITY[g.k]));
    for (let n = 0, tries = 0; n < count && tries < count * 4; tries++) {
      const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
      if (!pointInRing(x, z, ring)) continue;
      spots.push([x, z, 0.7 + rand() * 0.7]);
      n++;
    }
  }

  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 5).translate(0, 1.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(2.6, 0).translate(0, 5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: "#5a4636", roughness: 1 }), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, flatShading: true }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const color = new THREE.Color();
  // fin octobre : un mélange de verts et de teintes d'automne
  const leaves = ["#4f7a3a", "#5e8a40", "#6f8f3c", "#b8862f", "#c46a2b", "#8f9a38"];
  spots.forEach(([x, z, k], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    m.compose(p.set(x, 0, z), q, s.set(k, k * (0.85 + rand() * 0.4), k));
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, color.set(leaves[Math.floor(rand() * leaves.length)]));
  });
  crowns.castShadow = trunks.castShadow = true;
  const group = new THREE.Group();
  group.name = "trees";
  group.add(trunks, crowns);
  return group;
}

// ---------- Relief ----------

export function buildTerrain(city: City): THREE.Mesh {
  const { half, res, h } = city.terrain;
  const geo = new THREE.PlaneGeometry(half * 2, half * 2, res, res);
  geo.rotateX(-Math.PI / 2); // (x, y) → (x, -y) en xz : la ligne j correspond à z = -half + j·pas
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const urban = new THREE.Color("#a7a493"), meadow = new THREE.Color("#7e9a5a"), forest = new THREE.Color("#466a35");
  const rock = new THREE.Color("#8d877c"), snow = new THREE.Color("#f2f4f7"), shore = new THREE.Color("#9c9886");
  const b = city.bounds;
  for (let i = 0; i < pos.count; i++) {
    const y = h[i];
    pos.setY(i, y);
    const x = pos.getX(i), z = pos.getZ(i);
    const inZone = x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
    if (y < 0) c.copy(shore);
    else if (inZone) c.copy(urban);
    else if (y < 150) c.copy(meadow).lerp(forest, y / 150);
    else if (y < 900) c.copy(forest);
    else if (y < 1350) c.copy(forest).lerp(rock, (y - 900) / 450);
    else if (y < 1700) c.copy(rock);
    else c.copy(rock).lerp(snow, Math.min(1, (y - 1700) / 150));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false }));
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}
