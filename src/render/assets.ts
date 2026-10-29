// Objets de la banque de modèles 3D (CC0), chargés à la demande et posés autour du lieu d'un événement.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetPlacement } from "../shared/catalog";

const loader = new GLTFLoader();
/** un chargement par modèle, partagé par toutes les copies */
const cache = new Map<string, Promise<THREE.Object3D | null>>();

function load(id: string): Promise<THREE.Object3D | null> {
  let p = cache.get(id);
  if (!p) {
    p = loader.loadAsync(`/models/${id}.glb`).then(
      (gltf) => {
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
        });
        return gltf.scene;
      },
      () => null,
    );
    cache.set(id, p);
  }
  return p;
}

function hash(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Copie mise à l'échelle réelle (plus grande dimension = `size`), posée sur le sol, centrée. */
function fit(model: THREE.Object3D, size: number): THREE.Object3D {
  const clone = model.clone(true);
  const box = new THREE.Box3().setFromObject(clone);
  const dim = box.getSize(new THREE.Vector3());
  const k = size / Math.max(0.001, dim.x, dim.y, dim.z);
  clone.scale.setScalar(k);
  const center = box.getCenter(new THREE.Vector3());
  clone.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  const holder = new THREE.Group();
  holder.add(clone);
  return holder;
}

interface Placed {
  obj: THREE.Object3D;
  a: AssetPlacement;
  x: number;
  z: number;
  phase: number;
}

/**
 * Pose les objets autour de (x, z) dans un rayon `r`, sans jamais les mettre dans l'eau
 * (sauf placement « lac », qui cherche au contraire l'eau la plus proche).
 */
export function buildAssets(list: AssetPlacement[], x: number, z: number, r: number, seed: number, isWater: (x: number, z: number) => boolean) {
  const group = new THREE.Group();
  const placed: Placed[] = [];
  list.forEach((a, k) => {
    for (let i = 0; i < a.count; i++) {
      const u = hash(seed * 31 + k * 97 + i), v = hash(seed * 17 + k * 53 + i * 7);
      let px = x, pz = z, angle = v * Math.PI * 2;
      const spread = Math.min(r, 25 + a.size * 3);
      switch (a.placement) {
        case "cercle": {
          const t = (i / a.count) * Math.PI * 2 + k;
          px = x + Math.sin(t) * spread * 0.6;
          pz = z + Math.cos(t) * spread * 0.6;
          angle = t + Math.PI; // tourné vers le centre
          break;
        }
        case "ligne": {
          const d = (i - (a.count - 1) / 2) * a.size * 1.6;
          const dir = hash(seed + k) * Math.PI;
          px = x + Math.sin(dir) * d + Math.cos(dir) * (k - 1) * 8;
          pz = z + Math.cos(dir) * d - Math.sin(dir) * (k - 1) * 8;
          angle = dir;
          break;
        }
        case "disperse":
        case "ciel":
          px = x + Math.sin(v * 6.283) * Math.sqrt(u) * spread;
          pz = z + Math.cos(v * 6.283) * Math.sqrt(u) * spread;
          break;
        case "lac": {
          // l'eau la plus proche, en spirale
          for (let s = 0; s < 80; s++) {
            const t = s * 0.7 + u, d = 20 + s * 12;
            const cx = x + Math.sin(t) * d, cz = z + Math.cos(t) * d;
            if (isWater(cx, cz) && isWater(cx + 10, cz) && isWater(cx, cz + 10)) {
              px = cx + (i % 3) * a.size * 1.5;
              pz = cz + Math.floor(i / 3) * a.size * 1.5;
              break;
            }
          }
          break;
        }
        default:
          // au centre, côte à côte s'il y en a plusieurs
          px = x + (i - (a.count - 1) / 2) * a.size * 1.2 + (a.count > 1 ? (u - 0.5) * 2 : 0);
          pz = z + (v - 0.5) * a.size * 0.6;
      }
      if (a.placement !== "lac" && a.placement !== "ciel") {
        for (let s = 0; s < 8 && isWater(px, pz); s++) {
          px = x + (px - x) * 0.6;
          pz = z + (pz - z) * 0.6;
        }
      }
      const holder = new THREE.Group();
      holder.position.set(px, a.placement === "ciel" || a.motion === "orbite" ? Math.max(30, a.altitude) : a.altitude, pz);
      holder.rotation.y = angle;
      group.add(holder);
      placed.push({ obj: holder, a, x: px, z: pz, phase: u * 10 });
      load(a.id).then((m) => m && holder.add(fit(m, a.size)));
    }
  });
  const animate = (t: number) => {
    for (const p of placed) {
      const { a, obj } = p;
      switch (a.motion) {
        case "orbite": {
          const R = Math.max(60, a.size * 4), w = 14 / R, ang = t * w + p.phase;
          obj.position.set(x + Math.sin(ang) * R, Math.max(30, a.altitude) + Math.sin(t + p.phase) * 3, z + Math.cos(ang) * R);
          obj.rotation.y = ang + Math.PI / 2;
          break;
        }
        case "flotte":
          obj.position.y = (a.placement === "ciel" ? Math.max(30, a.altitude) : a.altitude) + Math.sin(t * 0.8 + p.phase) * (a.placement === "lac" ? 0.3 : 1.5);
          obj.rotation.z = Math.sin(t * 0.6 + p.phase) * 0.04;
          break;
        case "tourne":
          obj.rotation.y = t * 0.5 + p.phase;
          break;
        case "pulse":
          obj.scale.setScalar(1 + 0.05 * Math.sin(t * 3 + p.phase));
          break;
      }
    }
  };
  return { group, animate };
}
