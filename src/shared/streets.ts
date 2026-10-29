// Noms de rues OpenStreetMap : liste, recherche approximative (« av de genève » → « Avenue de Genève »).
import type { City } from "./city";

export const normalize = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’\-]/g, " ").replace(/\s+/g, " ").trim();

const ABBREV: [RegExp, string][] = [
  [/\bav\.?\b/g, "avenue"], [/\bbd\.?\b/g, "boulevard"], [/\bbld\b/g, "boulevard"], [/\bpl\.?\b/g, "place"],
  [/\bst\b/g, "saint"], [/\bste\b/g, "sainte"], [/\bfbg\b/g, "faubourg"], [/\bimp\b/g, "impasse"],
];
const STOP = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "a", "au", "aux", "et"]);

function expand(s: string) {
  let n = normalize(s);
  for (const [re, full] of ABBREV) n = n.replace(re, full);
  return n;
}

const tokens = (s: string) => expand(s).split(" ").filter((t) => t && !STOP.has(t));

/** Rues nommées praticables en voiture ou à pied, triées par longueur décroissante. */
export function streetNames(city: City): string[] {
  const len = new Map<string, number>();
  for (const r of city.roads) {
    if (!r.name) continue;
    let l = 0;
    for (let i = 0; i < r.n.length - 1; i++) {
      l += Math.hypot(city.nodes[2 * r.n[i + 1]] - city.nodes[2 * r.n[i]], city.nodes[2 * r.n[i + 1] + 1] - city.nodes[2 * r.n[i] + 1]);
    }
    len.set(r.name, (len.get(r.name) ?? 0) + l);
  }
  return [...len].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** Nom OSM le plus proche d'une désignation libre, ou null si rien de convaincant. */
export function matchStreet(query: string, names: string[]): string | null {
  const q = expand(query);
  const qt = tokens(query);
  if (!qt.length) return null;
  let best: string | null = null, bestScore = 0;
  for (const name of names) {
    const n = expand(name);
    if (n === q) return name;
    const nt = tokens(name);
    const common = qt.filter((t) => nt.includes(t)).length;
    // il faut retrouver tous les mots significatifs de la requête…
    let score = common / Math.max(qt.length, nt.length);
    if (common < qt.length) score *= 0.5;
    // … et le type de voie, s'il est donné, doit correspondre
    if (qt[0] !== nt[0] && ["rue", "avenue", "boulevard", "place", "quai", "chemin", "route", "faubourg", "pont", "impasse", "allee"].includes(qt[0])) score *= 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/** Rues citées dans un texte libre (interpréteur local). */
export function findStreetsInText(text: string, names: string[]): string[] {
  let t = ` ${expand(text)} `;
  const found: string[] = [];
  for (const name of [...names].sort((a, b) => b.length - a.length)) {
    const n = ` ${expand(name)} `;
    if (n.length < 9 || !t.includes(n)) continue;
    found.push(name);
    t = t.replace(n, " ");
  }
  return found;
}

/** Indices des rues (city.roads) portant ces noms. */
export function roadsNamed(city: City, names: string[]): number[] {
  const set = new Set(names);
  const out: number[] = [];
  city.roads.forEach((r, i) => r.name && set.has(r.name) && out.push(i));
  return out;
}
