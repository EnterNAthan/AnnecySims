// Couche trafic (fluidité de chaque rue, du vert au rouge) et aperçu d'un événement avant confirmation.
import * as THREE from "three";
import { ROAD_FLAGS, type City } from "../shared/city";
import { ribbon } from "./cityMeshes";
import type { Preview } from "../sim/protocol";

const FLUID = new THREE.Color("#35c46a");
const SLOW = new THREE.Color("#ffb020");
const JAM = new THREE.Color("#e8323c");
const CLOSED = new THREE.Color("#8a1020");

export class TrafficLayer {
  readonly mesh: THREE.Mesh;
  /** premier sommet et nombre de sommets de chaque rue dans le ruban */
  private readonly range = new Map<number, [number, number]>();
  private readonly colors: THREE.BufferAttribute;
  private data: Uint8Array | null = null;
  private showFlow = false;

  constructor(city: City) {
    const lines: { pts: [number, number][]; w: number }[] = [];
    let v = 0;
    city.roads.forEach((r, i) => {
      if (!(r.f & ROAD_FLAGS.CAR) || r.n.length < 2) return;
      lines.push({ pts: r.n.map((n) => [city.nodes[2 * n], city.nodes[2 * n + 1]]), w: Math.max(3, r.w * 0.55) });
      const count = (r.n.length - 1) * 6;
      this.range.set(i, [v, count]);
      v += count;
    });
    const geo = ribbon(lines, 0.7);
    this.colors = new THREE.BufferAttribute(new Float32Array(v * 4), 4);
    geo.setAttribute("color", this.colors);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }),
    );
    this.mesh.renderOrder = 2;
  }

  /** Affiche la fluidité de toutes les rues (sinon seulement les rues fermées et les bouchons forts). */
  set flow(on: boolean) {
    this.showFlow = on;
    if (this.data) this.update(this.data);
  }

  update(data: Uint8Array) {
    this.data = data;
    const c = this.colors.array as Float32Array;
    const col = new THREE.Color();
    for (const [r, [start, count]] of this.range) {
      const v = data[r];
      let alpha = 0;
      if (v === 1) {
        col.copy(CLOSED);
        alpha = 0.95;
      } else if (v > 1) {
        const f = (v - 2) / 253; // 1 = fluide
        if (f > 0.75) col.copy(FLUID).lerp(SLOW, (1 - f) / 0.25);
        else col.copy(SLOW).lerp(JAM, Math.min(1, (0.75 - f) / 0.4));
        // hors mode trafic, seuls les vrais ralentissements restent visibles
        alpha = this.showFlow ? 0.85 : f < 0.55 ? 0.75 : 0;
      }
      for (let k = start; k < start + count; k++) {
        c[4 * k] = col.r;
        c[4 * k + 1] = col.g;
        c[4 * k + 2] = col.b;
        c[4 * k + 3] = alpha;
      }
    }
    this.colors.needsUpdate = true;
  }
}

/** Surbrillance des rues et du parcours concernés par une proposition, en attente de confirmation. */
export class PreviewLayer {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({ color: "#7fe3ff", transparent: true, opacity: 0.8, depthWrite: false });

  constructor(private readonly city: City) {
    this.group.renderOrder = 3;
  }

  set(p: Preview | null) {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    if (!p) return;
    const node = (n: number): [number, number] => [this.city.nodes[2 * n], this.city.nodes[2 * n + 1]];
    const lines = p.roads.map((r) => ({ pts: this.city.roads[r].n.map(node), w: Math.max(6, this.city.roads[r].w + 3) }));
    if (p.path) {
      const pts: [number, number][] = [];
      for (let i = 0; i < p.path.length; i += 2) pts.push([p.path[i], p.path[i + 1]]);
      lines.push({ pts, w: 7 });
    }
    if (lines.length) this.group.add(new THREE.Mesh(ribbon(lines, 1.2), this.material));
    if (!lines.length || p.radius > 100) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(20, p.radius) * 0.94, Math.max(20, p.radius), 64).rotateX(-Math.PI / 2), this.material);
      ring.position.set(p.x, 1.2, p.z);
      this.group.add(ring);
    }
  }

  update(t: number) {
    this.material.opacity = 0.45 + 0.35 * Math.sin(t * 4) ** 2;
  }
}
