// Interprète de secours, sans IA : mots-clés → action la plus proche du catalogue.
// Utilisé quand le LLM n’est pas disponible ou que l'appel échoue.
import { defaultParams, EVENT_KINDS, EVENT_SPECS, type AssetPlacement, type EventKind, type EventModel, type EventProposal } from "./catalog";

/** Sans Claude, une menace inconnue (créature, attaque…) est traitée comme un danger, jamais comme une fête. */
const THREAT = /dragon|monstre|creature|attaque|invasion|zombie|godzilla|kraken|geant|crache|loup|ours|requin|bete/;

/** Silhouette de créature générique (corps, cou, tête, ailes, queue), faute de modèle sur mesure. */
const CREATURE: EventModel = {
  motion: "orbite", altitude: 70, orbit: 220, effects: ["feu"],
  parts: [
    { shape: "sphere", x: 0, y: 0, z: 0, sx: 8, sy: 6, sz: 18, rx: 0, ry: 0, rz: 0, color: "#7a1f1f", glow: 0 },
    { shape: "cylinder", x: 0, y: 3, z: 11, sx: 2.5, sy: 9, sz: 2.5, rx: 55, ry: 0, rz: 0, color: "#7a1f1f", glow: 0 },
    { shape: "box", x: 0, y: 6, z: 16, sx: 3.5, sy: 3, sz: 6, rx: 0, ry: 0, rz: 0, color: "#8c2a22", glow: 0 },
    { shape: "sphere", x: 1.2, y: 7, z: 18, sx: 0.8, sy: 0.8, sz: 0.8, rx: 0, ry: 0, rz: 0, color: "#ffcc00", glow: 1 },
    { shape: "sphere", x: -1.2, y: 7, z: 18, sx: 0.8, sy: 0.8, sz: 0.8, rx: 0, ry: 0, rz: 0, color: "#ffcc00", glow: 1 },
    { shape: "box", x: 12, y: 2, z: 0, sx: 20, sy: 0.5, sz: 9, rx: 0, ry: 0, rz: 15, color: "#5a1414", glow: 0 },
    { shape: "box", x: -12, y: 2, z: 0, sx: 20, sy: 0.5, sz: 9, rx: 0, ry: 0, rz: -15, color: "#5a1414", glow: 0 },
    { shape: "cone", x: 0, y: -1, z: -16, sx: 3, sy: 16, sz: 3, rx: -90, ry: 0, rz: 0, color: "#7a1f1f", glow: 0 },
  ],
};
import { findLocation } from "./locations";
import { findStreetsInText, normalize } from "./streets";

/** Lieu et parcours par défaut, plausibles pour chaque type d'événement. */
const DEFAULT_LOCATION: Partial<Record<EventKind, string>> = {
  tsunami: "Le Pâquier", inondation: "Jardins de l'Europe", feu_artifice: "Lac d'Annecy", pique_nique: "Le Pâquier",
  concert: "Le Pâquier", festival: "Bonlieu", festival_musique: "Le Pâquier", fete_musique: "Centre-ville", fete_foraine: "Les Marquisats",
  marche_noel: "Jardins de l'Europe", cinema_plein_air: "Le Pâquier", salon: "Haras d'Annecy", carnaval: "Bonlieu", competition: "Les Marquisats", marche: "Vieille ville", brocante: "Vieille ville", ovni: "Le Pâquier",
  manifestation: "Gare d'Annecy", incendie: "Vieille ville", meteorite: "Le Pâquier", marathon: "Le Pâquier", greve: "Gare d'Annecy",
};
export const DEFAULT_ROUTE: Partial<Record<EventKind, string[]>> = {
  carnaval: ["Bonlieu", "Hôtel de Ville", "Jardins de l'Europe", "Le Pâquier"],
  manifestation: ["Gare d'Annecy", "Bonlieu", "Hôtel de Ville"],
  marathon: ["Le Pâquier", "L'Impérial", "Les Marquisats", "Le Pâquier"],
};

/** Objets de la banque montrés par défaut, quand Claude n'est pas là pour les choisir. */
const DEFAULT_ASSETS: Partial<Record<EventKind, [string, number, number, AssetPlacement["placement"]][]>> = {
  accident: [["kenney/sedan", 1, 4.5, "centre"], ["kenney/hatchback-sports", 1, 4.2, "centre"], ["kenney/police", 1, 4.8, "cercle"], ["kenney/ambulance", 1, 6, "cercle"], ["kenney/cone", 6, 0.8, "cercle"], ["kenney/debris-tire", 3, 0.7, "disperse"]],
  travaux: [["kenney/truck", 1, 7, "centre"], ["kenney/tractor-shovel", 1, 6, "centre"], ["kenney/cone", 10, 0.8, "ligne"]],
  fermeture: [["kenney/cone", 8, 0.8, "ligne"], ["kenney/police", 1, 4.8, "centre"]],
  incendie: [["kenney/firetruck", 2, 9, "cercle"], ["kenney/ambulance", 1, 6, "cercle"], ["kenney/police", 1, 4.8, "cercle"]],
  inondation: [["kenney/firetruck", 1, 9, "cercle"], ["survival_pack/raft", 3, 4, "disperse"]],
  meteorite: [["kenney/meteor_detailed", 1, 18, "centre"], ["kenney/firetruck", 2, 9, "cercle"]],
  ovni: [["kenney/craft_speedera", 1, 30, "ciel"], ["kenney/alien", 3, 1.8, "disperse"]],
  greve: [["kenney/monorail_trainpassenger", 1, 20, "centre"]],
  manifestation: [["kenney/police", 2, 4.8, "ligne"]],
};

