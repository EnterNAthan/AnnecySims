// Marc : le seul habitant dessiné en détail. Ce matin, il est coincé dans les bouchons de l'avenue
// d'Albigny. Ouverture en gros plan sur lui au volant ; au clic, la caméra recule et s'élève jusqu'à
// révéler la file de voitures, l'accident qui la provoque, puis toute la ville. On peut ensuite le suivre.
// La file, l'accident et le trajet de Marc sont mis en scène ici, en temps réel ; la simulation n'en
// sait rien et ses propres voitures sont masquées dans ce couloir tant que dure l'accident.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { City } from "../shared/city";
import { Graph, Mode } from "../sim/graph";
import type { World } from "./scene";

const ROAD_Y = 0.45;
/** décalage du centre de la voie de droite (avenue de 10 m) */
const LANE = 2.6;
/** départ du trajet (avenue d'Albigny, côté Annecy-le-Vieux) et arrivée (bureau près de la gare) */
const FROM: [number, number] = [963, -643];
const TO: [number, number] = [-505, -224];
/** abscisse de l'accident le long du trajet (m) : les voitures s'arrêtent juste avant */
const GATE_S = 372;
/** secondes entre deux voitures que l'agent fait passer par la voie d'en face */
const GATE_PERIOD = 3.2;
const CARS_AHEAD = 9;
const CARS_BEHIND = 34;
/** centre de la vue d'ensemble de la ville, à la fin du recul */
const CITY_CENTER = new THREE.Vector3(250, 0, -50);
/** au-delà, les voitures de la file se fondent dans le trafic simulé */
const VANISH_AFTER = 200;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Tracé ----------

class Route {
  readonly x: number[] = [];
  readonly z: number[] = [];
  readonly cum: number[] = [];
  readonly length: number;

  constructor(pts: [number, number][]) {
    for (const [x, z] of pts) {
      const n = this.x.length;
      if (n && Math.hypot(x - this.x[n - 1], z - this.z[n - 1]) < 0.5) continue;
      this.cum.push(n ? this.cum[n - 1] + Math.hypot(x - this.x[n - 1], z - this.z[n - 1]) : 0);
      this.x.push(x);
      this.z.push(z);
    }
    this.length = this.cum[this.cum.length - 1];
  }

  point(s: number, out = new THREE.Vector2()) {
    s = Math.min(this.length, Math.max(0, s));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const k = (s - this.cum[lo]) / Math.max(1e-6, this.cum[hi] - this.cum[lo]);
    return out.set(this.x[lo] + (this.x[hi] - this.x[lo]) * k, this.z[lo] + (this.z[hi] - this.z[lo]) * k);
  }

  /** point décalé de `lat` m vers la droite du sens de marche */
  offset(s: number, lat: number, out = new THREE.Vector2()) {
    const a = this.point(s - 1.5), b = this.point(s + 1.5);
    const tx = b.x - a.x, tz = b.y - a.y, n = Math.hypot(tx, tz) || 1;
    this.point(s, out);
    return out.set(out.x - (tz / n) * lat, out.y + (tx / n) * lat);
  }

  /** position (x, z) et cap d'un véhicule centré en s, virages lissés sur sa longueur */
  place(s: number, lat: (s: number) => number) {
    const a = this.offset(s - 2.2, lat(s - 2.2)), b = this.offset(s + 2.2, lat(s + 2.2));
    return { x: (a.x + b.x) / 2, z: (a.y + b.y) / 2, h: Math.atan2(b.x - a.x, b.y - a.y) };
  }

  /** variation de cap sur les `ahead` prochains mètres (rad), pour ralentir avant un virage */
  turn(s: number, ahead: number) {
    let total = 0, prev = this.place(s, () => 0).h;
    for (let d = 5; d <= ahead; d += 5) {
      const h = this.place(s + d, () => 0).h;
      total = Math.max(total, Math.abs(Math.atan2(Math.sin(h - prev), Math.cos(h - prev))));
      prev = h;
    }
    return total;
  }
}

// ---------- Géométries ----------

/** Géométrie à couleur de sommet, prête à être fusionnée avec d'autres pièces. */
function paint(geo: THREE.BufferGeometry, color: string) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute("uv");
  if (g.attributes.uv1) g.deleteAttribute("uv1");
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return g;
}

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

/** Pavé allant de a à b (épaisseur w × d), pour montants, poutres, membres. */
function beamGeometry(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number) {
  const len = a.distanceTo(b);
  const geo = new THREE.BoxGeometry(w, len, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  geo.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return geo;
}

/** Place un maillage (cylindre de hauteur 1 selon y) entre a et b. */
function stretch(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  mesh.scale.set(1, a.distanceTo(b), 1);
}

interface CarSpec {
  L: number;
  W: number;
  H: number;
  /** garde au sol, ligne de caisse */
  clear: number;
  belt: number;
  /** z du pied de pare-brise et de lunette, z du pavillon avant et arrière */
  zf: number;
  zb: number;
  rf: number;
  rb: number;
  wheelR: number;
  /** z des essieux avant et arrière */
  axF: number;
  axB: number;
  /** hauteur du nez (capot avant) */
  nose: number;
}

const SPECS: Record<"hatch" | "sedan" | "suv" | "van", CarSpec> = {
  hatch: { L: 4.05, W: 1.76, H: 1.47, clear: 0.2, belt: 0.93, zf: 0.78, zb: -1.9, rf: 0.02, rb: -1.62, wheelR: 0.31, axF: 1.3, axB: -1.25, nose: 0.74 },
  sedan: { L: 4.6, W: 1.8, H: 1.44, clear: 0.18, belt: 0.9, zf: 0.92, zb: -1.55, rf: 0.12, rb: -1.0, wheelR: 0.32, axF: 1.45, axB: -1.4, nose: 0.72 },
  suv: { L: 4.5, W: 1.86, H: 1.7, clear: 0.24, belt: 1.06, zf: 0.85, zb: -2.05, rf: 0.18, rb: -1.9, wheelR: 0.36, axF: 1.42, axB: -1.38, nose: 0.9 },
  van: { L: 4.75, W: 1.88, H: 1.88, clear: 0.2, belt: 1.02, zf: 1.12, zb: -2.33, rf: 0.6, rb: -2.33, wheelR: 0.33, axF: 1.6, axB: -1.5, nose: 0.92 },
};

/** Profil latéral de caisse (en z, y), avec les passages de roue découpés. */
function bodyProfile(s: CarSpec) {
  const half = s.L / 2, yb = s.clear + 0.06;
  const shape = new THREE.Shape();
  shape.moveTo(-half + 0.06, yb);
  for (const ax of [s.axB, s.axF]) {
    const R = s.wheelR + 0.05, wy = s.wheelR;
    const beta = Math.asin(Math.max(-1, Math.min(1, (yb - wy) / R)));
    shape.lineTo(ax - R * Math.cos(beta), yb);
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI - beta - (k / 10) * (Math.PI - 2 * beta);
      shape.lineTo(ax + R * Math.cos(a), wy + R * Math.sin(a));
    }
  }
  shape.lineTo(half - 0.06, yb);
  shape.lineTo(half, yb + 0.12);
  shape.lineTo(half, s.nose - 0.08);
  shape.lineTo(half - 0.12, s.nose);
  shape.lineTo(s.zf + 0.4, s.belt - 0.03);
  shape.lineTo(s.zf, s.belt);
  shape.lineTo(-half + 0.14, s.belt);
  shape.lineTo(-half, s.belt - 0.14);
  shape.lineTo(-half, yb + 0.1);
  return shape;
}

/** Extrusion d'un profil (z, y) sur la largeur, centrée en x, bords arrondis. */
function extrudeProfile(shape: THREE.Shape, width: number, bevel: number) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  // (u, v, d) → (x = -d, y = v, z = u), puis recentré
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - 2 * bevel) / 2, 0, 0);
  return geo;
}

function cabinShape(s: CarSpec) {
  const shape = new THREE.Shape();
  shape.moveTo(s.zb, s.belt);
  shape.lineTo(s.zf, s.belt);
  shape.lineTo(s.rf, s.H - 0.03);
  shape.lineTo(s.rb, s.H - 0.03);
  shape.lineTo(s.zb, s.belt);
  return shape;
}

function wheelGeometries(s: CarSpec, rim = "#b9bec4") {
  const out: THREE.BufferGeometry[] = [];
  for (const z of [s.axF, s.axB]) {
    for (const side of [-1, 1]) {
      const x = side * (s.W / 2 - 0.14);
      out.push(paint(new THREE.CylinderGeometry(s.wheelR, s.wheelR, 0.22, 16).rotateZ(Math.PI / 2).translate(x, s.wheelR, z), "#151515"));
      out.push(paint(new THREE.CylinderGeometry(s.wheelR * 0.6, s.wheelR * 0.6, 0.235, 10).rotateZ(Math.PI / 2).translate(x, s.wheelR, z), rim));
    }
  }
  return out;
}

