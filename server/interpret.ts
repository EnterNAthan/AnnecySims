// Endpoints IA : interprétation des commandes, réactions des groupes d'habitants, analyse d'impact.
// Claude est appelé via Claude Code (`claude -p`) ; sans lui, on retombe sur des règles.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { EVENT_KINDS, EVENT_SPECS, type EventProposal } from "../src/shared/catalog";
import { LOCATIONS } from "../src/shared/locations";
import { DEFAULT_ROUTE, interpretLocally } from "../src/shared/localInterpreter";
import { matchStreet, streetNames } from "../src/shared/streets";
import { localAnalysis, localCohortResponses, type Analysis, type CohortResponse, type CohortStat, type EventSummary, type Kpis } from "../src/shared/advisors";
import { askClaude } from "./claudeCode";
import type { City } from "../src/shared/city";

const LOCATION_NAMES = LOCATIONS.map((l) => l.name);
let streets: string[] | null = null;
const allStreets = () => (streets ??= streetNames(JSON.parse(readFileSync("public/city.json", "utf8")) as City));

// ---------- Interprétation d'une commande ----------

function proposalSchema(extreme: boolean) {
  const kinds = EVENT_KINDS.filter((k) => extreme || !EVENT_SPECS[k].extreme) as unknown as [string, ...string[]];
  return z.object({
    understood: z.boolean().describe("false si la demande n'a rien à voir avec un événement dans la ville"),
    kind: z.enum(kinds),
    location: z.enum(LOCATION_NAMES as [string, ...string[]]).describe("lieu principal"),
    streets: z.array(z.string()).describe("noms exacts des rues concernées, pris dans la liste fournie ; vide si sans objet"),
    route: z.array(z.string()).describe("étapes du parcours (lieux ou rues de la liste) pour une manifestation ou une course ; vide sinon"),
    dayOffset: z.number().int().min(0).max(14).describe("0 = aujourd'hui, 1 = demain…"),
    startTime: z.string().describe("heure de début HH:MM, ou chaîne vide pour tout de suite"),
    durationMinutes: z.number().int().min(10).max(1440).describe("durée chaque jour"),
    days: z.number().int().min(1).max(60).describe("nombre de jours consécutifs"),
    intensity: z.number().int().min(1).max(3),
    title: z.string().describe("titre court et factuel, comme une alerte municipale"),
    description: z.string().describe("une ou deux phrases concrètes sur ce qui va se passer et pour qui"),
    question: z.string().describe("question de confirmation au joueur, tutoiement, commence par l'emoji de l'événement"),
    note: z.string().describe("si la demande a été rapprochée d'une action voisine ou comporte une ambiguïté : explication courte ; sinon vide"),
  });
}

function interpretSystem(extreme: boolean) {
  const kinds = EVENT_KINDS.filter((k) => extreme || !EVENT_SPECS[k].extreme);
  return `Tu es le service des opérations de la ville d'Annecy dans une simulation urbaine réaliste. Le joueur (le maire ou un agent municipal) décrit en français, parfois familièrement, une décision ou une situation. Tu la traduis en UN événement précis du catalogue.

Exigences :
- Sois factuel et réaliste, comme un arrêté municipal ou une alerte trafic. Pas d'emphase.
- Fermeture, travaux, piétonnisation, accident : remplis "streets" avec les noms EXACTS de la liste des rues ci-dessous (une désignation partielle comme « avenue de Genève » ou « rue royale » doit devenir le nom exact). Si une rue est introuvable, dis-le dans "note".
- Manifestation, course : remplis "route" avec 2 à 5 étapes (lieux ou rues de la liste) formant un parcours plausible. Par défaut, une manifestation part de la Gare d'Annecy vers l'Hôtel de Ville ; une course fait le tour des quais du Pâquier aux Marquisats.
- Interprète les durées (« 2 semaines » = 14 jours, « ce week-end » = 2 jours) et l'heure (relative à l'heure actuelle donnée). Des travaux ont lieu en journée (07:30, environ 10 h par jour) ; une fermeture administrative dure toute la journée (startTime vide, 1440 min).
- Si la demande ne correspond pas exactement au catalogue, choisis l'action la plus proche et explique-le dans "note".

Catalogue :
${kinds.map((k) => `- ${k} (${EVENT_SPECS[k].icon} ${EVENT_SPECS[k].label}, ${EVENT_SPECS[k].duration} min par défaut, début ${EVENT_SPECS[k].defaultStart || "immédiat"}) : ${EVENT_SPECS[k].about}`).join("\n")}

Lieux : ${LOCATION_NAMES.join(", ")}.

Rues d'Annecy (noms OpenStreetMap, des plus longues aux plus courtes) :
${allStreets().slice(0, 450).join(" | ")}`;
}

/** Ramène rues et étapes aux noms connus ; signale ce qui n'a pas été trouvé. */
function resolveNames(p: EventProposal): EventProposal {
  const names = allStreets();
  const missing: string[] = [];
  const streetsOut = [...new Set(p.streets.map((s) => matchStreet(s, names) ?? (missing.push(s), "")).filter(Boolean))];
  const route = p.route
    .map((s) => (LOCATION_NAMES.includes(s) ? s : matchStreet(s, names) ?? (missing.push(s), "")))
    .filter(Boolean);
  const spec = EVENT_SPECS[p.kind];
  const note = [p.note, missing.length ? `Introuvable sur la carte : ${missing.join(", ")}.` : ""].filter(Boolean).join(" ");
  return {
    ...p,
    streets: spec.needs === "streets" ? streetsOut : [],
    route: spec.needs === "route" ? (route.length >= 2 ? route : DEFAULT_ROUTE[p.kind] ?? []) : [],
    note,
  };
}

