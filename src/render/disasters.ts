// Effets spectaculaires des événements déclenchés par le joueur : météorite, incendie, tsunami,
// inondation, séisme, OVNI, feu d'artifice, pique-nique.
// Chaque effet renvoie une fonction d'animation appelée avec le temps réel écoulé depuis son début.
import * as THREE from "three";
import type { CityEvent } from "../sim/events";
import { locationXZ } from "../shared/locations";

export interface FxHost {
  flash(at: THREE.Vector3, power: number): void;
  shake(power: number): void;
}

/** age = secondes réelles depuis le début, t = horloge réelle, night = 0..1 */
export type Animate = (age: number, t: number, night: number) => void;

const additive = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/** Flammes vacillantes + colonne de fumée. */
export function fire(x: number, z: number, size: number, group: THREE.Group): Animate {
  const flames = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 3, 6).translate(0, 1.5, 0), additive("#ff7a1a", 0.85), 40);
  const smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: "#3b3b3b", transparent: true, opacity: 0.55, depthWrite: false }), 36);
  const glow = new THREE.PointLight("#ff6a1a", 0, size * 12, 1.5);
  glow.position.set(x, size * 0.8, z);
  const seeds = Array.from({ length: 40 }, () => [Math.random() * Math.PI * 2, Math.random() * size, Math.random() * 10]);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const colors = ["#ffb12a", "#ff6a1a", "#ff3b0a"].map((c) => new THREE.Color(c));
  seeds.forEach((_, i) => flames.setColorAt(i, colors[i % 3]));
  group.add(flames, smoke, glow);
  return (age, t) => {
    const grow = Math.min(1, age / 2);
    seeds.forEach(([a, r, ph], i) => {
      const h = (0.6 + 0.5 * Math.sin(t * 9 + ph)) * size * 0.35 * grow;
      m.compose(p.set(x + Math.cos(a) * r, 0, z + Math.sin(a) * r), q, s.set(size * 0.12, h, size * 0.12));
      flames.setMatrixAt(i, m);
    });
    flames.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 36; i++) {
      const life = ((t * 0.25 + i / 36) % 1);
      const k = Math.min(size, 30) * (0.3 + life * 1.1) * grow;
      m.compose(p.set(x + Math.sin(i * 7.1) * size * 0.4 + life * 60, 10 + life * Math.min(size, 40) * 7, z + Math.cos(i * 3.3) * size * 0.4), q, s.setScalar(k));
      smoke.setMatrixAt(i, m);
    }
    smoke.instanceMatrix.needsUpdate = true;
    glow.intensity = (3 + Math.sin(t * 13) * 0.8) * 1e5 * grow;
  };
}

export function meteorite(ev: CityEvent, group: THREE.Group, host: FxHost): Animate {
  const R = ev.radius;
  const impact = new THREE.Vector3(ev.x, 0, ev.z);
  const from = new THREE.Vector3(ev.x + 1600, 1500, ev.z - 1000);
  const FALL = 2.6;
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(10 * ev.intensity, 1), new THREE.MeshBasicMaterial({ color: "#ffe2a8" }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(45 * ev.intensity, 16, 12), additive("#ff8c2a", 0.6));
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(3 * ev.intensity, 30 * ev.intensity, 600, 12, 1, true).translate(0, 300, 0), additive("#ff9a3c", 0.35));
  // oriente la traînée le long de la trajectoire
  trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), from.clone().sub(impact).normalize());
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 64).rotateX(-Math.PI / 2), additive("#ffd9a0", 0.9));
  const crater = new THREE.Group();
  crater.add(
    new THREE.Mesh(new THREE.CircleGeometry(R * 0.28, 40).rotateX(-Math.PI / 2).translate(0, 1.2, 0), new THREE.MeshLambertMaterial({ color: "#2b211b" })),
    new THREE.Mesh(new THREE.TorusGeometry(R * 0.3, R * 0.05, 6, 40).rotateX(Math.PI / 2).translate(0, 1, 0), new THREE.MeshLambertMaterial({ color: "#5b4636" })),
    new THREE.Mesh(new THREE.CircleGeometry(R * 0.12, 24).rotateX(-Math.PI / 2).translate(0, 1.4, 0), additive("#ff5a12", 0.9)),
  );
  crater.position.copy(impact);
  const fireGroup = new THREE.Group();
  const burn = fire(ev.x, ev.z, R * 0.2, fireGroup);
  group.add(ball, halo, trail, shock, crater, fireGroup);
  let hit = false;
  return (age, t, night) => {
    const k = Math.min(1, age / FALL);
    const falling = k < 1;
    ball.visible = halo.visible = trail.visible = falling;
    crater.visible = fireGroup.visible = !falling;
    if (falling) {
      const pos = from.clone().lerp(impact, k ** 1.6);
      ball.position.copy(pos);
      halo.position.copy(pos);
      trail.position.copy(pos);
      halo.scale.setScalar(1 + Math.sin(t * 30) * 0.1);
      return;
    }
    if (!hit) {
      hit = true;
      host.flash(impact, 2);
      host.shake(4);
    }
    const after = age - FALL;
    shock.visible = after < 2;
    shock.scale.setScalar(5 + after * R * 0.9);
    (shock.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - after * 0.45);
    shock.position.set(ev.x, 2, ev.z);
    burn(after, t, night);
  };
}