/** Voiture ordinaire : caisse (teintée), détails (vitres, roues, pare-chocs), phares, feux stop. */
function carGeometries(s: CarSpec) {
  const half = s.L / 2;
  const body = merge([
    paint(extrudeProfile(bodyProfile(s), s.W, 0.05), "#ffffff"),
    paint(new RoundedBoxGeometry(s.W * 0.86, 0.07, s.rf - s.rb + 0.14, 2, 0.03).translate(0, s.H - 0.02, (s.rf + s.rb) / 2), "#ffffff"),
    paint(new THREE.BoxGeometry(s.W * 0.88, s.H - s.belt, 0.1).translate(0, (s.H + s.belt) / 2, (s.rf + s.rb) / 2 - 0.1), "#ffffff"),
    paint(new THREE.BoxGeometry(0.12, 0.1, 0.16).translate(s.W / 2 + 0.04, s.belt + 0.08, s.zf - 0.15), "#ffffff"),
    paint(new THREE.BoxGeometry(0.12, 0.1, 0.16).translate(-s.W / 2 - 0.04, s.belt + 0.08, s.zf - 0.15), "#ffffff"),
  ]);
  const detail = merge([
    paint(extrudeProfile(cabinShape(s), s.W * 0.86, 0.02), "#1d2733"),
    ...wheelGeometries(s),
    paint(new THREE.BoxGeometry(s.W * 0.98, 0.2, 0.12).translate(0, s.clear + 0.14, half), "#2a2c30"),
    paint(new THREE.BoxGeometry(s.W * 0.98, 0.2, 0.12).translate(0, s.clear + 0.14, -half), "#2a2c30"),
    paint(new THREE.BoxGeometry(s.W * 0.46, 0.13, 0.04).translate(0, s.nose - 0.22, half + 0.01), "#121316"),
    paint(new THREE.BoxGeometry(0.52, 0.11, 0.03).translate(0, s.clear + 0.3, half + 0.07), "#f2f2f2"),
    paint(new THREE.BoxGeometry(0.52, 0.11, 0.03).translate(0, s.clear + 0.42, -half - 0.02), "#f2f2f2"),
    paint(new THREE.BoxGeometry(0.36, 0.13, 0.03).translate(s.W / 2 - 0.25, s.belt - 0.12, -half - 0.005), "#5a1010"),
    paint(new THREE.BoxGeometry(0.36, 0.13, 0.03).translate(-s.W / 2 + 0.25, s.belt - 0.12, -half - 0.005), "#5a1010"),
  ]);
  const head = merge([
    paint(new THREE.BoxGeometry(0.38, 0.12, 0.04).translate(s.W / 2 - 0.3, s.nose - 0.1, half - 0.02), "#fff3d6"),
    paint(new THREE.BoxGeometry(0.38, 0.12, 0.04).translate(-s.W / 2 + 0.3, s.nose - 0.1, half - 0.02), "#fff3d6"),
  ]);
  const brake = merge([
    paint(new THREE.BoxGeometry(0.34, 0.12, 0.03).translate(s.W / 2 - 0.25, s.belt - 0.12, -half - 0.03), "#ff2a1f"),
    paint(new THREE.BoxGeometry(0.34, 0.12, 0.03).translate(-s.W / 2 + 0.25, s.belt - 0.12, -half - 0.03), "#ff2a1f"),
    paint(new THREE.BoxGeometry(0.4, 0.04, 0.03).translate(0, s.H - 0.06, s.rb - 0.04), "#ff2a1f"),
  ]);
  return { body, detail, head, brake };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Plaque française (bandes bleues F et 74). */
function plateTexture(text: string) {
  return canvasTexture(256, 56, (g) => {
    g.fillStyle = "#f7f7f2";
    g.fillRect(0, 0, 256, 56);
    g.fillStyle = "#1f47b8";
    g.fillRect(0, 0, 24, 56);
    g.fillRect(232, 0, 24, 56);
    g.fillStyle = "#fff";
    g.font = "bold 16px Arial";
    g.textAlign = "center";
    g.fillText("F", 12, 46);
    g.fillText("74", 244, 46);
    g.fillStyle = "#ffd200";
    g.beginPath();
    g.arc(12, 18, 7, 0, Math.PI * 2);
    g.strokeStyle = "#ffd200";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#111";
    g.font = "bold 38px Arial";
    g.fillText(text, 128, 42);
    g.strokeStyle = "#222";
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, 253, 53);
  });
}

