// Endpoints IA : interprétation des commandes, réactions des groupes d'habitants, analyse d'impact.
// Claude est appelé via Claude Code (`claude -p`) ; sans lui, on retombe sur des règles.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { EFFECTS, EVENT_KINDS, EVENT_SPECS, MOTIONS, NATURES, PLACEMENTS, PROPS, PROP_LABEL, SHAPES, type EventProposal } from "../src/shared/catalog";
import { assetCatalog, findAsset } from "./assets";
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
    attendance: z.number().int().min(0).max(200000).describe("fréquentation attendue PAR JOUR (personnes réelles) ; 0 si ce n'est pas un rassemblement"),
    ticketPrice: z.number().min(0).max(500).describe("prix d'entrée en €, 0 si gratuit"),
    setup: z.array(z.enum(PROPS)).describe("décor 3D installé sur place"),
    audience: z.enum(["tous", "jeunes", "familles", "seniors"]),
    shuttles: z.boolean().describe("navettes gratuites depuis la gare et les parkings relais"),
    icon: z.string().describe("un emoji qui représente l'événement"),
    label: z.string().describe("nom générique court du type d'événement (« Festival de musique », « Tournoi de beach-volley »…)"),
    nature: z.enum(NATURES),
    danger: z.boolean().describe("true seulement si les gens doivent fuir (sinistre)"),
    closesRoads: z.boolean().describe("des rues sont fermées aux voitures (rues listées, parcours, ou abords du site)"),
    mood: z.number().int().min(-2).max(2).describe("effet sur l'humeur des riverains : -2 nuisance forte … +2 très apprécié"),
    model: z
      .object({
        parts: z.array(z.object({
          shape: z.enum(SHAPES),
          x: z.number(), y: z.number(), z: z.number(),
          sx: z.number().min(0.1).max(300), sy: z.number().min(0.1).max(300), sz: z.number().min(0.1).max(300),
          rx: z.number(), ry: z.number(), rz: z.number(),
          color: z.string().describe("#rrggbb"),
          glow: z.number().min(0).max(1),
        })).max(40),
        motion: z.enum(MOTIONS),
        altitude: z.number().min(0).max(400),
        orbit: z.number().min(0).max(800),
        effects: z.array(z.enum(EFFECTS)),
      })
      .nullable()
      .describe("modèle 3D en primitives, SEULEMENT si aucun modèle de la banque ne représente la chose principale ; null sinon"),
    assets: z.array(z.object({
      id: z.string().describe("identifiant exact pack/nom pris dans la banque de modèles"),
      count: z.number().int().min(1).max(30),
      size: z.number().min(0.2).max(400).describe("plus grande dimension en mètres, à l'échelle réelle"),
      placement: z.enum(PLACEMENTS),
      motion: z.enum(MOTIONS),
      altitude: z.number().min(0).max(400),
    })).max(10).describe("objets de la banque à montrer sur place pour rendre la scène lisible"),
  });
}

