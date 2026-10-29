// Modèle 3D composé par Claude (primitives, mouvement, effets) : pour tout ce qui n'a pas de décor prévu.
import * as THREE from "three";
import type { EventModel, ModelPart } from "../shared/catalog";

const deg = Math.PI / 180;

function geometry(p: ModelPart): THREE.BufferGeometry {
  switch (p.shape) {
    case "sphere": return new THREE.SphereGeometry(0.5, 16, 12);
    case "cylinder": return new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    case "cone": return new THREE.ConeGeometry(0.5, 1, 14);
    case "torus": return new THREE.TorusGeometry(0.4, 0.1, 8, 24);
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function color(c: string) {
  try {
    return new THREE.Color(/^#[0-9a-f]{6}$/i.test(c) ? c : "#888888");
  } catch {
    return new THREE.Color("#888888");
  }
}

/** Petites particules additives (flammes, étincelles) ou opaques (fumée). */
function particles(count: number, size: number, tint: string, additive: boolean) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: tint, size, transparent: true, opacity: additive ? 0.9 : 0.45, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, pos, attr: geo.getAttribute("position") as THREE.BufferAttribute };
}

/**
 * Construit le modèle et son animation. Le modèle est centré sur (x, z) ; selon le mouvement il flotte,
 * tourne sur lui-même ou décrit une orbite au-dessus de la zone. Les effets sont crachés par l'avant (feu)
 * ou s'élèvent au-dessus (fumée).
 */
export function buildModel(m: EventModel, x: number, z: number): { group: THREE.Group; animate: (t: number, night: number) => void; height: number } {
  const group = new THREE.Group();
  const body = new THREE.Group();
  const glowing: THREE.MeshStandardMaterial[] = [];
  let top = 0, front = 0, frontY = 0, size = 0;
  for (const p of m.parts) {
    const glow = Math.max(0, Math.min(1, p.glow || 0));
    const c = color(p.color);
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, emissive: c, emissiveIntensity: glow * 1.5, flatShading: true });
    if (glow > 0) glowing.push(mat);
    const mesh = new THREE.Mesh(geometry(p), mat);
    mesh.position.set(p.x, p.y, p.z);
    mesh.scale.set(Math.max(0.1, p.sx), Math.max(0.1, p.sy), Math.max(0.1, p.sz));
    mesh.rotation.set((p.rx || 0) * deg, (p.ry || 0) * deg, (p.rz || 0) * deg);
    mesh.castShadow = true;
    body.add(mesh);
    top = Math.max(top, p.y + p.sy / 2);
    size = Math.max(size, Math.abs(p.x) + p.sx / 2, Math.abs(p.z) + p.sz / 2);
    if (p.z + p.sz / 2 > front) {
      front = p.z + p.sz / 2;
      frontY = p.y;
    }
  }
  group.add(body);
  // ombre portée au sol, même quand il vole
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(Math.max(4, size * 0.8), 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.25, depthWrite: false }));
  shadow.position.y = 0.4;
  group.add(shadow);

  const fx: ((t: number, dt: number, night: number) => void)[] = [];
  if (m.effects.includes("feu")) {
    // jet de flammes vers l'avant et le bas
    const n = 260, f = particles(n, Math.max(1.5, size * 0.12), "#ff7a1a", true);
    const life = new Float32Array(n).map(() => Math.random());
    body.add(f.pts);
    fx.push((t, dt) => {
      const burst = Math.sin(t * 0.8) > -0.2; // il crache par intermittence
      for (let i = 0; i < n; i++) {
        life[i] += dt * 1.6;
        if (life[i] > 1) life[i] = burst ? 0 : 1;
        const k = life[i], spread = k * size * 0.35;
        f.pos[3 * i] = (Math.sin(i * 12.9) * spread) || 0;
        f.pos[3 * i + 1] = frontY - k * k * size * 0.8 + Math.cos(i * 7.1) * spread * 0.5;
        f.pos[3 * i + 2] = front + k * size * 2.2;
      }
      f.attr.needsUpdate = true;
      (f.pts.material as THREE.PointsMaterial).opacity = burst ? 0.9 : 0.2;
    });
  }
  if (m.effects.includes("fumee")) {
    const n = 120, f = particles(n, Math.max(3, size * 0.25), "#6b6b6b", false);
    const life = new Float32Array(n).map(() => Math.random());
    group.add(f.pts);
    fx.push((_t, dt) => {
      for (let i = 0; i < n; i++) {
        life[i] = (life[i] + dt * 0.15) % 1;
        const k = life[i];
        f.pos[3 * i] = body.position.x + Math.sin(i * 3.7) * size * (0.3 + k);
        f.pos[3 * i + 1] = body.position.y + top + k * size * 3;
        f.pos[3 * i + 2] = body.position.z + Math.cos(i * 5.3) * size * (0.3 + k);
      }
      f.attr.needsUpdate = true;
    });
  }
  if (m.effects.includes("etincelles")) {
    const n = 150, f = particles(n, 0.8, "#fff2a8", true);
    group.add(f.pts);
    fx.push((t) => {
      for (let i = 0; i < n; i++) {
        const a = i * 2.4 + t * (0.5 + (i % 7) * 0.1), r = size * (0.6 + ((i * 37) % 10) / 10);
        f.pos[3 * i] = body.position.x + Math.sin(a) * r;
        f.pos[3 * i + 1] = body.position.y + top * ((i % 11) / 11) + Math.sin(t * 3 + i) * 1.5;
        f.pos[3 * i + 2] = body.position.z + Math.cos(a) * r;
      }
      f.attr.needsUpdate = true;
    });
  }
  if (m.effects.includes("lumiere")) {
    const light = new THREE.PointLight("#ffd9a0", 0, Math.max(80, size * 8), 1.5);
    light.position.y = top * 0.6;
    body.add(light);
    fx.push((t, _dt, night) => (light.intensity = (2000 + 1500 * Math.sin(t * 2) ** 2) * (0.2 + night)));
  }

  const alt = Math.max(0, m.altitude || 0);
  const R = Math.max(0, m.orbit || 0);
  // ~12 m/s sur l'orbite
  const omega = R > 0 ? 12 / R : 0;
  let last = 0;
  const animate = (t: number, night: number) => {
    const dt = last ? Math.min(0.1, t - last) : 0;
    last = t;
    let bx = x, by = alt, bz = z, heading = 0;
    switch (m.motion) {
      case "orbite": {
        const a = t * omega;
        bx = x + Math.sin(a) * R;
        bz = z + Math.cos(a) * R;
        by = alt + Math.sin(t * 0.9) * 4;
        heading = a + Math.PI / 2;
        body.rotation.z = -0.25; // il s'incline dans le virage
        break;
      }
      case "flotte":
        by = alt + Math.sin(t * 0.8) * 1.5;
        body.rotation.z = Math.sin(t * 0.6) * 0.05;
        heading = Math.sin(t * 0.2) * 0.3;
        break;
      case "tourne":
        heading = t * 0.5;
        break;
      case "pulse":
        body.scale.setScalar(1 + 0.06 * Math.sin(t * 3));
        break;
    }
    body.position.set(bx, by, bz);
    body.rotation.y = heading;
    shadow.position.set(bx, 0.4, bz);
    (shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 / (1 + by / 60);
    for (const g of glowing) g.emissiveIntensity = 0.8 + 0.7 * night + 0.2 * Math.sin(t * 4);
    for (const f of fx) f(t, dt, night);
  };
  animate(0, 0);
  return { group, animate, height: alt + top };
}