function textTexture(text: string, color: string, bg: string | null, w = 512, h = 64) {
  return canvasTexture(w, h, (g) => {
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
    }
    g.fillStyle = color;
    g.font = `bold ${Math.round(h * 0.62)}px Arial`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

/** Écran du GPS : itinéraire rouge, embouteillé. */
function gpsTexture() {
  return canvasTexture(128, 80, (g) => {
    g.fillStyle = "#0e1726";
    g.fillRect(0, 0, 128, 80);
    g.strokeStyle = "#2d3d57";
    g.lineWidth = 6;
    for (const [a, b, c, d] of [[0, 20, 128, 34], [30, 0, 46, 80], [80, 0, 100, 80], [0, 64, 128, 58]]) {
      g.beginPath();
      g.moveTo(a, b);
      g.lineTo(c, d);
      g.stroke();
    }
    g.strokeStyle = "#ff3b2f";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(120, 70);
    g.lineTo(90, 52);
    g.lineTo(60, 40);
    g.lineTo(38, 26);
    g.stroke();
    g.fillStyle = "#4fa3ff";
    g.beginPath();
    g.arc(90, 52, 5, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "bold 12px Arial";
    g.fillText("+18 min", 6, 12);
  });
}

const std = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...o });
/** couleurs de Marc toujours lisibles, même à l'ombre de l'habitacle ou la nuit */
const lit = (color: string, o: THREE.MeshStandardMaterialParameters = {}) => std(color, { emissive: color, emissiveIntensity: 0.28, ...o });

// ---------- Marc ----------

const SKIN = "#e9b590", HAIR = "#5b3a22", JACKET = "#2f4a7c", PANTS = "#3a3f4a";
/** Marc est assis côté conducteur (à gauche, x > 0 dans le repère de la voiture qui regarde vers +z) */
const SEAT_X = 0.38;
const WHEEL_C = new THREE.Vector3(SEAT_X, 0.93, 0.13);
const WHEEL_TILT = 0.36;
const WHEEL_R = 0.18;

/** Point du volant à l'angle `a` (0 = en haut, positif vers la gauche de Marc). */
function wheelPoint(a: number) {
  const p = new THREE.Vector3(Math.sin(a) * WHEEL_R, Math.cos(a) * WHEEL_R, 0);
  p.applyAxisAngle(new THREE.Vector3(1, 0, 0), WHEEL_TILT);
  return p.add(WHEEL_C);
}

interface Pose {
  /** cibles des mains (repère voiture) */
  left: THREE.Vector3;
  right: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  /** penché vers la vitre / le centre (m) */
  lean: number;
  /** sourcils : 1 = froncés, -0.5 = levés */
  brow: number;
  talk: number;
}

interface Arm {
  shoulder: THREE.Vector3;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  elbow: THREE.Mesh;
  hand: THREE.Group;
  side: number;
}

class MarcFigure {
  readonly group = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly arms: Arm[] = [];
  private readonly brows: THREE.Mesh[] = [];
  private readonly eyes: THREE.Group[] = [];
  private readonly mouth: THREE.Mesh;
  private readonly pose: Pose;

  constructor() {
    const skin = lit(SKIN, { roughness: 0.6 }), hair = lit(HAIR, { roughness: 0.9 }), jacket = lit(JACKET);
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };

    // buste, légèrement renversé dans le siège
    this.torso.position.set(SEAT_X, 0.52, -0.3);
    this.torso.rotation.x = -0.18;
    this.group.add(this.torso);
    const chest = mesh(new THREE.CapsuleGeometry(0.17, 0.3, 4, 12), jacket, this.torso, 0, 0.3, 0);
    chest.scale.set(1.18, 1, 0.78);
    mesh(new THREE.BoxGeometry(0.1, 0.16, 0.02), lit("#f4f4ee"), this.torso, 0, 0.42, 0.125).rotation.x = -0.15;
    mesh(new THREE.BoxGeometry(0.045, 0.22, 0.015), lit("#b8322a"), this.torso, 0, 0.3, 0.14);
    mesh(new THREE.BoxGeometry(0.06, 0.035, 0.02), std("#a02a22"), this.torso, 0, 0.42, 0.14);
    for (const side of [-1, 1]) {
      const lapel = mesh(new THREE.BoxGeometry(0.06, 0.24, 0.02), std("#243b66"), this.torso, side * 0.07, 0.36, 0.13);
      lapel.rotation.z = side * 0.35;
    }
    mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.12, 12), skin, this.torso, 0, 0.56, 0.01);

    // tête
    this.head.position.set(0, 0.69, 0.02);
    this.head.scale.setScalar(1.12);
    this.torso.add(this.head);
    mesh(new THREE.SphereGeometry(0.115, 28, 20), skin, this.head).scale.set(0.92, 1.08, 1);
    mesh(new THREE.SphereGeometry(0.085, 20, 14), skin, this.head, 0, -0.06, 0.03).scale.set(1, 0.85, 1);
    const cap = mesh(new THREE.SphereGeometry(0.122, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), hair, this.head, 0, 0.012, -0.012);
    cap.scale.set(0.95, 1, 1.04);
    cap.rotation.x = -0.42;
    const quiff = mesh(new RoundedBoxGeometry(0.13, 0.045, 0.08, 2, 0.02), hair, this.head, 0.015, 0.118, 0.055);
    quiff.rotation.set(0.35, 0, 0.18);
    for (const side of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.014, 0.055, 0.035), hair, this.head, side * 0.103, -0.005, 0.005);
      mesh(new THREE.SphereGeometry(0.03, 10, 8), skin, this.head, side * 0.108, 0, -0.008).scale.set(0.45, 1, 0.8);
      const eye = new THREE.Group();
      eye.position.set(side * 0.04, 0.025, 0.098);
      this.head.add(eye);
      mesh(new THREE.SphereGeometry(0.019, 14, 10), lit("#ffffff", { roughness: 0.3 }), eye);
      mesh(new THREE.SphereGeometry(0.0105, 10, 8), std("#1c1a18", { roughness: 0.2 }), eye, 0, 0, 0.014);
      this.eyes.push(eye);
      const brow = mesh(new RoundedBoxGeometry(0.052, 0.014, 0.016, 1, 0.005), std("#3e2716"), this.head, side * 0.043, 0.062, 0.104);
      brow.userData.side = side;
      this.brows.push(brow);
      // moustache : deux mèches épaisses et tombantes
      const tache = mesh(new THREE.CapsuleGeometry(0.013, 0.045, 4, 8), std("#4a2d18", { roughness: 0.95 }), this.head, side * 0.025, -0.033, 0.108);
      tache.rotation.z = side * 1.15;
    }
    mesh(new THREE.SphereGeometry(0.023, 12, 10), skin, this.head, 0, 0.002, 0.117).scale.set(0.8, 1, 1.25);
    this.mouth = mesh(new THREE.SphereGeometry(0.022, 14, 10), std("#5a1f1f"), this.head, 0, -0.058, 0.1);
    this.mouth.scale.set(1.3, 0.2, 0.45);

    // bras : épaule fixe (repère du buste), coude et main résolus à chaque image
    for (const side of [1, -1]) {
      const arm: Arm = {
        side,
        shoulder: new THREE.Vector3(side * 0.205, 0.47, 0),
        upper: mesh(new THREE.CylinderGeometry(0.058, 0.052, 1, 12), jacket, this.group),
        fore: mesh(new THREE.CylinderGeometry(0.05, 0.044, 1, 12), jacket, this.group),
        elbow: mesh(new THREE.SphereGeometry(0.055, 12, 10), jacket, this.group),
        hand: new THREE.Group(),
      };
      mesh(new THREE.SphereGeometry(0.045, 14, 10), skin, arm.hand).scale.set(0.85, 1.1, 0.7);
      mesh(new THREE.CapsuleGeometry(0.014, 0.03, 4, 8), skin, arm.hand, side * 0.035, 0.02, 0.01).rotation.z = side * 0.6;
      mesh(new THREE.CylinderGeometry(0.047, 0.047, 0.03, 12), std("#f4f4ee"), arm.hand, 0, -0.05, 0);
      this.group.add(arm.hand);
      this.arms.push(arm);
    }
    // jambes (aperçues par les vitres latérales)
    const pants = std(PANTS);
    for (const side of [-1, 1]) {
      const hip = new THREE.Vector3(SEAT_X + side * 0.1, 0.56, -0.25), knee = new THREE.Vector3(SEAT_X + side * 0.11, 0.64, 0.22);
      const ankle = new THREE.Vector3(SEAT_X + side * 0.1, 0.27, 0.42);
      stretch(mesh(new THREE.CylinderGeometry(0.075, 0.07, 1, 10), pants, this.group), hip, knee);
      stretch(mesh(new THREE.CylinderGeometry(0.06, 0.055, 1, 10), pants, this.group), knee, ankle);
      mesh(new RoundedBoxGeometry(0.1, 0.08, 0.24, 2, 0.03), std("#1e1a17"), this.group, ankle.x, 0.24, 0.5);
    }

    this.pose = { left: wheelPoint(-1.05), right: wheelPoint(1.05), yaw: 0, pitch: 0, roll: 0, lean: 0, brow: 1, talk: 0 };
  }

  /** Point de la tête dans le repère de la voiture (pour la caméra, la main sur le front). */
  headPoint(out = new THREE.Vector3()) {
    this.torso.updateMatrix();
    return out.copy(this.head.position).applyMatrix4(this.torso.matrix);
  }

  /** Rejoint en douceur la pose voulue puis place bras, tête et visage. */
  update(target: Pose, dt: number, t: number) {
    const p = this.pose, k = 1 - Math.exp(-dt * 7);
    p.left.lerp(target.left, k);
    p.right.lerp(target.right, k);
    for (const key of ["yaw", "pitch", "roll", "lean", "brow", "talk"] as const) p[key] += (target[key] - p[key]) * k;

    this.torso.position.x = SEAT_X + p.lean;
    this.torso.rotation.z = -p.lean * 1.2;
    this.torso.position.y = 0.52 + Math.sin(t * 1.3) * 0.004; // respiration
    this.head.rotation.set(p.pitch, p.yaw, p.roll);
    for (const b of this.brows) {
      const side = b.userData.side as number;
      b.rotation.z = side * 0.42 * p.brow;
      b.position.y = 0.062 - 0.006 * Math.max(0, p.brow) + 0.012 * Math.max(0, -p.brow);
    }
    const blink = (t % 3.7) < 0.12 ? 0.1 : 1;
    for (const e of this.eyes) e.scale.y = blink * (p.brow > 0.5 ? 0.8 : 1);
    this.mouth.scale.y = 0.2 + p.talk * (0.45 + 0.45 * Math.abs(Math.sin(t * 17)));

    this.group.updateMatrixWorld();
    this.torso.updateMatrix();
    for (const arm of this.arms) {
      const s = arm.shoulder.clone().applyMatrix4(this.torso.matrix);
      const target = arm.side > 0 ? p.left : p.right;
      const l1 = 0.31, l2 = 0.32;
      const to = target.clone().sub(s);
      const d = Math.min(Math.max(to.length(), 0.08), l1 + l2 - 0.005);
      const dir = to.normalize();
      const hand = s.clone().addScaledVector(dir, d);
      const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      // le coude part vers l'extérieur et le bas
      const pole = new THREE.Vector3(arm.side * 1, -1, -0.3);
      pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const elbow = s.clone().addScaledVector(dir, a).addScaledVector(pole, h);
      stretch(arm.upper, s, elbow);
      stretch(arm.fore, elbow, hand);
      arm.elbow.position.copy(elbow);
      arm.hand.position.copy(hand);
      arm.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hand.clone().sub(elbow).normalize());
    }
  }
}

/** Ce que fait Marc à un instant donné de sa crise, et ce qu'il dit. */
interface Beat {
  until: number;
  say?: string;
  pose: (t: number, head: THREE.Vector3) => Partial<Pose>;
  honk?: boolean;
}

const onWheel = (t: number, tap = 0) => ({
  left: wheelPoint(-1.05).add(new THREE.Vector3(0, tap * Math.abs(Math.sin(t * 9)) * 0.03, 0)),
  right: wheelPoint(1.05),
});

/** Une boucle de 15 s : il tapote, se penche pour voir, lève les bras, klaxonne, se prend la tête, regarde sa montre. */
const JAM_BEATS: Beat[] = [
  { until: 3.2, say: "Allez… avance…", pose: (t) => ({ ...onWheel(t, 1), yaw: Math.sin(t * 0.8) * 0.1, brow: 1, talk: t < 2 ? 1 : 0 }) },
  { until: 5.4, say: "Mais qu'est-ce qu'ils fabriquent devant ?!", pose: (t) => ({ ...onWheel(t), lean: 0.09, yaw: 0.28, pitch: -0.05, roll: 0.12, brow: 1.2, talk: 1 }) },
  {
    until: 7.2, say: "C'est pas possible !",
    pose: () => ({ left: new THREE.Vector3(SEAT_X + 0.34, 1.22, 0.02), right: new THREE.Vector3(SEAT_X - 0.34, 1.22, 0.02), pitch: -0.15, brow: -0.5, talk: 1 }),
  },
  {
    until: 8.8, say: "TUUUUT !", honk: true,
    pose: (t) => ({ left: wheelPoint(-1.05), right: WHEEL_C.clone().add(new THREE.Vector3(0, 0.02 + Math.max(0, Math.sin(t * 7)) * 0.08, -0.04)), brow: 1.3, talk: 0.6 }),
  },
  {
    until: 11.3, say: "J'vais finir par venir en pédalo…",
    pose: (_t, head) => ({ left: head.clone().add(new THREE.Vector3(0.0, 0.07, 0.12)), right: wheelPoint(1.05), pitch: 0.28, roll: -0.1, brow: 0.6, talk: 0.5 }),
  },
  {
    until: 15, say: "8 h 03. Encore en retard.",
    pose: () => ({ left: new THREE.Vector3(SEAT_X + 0.05, 1.0, -0.02), right: wheelPoint(1.05), pitch: 0.42, yaw: 0.2, brow: 0.8, talk: 0.4 }),
  },
];

// ---------- Personnages secondaires (secours, conducteur) ----------

