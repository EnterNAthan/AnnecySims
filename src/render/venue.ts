// Décor 3D d'un grand événement, posé selon l'aménagement calculé par la simulation (src/sim/venue.ts).
import * as THREE from "three";
import type { Prop } from "../shared/catalog";
import type { VenueItem, VenueLayout } from "../sim/venue";

type Animate = (t: number, night: number) => void;

const lambert = (color: string, emissive = "#000000", emissiveIntensity = 0) =>
  new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
const MAT = {
  truss: lambert("#2b2d33"),
  deck: lambert("#1c1d22"),
  speaker: lambert("#111214"),
  white: lambert("#f4f1ea"),
  canvas: lambert("#e9e4d8"),
  wood: lambert("#8a5a35"),
  roofWood: lambert("#5a3a22"),
  steel: lambert("#9aa3ad"),
  fence: lambert("#b8c0c8"),
  blue: lambert("#2a6fd6"),
  red: lambert("#d8402f"),
};

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  return m;
}

/** Écran LED : couleur animée, plus vive la nuit. */
function ledScreen(w: number, h: number, hue: number) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue, 0.8, 0.5) });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const animate: Animate = (t, night) => {
    mat.color.setHSL((hue + t * 0.03 + Math.sin(t * 0.7) * 0.05) % 1, 0.75, 0.25 + 0.3 * night + 0.1 * Math.sin(t * 3) ** 2);
  };
  return { mesh: m, animate };
}

/** Faisceau de projecteur additif. */
function beam(color: string) {
  const geo = new THREE.ConeGeometry(5, 60, 16, 1, true).translate(0, -30, 0).rotateX(Math.PI);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
}

function stage(color: string): [THREE.Object3D, Animate] {
  const g = new THREE.Group();
  g.add(box(30, 2.2, 16, MAT.deck));
  // structure (pieds, poutres, toit)
  for (const x of [-15, 15]) for (const z of [-8, 7]) g.add(box(0.8, 15, 0.8, MAT.truss, x, 0, z));
  g.add(box(31, 1, 1, MAT.truss, 0, 15, -8), box(31, 1, 1, MAT.truss, 0, 15, 7), box(31, 0.6, 16, MAT.truss, 0, 16, 0));
  // façades de son
  for (const x of [-18.5, 18.5]) g.add(box(3, 9, 3, MAT.speaker, x, 2.2, 6));
  const screen = ledScreen(26, 10, 0.7);
  screen.mesh.position.set(0, 8.5, -7.6);
  g.add(screen.mesh);
  const beams = ["#ffffff", color, "#ffd84d", color, "#ffffff"].map((c, i) => {
    const b = beam(c);
    b.position.set(-12 + i * 6, 15, 5);
    g.add(b);
    return b;
  });
  return [g, (t, night) => {
    screen.animate(t, night);
    beams.forEach((b, i) => {
      b.rotation.z = Math.sin(t * 0.8 + i * 1.4) * 0.6;
      b.rotation.x = 0.35 + Math.cos(t * 0.6 + i) * 0.25;
      (b.material as THREE.MeshBasicMaterial).opacity = 0.03 + 0.2 * night;
    });
  }];
}

function bigScreen(): [THREE.Object3D, Animate] {
  const g = new THREE.Group();
  g.add(box(0.6, 9, 0.6, MAT.truss, -8, 0, 0), box(0.6, 9, 0.6, MAT.truss, 8, 0, 0), box(17, 9.5, 0.6, MAT.speaker, 0, 6, -0.4));
  const s = ledScreen(16, 9, 0.58);
  s.mesh.position.set(0, 10.75, 0);
  g.add(s.mesh);
  return [g, s.animate];
}

function tent(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(box(9, 3, 9, MAT.canvas));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.6, 3.2, 4).rotateY(Math.PI / 4), MAT.white);
  roof.position.y = 4.6;
  roof.castShadow = true;
  g.add(roof);
  return g;
}

function stall(color: string): THREE.Object3D {
  const g = new THREE.Group();
  g.add(box(3.4, 1.1, 2, MAT.wood));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.3, 4).rotateY(Math.PI / 4), lambert(color));
  roof.position.y = 2.7;
  for (const x of [-1.5, 1.5]) g.add(box(0.12, 2.2, 0.12, MAT.wood, x, 0, 0.9));
  g.add(roof);
  return g;
}

