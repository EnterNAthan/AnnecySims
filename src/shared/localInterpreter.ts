// Interprète de secours, sans IA : mots-clés → action la plus proche du catalogue.
// Utilisé quand Claude Code n'est pas disponible ou que l'appel échoue.
import { EVENT_KINDS, EVENT_SPECS, type EventKind, type EventProposal } from "./catalog";
import { findLocation } from "./locations";
import { findStreetsInText, normalize } from "./streets";

/** Lieu et parcours par défaut, plausibles pour chaque type d'événement. */
const DEFAULT_LOCATION: Partial<Record<EventKind, string>> = {
  tsunami: "Le Pâquier", inondation: "Jardins de l'Europe", feu_artifice: "Lac d'Annecy", pique_nique: "Le Pâquier",
  concert: "Le Pâquier", festival: "Bonlieu", marche: "Vieille ville", brocante: "Vieille ville", ovni: "Le Pâquier",
  manifestation: "Gare d'Annecy", incendie: "Vieille ville", meteorite: "Le Pâquier", marathon: "Le Pâquier", greve: "Gare d'Annecy",
};
export const DEFAULT_ROUTE: Partial<Record<EventKind, string[]>> = {
  manifestation: ["Gare d'Annecy", "Bonlieu", "Hôtel de Ville"],
  marathon: ["Le Pâquier", "L'Impérial", "Les Marquisats", "Le Pâquier"],
};

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
  return {
    kind, location, streets: spec.needs === "streets" ? streets : [], route: spec.needs === "route" ? DEFAULT_ROUTE[kind] ?? [] : [],
    dayOffset, startTime, durationMinutes: spec.duration, days: Math.min(days, 60), intensity,
    title: `${spec.label} — ${where}`,
    description: spec.about,
    question: `${spec.icon} ${spec.label} : ${where}${days > 1 ? ` pendant ${days} jours` : ""}. On lance ?`,
    note: spec.needs === "streets" && !streets.length ? "Aucune rue reconnue : précise le nom exact." : "Interprété par mots-clés (Claude Code indisponible).",
    source: "local",
  };
}