function person(o: { body: string; legs: string; vest?: string; hat?: "casque" | "kepi"; skin?: string }) {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, std(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  for (const side of [-1, 1]) add(new THREE.BoxGeometry(0.15, 0.86, 0.18), o.legs, side * 0.1, 0.43, 0);
  add(new RoundedBoxGeometry(0.44, 0.62, 0.26, 2, 0.05), o.body, 0, 1.17, 0);
  if (o.vest) {
    add(new THREE.BoxGeometry(0.46, 0.36, 0.28), o.vest, 0, 1.18, 0);
    add(new THREE.BoxGeometry(0.47, 0.05, 0.29), "#d9dde0", 0, 1.08, 0);
  }
  add(new THREE.SphereGeometry(0.12, 16, 12), o.skin ?? SKIN, 0, 1.62, 0);
  if (o.hat === "casque") add(new THREE.SphereGeometry(0.135, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), "#e8c21a", 0, 1.64, 0);
  if (o.hat === "kepi") add(new THREE.CylinderGeometry(0.12, 0.13, 0.09, 14), "#1b2a52", 0, 1.74, 0);
  const arms = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.28, 1.43, 0);
    add(new THREE.BoxGeometry(0.11, 0.6, 0.12).translate(0, -0.3, 0), o.body, 0, 0, 0, pivot);
    add(new THREE.SphereGeometry(0.055, 8, 6), o.skin ?? SKIN, 0, -0.62, 0, pivot);
    g.add(pivot);
    return pivot;
  });
  return { group: g, left: arms[1], right: arms[0] };
}

// ---------- Mise en scène ----------

interface Car {
  s: number;
  v: number;
  len: number;
  type: number;
  color: THREE.Color;
  released: boolean;
  gone: boolean;
  marc: boolean;
  minGap: number;
  braking: boolean;
  /** temps passé à l'arrêt ou au pas (s) */
  waited: number;
}

/** Chiffres du bouchon, pour le compte rendu. */
export interface JamStats {
  active: boolean;
  blocked: number;
  passed: number;
  /** longueur de la file (m) */
  length: number;
  /** attente moyenne et attente de Marc (min) */
  avgWait: number;
  marcWait: number;
  marcPassed: boolean;
  /** CO₂ rejeté au ralenti (kg) */
  co2: number;
}

/** l'accident a eu lieu à 7 h 41 : la tête de file attend déjà depuis 17 min au lever de rideau */
const WAIT_AT_START = 17 * 60;
/** consommation au ralenti : ~0,6 L/h, soit ~1,4 kg de CO₂ par heure */
const IDLE_CO2_PER_S = 1.4 / 3600;

interface Fleet {
  spec: CarSpec;
  meshes: { body: THREE.InstancedMesh; detail: THREE.InstancedMesh; head: THREE.InstancedMesh; brake: THREE.InstancedMesh };
}

type Phase = "closeup" | "pullback" | "free";

interface Shot {
  /** instant du plan (s depuis le clic) */
  at: number;
  target: THREE.Vector3;
  radius: number;
  phi: number;
  theta: number;
  fov: number;
}

