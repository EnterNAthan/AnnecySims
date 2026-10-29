// Création des habitants : profils, logement, travail, équipement, besoins.
import type { Place, Places } from "./places";
import type { Path } from "./graph";
import { Mode } from "./graph";

export const PROFILES = ["salarie", "frontalier", "etudiant", "retraite", "commercant", "enfant", "touriste", "pendulaire"] as const;
export type Profile = (typeof PROFILES)[number];

export const PROFILE_LABEL: Record<Profile, string> = {
  salarie: "Salarié·e",
  frontalier: "Frontalier·e (Genève)",
  etudiant: "Étudiant·e",
  retraite: "Retraité·e",
  commercant: "Commerçant·e",
  enfant: "Enfant",
  touriste: "Touriste",
  pendulaire: "Pendulaire (vit hors zone)",
};

export const PROFILE_COLOR: Record<Profile, string> = {
  salarie: "#4c9be8",
  frontalier: "#9aa4b1",
  etudiant: "#f2c84b",
  retraite: "#a678e0",
  commercant: "#f08a3c",
  enfant: "#5fd08a",
  touriste: "#ef5d8a",
  pendulaire: "#6fd3d6",
};

/** Part de chaque profil parmi les résidents (touristes et pendulaires s'ajoutent). */
const RESIDENT_SHARE: [Profile, number][] = [
  ["salarie", 0.36], ["frontalier", 0.09], ["etudiant", 0.1], ["retraite", 0.23], ["commercant", 0.05], ["enfant", 0.17],
];

export interface Activity {
  place: Place;
  /** minute de départ prévue (peut dépasser 1440 pour « jusqu'au lendemain ») */
  until: number;
  /** façon d'y aller : course à pied ou promenade du chien (sinon mode normal) */
  travel?: "run" | "dog";
}

export interface Trip {
  path: Path;
  mode: Mode;
  /** distance parcourue sur le chemin, en m */
  d: number;
  /** index de l'arête courante */
  seg: number;
  startMinute: number;
  /** durée à vide estimée, en minutes */
  freeMinutes: number;
  style?: "run" | "dog";
}

export interface Needs {
  energy: number;
  social: number;
  fun: number;
}

export interface Agent {
  id: number;
  name: string;
  profile: Profile;
  age: number;
  home: Place;
  work: Place | null;
  exit: Place | null;
  hasCar: boolean;
  hasBike: boolean;
  needs: Needs;
  /** lieux habituels (« la boulangerie près du bureau »), par type et point de départ */
  habits: Map<string, Place>;
  /** satisfaction envers la ville et le maire, 0..1 */
  satisfaction: number;
  plan: Activity[];
  step: number;
  /** mode choisi pour la tournée en cours (on revient avec le même véhicule) */
  tourMode: Mode | null;
  trip: Trip | null;
  x: number;
  z: number;
  heading: number;
  /** minutes passées en déplacement aujourd'hui, et minutes perdues dans les bouchons */
  travelMinutes: number;
  delayMinutes: number;
  spentToday: number;
  /** a un chien (promenades matin et soir) */
  hasDog: boolean;
  /** minute de la dernière pensée exprimée, pour ne pas spammer */
  lastThought: number;
  /** quartier de résidence (groupes d'habitants) */
  district: string;
  /** mode de la dernière tournée : 1 marche, 2 vélo, 3 voiture */
  usualMode: number;
  /** préférences décidées pour son groupe face à un événement en cours */
  bias: { car: number; bike: number; walk: number } | null;
  /** jour où il covoiture (grève des trains), pour forcer la voiture */
  carpoolDay: number;
  /** dernières pensées exprimées (la plus récente en dernier) */
  thoughtLog: { icon: string; text: string; day: number; minute: number }[];
}