export function defaultAssets(kind: EventKind): AssetPlacement[] {
  return (DEFAULT_ASSETS[kind] ?? []).map(([id, count, size, placement]) => ({ id, query: id, count, size, placement, motion: placement === "ciel" ? "flotte" : "fixe", altitude: placement === "ciel" ? 80 : 0 }));
}

export function interpretLocally(text: string, streetNames: string[], extreme: boolean): EventProposal | null {
  const t = ` ${normalize(text)} `;
  // le mot-clé le plus long gagne (« feu d'artifice » plutôt que « feu »)
  let kind: EventKind | null = null, bestLen = 0;
  for (const k of EVENT_KINDS) {
    if (EVENT_SPECS[k].extreme && !extreme) continue;
    for (const kw of EVENT_SPECS[k].keywords) {
      if (kw.length > bestLen && t.includes(normalize(kw))) {
        kind = k;
        bestLen = kw.length;
      }
    }
  }
  const streets = findStreetsInText(text, streetNames);
  // « ferme la rue X » sans autre indice : c'est une fermeture
  if (!kind && streets.length) kind = "fermeture";
  // une demande qu'aucun mot-clé ne reconnaît mais qui parle de monde ou d'un lieu devient un événement libre
  const people = t.match(/(\d[\d\s.]*)\s*(000\s*)?(personnes|visiteurs|spectateurs|participants|festivaliers)/);
  const threat = THREAT.test(t);
  if (!kind && (people || threat || findLocation(text))) kind = "evenement";
  if (!kind) return null;
  const spec = EVENT_SPECS[kind];
  let location = findLocation(text)?.name ?? DEFAULT_LOCATION[kind] ?? "Centre-ville";
  if ((kind === "tsunami" || kind === "inondation") && location === "Lac d'Annecy") location = DEFAULT_LOCATION[kind]!;
  const intensity = /enorme|geant|gigantesque|extreme|massi|violent|grosse/.test(t) ? 3 : /petit|leger|mini/.test(t) ? 1 : 2;
  const weeks = t.match(/(\d+) semaine/), daysM = t.match(/(\d+) jour/);
  const days = weeks ? Number(weeks[1]) * 7 : daysM ? Number(daysM[1]) : /semaine/.test(t) ? 7 : 1;
  const hour = t.match(/(\d{1,2}) ?h ?(\d{2})?/);
  const startTime = hour ? `${hour[1].padStart(2, "0")}:${hour[2] ?? "00"}` : /ce soir/.test(t) ? "20:00" : spec.defaultStart;
  const dayOffset = /apres demain/.test(t) ? 2 : /demain/.test(t) ? 1 : 0;
  const where = streets.length ? streets.join(", ") : location;
  const params = defaultParams(kind);
  params.assets = defaultAssets(kind);
  if (people) params.attendance = Number(people[1].replace(/[\s.]/g, "")) * (people[2] ? 1000 : 1);
  const price = t.match(/(\d+)\s*(euros?|€)/);
  if (price) params.ticketPrice = Number(price[1]);
  if (/gratuit/.test(t)) params.ticketPrice = 0;
  if (/navette/.test(t)) params.shuttles = true;
  // menace inconnue : évacuation de la zone, modèle de créature générique
  if (kind === "evenement" && threat) {
    if (!extreme) return null;
    Object.assign(params, { nature: "danger", danger: true, closesRoads: true, mood: -2, icon: "⚠️", label: "Menace", model: /dragon|monstre|creature|bete|godzilla/.test(t) ? CREATURE : null });
  }
  return {
    ...params,
    kind, location, streets: spec.needs === "streets" ? streets : [], route: spec.needs === "route" ? DEFAULT_ROUTE[kind] ?? [] : [],
    dayOffset, startTime, durationMinutes: spec.duration, days: Math.min(days, 60), intensity,
    title: `${params.label || spec.label} — ${where}`,
    description: spec.about,
    question: `${spec.icon} ${spec.label} : ${where}${days > 1 ? ` pendant ${days} jours` : ""}. On lance ?`,
    note: spec.needs === "streets" && !streets.length ? "Aucune rue reconnue : précise le nom exact." : "Interprété par mots-clés (LLM indisponible).",
    source: "local",
  };
}