/** Disque d'eau qui monte (inondation) ; renvoie aussi la hauteur courante. */
function floodDisk(ev: CityEvent, group: THREE.Group, maxHeight: number, rise: number): Animate {
  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(ev.radius, 72).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: "#3d7fa6", transparent: true, opacity: 0.78, roughness: 0.15, metalness: 0.2 }),
  );
  disk.position.set(ev.x, 0, ev.z);
  group.add(disk);
  return (age, t) => {
    const h = maxHeight * Math.min(1, age / rise);
    disk.position.y = h + Math.sin(t * 1.5) * 0.15;
    disk.visible = h > 0.05;
  };
}

export function flood(ev: CityEvent, group: THREE.Group): Animate {
  return floodDisk(ev, group, 1.2 + ev.intensity * 1.2, 8);
}

export function tsunami(ev: CityEvent, group: THREE.Group, host: FxHost): Animate {
  const [lx, lz] = locationXZ("Lac d'Annecy");
  // la vague part du large, dans l'axe lac → cible
  const dir = new THREE.Vector2(ev.x - lx, ev.z - lz);
  if (dir.lengthSq() < 1) dir.set(-1, -1);
  dir.normalize();
  const start = new THREE.Vector2(ev.x, ev.z).addScaledVector(dir, -1800);
  const H = 12 + ev.intensity * 10;
  const width = ev.radius * 3;
  const wave = new THREE.Group();
  wave.add(
    new THREE.Mesh(new THREE.BoxGeometry(width, H, 40).translate(0, H / 2, 0), new THREE.MeshStandardMaterial({ color: "#2f7fb0", transparent: true, opacity: 0.85, roughness: 0.2 })),
    new THREE.Mesh(new THREE.BoxGeometry(width, H * 0.18, 22).translate(0, H, 8), new THREE.MeshLambertMaterial({ color: "#f2fbff", emissive: "#bfe6ff", emissiveIntensity: 0.3 })),
  );
  wave.rotation.y = Math.atan2(dir.x, dir.y);
  group.add(wave);
  const TRAVEL = 7;
  const water = floodDisk(ev, group, 2 + ev.intensity, 1);
  let hit = false;
  return (age, t, night) => {
    const k = Math.min(1, age / TRAVEL);
    wave.visible = k < 1;
    if (k < 1) {
      const p = start.clone().lerp(new THREE.Vector2(ev.x, ev.z), k ** 1.3);
      wave.position.set(p.x, 0, p.y);
      wave.scale.y = 0.6 + k * 0.6;
      return;
    }
    if (!hit) {
      hit = true;
      host.shake(2.5);
    }
    water(age - TRAVEL, t, night);
  };
}

export function earthquake(ev: CityEvent, group: THREE.Group, host: FxHost): Animate {
  const dust = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: "#b9ad98", transparent: true, opacity: 0.5, depthWrite: false }), 80);
  const spots = Array.from({ length: 80 }, () => {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * Math.min(ev.radius, 1200);
    return [ev.x + Math.cos(a) * r, ev.z + Math.sin(a) * r, Math.random()];
  });
  group.add(dust);
  const m = new THREE.Matrix4();
  const DURATION = 9;
  return (age) => {
    if (age < DURATION) host.shake(0.8 + ev.intensity * 0.8 * (1 - age / DURATION));
    const k = Math.min(1, age / DURATION);
    spots.forEach(([x, z, ph], i) => {
      const s = (8 + ph * 18) * (0.3 + k);
      m.makeScale(s, s * 0.6, s).setPosition(x, s * 0.4 + k * 20 * ph, z);
      dust.setMatrixAt(i, m);
    });
    dust.instanceMatrix.needsUpdate = true;
    (dust.material as THREE.MeshLambertMaterial).opacity = 0.55 * (1 - Math.max(0, (age - DURATION) / 20));
    dust.visible = age < DURATION + 20;
  };
}