export async function interpret(text: string, context: { time: string; weather: string }, extreme: boolean): Promise<EventProposal | { error: string }> {
  try {
    const out = await askClaude(interpretSystem(extreme), `Heure actuelle : ${context.time}. Météo : ${context.weather}.\nDemande : « ${text} »`, proposalSchema(extreme));
    if (!out.understood) return { error: out.note || "Ça ne ressemble pas à un événement pour la ville." };
    const { understood: _, ...p } = out;
    return resolveNames({ ...(p as Omit<EventProposal, "source">), intensity: p.intensity as 1 | 2 | 3, source: "claude" });
  } catch (err) {
    console.warn("[interpret] Claude Code indisponible :", (err as Error).message);
    const local = interpretLocally(text, allStreets(), extreme);
    return local ?? { error: "Je n'ai pas reconnu la demande. Exemple : « ferme l'avenue de Genève pour travaux pendant 2 semaines »." };
  }
}

// ---------- Réactions des groupes d'habitants ----------

const CohortSchema = z.object({
  responses: z.array(
    z.object({
      id: z.string(),
      departShift: z.number().int().min(-90).max(90),
      car: z.number().min(-1).max(1),
      bike: z.number().min(-1).max(1),
      walk: z.number().min(-1).max(1),
      avoidZone: z.boolean(),
      cancelLeisure: z.number().min(0).max(1),
      joinEvent: z.number().min(0).max(1),
      mood: z.number().int().min(-2).max(2),
      quote: z.string().describe("une phrase de 25 mots maximum, à la première personne, naturelle, qui cite un lieu ou une heure concrète quand c'est pertinent"),
    }),
  ),
});

const COHORT_SYSTEM = `Tu modélises la réaction réaliste de groupes d'habitants d'Annecy face à un événement urbain, pour une simulation. Chaque groupe (profil × quartier) est décrit par des chiffres mesurés : taille, part directement concernée, modes de transport, retard subi, satisfaction, destinations habituelles.

Pour CHAQUE groupe fourni, décide d'ajustements de comportement plausibles et proportionnés :
- departShift : décaler les départs (minutes, négatif = plus tôt) si les trajets sont rallongés ;
- car / bike / walk : préférence de -1 à +1 (report modal réaliste : le vélo ne concerne que des distances courtes, les retraités marchent peu loin, les frontaliers dépendent de la voiture ou du train) ;
- avoidZone : éviter la zone (commerçants exceptés s'ils y travaillent) ;
- cancelLeisure : renoncer à une partie des loisirs ;
- joinEvent : part du groupe qui participe (manifestation, marché, fête…) ;
- mood et quote : l'humeur et une phrase naturelle, à la première personne, spécifique au groupe et ancrée dans les chiffres.
Un groupe peu concerné garde des ajustements proches de zéro. Reste sobre et crédible.
Pour une manifestation, la participation dépend du motif : quelques pourcents pour la plupart des groupes, davantage pour les plus concernés (étudiants, salariés d'un secteur en grève).`;

export async function cohortResponses(ev: EventSummary, cohorts: CohortStat[]): Promise<{ responses: CohortResponse[]; source: "claude" | "local" }> {
  try {
    const out = await askClaude(COHORT_SYSTEM, JSON.stringify({ evenement: ev, groupes: cohorts }), CohortSchema);
    const ids = new Set(cohorts.map((c) => c.id));
    const responses = out.responses.filter((r) => ids.has(r.id));
    if (!responses.length) throw new Error("aucune réponse exploitable");
    return { responses, source: "claude" };
  } catch (err) {
    console.warn("[cohortes] repli sur les règles :", (err as Error).message);
    return { responses: localCohortResponses(ev, cohorts), source: "local" };
  }
}

// ---------- Analyse d'impact ----------

const AnalysisSchema = z.object({
  headline: z.string().describe("titre factuel de 12 mots maximum avec le chiffre clé"),
  summary: z.string().describe("2 ou 3 phrases, 60 mots maximum, chiffrées"),
  winners: z.array(z.string()).max(3).describe("au plus 3 groupes gagnants, 2 à 6 mots chacun, sans chiffres"),
  losers: z.array(z.string()).max(3).describe("au plus 3 groupes perdants, 2 à 6 mots chacun, sans chiffres"),
  recommendation: z.string().describe("une mesure concrète et réaliste que la mairie pourrait prendre, 35 mots maximum"),
});

const ANALYSIS_SYSTEM = `Tu es l'analyste mobilité et économie de la ville d'Annecy. À partir d'indicateurs mesurés avant et pendant un événement, et des réactions des groupes d'habitants, rédige une note d'impact courte, factuelle et chiffrée, en français, comme pour un élu. N'invente aucun chiffre : utilise uniquement ceux fournis.`;

export async function analyze(ev: EventSummary, before: Kpis, after: Kpis, cohorts: CohortStat[], responses: CohortResponse[]): Promise<Analysis> {
  try {
    const out = await askClaude(ANALYSIS_SYSTEM, JSON.stringify({ evenement: ev, avant: before, pendant: after, groupes: cohorts, reactions: responses }), AnalysisSchema);
    return { ...out, source: "claude" };
  } catch (err) {
    console.warn("[analyse] repli sur les règles :", (err as Error).message);
    return localAnalysis(ev, before, after, cohorts, responses);
  }
}