function interpretSystem(extreme: boolean) {
  const kinds = EVENT_KINDS.filter((k) => extreme || !EVENT_SPECS[k].extreme);
  const fantasy = extreme
    ? "Les scénarios extrêmes sont ACTIVÉS : les demandes fantastiques ou catastrophiques (créatures, phénomènes surnaturels, catastrophes) sont acceptées ; traite-les avec le même sérieux, comme si c'était réel."
    : "Les scénarios extrêmes sont DÉSACTIVÉS : si la demande est fantastique ou catastrophique (créature, phénomène surnaturel, catastrophe majeure), réponds understood=false et explique dans note qu'il faut activer l'interrupteur « Scénarios extrêmes ».";
  return `${fantasy}

Tu es le service des opérations de la ville d'Annecy dans une simulation urbaine réaliste. Le joueur (le maire ou un agent municipal) décrit en français, parfois familièrement, une décision ou une situation. Tu la traduis en UN événement précis du catalogue.

Exigences :
- Sois factuel et réaliste, comme un arrêté municipal ou une alerte trafic. Pas d'emphase.
- Fermeture, travaux, piétonnisation, accident : remplis "streets" avec les noms EXACTS de la liste des rues ci-dessous (une désignation partielle comme « avenue de Genève » ou « rue royale » doit devenir le nom exact). Si une rue est introuvable, dis-le dans "note".
- Manifestation, course : remplis "route" avec 2 à 5 étapes (lieux ou rues de la liste) formant un parcours plausible. Par défaut, une manifestation part de la Gare d'Annecy vers l'Hôtel de Ville ; une course fait le tour des quais du Pâquier aux Marquisats.
- Interprète les durées (« 2 semaines » = 14 jours, « ce week-end » = 2 jours) et l'heure (relative à l'heure actuelle donnée). Des travaux ont lieu en journée (07:30, environ 10 h par jour) ; une fermeture administrative dure toute la journée (startTime vide, 1440 min).
- Tout événement est possible. Si aucun type du catalogue ne convient vraiment, utilise "evenement" et décris-le avec ses caractéristiques (icon, label, nature, attendance, setup, closesRoads, route ou streets…). Ne force jamais une demande festive vers un type de sinistre : un festival, une fête, un salon sont des événements positifs.
- Donne des chiffres réalistes pour Annecy : un grand festival de musique (type Musilac) attire 20 000 à 40 000 personnes par jour avec billet autour de 50-70 € ; une fête foraine quelques milliers ; un marché de Noël 3 000 à 8 000 ; un cinéma en plein air 1 000 à 3 000. Respecte les chiffres donnés par le joueur.
- Décor : choisis les éléments cohérents (scène et écrans pour un concert, chalets pour un marché de Noël, tribunes et arche pour du sport…). Éléments possibles : ${PROPS.map((p) => `${p} (${PROP_LABEL[p]})`).join(", ")}.
- Visualisation (assets) : rends TOUT événement visible avec 1 à 8 objets de la banque de modèles ci-dessous, à leur taille réelle : par exemple un accident = 2 voitures, débris, cônes, voiture de police, ambulance ; un incendie = camion de pompiers, ambulance ; une ferme pédagogique = vaches, chevaux, clôtures ; un salon nautique = bateaux sur le lac. Placement : centre (la chose principale), cercle (autour), ligne (alignés le long du lieu), disperse (éparpillés), ciel (en vol, avec altitude), lac (sur l'eau). Mouvement : fixe, flotte, tourne, orbite (vole en rond au-dessus), pulse.
- Modèle 3D (model) : SEULEMENT si la chose principale n'existe pas dans la banque : pour toute chose physique qui n'a pas de décor prévu (un dragon, un canard géant, une montgolfière, un vaisseau…), compose-la avec 8 à 40 primitives à l'échelle réelle en mètres (y = hauteur depuis le sol du modèle, l'avant vers +z), couleurs réalistes, glow pour ce qui brille (yeux, feu, lumières). Choisis le mouvement (orbite pour ce qui vole autour de la zone, flotte pour ce qui plane ou flotte sur l'eau, tourne, pulse, fixe), l'altitude, le rayon d'orbite et les effets (feu, fumee, lumiere, etincelles). Sinon null.
- Une chose dangereuse (créature hostile, sinistre) : danger=true, nature "danger", les rues de la zone fermées ; une curiosité inoffensive attire au contraire les badauds (attendance > 0).
- mood : un grand événement nocturne et bruyant gêne les riverains (-1), une fête de quartier familiale est appréciée (+1).
- Si la demande ne correspond pas exactement au catalogue, choisis l'action la plus proche et explique-le dans "note".

Catalogue :
${kinds.map((k) => `- ${k} (${EVENT_SPECS[k].icon} ${EVENT_SPECS[k].label}, ${EVENT_SPECS[k].duration} min par défaut, début ${EVENT_SPECS[k].defaultStart || "immédiat"}) : ${EVENT_SPECS[k].about}`).join("\n")}

Lieux : ${LOCATION_NAMES.join(", ")}.

Banque de modèles 3D (identifiant = pack/nom) :
${assetCatalog()}

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
  // objets de la banque : identifiant exact, sinon le plus proche par mots-clés
  const assets = (p.assets ?? []).map((a) => ({ ...a, query: a.query ?? a.id, id: findAsset(a.id)?.id ?? "" }));
  return {
    ...p,
    assets,
    // les rues servent aussi aux abords fermés d'un rassemblement ; un parcours peut accompagner un événement libre
    streets: streetsOut,
    route: route.length >= 2 ? route : spec.needs === "route" ? DEFAULT_ROUTE[p.kind] ?? [] : [],
    note,
  };
}

// Cache disque des interprétations de Claude : une demande déjà vue (suggestions, démo) répond instantanément.
const CACHE_FILE = "data/interpret-cache.json";
/** proposition, et heure de la simulation (minutes) au moment où Claude l'a interprétée */
type Cached = { p: EventProposal; at: number };
let cache: Record<string, Cached> | null = null;
const loadCache = () => (cache ??= existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {});
const cacheKey = (text: string, extreme: boolean) => `${extreme ? "x" : "n"}:${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
/** interprétations en cours : une même demande n'appelle Claude qu'une fois */
const inflight = new Map<string, Promise<EventProposal | { error: string }>>();

/** Une heure de début déjà passée garde le même délai qu'à l'interprétation (« dans une heure »). */
function replay({ p, at }: Cached, time: string): EventProposal {
  const now = minutes(time), start = minutes(p.startTime);
  if (now === null || start === null || p.dayOffset > 0 || start > now) return { ...p, cached: true };
  const shifted = Math.min(23 * 60 + 50, now + Math.max(0, start - at));
  return { ...p, startTime: hhmm(shifted), cached: true };
}

export function interpret(text: string, context: { time: string; weather: string }, extreme: boolean): Promise<EventProposal | { error: string }> {
  const key = cacheKey(text, extreme);
  const hit = loadCache()[key];
  if (hit?.p) return Promise.resolve(replay(hit, context.time));
  let job = inflight.get(key);
  if (!job) {
    job = interpretWithClaude(text, context, extreme).then((out) => {
      if (!("error" in out) && out.source === "claude") {
        loadCache()[key] = { p: out, at: minutes(context.time) ?? 0 };
        try {
          writeFileSync(CACHE_FILE, JSON.stringify(cache));
        } catch {
          /* cache facultatif */
        }
      }
      return out;
    }).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

/** Préchauffe le cache avec les suggestions, une à la fois pour laisser la place aux demandes du joueur. */
let warming = Promise.resolve();
export function warm(texts: string[], context: { time: string; weather: string }, extreme: boolean) {
  const todo = texts.filter((t) => !loadCache()[cacheKey(t, extreme)]);
  for (const t of todo) warming = warming.then(() => interpret(t, context, extreme)).then(() => {}, () => {});
  return Promise.resolve({ queued: todo.length });
}

async function interpretWithClaude(text: string, context: { time: string; weather: string }, extreme: boolean): Promise<EventProposal | { error: string }> {
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

// ---------- Bilan d'un événement terminé ----------

const BilanSchema = z.object({
  verdict: z.enum(["réussite", "mitigé", "à revoir"]),
  headline: z.string().describe("titre factuel de 12 mots maximum avec le chiffre clé"),
  summary: z.string().describe("3 phrases maximum, 70 mots maximum, chiffrées"),
  positives: z.array(z.string()).max(3).describe("points positifs, 8 mots maximum chacun"),
  negatives: z.array(z.string()).max(3).describe("points négatifs, 8 mots maximum chacun"),
  recommendation: z.string().describe("ce qu'il faudrait changer pour la prochaine édition, 35 mots maximum"),
});
export type FinalReport = z.infer<typeof BilanSchema> & { source: "claude" | "local" };

const BILAN_SYSTEM = `Tu es le service événementiel de la ville d'Annecy. À partir du bilan mesuré d'un événement (fréquentation, billetterie, dépenses sur place, chiffre d'affaires des commerces voisins comparé à un jour normal, déplacements en voiture des visiteurs, CO₂, plaintes de riverains), rédige un bilan court, honnête et chiffré pour le maire. N'invente aucun chiffre.`;

export async function finalReport(ev: EventSummary, bilan: Record<string, number>): Promise<FinalReport> {
  try {
    const out = await askClaude(BILAN_SYSTEM, JSON.stringify({ evenement: ev, bilan }), BilanSchema);
    return { ...out, source: "claude" };
  } catch (err) {
    console.warn("[bilan] repli sur les règles :", (err as Error).message);
    const money = bilan.ticketRevenue + bilan.onsiteSpend;
    const shops = bilan.zoneRevenue - bilan.zoneRevenueBefore;
    return {
      verdict: bilan.complaints > bilan.attendees * 0.05 ? "mitigé" : "réussite",
      headline: `${ev.title} : ${Math.round(bilan.attendees).toLocaleString("fr-FR")} personnes`,
      summary: `${Math.round(bilan.outsiders).toLocaleString("fr-FR")} visiteurs extérieurs, ${Math.round(money).toLocaleString("fr-FR")} € de billetterie et de dépenses sur place, commerces voisins ${shops >= 0 ? "+" : ""}${Math.round(shops).toLocaleString("fr-FR")} €. ${Math.round(bilan.visitorCarKm).toLocaleString("fr-FR")} km parcourus en voiture par les visiteurs (${bilan.co2Tonnes} t de CO₂).`,
      positives: [`pic à ${Math.round(bilan.peak).toLocaleString("fr-FR")} personnes`],
      negatives: bilan.complaints ? [`${bilan.complaints} plaintes de riverains`] : [],
      recommendation: bilan.visitorCarTrips > bilan.outsiders * 0.5 ? "Mettre en place des navettes depuis la gare et les parkings relais." : "Reconduire le dispositif.",
      source: "local",
    };
  }
}
