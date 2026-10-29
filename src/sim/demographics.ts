// Demographic targets for Annecy (commune 74010).
// Source: INSEE, dossier complet, RP2023 (published 2026-08-27), https://www.insee.fr/fr/statistiques/2011101?geo=COM-74010
// Values marked "approx." are not from the Annecy dossier: national INSEE orders of magnitude or calibration choices.

/** POP T4: population by age bracket and sex (2023). `to` is inclusive. */
export const AGE_SEX_PYRAMID: { from: number; to: number; male: number; female: number }[] = [
  { from: 0, to: 14, male: 10631, female: 10041 },
  { from: 15, to: 24, male: 8746, female: 7559 },
  { from: 25, to: 39, male: 14503, female: 14305 },
  { from: 40, to: 54, male: 12197, female: 12708 },
  { from: 55, to: 64, male: 6730, female: 7763 },
  { from: 65, to: 79, male: 7704, female: 10353 },
  // 80+: density should decrease with age inside the bracket
  { from: 80, to: 99, male: 3124, female: 5753 },
];

/** EMP T1: population aged 15-64 by activity type (2023, 84,511 people). Shares of the age group, not of the labour force. */
export const ACTIVITY_15_64 = {
  employed: 0.729,
  unemployed: 0.071,
  student: 0.092,
  retired: 0.042,
  otherInactive: 0.066,
} as const;
/** EMP T4: unemployment rate as a share of the labour force (15-64, 2023). */
export const UNEMPLOYMENT_RATE = 0.089;

export const CSPS = ["artisan", "cadre", "intermediaire", "employe", "ouvrier"] as const;
export type Csp = (typeof CSPS)[number];

export const CSP_LABEL: Record<Csp, string> = {
  artisan: "Artisan, commerçant, chef d'entreprise",
  cadre: "Cadre",
  intermediaire: "Profession intermédiaire",
  employe: "Employé·e",
  ouvrier: "Ouvrier·ère",
};

/** EMP T3: active population 15-64 by CSP (2023, counts). Farmers (65) are dropped. */
export const CSP_ACTIVE: Record<Csp, number> = {
  artisan: 4374,
  cadre: 16044,
  intermediaire: 18893,
  employe: 16841,
  ouvrier: 11297,
};

/**
 * Share of cross-border workers (Switzerland, mostly Geneva) among employed residents, by CSP.
 * INSEE Analyses ARA n°150 (2022, RP2018): 10% overall, 16% of cadres, 12% of intermediate professions;
 * employe/ouvrier derived so the total stays at 10%; artisans work locally.
 */
export const FRONTALIER_RATE: Record<Csp, number> = {
  artisan: 0,
  cadre: 0.16,
  intermediaire: 0.12,
  employe: 0.05,
  ouvrier: 0.05,
};

/** ACT T3: part-time rate of salaried workers 15-64, by sex and age (2023). */
export const PART_TIME_RATE: Record<"M" | "F", { from: number; to: number; rate: number }[]> = {
  M: [{ from: 15, to: 24, rate: 0.19 }, { from: 25, to: 54, rate: 0.064 }, { from: 55, to: 64, rate: 0.105 }],
  F: [{ from: 15, to: 24, rate: 0.29 }, { from: 25, to: 54, rate: 0.245 }, { from: 55, to: 64, rate: 0.298 }],
};

export type HouseholdKind = "seul" | "colocation" | "couple" | "famille" | "monoparentale" | "touristes" | "pendulaire";

/** FAM T1: households by composition (2023, 65,766 households, mean size 1.97). */
export const HOUSEHOLD_SHARE: { kind: Exclude<HouseholdKind, "touristes" | "pendulaire">; sex?: "M" | "F"; share: number }[] = [
  { kind: "seul", sex: "M", share: 0.198 },
  { kind: "seul", sex: "F", share: 0.261 },
  { kind: "colocation", share: 0.018 },
  { kind: "couple", share: 0.233 },
  { kind: "famille", share: 0.197 },
  { kind: "monoparentale", share: 0.092 },
];
export const MEAN_HOUSEHOLD_SIZE = 1.97;

/** Approx. (France): number of children in families with children. */
export const CHILDREN_PER_FAMILY: [number, number][] = [[1, 0.45], [2, 0.39], [3, 0.13], [4, 0.03]];
/** Approx. (France): share of single-parent families headed by the mother. */
export const SINGLE_PARENT_MOTHER = 0.82;

