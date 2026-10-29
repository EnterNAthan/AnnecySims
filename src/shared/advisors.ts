// Porte-parole des groupes d'habitants et analyse d'impact.
// Claude raisonne sur une vingtaine de groupes (profil × quartier) au lieu de milliers d'individus :
// il reçoit ce que chaque groupe vit réellement et renvoie des ajustements de comportement,
// que le moteur applique à tous les membres du groupe avec de la variabilité individuelle.
import { EVENT_SPECS, type EventKind, type EventTraits } from "./catalog";

/** Ce qu'un groupe vit pendant l'événement (mesuré par la simulation). */
export interface CohortStat {
  id: string;
  /** « Frontaliers · Courier – Gare » */
  label: string;
  profile: string;
  district: string;
  /** nombre de personnes réelles représentées */
  people: number;
  /** part du groupe directement concernée (domicile, trajet ou destination dans la zone) */
  affectedShare: number;
  carShare: number;
  bikeShare: number;
  walkShare: number;
  /** minutes de trajet par jour, moyenne */
  travelMinutes: number;
  /** retard moyen en voiture sur la dernière heure, en minutes */
  delayMinutes: number;
  satisfaction: number;
  /** destinations les plus fréquentes du groupe */
  destinations: string[];
}

/** Réaction décidée pour un groupe, appliquée à ses membres. */
export interface CohortResponse {
  id: string;
  /** décalage des départs du domicile, en minutes (négatif = plus tôt) */
  departShift: number;
  /** préférence pour chaque mode, de -1 (l'éviter) à +1 (le privilégier) */
  car: number;
  bike: number;
  walk: number;
  /** évite la zone de l'événement (se rabat sur d'autres lieux) */
  avoidZone: boolean;
  /** part des loisirs et courses annulés, 0..1 */
  cancelLeisure: number;
  /** part du groupe qui se rend à l'événement, 0..1 */
  joinEvent: number;
  /** humeur, de -2 (furieux) à +2 (ravi) */
  mood: number;
  /** ce que dirait un membre typique du groupe, à la première personne */
  quote: string;
}

export interface EventSummary {
  kind: EventKind;
  title: string;
  description: string;
  location: string;
  streets: string[];
  route: string[];
  days: number;
  when: string;
  /** comportement résolu : nature, fréquentation, prix, décor, public, navettes… */
  traits?: EventTraits;
}

/** Indicateurs de la ville sur une fenêtre glissante d'une heure. */
export interface Kpis {
  /** retard moyen des trajets en voiture / temps à vide */
  congestion: number;
  /** temps moyen d'un trajet, en minutes */
  tripMinutes: number;
  carShare: number;
  bikeShare: number;
  walkShare: number;
  /** part des trajets en bus */
  busShare: number;
  /** occupation moyenne des parkings proches de la zone (0..1), -1 sans parking */
  parking: number;
  /** chiffre d'affaires par heure dans la zone de l'événement, en € */
  zoneRevenue: number;
  /** personnes présentes dans la zone */
  zonePeople: number;
  satisfaction: number;
}