function foodtruck(color: string): THREE.Object3D {
  const g = new THREE.Group();
  g.add(box(2.4, 2.8, 5.6, lambert(color), 0, 0.4, 0));
  g.add(box(0.1, 1, 3, lambert("#2a2f38", "#ffd28a", 0.6), 1.25, 1.6, 0.2));
  const awning = box(1.4, 0.08, 3.4, MAT.white, 1.9, 3.2, 0.2);
  awning.rotation.z = -0.25;
  g.add(awning);
  for (const z of [-1.8, 1.8]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 2.5, 8).rotateZ(Math.PI / 2), MAT.speaker);
    w.position.set(0, 0.4, z);
    g.add(w);
  }
  return g;
}

function bar(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(box(10, 1.2, 1.4, MAT.wood));
  for (const x of [-4.8, 4.8]) for (const z of [-0.6, 2.4]) g.add(box(0.15, 3, 0.15, MAT.steel, x, 0, z));
  g.add(box(10.4, 0.15, 3.6, MAT.red, 0, 3, 0.9));
  return g;
}

function ferrisWheel(): [THREE.Object3D, Animate] {
  const g = new THREE.Group();
  const R = 15;
  // pieds en A
  for (const z of [-2, 2]) for (const s of [-1, 1]) {
    const leg = box(0.7, R + 4, 0.7, MAT.steel);
    leg.position.set(s * 4.5, 0, z);
    leg.rotation.z = s * 0.28;
    g.add(leg);
  }
  const wheel = new THREE.Group();
  wheel.position.y = R + 3;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.35, 6, 48), MAT.white));
  const colors = ["#e74c3c", "#f1c40f", "#3498db", "#2ecc71", "#9b59b6", "#e67e22"];
  const cabins: THREE.Mesh[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.15, R, 0.15), MAT.white);
    spoke.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), lambert(colors[i % colors.length], colors[i % colors.length], 0.2));
    cabin.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(cabin);
    cabins.push(cabin);
  }
  g.add(wheel);
  return [g, (t, night) => {
    wheel.rotation.z = t * 0.12;
    // les nacelles restent à l'horizontale
    for (const c of cabins) {
      c.rotation.z = -wheel.rotation.z;
      ((c.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.15 + 0.8 * night);
    }
  }];
}

function carousel(): [THREE.Object3D, Animate] {
  const g = new THREE.Group();
  const top = new THREE.Group();
  top.add(new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.6, 24), MAT.wood));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6.8, 3, 24), lambert("#e74c3c", "#ff9a6a", 0.2));
  roof.position.y = 6.2;
  top.add(roof);
  top.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 5, 8).translate(0, 2.8, 0), MAT.white));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.4, 6), MAT.steel);
    pole.position.set(Math.cos(a) * 4.6, 2.6, Math.sin(a) * 4.6);
    const horse = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.5), lambert(i % 2 ? "#ffffff" : "#f1c40f"));
    horse.position.set(Math.cos(a) * 4.6, 1.8, Math.sin(a) * 4.6);
    horse.rotation.y = -a;
    top.add(pole, horse);
  }
  g.add(top);
  return [g, (t, night) => {
    top.rotation.y = t * 0.6;
    (roof.material as THREE.MeshLambertMaterial).emissiveIntensity = 0.2 + 0.6 * night;
  }];
}

function chalet(): THREE.Object3D {
  const g = new THREE.Group();
  g.add(box(4, 2.6, 3, MAT.wood));
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 2.8, 1.6, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 1, 1.6), MAT.roofWood);
  roof.position.y = 3.3;
  g.add(roof, box(3.2, 0.9, 0.1, lambert("#3a2516", "#ffc070", 0.8), 0, 1.1, 1.52));
  return g;
}

function bleachers(): THREE.Object3D {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) g.add(box(24, 0.6 + i * 0.9, 1.4, i % 2 ? MAT.steel : MAT.blue, 0, 0, -i * 1.4));
  return g;
}

function arch(color: string): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.TorusGeometry(7, 1, 10, 24, Math.PI), lambert(color));
  m.castShadow = true;
  return m;
}

