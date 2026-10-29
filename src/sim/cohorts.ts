// Groupes d'habitants (profil × quartier) : statistiques mesurées pour Claude, application de ses réactions.
import { project } from "../shared/geo";
import type { CohortStat } from "../shared/advisors";
import { PLACE_LABEL } from "./places";
import { PROFILE_LABEL, type Agent } from "./population";
import type { Zone } from "./eventGeometry";

const DISTRICTS: [string, number, number][] = [
  ["Vieille ville", 45.8988, 6.1262],
  ["Centre – Bonlieu", 45.9015, 6.129],
  ["Gare – Courier", 45.9035, 6.1225],
  ["Les Fins", 45.911, 6.127],
  ["Novel – Teppes", 45.912, 6.14],
  ["Albigny", 45.908, 6.148],
  ["Vovray – Sacré-Cœur", 45.892, 6.125],
  ["Marquisats – rives sud", 45.8935, 6.136],
  ["Cran-Gevrier", 45.9, 6.105],
  ["Parmelan – Romains", 45.91, 6.115],
];
const CENTERS = DISTRICTS.map(([name, lat, lon]) => [name, ...project(lat, lon)] as [string, number, number]);

export function districtOf(a: Agent): string {
  if (a.profile === "pendulaire") return "hors Annecy";
  if (a.profile === "touriste") return "hôtels";
  let best = CENTERS[0][0], bd = Infinity;
  for (const [name, x, z] of CENTERS) {
    const d = (a.home.x - x) ** 2 + (a.home.z - z) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

export const cohortId = (a: Agent) => `${a.profile}|${a.district}`;

/** L'habitant est-il concerné : domicile, travail ou une étape de sa journée dans la zone ? */
export function isAffected(a: Agent, zone: Zone): boolean {
  if (zone.contains(a.home.x, a.home.z)) return true;
  if (a.work && zone.contains(a.work.x, a.work.z)) return true;
  for (const act of a.plan) if (zone.contains(act.place.x, act.place.z)) return true;
  // trajet domicile → travail qui traverse la zone (approximation en ligne droite)
  if (a.work) {
    for (let k = 0.2; k < 1; k += 0.2) {
      if (zone.contains(a.home.x + (a.work.x - a.home.x) * k, a.home.z + (a.work.z - a.home.z) * k)) return true;
    }
  }
  return false;
}

/**
 * Statistiques par groupe, triées par importance (taille × part concernée).
 * `modeOf` renvoie le mode habituel de l'habitant (mesuré sur sa dernière tournée).
 */
export function cohortStats(agents: Agent[], zone: Zone, scale: number, delayOf: (a: Agent) => number, max = 16): CohortStat[] {
  const groups = new Map<string, Agent[]>();
  for (const a of agents) {
    const k = cohortId(a);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(a);
  }
  const stats: CohortStat[] = [];
  for (const [id, members] of groups) {
    if (members.length < 20) continue;
    const n = members.length;
    let affected = 0, car = 0, bike = 0, walk = 0, travel = 0, delay = 0, sat = 0;
    const dest = new Map<string, number>();
    for (const a of members) {
      if (isAffected(a, zone)) affected++;
      const m = a.usualMode;
      if (m === 3) car++;
      else if (m === 2) bike++;
      else walk++;
      travel += a.travelMinutes;
      delay += delayOf(a);
      sat += a.satisfaction;
      for (const act of a.plan) {
        if (act.place === a.home) continue;
        const label = act.place.name ?? PLACE_LABEL[act.place.kind];
        dest.set(label, (dest.get(label) ?? 0) + 1);
      }
    }
    const [profile, district] = id.split("|");
    stats.push({
      id, profile, district,
      label: `${PROFILE_LABEL[profile as Agent["profile"]].replace(/ \(.*\)/, "")} · ${district}`,
      people: n * scale,
      affectedShare: +(affected / n).toFixed(2),
      carShare: +(car / n).toFixed(2), bikeShare: +(bike / n).toFixed(2), walkShare: +(walk / n).toFixed(2),
      travelMinutes: +(travel / n).toFixed(1), delayMinutes: +(delay / n).toFixed(1), satisfaction: +(sat / n).toFixed(2),
      destinations: [...dest].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d),
    });
  }
  return stats.sort((a, b) => b.people * (0.2 + b.affectedShare) - a.people * (0.2 + a.affectedShare)).slice(0, max);
}