export class MarcStory {
  readonly group = new THREE.Group();
  /** la caméra suit Marc */
  following = false;
  /** habitants simulés visibles (masqués pendant le gros plan, où ils seraient géants) */
  crowdVisible = true;
  private phase: Phase = "free";
  private introT = 0;
  private onIntroDone: () => void = () => {};
  private readonly route: Route;
  private readonly cars: Car[] = [];
  private readonly marc: Car;
  private readonly fleets: Fleet[] = [];
  private readonly car = new THREE.Group();
  private readonly figure = new MarcFigure();
  private readonly wheels: THREE.Object3D[] = [];
  private readonly freshener = new THREE.Group();
  private readonly brakeLights: THREE.MeshStandardMaterial;
  private readonly accident = new THREE.Group();
  private readonly accidentItems: THREE.Object3D[] = [];
  private readonly beacons: { mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  private readonly hazards: THREE.MeshBasicMaterial[] = [];
  private readonly flashers: THREE.PointLight[] = [];
  private readonly smoke: THREE.Sprite[] = [];
  private readonly officerArm: THREE.Object3D;
  private readonly honkRings: THREE.Mesh[] = [];
  private readonly jam: THREE.Mesh;
  private readonly bubbleEl = document.createElement("div");
  private readonly bubbleText = document.createElement("div");
  private cameraDistance = 0;
  private readonly bubble: CSS2DObject;
  private readonly tagEl = document.createElement("div");
  private readonly tag: CSS2DObject;
  private readonly accidentLabel: CSS2DObject;
  private accidentActive = true;
  private accidentFade = 1;
  private gateTimer = 0;
  private lastReleased: Car | null = null;
  private honkAt = -10;
  private lastBeat = -1;
  private speech = "";
  private speechUntil = 0;
  private storyLine = "";
  private time = 0;
  private wheelTurn = 0;
  private scale = 1;
  private readonly mask: { ax: number; az: number; bx: number; bz: number }[] = [];
  private readonly maskBox = new THREE.Box2();
  private readonly saved = { minDistance: 0, maxPolar: 0, fov: 50 };
  /** plans du recul : gros plan, au-dessus de l'accident, pause, toute la ville */
  private shots: Shot[] = [];
  private onReveal: () => void = () => {};

  constructor(city: City, private readonly world: World) {
    const graph = new Graph(city);
    const path = graph.route(graph.nearest(FROM[0], FROM[1], Mode.Car), graph.nearest(TO[0], TO[1], Mode.Car), Mode.Car);
    const pts: [number, number][] = path ? Array.from(path.nodes, (n) => [graph.x[n], graph.z[n]] as [number, number]) : [FROM, TO];
    this.route = new Route(pts);

    // la file : voitures devant Marc jusqu'à l'accident, Marc, puis celles qui attendent derrière
    const rand = mulberry32(74);
    const palette = ["#d8d8d8", "#2b2d31", "#5b6168", "#f2f2ee", "#2453a8", "#1f2a44", "#7a7f86", "#3d6b45", "#8a1f1f", "#c9a443", "#ececec", "#40464f"];
    const types = Object.values(SPECS);
    for (const spec of types) {
      const g = carGeometries(spec);
      const make = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => {
        const m = new THREE.InstancedMesh(geo, mat, CARS_AHEAD + CARS_BEHIND);
        m.count = 0;
        m.castShadow = shadow;
        m.receiveShadow = shadow;
        m.frustumCulled = false;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
        return m;
      };
      const body = make(g.body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.15 }), true);
      body.setColorAt(0, new THREE.Color());
      this.fleets.push({
        spec,
        meshes: {
          body,
          detail: make(g.detail, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), true),
          head: make(g.head, new THREE.MeshBasicMaterial({ vertexColors: true }), false),
          brake: make(g.brake, new THREE.MeshBasicMaterial({ vertexColors: true }), false),
        },
      });
    }
    const pickType = () => {
      const r = rand();
      return r < 0.42 ? 0 : r < 0.7 ? 1 : r < 0.9 ? 2 : 3;
    };
    let front = GATE_S - 1.2;
    const add = (type: number, gap: number, marc = false) => {
      const len = marc ? SPECS.hatch.L : types[type].L;
      const c: Car = {
        s: front - len / 2, v: 0, len, type, color: new THREE.Color(palette[Math.floor(rand() * palette.length)]),
        released: false, gone: false, marc, minGap: marc ? 4.4 : 1.6 + rand() * 0.9, braking: true, waited: 0,
      };
      this.cars.push(c);
      front = c.s - len / 2 - gap;
      return c;
    };
    for (let i = 0; i < CARS_AHEAD; i++) add(pickType(), i === CARS_AHEAD - 1 ? 4.4 : 1.4 + rand() * 1.2);
    this.marc = add(0, 1.5 + rand(), true);
    for (let i = 0; i < CARS_BEHIND && front > 6; i++) add(pickType(), 1.4 + rand() * 1.2);
    // les premiers arrivés attendent depuis le plus longtemps
    this.cars.forEach((c, i) => (c.waited = 60 + (WAIT_AT_START - 60) * (1 - i / this.cars.length)));

    // couloir où les voitures simulées sont masquées
    const back = this.cars[this.cars.length - 1].s - 15;
    const a = new THREE.Vector2(), b = new THREE.Vector2();
    for (let s = back; s < GATE_S + VANISH_AFTER; s += 10) {
      this.route.point(s, a);
      this.route.point(s + 10, b);
      this.mask.push({ ax: a.x, az: a.y, bx: b.x, bz: b.y });
      this.maskBox.expandByPoint(a).expandByPoint(b);
    }
    this.maskBox.expandByScalar(40);

    // voiture de Marc
    const parts = this.buildMarcCar();
    this.brakeLights = parts.brake;
    this.car.add(this.figure.group);
    this.group.add(this.car);

    // accident, secours et bouchon
    this.officerArm = this.buildAccident();
    this.group.add(this.accident);
    this.jam = this.buildJamRibbon();
    this.group.add(this.jam);

    // klaxon : ondes devant la voiture
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40), new THREE.MeshBasicMaterial({ color: "#ffd84d", transparent: true, opacity: 0, depthWrite: false }));
      ring.position.set(0, 0.85, SPECS.hatch.L / 2 + 0.3);
      ring.visible = false;
      this.car.add(ring);
      this.honkRings.push(ring);
    }

    // bulle, étiquette « Marc », étiquette de l'accident
    // l'ancre est centrée sur le point 3D ; la bulle est décalée au-dessus pour ne pas cacher la voiture
    this.bubbleEl.className = "marc-ui marc-bubble-anchor";
    this.bubbleText.className = "marc-bubble";
    this.bubbleEl.appendChild(this.bubbleText);
    this.bubble = new CSS2DObject(this.bubbleEl);
    this.group.add(this.bubble);
    this.tagEl.className = "marc-ui marc-tag";
    this.tagEl.innerHTML = `<span>🚗</span><b>Marc</b>`;
    this.tag = new CSS2DObject(this.tagEl);
    this.group.add(this.tag);
    const accEl = document.createElement("div");
    accEl.className = "event-label marc-accident";
    accEl.style.setProperty("--c", "#ff3b3b");
    accEl.innerHTML = `<span class="icon">💥</span><span><b>Accident avenue d'Albigny</b><small>Voie bloquée · circulation alternée</small></span>`;
    this.accidentLabel = new CSS2DObject(accEl);
    const g = this.route.place(GATE_S + 12, () => LANE);
    this.accidentLabel.position.set(g.x, 14, g.z);
    this.group.add(this.accidentLabel);

    this.placeCars();
  }

  /** Voiture de Marc, détaillée : carrosserie vernie, vitres transparentes, habitacle, plaques. */
  private buildMarcCar() {
    const s = SPECS.hatch, half = s.L / 2;
    const car = this.car;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      car.add(m);
      return m;
    };
    const paintMat = new THREE.MeshPhysicalMaterial({ color: "#c9352a", roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 });
    const trim = std("#16181c", { roughness: 0.5 }), chrome = std("#d5d9de", { roughness: 0.2, metalness: 0.8 });
    const glass = new THREE.MeshPhysicalMaterial({ color: "#b6d3e6", transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    add(extrudeProfile(bodyProfile(s), s.W, 0.06), paintMat);
    add(new RoundedBoxGeometry(s.W * 0.88, 0.07, s.rf - s.rb + 0.16, 3, 0.03).translate(0, s.H - 0.01, (s.rf + s.rb) / 2), paintMat);
    add(extrudeProfile(cabinShape(s), s.W * 0.86, 0.015), glass, false);
    const cw = (s.W * 0.86) / 2;
    for (const side of [-1, 1]) {
      const x = side * cw;
      add(beamGeometry(v(x, s.belt, s.zf), v(x, s.H, s.rf), 0.07, 0.08), paintMat);
      add(beamGeometry(v(x, s.belt, -0.48), v(x, s.H, -0.6), 0.06, 0.1), trim);
      add(beamGeometry(v(x, s.belt, s.zb + 0.05), v(x, s.H, s.rb), 0.07, 0.3), paintMat);
      add(new THREE.BoxGeometry(0.015, 0.025, s.zf - s.zb).translate(side * (s.W / 2 + 0.005), s.belt - 0.01, (s.zf + s.zb) / 2), chrome);
      // portières : joints et poignées
      for (const z of [0.95, -0.5, -1.55]) add(new THREE.BoxGeometry(0.01, s.belt - s.clear - 0.2, 0.012).translate(side * (s.W / 2 + 0.008), (s.belt + s.clear) / 2 + 0.05, z), trim, false);
      for (const z of [-0.2, -1.25]) add(new RoundedBoxGeometry(0.02, 0.03, 0.14, 1, 0.008).translate(side * (s.W / 2 + 0.01), s.belt - 0.12, z), chrome, false);
      // rétroviseurs
      add(new RoundedBoxGeometry(0.1, 0.12, 0.18, 2, 0.03).translate(side * (s.W / 2 + 0.08), s.belt + 0.1, s.zf - 0.2), paintMat);
      add(new THREE.BoxGeometry(0.008, 0.09, 0.14).translate(side * (s.W / 2 + 0.07), s.belt + 0.1, s.zf - 0.3), std("#8fa6b8", { roughness: 0.1, metalness: 0.6 }), false);
      // optiques
      add(new RoundedBoxGeometry(0.42, 0.13, 0.08, 2, 0.03).translate(side * (s.W / 2 - 0.3), s.nose - 0.1, half - 0.07), new THREE.MeshStandardMaterial({ color: "#fff6dd", emissive: "#fff1c4", emissiveIntensity: 0.6, roughness: 0.1 }), false);
    }
    this.wheels.push(...[s.axF, s.axB].flatMap((z) => [-1, 1].map((side) => {
      const w = new THREE.Group();
      w.position.set(side * (s.W / 2 - 0.14), s.wheelR, z);
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(s.wheelR, s.wheelR, 0.21, 24).rotateZ(Math.PI / 2), std("#141414", { roughness: 0.9 }));
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(s.wheelR * 0.62, s.wheelR * 0.62, 0.225, 5).rotateZ(Math.PI / 2), chrome);
      tire.castShadow = true;
      w.add(tire, rim);
      car.add(w);
      return w;
    })));
    // pare-chocs, calandre, plaques, essuie-glaces, antenne
    add(new RoundedBoxGeometry(s.W * 0.98, 0.22, 0.16, 2, 0.05).translate(0, s.clear + 0.14, half - 0.02), trim);
    add(new RoundedBoxGeometry(s.W * 0.98, 0.22, 0.16, 2, 0.05).translate(0, s.clear + 0.14, -half + 0.02), trim);
    add(new THREE.BoxGeometry(s.W * 0.5, 0.12, 0.04).translate(0, s.nose - 0.24, half + 0.005), trim, false);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).rotateX(Math.PI / 2).translate(0, s.nose - 0.24, half + 0.03), chrome, false);
    const plate = new THREE.MeshStandardMaterial({ map: plateTexture("MA-274-RC"), roughness: 0.4 });
    add(new THREE.PlaneGeometry(0.52, 0.114).translate(0, s.clear + 0.3, half + 0.065), plate, false);
    add(new THREE.PlaneGeometry(0.52, 0.114).rotateY(Math.PI).translate(0, s.clear + 0.44, -half - 0.01), plate, false);
    for (const side of [-1, 1]) add(beamGeometry(v(side * 0.1, s.belt + 0.03, s.zf - 0.05), v(side * 0.55, s.belt + 0.06, s.zf - 0.12), 0.02, 0.02), trim, false);
    add(beamGeometry(v(-0.5, s.H, s.rb + 0.2), v(-0.5, s.H + 0.28, s.rb - 0.05), 0.012, 0.012), trim, false);
    const brake = new THREE.MeshStandardMaterial({ color: "#7a0d0d", emissive: "#ff1a10", emissiveIntensity: 2.2 });
    for (const side of [-1, 1]) add(new RoundedBoxGeometry(0.34, 0.15, 0.06, 2, 0.02).translate(side * (s.W / 2 - 0.25), s.belt - 0.12, -half - 0.01), brake, false);
    add(new THREE.BoxGeometry(0.42, 0.04, 0.03).translate(0, s.H - 0.06, s.rb - 0.06), brake, false);

    // habitacle : garnitures sombres sur le haut des portières et le plancher
    const dash = std("#24262b", { roughness: 0.85 }), seat = std("#3a3d45", { roughness: 0.95 });
    add(new THREE.BoxGeometry(s.W * 0.84, 0.012, s.zf - s.zb - 0.1).translate(0, s.belt + 0.008, (s.zf + s.zb) / 2), std("#2b2e34", { roughness: 0.9 }), false);
    add(new RoundedBoxGeometry(s.W * 0.84, 0.22, 0.48, 2, 0.06).translate(0, 0.88, 0.58), dash);
    add(new RoundedBoxGeometry(0.42, 0.08, 0.2, 2, 0.03).translate(SEAT_X, 1.0, 0.44), dash);
    add(new THREE.PlaneGeometry(0.2, 0.125).rotateX(-0.5).translate(0, 1.0, 0.36), new THREE.MeshBasicMaterial({ map: gpsTexture() }), false);
    add(new RoundedBoxGeometry(0.22, 0.32, 0.6, 2, 0.04).translate(0, 0.52, 0.0), dash);
    for (const side of [-1, 1]) {
      const x = side * SEAT_X;
      add(new RoundedBoxGeometry(0.5, 0.13, 0.52, 2, 0.05).translate(x, 0.46, -0.3), seat);
      const back = add(new RoundedBoxGeometry(0.5, 0.66, 0.13, 2, 0.05), seat);
      back.position.set(x, 0.82, -0.6);
      back.rotation.x = -0.16;
      add(new RoundedBoxGeometry(0.26, 0.18, 0.1, 2, 0.04).translate(x, 1.24, -0.7), seat);
    }
    add(new RoundedBoxGeometry(1.4, 0.5, 0.45, 2, 0.06).translate(0, 0.62, -1.35), seat);
    // volant, colonne
    const wheel = new THREE.Group();
    wheel.position.copy(WHEEL_C);
    wheel.rotation.x = WHEEL_TILT;
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R, 0.024, 10, 32), std("#1b1b1d", { roughness: 0.6 })));
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 16).rotateX(Math.PI / 2), std("#2a2b2f")));
    for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.025, WHEEL_R, 0.02).translate(0, WHEEL_R / 2, 0), std("#2a2b2f"));
      spoke.rotation.z = a;
      wheel.add(spoke);
    }
    car.add(wheel);
    add(beamGeometry(WHEEL_C.clone().add(v(0, -0.02, 0.05)), v(SEAT_X, 0.86, 0.5), 0.05, 0.05), dash, false);
    // rétroviseur intérieur et son sapin parfumé qui se balance
    add(beamGeometry(v(0, s.H - 0.04, s.rf - 0.05), v(0, s.H - 0.12, s.rf - 0.05), 0.015, 0.015), trim, false);
    add(new RoundedBoxGeometry(0.24, 0.07, 0.03, 1, 0.01).translate(0, s.H - 0.15, s.rf - 0.05), trim, false);
    this.freshener.position.set(0, s.H - 0.19, s.rf - 0.05);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.08, 4).translate(0, -0.04, 0), std("#ffffff"));
    const tree = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 3).translate(0, -0.13, 0), std("#2e9b46"));
    this.freshener.add(string, tree);
    car.add(this.freshener);
    // café dans le porte-gobelet, sacoche sur le siège passager
    add(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 14).translate(0.04, 0.73, 0.12), std("#f3efe6"), false);
    add(new THREE.CylinderGeometry(0.037, 0.037, 0.015, 14).translate(0.04, 0.795, 0.12), std("#5b3b25"), false);
    add(new RoundedBoxGeometry(0.36, 0.26, 0.1, 2, 0.03).translate(-SEAT_X, 0.66, -0.3), std("#6b4428", { roughness: 0.6 }));
    return { brake };
  }

  /** Accident : deux voitures embouties, police, VSAV des pompiers, plots, débris, fumée. */
  private buildAccident() {
    const at = (ds: number, lat: number, yaw = 0, obj: THREE.Object3D) => {
      const p = this.route.place(GATE_S + ds, () => lat);
      obj.position.set(p.x, ROAD_Y, p.z);
      obj.rotation.y = p.h + yaw;
      this.accident.add(obj);
      this.accidentItems.push(obj);
      return obj;
    };
    const vehicle = (spec: CarSpec, color: string, crush = 0) => {
      const g = carGeometries(spec);
      const group = new THREE.Group();
      const parts = [
        new THREE.Mesh(g.body, new THREE.MeshStandardMaterial({ vertexColors: true, color, roughness: 0.4, metalness: 0.1 })),
        new THREE.Mesh(g.detail, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 })),
        new THREE.Mesh(g.head, new THREE.MeshBasicMaterial({ vertexColors: true })),
      ];
      // tôle froissée : l'avant (crush > 0) ou l'arrière (crush < 0) est écrasé
      if (crush) {
        const rand = mulberry32(Math.round(crush * 100) + 7);
        for (const m of parts) {
          m.geometry = m.geometry.clone();
          const pos = m.geometry.attributes.position as THREE.BufferAttribute;
          const edge = spec.L / 2 - 0.95;
          for (let i = 0; i < pos.count; i++) {
            const z = pos.getZ(i) * Math.sign(crush);
            if (z <= edge) continue;
            const k = (z - edge) / 0.95;
            pos.setZ(i, Math.sign(crush) * (edge + (z - edge) * 0.42));
            pos.setY(i, pos.getY(i) + Math.sin(pos.getX(i) * 7 + k * 4) * 0.06 * k + (rand() - 0.5) * 0.03 * k);
            pos.setX(i, pos.getX(i) * (1 - 0.06 * k));
          }
          m.geometry.computeVertexNormals();
        }
      }
      for (const m of parts) {
        m.castShadow = true;
        m.receiveShadow = true;
        group.add(m);
      }
      return group;
    };
    const lightBar = (parent: THREE.Object3D, y: number, z: number, width: number) => {
      parent.add(new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.22).translate(0, y, z), std("#222")));
      for (const side of [-1, 1]) {
        const mat = new THREE.MeshBasicMaterial({ color: "#2f6bff", transparent: true });
        const m = new THREE.Mesh(new RoundedBoxGeometry(width * 0.42, 0.12, 0.2, 2, 0.04), mat);
        m.position.set((side * width) / 4, y + 0.08, z);
        parent.add(m);
        this.beacons.push({ mat, phase: side > 0 ? 0 : Math.PI });
      }
    };
    const flasher = (obj: THREE.Object3D, y: number) => {
      const light = new THREE.PointLight("#3d6dff", 0, 45, 2);
      light.position.set(0, y, 0);
      obj.add(light);
      this.flashers.push(light);
    };
    const side = (text: string, color: string, bg: string | null, L: number, y: number, x: number, h = 0.22) => {
      const mat = new THREE.MeshBasicMaterial({ map: textTexture(text, color, bg), transparent: !bg });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(L, h), mat);
      plane.position.set(x, y, 0);
      plane.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
      return plane;
    };

    // plots en biseau qui rabattent la voie de droite vers la gauche
    const coneGeo = merge([
      paint(new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.02, 0), "#1c1c1c"),
      paint(new THREE.ConeGeometry(0.16, 0.7, 12).translate(0, 0.39, 0), "#ff6a13"),
      paint(new THREE.CylinderGeometry(0.095, 0.115, 0.09, 12).translate(0, 0.42, 0), "#f4f4f4"),
    ]);
    const coneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    for (let i = 0; i < 7; i++) {
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.castShadow = true;
      at(-14 + i * 2.2, LANE + 2.2 - i * 0.55, 0, cone);
    }
    // véhicule de police en protection, gyrophares
    const police = vehicle(SPECS.sedan, "#f4f5f7");
    const sedan = SPECS.sedan;
    for (const sx of [-1, 1]) {
      police.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, sedan.L * 0.9).translate(sx * (sedan.W / 2 + 0.06), sedan.belt - 0.25, 0), std("#1f4fbf")));
      police.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, sedan.L * 0.9).translate(sx * (sedan.W / 2 + 0.065), sedan.belt - 0.35, 0), std("#d7262e")));
      police.add(side("POLICE", "#1f3a8a", null, 1.6, sedan.belt - 0.08, sx * (sedan.W / 2 + 0.07)));
    }
    lightBar(police, sedan.H + 0.02, -0.4, 1.1);
    flasher(police, 2.4);
    at(1.5, LANE - 0.2, 0.18, police);
    // les deux voitures accidentées : l'une a percuté l'arrière de l'autre, poussée sur le trottoir
    const hit = vehicle(SPECS.hatch, "#e7e7e2", 1);
    at(11, LANE - 0.6, 0.42, hit);
    const struck = vehicle(SPECS.suv, "#2c4f7a", -1);
    at(16.8, LANE + 1.6, -0.22, struck);
    for (const [obj, spec] of [[hit, SPECS.hatch], [struck, SPECS.suv]] as const) {
      for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const mat = new THREE.MeshBasicMaterial({ color: "#ffa21a", transparent: true });
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat);
        m.position.set(x * (spec.W / 2 - 0.2), spec.belt - 0.1, z * (spec.L / 2 + 0.02));
        obj.add(m);
        this.hazards.push(mat);
      }
    }
    // capot ouvert et fumée qui s'échappe du moteur
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.8), std("#e7e7e2", { roughness: 0.4 }));
    hood.position.set(0, 1.05, 1.15);
    hood.rotation.x = -0.6;
    hit.add(hood);
    const puff = canvasTexture(64, 64, (g) => {
      const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      r.addColorStop(0, "rgba(220,220,220,0.9)");
      r.addColorStop(1, "rgba(220,220,220,0)");
      g.fillStyle = r;
      g.fillRect(0, 0, 64, 64);
    });
    for (let i = 0; i < 14; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puff, color: "#bfc3c7", transparent: true, depthWrite: false }));
      sprite.userData.phase = i / 14;
      hit.add(sprite);
      this.smoke.push(sprite);
    }
    // VSAV des pompiers
    const vsav = vehicle(SPECS.van, "#c8102e");
    const van = SPECS.van;
    for (const sx of [-1, 1]) {
      vsav.add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, van.L * 0.92).translate(sx * (van.W / 2 + 0.06), van.belt - 0.2, 0), std("#f2f2f2")));
      vsav.add(side("SAPEURS-POMPIERS", "#ffffff", null, 2.6, van.belt + 0.3, sx * (van.W / 2 + 0.065), 0.24));
    }
    lightBar(vsav, van.H + 0.02, 0.4, 1.3);
    flasher(vsav, 2.8);
    at(27, LANE + 0.4, -0.08, vsav);
    // débris : verre et plastique
    const rand = mulberry32(29);
    const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.4 }), 70);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < 70; i++) {
      const glassBit = i < 45;
      const sz = glassBit ? 0.04 + rand() * 0.05 : 0.12 + rand() * 0.25;
      const ds = 10 + rand() * 9, lat = LANE - 1.5 + rand() * 3.5;
      const p = this.route.place(GATE_S + ds, () => lat);
      m4.compose(new THREE.Vector3(p.x, ROAD_Y + 0.02, p.z), q.setFromEuler(e.set(0, rand() * 6, 0)), new THREE.Vector3(sz, glassBit ? 0.01 : 0.04, sz * (0.5 + rand())));
      debris.setMatrixAt(i, m4);
      debris.setColorAt(i, new THREE.Color(glassBit ? "#dceaf3" : "#1d1f22"));
    }
    this.accident.add(debris);
    // traces de freinage
    for (const off of [-0.75, 0.75]) {
      const a = this.route.offset(GATE_S - 4, LANE + off), b = this.route.offset(GATE_S + 9, LANE - 0.4 + off);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(0.2, len).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: "#151515", transparent: true, opacity: 0.55, depthWrite: false }),
      );
      mark.position.set((a.x + b.x) / 2, ROAD_Y + 0.015, (a.y + b.y) / 2);
      mark.rotation.y = Math.atan2(b.x - a.x, b.y - a.y);
      this.accident.add(mark);
    }
    // agent qui fait passer les voitures une à une, pompiers, conducteur au téléphone
    const officer = person({ body: "#1b2a52", legs: "#1b2a52", vest: "#d8f03a", hat: "kepi" });
    at(-3.5, 0.6, Math.PI, officer.group);
    officer.left.rotation.z = -0.15;
    for (const [ds, lat, yaw] of [[9.5, LANE + 1.9, -1.8], [13, LANE + 2.6, -2.4]]) {
      const ff = person({ body: "#1d2433", legs: "#1d2433", vest: "#c9ced2", hat: "casque" });
      ff.right.rotation.x = -0.9;
      ff.left.rotation.x = -0.5;
      at(ds, lat, yaw, ff.group);
    }
    const driver = person({ body: "#7b5a3a", legs: "#3b4a63" });
    driver.right.rotation.set(-2.5, 0, 0.35);
    at(20, LANE + 5.2, -1.2, driver.group);
    return officer.right;
  }

  /** Ruban rouge sur la chaussée, de la queue de la file jusqu'à l'accident : lisible de très haut. */
  private buildJamRibbon() {
    const back = this.cars[this.cars.length - 1].s - 4;
    const pts: number[] = [], idx: number[] = [];
    const a = new THREE.Vector2(), b = new THREE.Vector2();
    let n = 0;
    for (let s = back; s <= GATE_S; s += 4) {
      this.route.offset(s, LANE - 2.4, a);
      this.route.offset(s, LANE + 2.4, b);
      pts.push(a.x, ROAD_Y + 0.08, a.y, b.x, ROAD_Y + 0.08, b.y);
      if (n) idx.push(2 * n - 2, 2 * n - 1, 2 * n, 2 * n - 1, 2 * n + 1, 2 * n);
      n++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#ff3b2f", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 2;
    return mesh;
  }

  // ---------- Ouverture ----------

  /** Gros plan sur Marc au volant ; un clic (ou espace, entrée, flèche, télécommande) lance le recul. */
  startIntro(onReveal: () => void, onDone: () => void) {
    const { controls, camera } = this.world;
    this.onReveal = onReveal;
    this.onIntroDone = onDone;
    this.phase = "closeup";
    this.crowdVisible = false;
    document.body.classList.add("intro");
    this.saved.minDistance = controls.minDistance;
    this.saved.maxPolar = controls.maxPolarAngle;
    this.saved.fov = camera.fov;
    controls.enabled = false;
    controls.minDistance = 0.1;
    controls.maxPolarAngle = Math.PI * 0.7;
    camera.fov = 27;
    camera.updateProjectionMatrix();
    this.closeupCamera(0);
    const go = () => {
      if (this.phase !== "closeup") return;
      this.phase = "pullback";
      this.introT = 0;
      const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      const crash = this.route.place(GATE_S + 8, () => 0), queue = this.route.place(GATE_S - 40, () => 0);
      const th = sph.theta;
      this.shots = [
        { at: 0, target: controls.target.clone(), radius: sph.radius, phi: sph.phi, theta: th, fov: camera.fov },
        // au-dessus de l'accident : gyrophares au premier plan, la file derrière, Marc dedans
        { at: 7, target: new THREE.Vector3(crash.x, 0, crash.z), radius: 85, phi: 0.85, theta: th + 0.45, fov: 45 },
        { at: 10.5, target: new THREE.Vector3(queue.x, 0, queue.z), radius: 175, phi: 0.78, theta: th + 0.7, fov: this.saved.fov },
        // puis toute la ville
        // dézoom 1,3 fois plus lent que la première partie, jusqu'à toute l'agglomération
        { at: 10.5 + 7.5 * 1.3, target: CITY_CENTER.clone(), radius: 6000, phi: 0.62, theta: th + 1.25, fov: this.saved.fov },
      ];
      window.removeEventListener("keydown", key);
    };
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if ([" ", "Enter", "ArrowRight", "ArrowDown", "PageDown"].includes(e.key)) {
        e.preventDefault();
        go();
      }
    };
    this.world.renderer.domElement.addEventListener("pointerdown", go, { once: true });
    window.addEventListener("keydown", key);
  }

  /** Sans ouverture (`?nointro`) : vue habituelle, la file avance déjà. */
  skipIntro() {
    this.phase = "free";
  }

  get introRunning() {
    return this.phase !== "free";
  }

  /** Caméra du gros plan : devant la voiture, à hauteur du visage, avec un léger flottement de caméra à l'épaule. */
  private closeupCamera(t: number) {
    const { camera, controls } = this.world;
    this.car.updateMatrixWorld();
    const head = this.figure.headPoint();
    const drift = Math.min(1, t / 14);
    const local = new THREE.Vector3(0.95 - drift * 0.12 + Math.sin(t * 0.5) * 0.03, 1.62 + Math.sin(t * 0.7) * 0.02, 3.5 - drift * 0.35);
    camera.position.copy(this.car.localToWorld(local));
    controls.target.copy(this.car.localToWorld(head.add(new THREE.Vector3(-0.05, 0.02, 0))));
    camera.lookAt(controls.target);
  }

  private pullbackCamera(dt: number) {
    const { camera, controls } = this.world;
    this.introT += dt;
    const t = this.introT, shots = this.shots, last = shots[shots.length - 1];
    let i = 0;
    while (i < shots.length - 2 && t > shots[i + 1].at) i++;
    const a = shots[i], b = shots[i + 1];
    const u = easeInOut(Math.min(1, (t - a.at) / (b.at - a.at)));
    // la caméra monte d'abord (inclinaison), puis s'éloigne ; distance interpolée en échelle log
    const target = a.target.clone().lerp(b.target, i === 0 ? smooth(0.2, 1, u) : u);
    const radius = a.radius * Math.pow(b.radius / a.radius, u);
    const phi = THREE.MathUtils.lerp(a.phi, b.phi, i === 0 ? smooth(0, 0.6, u) : u);
    const theta = THREE.MathUtils.lerp(a.theta, b.theta, u);
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(radius, phi, theta)));
    controls.target.copy(target);
    camera.fov = THREE.MathUtils.lerp(a.fov, b.fov, u);
    camera.updateProjectionMatrix();
    camera.lookAt(target);
    this.crowdVisible = radius > 40;
    if (t > shots[1].at && document.body.classList.contains("intro")) {
      document.body.classList.remove("intro");
      this.onReveal();
    }
    if (t >= last.at) {
      controls.minDistance = this.saved.minDistance;
      controls.maxPolarAngle = this.saved.maxPolar;
      controls.enabled = true;
      this.phase = "free";
      this.onIntroDone();
    }
  }

  // ---------- Suivi ----------

  /** Caméra derrière Marc, un peu au-dessus, puis elle l'accompagne (un glissement de la carte l'arrête). */
  follow() {
    const { camera, controls } = this.world;
    this.following = true;
    const p = this.marcPlace();
    const back = new THREE.Vector3(-Math.sin(p.h), 0, -Math.cos(p.h));
    const right = new THREE.Vector3(-Math.cos(p.h), 0, Math.sin(p.h));
    controls.target.set(p.x, 0, p.z);
    camera.position.set(p.x, 0, p.z).addScaledVector(back, 34).addScaledVector(right, -10).add(new THREE.Vector3(0, 22, 0));
    this.world.flyTo = null;
  }

  get position() {
    return new THREE.Vector3(this.car.position.x, 0, this.car.position.z);
  }

  /** Les voitures simulées sont masquées le long de la file tant que l'accident est en place. */
  hidesCar(x: number, z: number) {
    if (!this.accidentActive || !this.maskBox.containsPoint(new THREE.Vector2(x, z))) return false;
    const r = 7 + this.scale * 2.5, r2 = r * r;
    for (const s of this.mask) {
      const dx = s.bx - s.ax, dz = s.bz - s.az;
      const k = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz || 1)));
      if ((s.ax + dx * k - x) ** 2 + (s.az + dz * k - z) ** 2 < r2) return true;
    }
    return false;
  }

  /** Étiquette de l'accident (cliquable pour le compte rendu). */
  get accidentElement() {
    return this.accidentLabel.element;
  }

  stats(): JamStats {
    const live = this.cars.filter((c) => !c.gone);
    const waiting = live.filter((c) => !c.released);
    const last = waiting[waiting.length - 1];
    return {
      active: this.accidentActive,
      blocked: waiting.length,
      passed: this.cars.length - waiting.length,
      length: last ? Math.max(0, GATE_S - (last.s - last.len / 2)) : 0,
      avgWait: this.cars.reduce((n, c) => n + c.waited, 0) / this.cars.length / 60,
      marcWait: this.marc.waited / 60,
      marcPassed: this.marc.released && this.marc.s > GATE_S,
      co2: this.cars.reduce((n, c) => n + c.waited, 0) * IDLE_CO2_PER_S,
    };
  }

  private latAt = (s: number) => {
    if (!this.accidentActive) return LANE;
    // contournement par la voie d'en face, au pas, sous les ordres de l'agent
    const bump = smooth(GATE_S - 16, GATE_S - 4, s) * (1 - smooth(GATE_S + 26, GATE_S + 38, s));
    return LANE - 2 * LANE * bump;
  };

  private marcPlace() {
    return this.route.place(this.marc.s, this.latAt);
  }

  // ---------- Animation ----------

  /**
   * @param dt pas réel (s)
   * @param rate vitesse du trafic mis en scène (0 en pause, 1 en temps réel)
   * @param cameraDistance distance caméra – cible
   * @param sizeBoost exagération des silhouettes choisie dans l'interface
   */
  update(dt: number, rate: number, t: number, cameraDistance: number, sizeBoost: number) {
    this.time += dt;
    this.cameraDistance = cameraDistance;
    if (this.phase !== "closeup") this.traffic(dt * rate);
    // même grossissement que les voitures simulées, mais taille réelle de près
    this.scale = THREE.MathUtils.clamp((cameraDistance / 220) * sizeBoost * 0.55, 1, 8);
    this.placeCars();
    this.animateMarc(dt, t);
    this.animateAccident(dt, t);
    if (this.phase === "closeup") this.closeupCamera(this.time);
    else if (this.phase === "pullback") this.pullbackCamera(dt);
    else if (this.following) this.world.flyTo = this.position;
  }

  /** File : chacun avance quand celui de devant avance ; l'agent laisse passer une voiture à la fois. */
  private traffic(dt: number) {
    if (dt <= 0) return;
    this.gateTimer += dt;
    const next = this.cars.find((c) => !c.released && !c.gone);
    if (next && this.accidentActive && this.gateTimer >= GATE_PERIOD) {
      const front = next.s + next.len / 2;
      const prev = this.lastReleased;
      if (front > GATE_S - 4 && (!prev || prev.s - prev.len / 2 > GATE_S + 4)) {
        next.released = true;
        if (next.marc) next.minGap = 1.8;
        this.lastReleased = next;
        this.gateTimer = 0;
      }
    }
    let leaderBack = Infinity;
    for (const c of this.cars) {
      if (c.gone) continue;
      const front = c.s + c.len / 2;
      let limit = leaderBack - c.minGap;
      if (!c.released && this.accidentActive) limit = Math.min(limit, GATE_S - 1.2);
      const bypass = this.accidentActive && c.s > GATE_S - 20 && c.s < GATE_S + 40;
      let vmax = bypass ? 3.2 : 11;
      if (c.marc) {
        vmax = Math.min(vmax, 4 + 9 * (1 - Math.min(1, this.route.turn(c.s, 25) / 1.1)));
        limit = Math.min(limit, this.route.length - 2);
      }
      const vSafe = Math.sqrt(2 * 3.5 * Math.max(0, limit - front - 0.3));
      const target = Math.min(vmax, vSafe);
      c.v += THREE.MathUtils.clamp(target - c.v, -6 * dt, 1.8 * dt);
      c.v = Math.max(0, c.v);
      c.s = Math.min(c.s + c.v * dt, limit - c.len / 2);
      c.braking = c.v < 0.4 || target < c.v - 0.2;
      if (c.v < 2 && (!c.released || c.s < GATE_S + 20)) c.waited += dt;
      if (!c.marc && c.s > GATE_S + VANISH_AFTER) c.gone = true;
      leaderBack = c.s - c.len / 2;
      if (c.marc) this.wheelTurn += (c.v * dt) / SPECS.hatch.wheelR;
    }
    // la voie est dégagée une fois toute la file passée
    if (this.accidentActive && this.cars.every((c) => c.released && (c.gone || c.s > GATE_S + 45))) this.accidentActive = false;
  }

  private placeCars() {
    const counts = this.fleets.map(() => 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const k = this.scale, hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const c of this.cars) {
      if (c.gone || c.marc) continue;
      const p = this.route.place(c.s, this.latAt);
      const f = this.fleets[c.type], i = counts[c.type]++;
      m.compose(new THREE.Vector3(p.x, ROAD_Y, p.z), q.setFromAxisAngle(up, p.h), new THREE.Vector3(k, k, k));
      f.meshes.body.setMatrixAt(i, m);
      f.meshes.body.setColorAt(i, c.color);
      f.meshes.detail.setMatrixAt(i, m);
      f.meshes.head.setMatrixAt(i, m);
      f.meshes.brake.setMatrixAt(i, c.braking ? m : hidden);
    }
    this.fleets.forEach((f, j) => {
      for (const mesh of Object.values(f.meshes)) {
        mesh.count = counts[j];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    });
    const p = this.marcPlace();
    // petite vibration du moteur au ralenti
    const idle = this.marc.v < 0.1 ? Math.sin(this.time * 38) * 0.004 : 0;
    this.car.position.set(p.x, ROAD_Y + idle, p.z);
    this.car.rotation.y = p.h;
    this.car.scale.setScalar(k);
  }

  private beatAt(t: number) {
    const loop = t % 15;
    return JAM_BEATS.findIndex((b) => loop < b.until);
  }

  private say(text: string, seconds: number) {
    this.speech = text;
    this.speechUntil = this.time + seconds;
  }

  private animateMarc(dt: number, t: number) {
    const stuck = !this.marc.released;
    const head = this.figure.headPoint();
    let pose: Pose = { ...onWheel(t), yaw: 0, pitch: 0, roll: 0, lean: 0, brow: 0.3, talk: 0 };
    if (stuck) {
      const i = this.beatAt(this.time), beat = JAM_BEATS[i];
      pose = { ...pose, ...beat.pose(this.time, head) };
      if (i !== this.lastBeat) {
        this.lastBeat = i;
        if (beat.say) this.say(beat.say, beat.until - (i ? JAM_BEATS[i - 1].until : 0));
        if (beat.honk) this.honkAt = this.time + 0.35;
      }
    } else {
      // il roule : regard sur la route, quelques mots selon l'avancée du trajet
      const s = this.marc.s;
      const line = s < GATE_S - 16 ? "Allez, c'est à nous !"
        : s < GATE_S + 20 ? "Ah… c'était donc ça. Pourvu que personne ne soit blessé."
        : s < GATE_S + 220 ? "Enfin, ça roule !"
        : this.marc.s > this.route.length - 30 && this.marc.v < 0.2 ? "Arrivé. Demain, même heure, même bouchon."
        : "";
      if (line !== this.storyLine) {
        this.storyLine = line;
        if (line) this.say(line, line.startsWith("Arrivé") ? 9 : 5);
      }
      if (s < GATE_S + 30) pose = { ...pose, yaw: -0.45, brow: -0.3 };
      if (this.time < this.speechUntil) pose.talk = 0.5;
    }
    this.figure.update(pose, dt, this.time);

    // roues, sapin parfumé, feux stop
    for (const w of this.wheels) w.rotation.x = this.wheelTurn;
    this.freshener.rotation.z = Math.sin(this.time * 2.1) * 0.12 + (this.time - this.honkAt < 0.6 ? Math.sin(this.time * 20) * 0.25 : 0);
    this.brakeLights.emissiveIntensity = this.marc.braking ? 2.2 : 0.15;

    // klaxon : trois ondes qui partent de l'avant
    const since = this.time - this.honkAt;
    this.honkRings.forEach((ring, j) => {
      const u = since - j * 0.18;
      ring.visible = u > 0 && u < 0.9;
      if (!ring.visible) return;
      ring.scale.setScalar(0.4 + u * 3.2);
      ring.position.z = SPECS.hatch.L / 2 + 0.3 + u * 2.5;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - u / 0.9);
    });

    // bulle : de près seulement ; de loin, l'étiquette « Marc »
    const k = this.scale;
    const near = this.cameraDistance < 90 && this.time < this.speechUntil && !!this.speech;
    if (this.bubbleText.textContent !== this.speech) this.bubbleText.textContent = this.speech;
    this.bubbleText.classList.toggle("honk", this.speech.startsWith("TUU"));
    this.bubble.visible = near;
    this.bubble.position.copy(this.car.localToWorld(new THREE.Vector3(SEAT_X + 0.2, 1.52, -0.2)));
    this.tag.visible = !document.body.classList.contains("intro") && !near;
    this.tag.position.copy(this.car.position).add(new THREE.Vector3(0, 2.4 * k, 0));
  }

  private animateAccident(dt: number, t: number) {
    // l'accident s'efface une fois la file écoulée
    this.accidentFade = this.accidentActive ? 1 : Math.max(0, this.accidentFade - dt / 2);
    this.accident.visible = this.accidentFade > 0;
    this.accidentLabel.visible = this.accidentActive && !document.body.classList.contains("intro");
    if (!this.accident.visible) {
      for (const l of this.flashers) l.intensity = 0;
      this.jam.visible = false;
      return;
    }
    const k = Math.min(this.scale, 4) * (this.accidentFade < 1 ? this.accidentFade : 1);
    for (const o of this.accidentItems) o.scale.setScalar(Math.max(0.001, k));
    // gyrophares bleus en alternance, warnings orange
    const flash = (ph: number) => (Math.sin(t * 12 + ph) > 0.3 ? 1 : 0.12);
    for (const b of this.beacons) b.mat.opacity = flash(b.phase);
    this.flashers.forEach((l, i) => (l.intensity = 70 * flash(i * 2) * this.accidentFade));
    const hz = Math.sin(t * 5) > 0 ? 1 : 0.15;
    for (const m of this.hazards) m.opacity = hz;
    this.officerArm.rotation.set(-1.4 + Math.sin(t * 3.2) * 0.55, 0, 0.5);
    for (const s of this.smoke) {
      const u = (t * 0.25 + (s.userData.phase as number)) % 1;
      s.position.set(Math.sin(u * 9 + (s.userData.phase as number) * 20) * 0.2, 1.0 + u * 3.5, 1.3 - u * 0.8);
      s.scale.setScalar(0.5 + u * 2.4);
      s.material.opacity = 0.55 * Math.sin(u * Math.PI);
    }
    // ruban du bouchon, quand la caméra est assez haute pour ne plus distinguer les voitures
    const jamMat = this.jam.material as THREE.MeshBasicMaterial;
    jamMat.opacity = smooth(1.6, 3, this.scale) * (0.45 + 0.15 * Math.sin(t * 3)) * (this.accidentActive ? 1 : this.accidentFade);
    this.jam.visible = jamMat.opacity > 0.01;
  }
}