function podium(color: string): THREE.Object3D {
  const g = new THREE.Group();
  g.add(box(3, 1.6, 3, MAT.white), box(3, 1.1, 3, MAT.white, -3, 0, 0), box(3, 0.7, 3, MAT.white, 3, 0, 0));
  g.add(box(12, 6, 0.3, lambert(color), 0, 0, -2.5));
  return g;
}

function flag(color: string): THREE.Object3D {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 8, 6).translate(0, 4, 0), MAT.steel));
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 3.4), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  f.position.set(0.75, 6, 0);
  g.add(f);
  return g;
}

function toilets(): THREE.Object3D {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) g.add(box(1.2, 2.3, 1.2, MAT.blue, i * 1.35 - 2.7, 0, 0));
  return g;
}

/** Barrières tout autour du site, et guirlandes lumineuses au-dessus du public. */
function perimeter(layout: VenueLayout, withFence: boolean, withLights: boolean, isWater: (x: number, z: number) => boolean): [THREE.Object3D, Animate | null] {
  const g = new THREE.Group();
  const { x, z, r } = layout.crowd;
  if (withFence) {
    const R = r + 8, n = Math.ceil((2 * Math.PI * R) / 3.5);
    const fence = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 1.9, 0.08).translate(0, 0.95, 0), MAT.fence, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, px = x + Math.sin(a) * R, pz = z + Math.cos(a) * R;
      if (isWater(px, pz)) continue;
      q.setFromAxisAngle(up, a + Math.PI / 2);
      fence.setMatrixAt(k++, m.compose(new THREE.Vector3(px, 0, pz), q, one));
    }
    fence.count = k;
    g.add(fence);
  }
  if (!withLights) return [g, null];
  const bulbs: THREE.Vector3[] = [];
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * Math.PI;
    const ax = x + Math.sin(a) * r, az = z + Math.cos(a) * r, bx = x - Math.sin(a) * r, bz = z - Math.cos(a) * r;
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      bulbs.push(new THREE.Vector3(ax + (bx - ax) * k, 7 - Math.sin(k * Math.PI) * 2, az + (bz - az) * k));
    }
  }
  const mat = new THREE.MeshBasicMaterial({ color: "#ffd98a" });
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 6, 4), mat, bulbs.length);
  const m = new THREE.Matrix4();
  bulbs.forEach((p, i) => lights.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  g.add(lights);
  return [g, (_t, night) => mat.color.setRGB(0.35 + 0.65 * night, 0.3 + 0.55 * night, 0.15 + 0.3 * night)];
}

const PALETTE = ["#e74c3c", "#3498db", "#f1c40f", "#2ecc71", "#9b59b6", "#e67e22"];

/** Construit tout le décor d'un site. */
export function buildVenue(layout: VenueLayout, setup: Prop[], color: string, isWater: (x: number, z: number) => boolean): { group: THREE.Group; animate: Animate } {
  const group = new THREE.Group();
  const anims: Animate[] = [];
  const place = (o: THREE.Object3D, it: VenueItem) => {
    o.position.set(it.x, 0, it.z);
    o.rotation.y = it.angle;
    group.add(o);
  };
  layout.items.forEach((it, i) => {
    const c = PALETTE[i % PALETTE.length];
    let o: THREE.Object3D, a: Animate | undefined;
    switch (it.prop) {
      case "scene": [o, a] = stage(color); break;
      case "ecran": [o, a] = bigScreen(); break;
      case "tentes": o = tent(); break;
      case "stands": o = stall(c); break;
      case "foodtrucks": o = foodtruck(c); break;
      case "bar": o = bar(); break;
      case "grande_roue": [o, a] = ferrisWheel(); break;
      case "manege": [o, a] = carousel(); break;
      case "chalets": o = chalet(); break;
      case "tribunes": o = bleachers(); break;
      case "arche": o = arch(color); break;
      case "podium": o = podium(color); break;
      case "drapeaux": o = flag(i % 2 ? color : "#ffffff"); break;
      case "toilettes": o = toilets(); break;
      default: return;
    }
    place(o, it);
    if (a) anims.push(a);
  });
  const [ring, lights] = perimeter(layout, setup.includes("barrieres"), setup.includes("guirlandes") || setup.includes("chalets"), isWater);
  group.add(ring);
  if (lights) anims.push(lights);
  return { group, animate: (t, night) => anims.forEach((f) => f(t, night)) };
}