export interface Analysis {
  headline: string;
  summary: string;
  winners: string[];
  losers: string[];
  recommendation: string;
  source: "claude" | "local";
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const pct = (v: number) => `${Math.round(v * 100)} %`;

/** Réactions à règles, utilisées sans Claude : déduites des mêmes chiffres. */
export function localCohortResponses(ev: EventSummary, cohorts: CohortStat[]): CohortResponse[] {
  const spec = { ...EVENT_SPECS[ev.kind], ...(ev.traits ? { attraction: ev.traits.attraction, closesRoads: ev.traits.closesRoads, icon: ev.traits.icon } : {}) };
  return cohorts.map((c) => {
    const hit = c.affectedShare;
    const roads = spec.closesRoads && ev.kind !== "manifestation" && ev.kind !== "marathon";
    const drivers = c.carShare > 0.5;
    const r: CohortResponse = {
      id: c.id, departShift: 0, car: 0, bike: 0, walk: 0, avoidZone: false, cancelLeisure: 0, joinEvent: 0, mood: 0,
      quote: "Pas de changement pour moi.",
    };
    if (roads && hit > 0.1) {
      r.car = -clamp(hit * 1.5, 0, 0.8);
      r.bike = c.bikeShare > 0.1 ? 0.4 : 0.15;
      r.walk = 0.2;
      r.departShift = drivers ? -Math.round(clamp(c.delayMinutes + hit * 30, 5, 40)) : 0;
      r.mood = drivers ? -1 - (hit > 0.4 ? 1 : 0) : 0;
      r.quote = drivers
        ? `Avec ${ev.streets[0] ?? "la rue"} fermée, je pars ${-r.departShift} minutes plus tôt pour ne pas être en retard.`
        : "Je passe à vélo, ça ne change pas grand-chose pour moi.";
    }
    if (ev.kind === "pietonnisation") {
      r.walk = 0.5;
      r.mood = drivers ? -1 : 1;
      r.quote = drivers ? "Encore une rue interdite aux voitures, il va falloir se garer plus loin." : "Enfin une rue où l'on peut flâner tranquillement !";
    }
    if (ev.kind === "greve" && c.profile === "frontalier") {
      r.mood = -2;
      r.car = 0.6;
      r.departShift = -20;
      r.quote = "Sans Léman Express, je covoiture avec un collègue… ou je télétravaille.";
    }
    if (ev.kind === "manifestation") {
      r.joinEvent = c.profile === "etudiant" ? 0.25 : c.profile === "salarie" ? 0.08 : c.profile === "retraite" ? 0.05 : 0;
      r.avoidZone = c.profile === "commercant" || c.profile === "touriste";
      r.mood = r.joinEvent > 0.1 ? 1 : c.profile === "commercant" ? -1 : 0;
      r.quote = r.joinEvent > 0.1 ? "On sera nombreux au départ de la gare !" : c.profile === "commercant" ? "Journée de manif, je n'aurai pas un client." : "J'éviterai le centre cet après-midi.";
    }
    if (ev.kind === "marathon") {
      r.joinEvent = c.profile === "retraite" || c.profile === "enfant" ? 0.12 : 0.05;
      r.car = hit > 0.1 ? -0.4 : 0;
      r.quote = drivers && hit > 0.1 ? "Les quais sont fermés toute la matinée, je fais le tour." : "On ira encourager les coureurs au bord du lac.";
    }
    if (spec.weather === "pluie" || spec.weather === "neige" || ev.kind === "tempete") {
      r.cancelLeisure = 0.6;
      r.bike = -0.6;
      r.walk = -0.3;
      r.car = 0.3;
      r.mood = -1;
      r.quote = "Avec ce temps, je reste au sec et je prends la voiture.";
    }
    if (spec.attraction > 0 && !["manifestation", "marathon"].includes(ev.kind)) {
      r.joinEvent = clamp(spec.attraction * (c.profile === "etudiant" || c.profile === "touriste" ? 1.6 : 1), 0, 0.6);
      // les riverains d'un grand événement apprécient moins le bruit et le stationnement
      r.mood = hit > 0.5 && (ev.traits?.attendance ?? 0) > 5000 ? -1 : 1;
      r.quote = r.mood < 0 ? `${spec.icon} Encore du monde et du bruit en bas de chez moi ce soir.` : `${spec.icon} On y va, ça a l'air sympa !`;
    }
    return r;
  });
}

export function localAnalysis(ev: EventSummary, before: Kpis, after: Kpis, cohorts: CohortStat[], responses: CohortResponse[]): Analysis {
  const dCong = after.congestion - before.congestion;
  const dRev = before.zoneRevenue > 0 ? after.zoneRevenue / before.zoneRevenue - 1 : 0;
  const byMood = responses.map((r) => ({ r, c: cohorts.find((c) => c.id === r.id)! })).filter((x) => x.c);
  const winners = byMood.filter((x) => x.r.mood > 0).sort((a, b) => b.c.people - a.c.people).slice(0, 3).map((x) => x.c.label);
  const losers = byMood.filter((x) => x.r.mood < 0).sort((a, b) => b.c.people - a.c.people).slice(0, 3).map((x) => x.c.label);
  return {
    headline: `${EVENT_SPECS[ev.kind].icon} ${ev.title} : congestion ${dCong >= 0 ? "+" : ""}${Math.round(dCong * 100)} pts`,
    summary:
      `La part de la voiture passe de ${pct(before.carShare)} à ${pct(after.carShare)}, le vélo de ${pct(before.bikeShare)} à ${pct(after.bikeShare)}. ` +
      `Le temps moyen d'un trajet évolue de ${before.tripMinutes.toFixed(1)} à ${after.tripMinutes.toFixed(1)} min` +
      (before.zoneRevenue > 0 ? ` et le chiffre d'affaires de la zone de ${dRev >= 0 ? "+" : ""}${Math.round(dRev * 100)} %.` : "."),
    winners, losers,
    recommendation: dCong > 0.15 ? "Communiquer un itinéraire de déviation et décaler les livraisons aux heures creuses." : "L'impact reste contenu ; le dispositif peut être maintenu.",
    source: "local",
  };
}