const FIRST = [
  "Camille", "Louis", "Léa", "Hugo", "Chloé", "Lucas", "Manon", "Jules", "Inès", "Arthur", "Emma", "Gabriel", "Jade",
  "Raphaël", "Louise", "Nathan", "Alice", "Théo", "Zoé", "Tom", "Sarah", "Mathis", "Lina", "Noah", "Anna", "Paul",
  "Élise", "Maxime", "Juliette", "Antoine", "Margaux", "Romain", "Clara", "Bastien", "Lou", "Yanis", "Céline", "Marc",
  "Sylvie", "Bernard", "Monique", "Jean", "Françoise", "Pierre", "Nicole", "Michel", "Aurélie", "Kevin", "Amandine",
];
const LAST = [
  "Martin", "Bernard", "Dubois", "Durand", "Favre", "Duret", "Mermillod", "Bouvier", "Pollet", "Ducret", "Girod",
  "Perrissin", "Baud", "Rey", "Burnier", "Cochet", "Tissot", "Jacquier", "Vulliet", "Dupont", "Moreau", "Laurent",
  "Simon", "Michel", "Garnier", "Rousseau", "Blanc", "Guerin", "Muller", "Fontaine", "Chevallier", "Gay", "Bochet",
];

export function createPopulation(places: Places, residents: number, tourists: number, commuters: number, rand: () => number): Agent[] {
  const agents: Agent[] = [];
  const pickProfile = () => {
    let r = rand();
    for (const [p, s] of RESIDENT_SHARE) if ((r -= s) < 0) return p;
    return "salarie";
  };
  const exits = places.list("exit");
  const genevaExits = [...exits].sort((a, b) => a.z + a.x - (b.z + b.x)).slice(0, Math.max(1, Math.ceil(exits.length / 3)));

  const make = (profile: Profile, home: Place): Agent => {
    const age =
      profile === "enfant" ? 4 + Math.floor(rand() * 13) :
      profile === "etudiant" ? 18 + Math.floor(rand() * 7) :
      profile === "retraite" ? 63 + Math.floor(rand() * 25) :
      25 + Math.floor(rand() * 38);
    let work: Place | null = null, exit: Place | null = null;
    if (profile === "salarie" || profile === "pendulaire") work = places.pick("work", rand);
    if (profile === "commercant") work = places.pick(rand() < 0.5 ? "shop" : rand() < 0.5 ? "food" : "grocery", rand);
    if (profile === "etudiant") work = places.pick("school", rand);
    if (profile === "enfant") work = places.near("school", home.x, home.z, rand, 6);
    const carShare: Record<Profile, number> = {
      salarie: 0.72, frontalier: 0.95, etudiant: 0.3, retraite: 0.65, commercant: 0.8, enfant: 0, touriste: 0.25, pendulaire: 1,
    };
    const bikeShare: Record<Profile, number> = {
      salarie: 0.35, frontalier: 0.1, etudiant: 0.45, retraite: 0.2, commercant: 0.25, enfant: 0.3, touriste: 0.15, pendulaire: 0,
    };
    const hasCar = rand() < carShare[profile];
    // les frontaliers sans voiture prennent le train (Léman Express) à la gare
    if (profile === "frontalier") exit = hasCar ? genevaExits[Math.floor(rand() * genevaExits.length)] : places.list("station")[0];
    if (profile === "pendulaire") exit = home;
    const a: Agent = {
      id: agents.length,
      name: `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`,
      profile, age, home, work, exit,
      hasCar,
      hasBike: rand() < bikeShare[profile],
      needs: { energy: 0.8 + rand() * 0.2, social: 0.3 + rand() * 0.6, fun: 0.3 + rand() * 0.6 },
      habits: new Map(),
      satisfaction: 0.55 + (rand() - 0.5) * 0.2,
      plan: [], step: 0, tourMode: null, trip: null,
      x: home.x, z: home.z, heading: 0,
      travelMinutes: 0, delayMinutes: 0, spentToday: 0,
      hasDog: profile !== "touriste" && profile !== "pendulaire" && profile !== "enfant" && rand() < (profile === "retraite" ? 0.3 : 0.12),
      lastThought: -999,
      thoughtLog: [],
      district: "", usualMode: hasCar ? 3 : 1, bias: null, carpoolDay: -1,
    };
    agents.push(a);
    return a;
  };

  for (let i = 0; i < residents; i++) make(pickProfile(), places.pick("home", rand));
  for (let i = 0; i < tourists; i++) make("touriste", places.pick("hotel", rand));
  for (let i = 0; i < commuters; i++) make("pendulaire", exits.length ? places.pick("exit", rand) : places.pick("home", rand));
  return agents;
}