/** LOG T12: cars per household (2023). */
export const CARS_PER_HOUSEHOLD: [number, number][] = [[0, 0.179], [1, 0.545], [2, 0.276]];

/** ACT G2: commute mode of employed residents (2023). Validation target, not an input. */
export const COMMUTE_MODE_SHARE = { none: 0.045, walk: 0.098, bike: 0.099, moto: 0.015, car: 0.626, transit: 0.117 } as const;

/**
 * REV T1 (Filosofi 2023): median annual disposable income per consumption unit, and poverty rate (< 60% of median).
 * A log-normal with this median matches the poverty rate with sigma = ln(0.6) / z(0.121) ≈ 0.437.
 */
export const INCOME_MEDIAN = 29760;
export const POVERTY_RATE = 0.121;
export const INCOME_SIGMA = 0.437;

/** Approx.: income multiplier of the household's reference person relative to the median (national INSEE ratios). */
export const INCOME_FACTOR = {
  cadre: 1.55,
  intermediaire: 1.15,
  artisan: 1.05,
  employe: 0.85,
  ouvrier: 0.85,
  retraite: 1.0,
  chomeur: 0.65,
  inactif: 0.75,
  etudiant: 0.7,
  /** extra factor for cross-border workers (Swiss wages) */
  frontalier: 1.8,
} as const;

/** Popular French first names by birth decade (approx., INSEE fichier des prénoms). Key = first year of the decade. */
export const FIRST_NAMES: Record<"M" | "F", [number, string[]][]> = {
  F: [
    [1920, ["Jeanne", "Marie", "Simone", "Germaine", "Paulette", "Yvonne", "Odette", "Denise", "Suzanne", "Marcelle"]],
    [1950, ["Monique", "Françoise", "Nicole", "Michèle", "Danielle", "Martine", "Christiane", "Jacqueline", "Annie", "Brigitte"]],
    [1960, ["Sylvie", "Catherine", "Isabelle", "Nathalie", "Christine", "Véronique", "Patricia", "Pascale", "Corinne", "Martine"]],
    [1970, ["Nathalie", "Valérie", "Sandrine", "Stéphanie", "Céline", "Karine", "Sophie", "Virginie", "Delphine", "Laurence"]],
    [1980, ["Aurélie", "Julie", "Émilie", "Audrey", "Élodie", "Mélanie", "Céline", "Sarah", "Laura", "Marion"]],
    [1990, ["Camille", "Laura", "Manon", "Marine", "Pauline", "Marie", "Léa", "Anaïs", "Chloé", "Justine"]],
    [2000, ["Léa", "Manon", "Emma", "Chloé", "Camille", "Océane", "Inès", "Clara", "Sarah", "Lucie"]],
    [2010, ["Emma", "Jade", "Louise", "Alice", "Chloé", "Lina", "Léa", "Rose", "Anna", "Mila"]],
    [2020, ["Jade", "Louise", "Ambre", "Alba", "Emma", "Rose", "Alma", "Alice", "Romy", "Anna"]],
  ],
  M: [
    [1920, ["Jean", "André", "Pierre", "René", "Louis", "Marcel", "Roger", "Robert", "Henri", "Georges"]],
    [1950, ["Jean", "Michel", "Alain", "Patrick", "Gérard", "Bernard", "Daniel", "Christian", "Jacques", "Philippe"]],
    [1960, ["Philippe", "Pascal", "Thierry", "Éric", "Patrick", "Laurent", "Christophe", "Didier", "Frédéric", "Dominique"]],
    [1970, ["Stéphane", "Sébastien", "Christophe", "Nicolas", "Frédéric", "David", "Laurent", "Cédric", "Olivier", "Jérôme"]],
    [1980, ["Nicolas", "Julien", "Sébastien", "Guillaume", "Mathieu", "Romain", "Jérémy", "Anthony", "Kevin", "Maxime"]],
    [1990, ["Thomas", "Kevin", "Alexandre", "Nicolas", "Maxime", "Quentin", "Antoine", "Julien", "Romain", "Florian"]],
    [2000, ["Lucas", "Hugo", "Thomas", "Théo", "Mathis", "Enzo", "Nathan", "Louis", "Clément", "Baptiste"]],
    [2010, ["Gabriel", "Louis", "Raphaël", "Jules", "Adam", "Lucas", "Léo", "Hugo", "Arthur", "Nathan"]],
    [2020, ["Gabriel", "Léo", "Raphaël", "Louis", "Noah", "Jules", "Arthur", "Adam", "Maël", "Lucas"]],
  ],
};
