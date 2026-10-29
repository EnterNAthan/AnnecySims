// Interprète de secours, sans IA : mots-clés → action la plus proche du catalogue.
// Utilisé quand aucune clé Claude n'est configurée ou si l'appel échoue.
import { EVENT_KINDS, EVENT_SPECS, type EventKind, type EventProposal } from "./catalog";
import { findLocation } from "./locations";

const strip = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Lieu par défaut, plausible pour chaque type d'événement. */
const DEFAULT_LOCATION: Partial<Record<EventKind, string>> = {
  tsunami: "Le Pâquier", inondation: "Jardins de l'Europe", feu_artifice: "Lac d'Annecy", pique_nique: "Le Pâquier",
  concert: "Le Pâquier", festival: "Bonlieu", marche: "Vieille ville", brocante: "Vieille ville", ovni: "Le Pâquier",
  manifestation: "Hôtel de Ville", incendie: "Vieille ville", meteorite: "Le Pâquier",
};

export function interpretLocally(text: string): EventProposal | null {
  const t = ` ${strip(text)} `;
  // le mot-clé le plus long gagne (« feu d'artifice » plutôt que « feu »)
  let kind: EventKind | null = null, bestLen = 0;
  for (const k of EVENT_KINDS) {
    for (const kw of EVENT_SPECS[k].keywords) {
      if (kw.length > bestLen && t.includes(kw)) {
        kind = k;
        bestLen = kw.length;
      }
    }
  }
  if (!kind) return null;
  const spec = EVENT_SPECS[kind];
  let loc = findLocation(text)?.name ?? DEFAULT_LOCATION[kind] ?? "Centre-ville";
  if ((kind === "tsunami" || kind === "inondation") && loc === "Lac d'Annecy") loc = DEFAULT_LOCATION[kind]!;
  const intensity = /enorme|geant|gigantesque|apocalyp|extreme|massi|violent/.test(t) ? 3 : /petit|leger|mini/.test(t) ? 1 : 2;
  const later = t.match(/dans (\d+) ?(min|h)/);
  const startIn = later ? Number(later[1]) * (later[2] === "h" ? 60 : 1) : /ce soir/.test(t) ? 120 : 0;
  return {
    kind, location: loc, startIn, durationMinutes: spec.duration, intensity,
    title: `${spec.label} — ${loc}`,
    description: spec.about,
    question: `${spec.icon} ${spec.label} sur ${loc}${startIn ? ` dans ${startIn} min` : " maintenant"}. On y va ?`,
    note: "Interprété par mots-clés (pas de clé Claude configurée).",
    source: "local",
  };
}
