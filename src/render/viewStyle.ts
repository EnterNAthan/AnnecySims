// Style de la vue 3D : « verre » (ville nocturne bleutée, assortie à l'interface) ou « réaliste » (couleurs OSM d'origine).
import * as THREE from "three";

export type ViewStyle = "verre" | "realiste";

export const VIEW_STYLES: { id: ViewStyle; label: string }[] = [
  { id: "verre", label: "Verre" },
  { id: "realiste", label: "Réaliste" },
];

// teinte multipliée aux couleurs d'origine : bâtiments ardoise, sol et relief plus sombres
const TINT = new THREE.Color("#8597bb");
const TINT_GROUND = new THREE.Color("#4d5a74");
const TINT_TREES = new THREE.Color("#71879c");

const original = new WeakMap<THREE.Material, THREE.Color>();

function tintFor(obj: THREE.Object3D): THREE.Color {
  for (let o: THREE.Object3D | null = obj; o; o = o.parent) {
    if (o.name === "terrain" || o.name === "greens") return TINT_GROUND;
    if (o.name === "trees") return TINT_TREES;
  }
  return TINT;
}

/** Recolore les maillages de la ville ; les couleurs d'origine sont gardées pour revenir au réaliste. */
export function applyViewStyle(style: ViewStyle, roots: THREE.Object3D[]) {
  for (const root of roots) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const m = mat as THREE.MeshStandardMaterial;
        if (!m.color) continue;
        if (!original.has(m)) original.set(m, m.color.clone());
        m.color.copy(original.get(m)!);
        if (style === "verre") m.color.multiply(tintFor(obj));
      }
    });
  }
}