export function ufo(ev: CityEvent, group: THREE.Group): Animate {
  const s = 1 + ev.intensity * 0.5;
  const saucer = new THREE.Group();
  saucer.add(
    new THREE.Mesh(new THREE.CylinderGeometry(24, 30, 5, 32), new THREE.MeshStandardMaterial({ color: "#9aa3ad", metalness: 0.9, roughness: 0.25 })),
    new THREE.Mesh(new THREE.SphereGeometry(11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 2, 0), new THREE.MeshStandardMaterial({ color: "#7fe8ff", transparent: true, opacity: 0.7, emissive: "#2fd2ff", emissiveIntensity: 0.6 })),
  );
  const lights: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? "#7dff8a" : "#ffe95a" }));
    l.position.set(Math.cos((i / 12) * Math.PI * 2) * 27, -1, Math.sin((i / 12) * Math.PI * 2) * 27);
    lights.push(l);
    saucer.add(l);
  }
  saucer.scale.setScalar(s);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 40, 1, 32, 1, true).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: "#8dff9b", transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  group.add(saucer, beam);
  return (age, t) => {
    const hover = 110 + Math.sin(t * 1.2) * 6;
    const y = age < 5 ? 1500 - (1500 - hover) * (1 - (1 - age / 5) ** 3) : hover;
    saucer.position.set(ev.x + Math.sin(t * 0.3) * 20, y, ev.z + Math.cos(t * 0.27) * 20);
    saucer.rotation.y = t * 1.5;
    lights.forEach((l, i) => (l.visible = Math.sin(t * 6 + i) > -0.3));
    beam.visible = age > 5;
    beam.position.set(saucer.position.x, y, saucer.position.z);
    beam.scale.y = y;
    (beam.material as THREE.MeshBasicMaterial).opacity = 0.15 + 0.08 * Math.sin(t * 4);
  };
}

export function fireworks(ev: CityEvent, group: THREE.Group, host: FxHost): Animate {
  const N = 160, BURSTS = 8;
  const bursts = Array.from({ length: BURSTS }, () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false;
    group.add(pts);
    return { pts, vel: new Float32Array(N * 3), born: -99, center: new THREE.Vector3() };
  });
  const palette = ["#ff4d6d", "#ffd23f", "#3ec1ff", "#9b5cff", "#4dff88", "#ffffff", "#ff8c1a"];
  let next = 0, slot = 0;
  return (age) => {
    if (age > next) {
      next = age + 0.35 + Math.random() * 0.5;
      const b = bursts[slot++ % BURSTS];
      b.born = age;
      b.center.set(ev.x + (Math.random() - 0.5) * 300, 150 + Math.random() * 140, ev.z + (Math.random() - 0.5) * 300);
      (b.pts.material as THREE.PointsMaterial).color.set(palette[Math.floor(Math.random() * palette.length)]);
      for (let i = 0; i < N; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 30;
        const r = Math.sqrt(1 - u * u);
        b.vel.set([r * Math.cos(th) * sp, u * sp, r * Math.sin(th) * sp], i * 3);
      }
      host.flash(b.center, 0.25);
    }
    for (const b of bursts) {
      const life = age - b.born;
      b.pts.visible = life < 2.2;
      if (!b.pts.visible) continue;
      const pos = b.pts.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const drag = (1 - Math.exp(-2 * life)) / 2;
      for (let i = 0; i < N; i++) {
        arr[i * 3] = b.center.x + b.vel[i * 3] * drag;
        arr[i * 3 + 1] = b.center.y + b.vel[i * 3 + 1] * drag - 9 * life * life;
        arr[i * 3 + 2] = b.center.z + b.vel[i * 3 + 2] * drag;
      }
      pos.needsUpdate = true;
      (b.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - life / 2.2);
    }
  };
}

export function picnic(ev: CityEvent, group: THREE.Group) {
  const n = 18 + ev.intensity * 8;
  const blankets = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 3).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: "#ffffff" }), n);
  const colors = ["#e74c3c", "#f5f5f5", "#3498db", "#f1c40f", "#e67e22"].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * ev.radius * 0.7;
    m.makeRotationY(Math.random() * Math.PI).setPosition(ev.x + Math.cos(a) * r, 0.5, ev.z + Math.sin(a) * r);
    blankets.setMatrixAt(i, m);
    blankets.setColorAt(i, colors[i % colors.length]);
  }
  group.add(blankets);
}
