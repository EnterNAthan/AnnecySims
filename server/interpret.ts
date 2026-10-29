// Interprétation d'une commande en langage naturel par Claude : choisit l'événement du catalogue
// le plus proche de la demande et rédige la question de confirmation.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { EVENT_KINDS, EVENT_SPECS, type EventProposal } from "../src/shared/catalog";
import { LOCATIONS } from "../src/shared/locations";
import { interpretLocally } from "../src/shared/localInterpreter";

const MODEL = "claude-opus-5-5";

const LOCATION_NAMES = LOCATIONS.map((l) => l.name) as [string, ...string[]];

const ProposalSchema = z.object({
  understood: z.boolean().describe("false si la demande n'a aucun rapport avec un événement dans la ville"),
  kind: z.enum(EVENT_KINDS),
  location: z.enum(LOCATION_NAMES),
  startIn: z.number().int().describe("minutes avant le début, 0 = tout de suite"),
  durationMinutes: z.number().int(),
  intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().describe("titre court, en français, comme une manchette"),
  description: z.string().describe("une ou deux phrases vivantes qui décrivent ce qui va se passer"),
  question: z.string().describe("question de confirmation au joueur, tutoiement, commence par l'emoji de l'événement"),
  note: z.string().describe("si la demande ne correspond pas exactement au catalogue : quelle action voisine tu as choisie et pourquoi ; sinon chaîne vide"),
});

// Prompt système stable (catalogue + lieux) : mis en cache d'une requête à l'autre.
const SYSTEM = `Tu es le maître du jeu d'une simulation de la ville d'Annecy (Haute-Savoie). Le joueur te décrit en français, souvent de façon familière ou avec des fautes, quelque chose qu'il veut voir arriver dans la ville. Tu traduis sa demande en UN événement du catalogue ci-dessous.

Si la demande ne correspond à aucune entrée exactement, choisis l'action la plus proche et explique ton choix dans "note" (par exemple « un dragon » → incendie, « des zombies » → manifestation). Ne mets understood = false que si la demande n'a vraiment rien à voir avec un événement (par exemple une question sans rapport).

Choisis le lieu cité par le joueur ; s'il n'en cite pas, prends le plus spectaculaire ou le plus logique pour l'événement (un tsunami arrive par le lac sur le Pâquier, un feu d'artifice se tire au-dessus du lac, un marché se tient dans la vieille ville). L'intensité vaut 3 si le joueur demande quelque chose d'énorme, 1 si c'est petit. La durée par défaut est indiquée pour chaque événement ; adapte-la si le joueur en précise une.

Catalogue :
${EVENT_KINDS.map((k) => `- ${k} (${EVENT_SPECS[k].icon} ${EVENT_SPECS[k].label}, ${EVENT_SPECS[k].duration} min par défaut) : ${EVENT_SPECS[k].about}`).join("\n")}

Lieux possibles : ${LOCATION_NAMES.join(", ")}.`;

let client: Anthropic | null = null;

export async function interpret(text: string, context: { time: string; weather: string }, apiKey?: string): Promise<EventProposal | { error: string }> {
  if (!apiKey) return interpretLocally(text) ?? { error: "Je n'ai pas compris. Essaie par exemple « une météorite sur le Pâquier »." };
  client ??= new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(ProposalSchema) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Il est ${context.time}, météo : ${context.weather}.\nDemande du joueur : « ${text} »` }],
    });
    if (response.stop_reason === "refusal") return { error: "Claude a refusé cette demande." };
    const out = response.parsed_output;
    if (!out) return interpretLocally(text) ?? { error: "Réponse illisible, réessaie." };
    if (!out.understood) return { error: out.note || "Ça ne ressemble pas à un événement pour la ville." };
    const { understood: _, ...proposal } = out;
    return { ...proposal, source: "claude" };
  } catch (err) {
    console.error("[interpret] appel Claude impossible :", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);
    const local = interpretLocally(text);
    return local ? { ...local, note: "Claude indisponible : interprété par mots-clés." } : { error: "Claude est indisponible et je n'ai pas reconnu la demande." };
  }
}
