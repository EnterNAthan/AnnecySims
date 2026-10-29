// Lieux nommés d'Annecy (positions OpenStreetMap) : étiquettes de la carte et cibles des événements.
import { project } from "./geo";

export interface NamedLocation {
  name: string;
  lat: number;
  lon: number;
  /** hauteur de l'étiquette sur la carte, en m */
  labelHeight: number;
  /** autres façons de le désigner (minuscules, sans accents) */
  aliases: string[];
}

export const LOCATIONS: NamedLocation[] = [
  { name: "Palais de l'Île", lat: 45.89855, lon: 6.12715, labelHeight: 25, aliases: ["palais", "palais de l'ile", "prison"] },
  { name: "Château d'Annecy", lat: 45.89758, lon: 6.12593, labelHeight: 40, aliases: ["chateau"] },
  { name: "Cathédrale Saint-Pierre", lat: 45.89933, lon: 6.12549, labelHeight: 35, aliases: ["cathedrale", "eglise"] },
  { name: "Vieille ville", lat: 45.8988, lon: 6.1262, labelHeight: 0, aliases: ["vieille ville", "vieil annecy", "rue sainte-claire", "centre historique"] },
  { name: "Hôtel de Ville", lat: 45.89935, lon: 6.1288, labelHeight: 25, aliases: ["mairie", "hotel de ville"] },
  { name: "Le Pâquier", lat: 45.90158, lon: 6.13194, labelHeight: 10, aliases: ["paquier", "pelouse"] },
  { name: "Jardins de l'Europe", lat: 45.89935, lon: 6.13082, labelHeight: 15, aliases: ["jardins de l'europe", "jardin"] },
  { name: "Pont des Amours", lat: 45.9002, lon: 6.13136, labelHeight: 10, aliases: ["pont des amours", "pont"] },
  { name: "Gare d'Annecy", lat: 45.9016, lon: 6.1221, labelHeight: 20, aliases: ["gare", "sncf", "train"] },
  { name: "Bonlieu", lat: 45.90187, lon: 6.12791, labelHeight: 25, aliases: ["bonlieu", "theatre"] },
  { name: "Courier", lat: 45.9042, lon: 6.1233, labelHeight: 30, aliases: ["courier", "centre commercial"] },
  { name: "L'Impérial", lat: 45.904, lon: 6.1445, labelHeight: 25, aliases: ["imperial", "casino", "albigny"] },
  { name: "Les Marquisats", lat: 45.893, lon: 6.136, labelHeight: 15, aliases: ["marquisats", "piscine"] },
  { name: "Lac d'Annecy", lat: 45.896, lon: 6.1405, labelHeight: 10, aliases: ["lac", "eau"] },
  { name: "Centre-ville", lat: 45.9005, lon: 6.1255, labelHeight: 0, aliases: ["centre", "ville", "annecy", "partout"] },
];

export function locationXZ(name: string): [number, number] {
  const loc = LOCATIONS.find((l) => l.name === name) ?? LOCATIONS[LOCATIONS.length - 1];
  return project(loc.lat, loc.lon);
}

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Lieu mentionné dans un texte libre (le plus long alias trouvé), sinon null. */
export function findLocation(text: string): NamedLocation | null {
  const t = strip(text);
  let best: NamedLocation | null = null, bestLen = 0;
  for (const loc of LOCATIONS) {
    for (const alias of [strip(loc.name), ...loc.aliases.map(strip)]) {
      if (alias.length > bestLen && t.includes(alias)) {
        best = loc;
        bestLen = alias.length;
      }
    }
  }
  return best;
}
