// Aménagement d'un lieu d'événement : scène, zone du public, stands autour, toujours sur la terre ferme.
// Calculé de la même façon par la simulation (placement de la foule) et par le rendu (décor 3D).
import type { Prop } from "../shared/catalog";

export interface VenueItem {
  prop: Prop;
  x: number;
  z: number;
  /** orientation (rad), face tournée vers le public */
  angle: number;
}

export interface VenueLayout {
  x: number;
  z: number;
  /** rayon du site */
  r: number;
  /** le public regarde dans cette direction (vers la scène ou l'écran), null s'il déambule */
  facing: number | null;
  /** zone où se tient le public */
  crowd: { x: number; z: number; r: number };
  items: VenueItem[];
}

/** Ce qu'il faut savoir de l'événement pour l'aménager. */
export interface VenueInput {
  id: number;
  x: number;
  z: number;
  attendance: number;
  setup: Prop[];
}

function hash(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Taille de la zone du public : environ 40 % des visiteurs présents en même temps, 2 personnes par m². */
export function crowdRadius(attendance: number) {
  return Math.max(18, Math.min(110, Math.sqrt((Math.max(500, attendance) * 0.4) / 2 / Math.PI)));
}

export function venueLayout(ev: VenueInput, isWater: (x: number, z: number) => boolean): VenueLayout {
  const cr = crowdRadius(ev.attendance);
  const r = cr + 45;
  // centre de gravité de la terre ferme autour du point demandé (au bord du lac, on recule)
  let sx = 0, sz = 0, n = 0;
  for (let i = -6; i <= 6; i++) {
    for (let j = -6; j <= 6; j++) {
      const x = ev.x + (i / 6) * r, z = ev.z + (j / 6) * r;
      if (i * i + j * j > 36 || isWater(x, z)) continue;
      sx += x;
      sz += z;
      n++;
    }
  }
  const cx = n ? sx / n : ev.x, cz = n ? sz / n : ev.z;
  const land = (x: number, z: number) => !isWater(x, z);

  const stage = ev.setup.includes("scene") ? "scene" : ev.setup.includes("ecran") ? "ecran" : ev.setup.includes("podium") ? "podium" : null;
  let facing: number | null = null;
  let crowd = { x: cx, z: cz, r: cr };
  const items: VenueItem[] = [];
  if (stage) {
    // on essaie 16 orientations : scène sur la terre ferme, public le plus possible sur la terre ferme
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      const sxp = cx + dx * cr * 0.85, szp = cz + dz * cr * 0.85;
      let score = land(sxp, szp) ? 30 : -100;
      if (land(sxp + dx * 12, szp + dz * 12)) score += 5;
      const ccx = cx - dx * cr * 0.15, ccz = cz - dz * cr * 0.15;
      for (let s = 0; s < 24; s++) {
        const t = (s / 24) * Math.PI * 2, rr = cr * (s % 2 ? 0.45 : 0.85);
        if (land(ccx + Math.sin(t) * rr, ccz + Math.cos(t) * rr)) score++;
      }
      if (score > bestScore) [best, bestScore] = [k, score];
    }
    const a = (best / 16) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a);
    // le public regarde la scène : de la zone vers la scène
    facing = a;
    crowd = { x: cx - dx * cr * 0.15, z: cz - dz * cr * 0.15, r: cr * 0.75 };
    items.push({ prop: stage, x: cx + dx * cr * 0.85, z: cz + dz * cr * 0.85, angle: a + Math.PI });
    // écran géant à côté de la grande scène
    if (stage === "scene" && ev.setup.includes("ecran")) {
      for (const side of [-1, 1]) items.push({ prop: "ecran", x: cx + dx * cr * 0.7 + dz * side * 22, z: cz + dz * cr * 0.7 - dx * side * 22, angle: a + Math.PI });
    }
  }

  // le reste du décor en couronne autour du public, du côté opposé à la scène d'abord
  const ring = ev.setup.filter((p) => p !== stage && !(p === "ecran" && stage === "scene") && p !== "barrieres" && p !== "guirlandes");
  const count: Partial<Record<Prop, number>> = {
    tentes: 4, stands: 8, foodtrucks: 6, bar: 2, grande_roue: 1, manege: 2, chalets: 14, tribunes: 2, arche: 1,
    podium: 1, drapeaux: 6, toilettes: 2, ecran: 1,
  };
  const base = facing ?? hash(ev.id) * Math.PI * 2;
  let slot = 0;
  const slots = ring.reduce((s, p) => s + (count[p] ?? 1), 0);
  for (const prop of ring) {
    for (let i = 0; i < (count[prop] ?? 1); i++, slot++) {
      // répartis sur un arc de 280° en face de la scène
      const t = base + Math.PI + ((slot + 0.5) / Math.max(1, slots) - 0.5) * (stage ? 4.9 : Math.PI * 2);
      const big = prop === "grande_roue" || prop === "tribunes" || prop === "manege";
      let rr = cr + (big ? 26 : 14);
      let x = crowd.x + Math.sin(t) * rr, z = crowd.z + Math.cos(t) * rr;
      // si c'est dans l'eau, on rapproche vers le centre
      while (isWater(x, z) && rr > 8) {
        rr -= 6;
        x = crowd.x + Math.sin(t) * rr;
        z = crowd.z + Math.cos(t) * rr;
      }
      if (isWater(x, z)) continue;
      items.push({ prop, x, z, angle: t + Math.PI });
    }
  }
  return { x: cx, z: cz, r, facing, crowd, items };
}

/**
 * Position d'un spectateur dans la zone du public (uniforme dans le disque, jamais dans l'eau).
 * `u`, `v` dans [0, 1[ propres à la personne.
 */
export function crowdSpot(layout: VenueLayout, u: number, v: number, isWater: (x: number, z: number) => boolean): [number, number] {
  const { x, z, r } = layout.crowd;
  let rr = Math.sqrt(u) * r;
  const t = v * Math.PI * 2;
  for (let k = 0; k < 6; k++, rr *= 0.6) {
    const px = x + Math.sin(t) * rr, pz = z + Math.cos(t) * rr;
    if (!isWater(px, pz)) return [px, pz];
  }
  return [x, z];
}
