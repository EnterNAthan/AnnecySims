// Création des habitants : profils, logement, travail, équipement, besoins.
import type { Place, Places } from "./places";
import type { Path } from "./graph";
import { Mode } from "./graph";
import type { Csp, HouseholdKind } from "./demographics";
import {
  AGE_SEX_PYRAMID, CARS_PER_HOUSEHOLD, CHILDREN_PER_FAMILY, CSPS, CSP_ACTIVE, FIRST_NAMES, FRONTALIER_RATE, HOUSEHOLD_SHARE,
  INCOME_FACTOR, INCOME_MEDIAN, PART_TIME_RATE, POVERTY_RATE, SINGLE_PARENT_MOTHER,
} from "./demographics";

export const PROFILES = ["salarie", "frontalier", "etudiant", "retraite", "commercant", "enfant", "chomeur", "inactif", "touriste", "pendulaire"] as const;
export type Profile = (typeof PROFILES)[number];

export const PROFILE_LABEL: Record<Profile, string> = {
  salarie: "Salarié·e",
  frontalier: "Frontalier·e (Genève)",
  etudiant: "Étudiant·e",
  retraite: "Retraité·e",
  commercant: "Commerçant·e",
  enfant: "Enfant",
  chomeur: "Demandeur·se d'emploi",
  inactif: "Au foyer / inactif·ve",
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
  chomeur: "#c9a27a",
  inactif: "#e0a8c8",
  touriste: "#ef5d8a",
  pendulaire: "#6fd3d6",
};


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

export type Sex = "M" | "F";

/** Agents sharing a home (and its cars): single person, couple, family, tourist group… */
export interface Household {
  id: number;
  kind: HouseholdKind;
  home: Place;
  /** adults first (reference person at index 0), then children by decreasing age */
  members: Agent[];
  /** cars owned by the household; they are assigned to adult drivers via Agent.hasCar */
  cars: number;
  /** annual disposable income per consumption unit (€), shared by all members */
  income: number;
}

export interface Agent {
  id: number;
  name: string;
  profile: Profile;
  age: number;
  sex: Sex;
  /** socio-professional category of workers (salarie, frontalier, commercant, pendulaire); null otherwise */
  csp: Csp | null;
  partTime: boolean;
  household: Household;
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
  /** dernières pensées exprimées (la plus récente en dernier) */
  thoughtLog: { icon: string; text: string; day: number; minute: number }[];
}

const LAST = [
  "Martin", "Bernard", "Dubois", "Durand", "Favre", "Duret", "Mermillod", "Bouvier", "Pollet", "Ducret", "Girod",
  "Perrissin", "Baud", "Rey", "Burnier", "Cochet", "Tissot", "Jacquier", "Vulliet", "Dupont", "Moreau", "Laurent",
  "Simon", "Michel", "Garnier", "Rousseau", "Blanc", "Guerin", "Muller", "Fontaine", "Chevallier", "Gay", "Bochet",
  "Dunand", "Carrier", "Besson", "Mugnier", "Excoffier", "Pochat", "Bouchet", "Francoz", "Veyrat", "Collomb", "Dupraz",
  "Blanchet", "Chappaz", "Gaillard", "Raphoz", "Petit", "Roux", "Lambert", "Morel",
];

// ---------------------------------------------------------------------------------------------
// Household shapes: ages and sexes only, drawn per household kind then filtered by importance
// weights so that the resident pyramid matches AGE_SEX_PYRAMID.
// ---------------------------------------------------------------------------------------------

export interface ShapePerson { age: number; sex: Sex; child: boolean }
export interface Shape { kind: HouseholdKind; persons: ShapePerson[] }

const BRACKETS = AGE_SEX_PYRAMID;
const bracketOf = (age: number) => {
  for (let i = 0; i < BRACKETS.length; i++) if (age <= BRACKETS[i].to) return i;
  return BRACKETS.length - 1;
};

/**
 * Acceptance ratios per [sex][bracket], found by iterating "ratio *= target / measured" on a large
 * sample (see scripts/check-demographics.ts --tune). Exported (and mutable) for that tuning only.
 */
export const AGE_RATIO: Record<Sex, number[]> = {
  M: [0.381, 0.529, 0.965, 0.634, 0.771, 0.772, 0.625],
  F: [0.307, 0.256, 0.427, 0.292, 0.799, 0.643, 1.0],
};

function gauss(rand: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}
const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Sampler over integer ages [lo, hi] with weights w(age). */
function sampler(lo: number, hi: number, w: (a: number) => number) {
  const cum: number[] = [];
  let s = 0;
  for (let a = lo; a <= hi; a++) cum.push((s += w(a)));
  return (rand: () => number) => {
    const r = rand() * s;
    let i = 0, j = cum.length - 1;
    while (i < j) {
      const m = (i + j) >> 1;
      if (cum[m] < r) i = m + 1; else j = m;
    }
    return lo + i;
  };
}
const tail80 = (a: number, k: number) => Math.exp(-(a - 80) / k);

const singleAge: Record<Sex, (rand: () => number) => number> = {
  M: sampler(18, 99, (a) => a < 25 ? 1 : a < 35 ? 1.4 : a < 65 ? 0.8 : a < 80 ? 0.9 : 0.7 * tail80(a, 5)),
  F: sampler(18, 99, (a) => a < 25 ? 0.9 : a < 35 ? 1.1 : a < 65 ? 0.8 : a < 80 ? 1.4 : 1.4 * tail80(a, 6)),
};
const coupleWomanAge = sampler(19, 97, (a) => a < 30 ? 0.8 : a < 55 ? 1 : a < 80 ? 1.2 : 1.2 * tail80(a, 5));
const colocAge = sampler(18, 30, (a) => a < 20 ? 1 : a < 25 ? 1.6 : 1);
const youngestChildAge = sampler(0, 24, (a) => a < 15 ? 1 : 0.7);

function drawShape(kind: HouseholdKind, single: Sex | undefined, rand: () => number): Shape {
  const persons: ShapePerson[] = [];
  const add = (age: number, sex: Sex, child = false) => persons.push({ age: clampInt(age, child ? 0 : 18, 99), sex, child });
  const randSex = (): Sex => (rand() < 0.5 ? "M" : "F");
  if (kind === "seul") {
    add(singleAge[single!](rand), single!);
  } else if (kind === "colocation") {
    const n = rand() < 0.7 ? 2 : 3;
    const first = colocAge(rand);
    for (let i = 0; i < n; i++) add(clampInt(first + gauss(rand) * 2.5, 18, 36), randSex());
  } else if (kind === "couple") {
    const w = coupleWomanAge(rand);
    add(w + gauss(rand) * 3.2 + 2.2, "M");
    add(w, "F");
  } else {
    // family: draw the youngest child, then older siblings spaced 1-4 years, parents derived from the eldest
    let r = rand(), n = 1;
    for (const [c, s] of CHILDREN_PER_FAMILY) if ((r -= s) < 0) { n = c; break; }
    const ages = [youngestChildAge(rand)];
    for (let i = 1; i < n; i++) {
      const a = ages[i - 1] + 1 + Math.floor(rand() * 4);
      if (a > 24) break;
      ages.push(a);
    }
    const eldest = ages[ages.length - 1];
    if (kind === "famille") {
      const mother = eldest + clampInt(29 + gauss(rand) * 4.5, 19, 43);
      add(mother + gauss(rand) * 3.5 + 2.5, "M");
      add(mother, "F");
    } else {
      const parent = eldest + clampInt(30 + gauss(rand) * 5.5, 18, 48);
      add(parent, rand() < SINGLE_PARENT_MOTHER ? "F" : "M");
    }
    for (const a of ages.reverse()) add(a, randSex(), true);
  }
  return { kind, persons };
}

/** Draw resident household shapes until exactly `n` persons exist (the last household is truncated). */
export function sampleShapes(n: number, rand: () => number): Shape[] {
  const rmax = Math.max(...AGE_RATIO.M, ...AGE_RATIO.F);
  const shapes: Shape[] = [];
  let total = 0;
  while (total < n) {
    let r = rand();
    let entry = HOUSEHOLD_SHARE[HOUSEHOLD_SHARE.length - 1];
    for (const e of HOUSEHOLD_SHARE) if ((r -= e.share) < 0) { entry = e; break; }
    let shape = drawShape(entry.kind, entry.sex, rand);
    for (let tries = 0; tries < 300; tries++) {
      const w = shape.persons.reduce((s, p) => s + AGE_RATIO[p.sex][bracketOf(p.age)], 0) / shape.persons.length;
      if (rand() * rmax < w) break;
      shape = drawShape(entry.kind, entry.sex, rand);
    }
    if (total + shape.persons.length > n) {
      shape.persons.length = n - total;
      if (shape.persons.length === 1) shape.kind = "seul";
    }
    total += shape.persons.length;
    shapes.push(shape);
  }
  return shapes;
}

// ---------------------------------------------------------------------------------------------
// Activity, CSP, part-time
// ---------------------------------------------------------------------------------------------

type Activity5 = "employed" | "unemployed" | "student" | "retired" | "inactive";

/** Approx. calibration: [from, to, student, unemployed, retired, inactive] shares by age band (rest is employed). */
const ACTIVITY_BANDS: [number, number, number, number, number, number][] = [
  [15, 17, 1, 0, 0, 0],
  [18, 24, 0.2, 0.12, 0, 0.05],
  [25, 39, 0.02, 0.07, 0, 0.068],
  [40, 54, 0.003, 0.065, 0.003, 0.068],
  [55, 59, 0, 0.06, 0.05, 0.07],
  [60, 64, 0, 0.055, 0.45, 0.07],
];

function drawActivity(age: number, sex: Sex, kind: HouseholdKind, youngKids: boolean, rand: () => number): Activity5 {
  if (age >= 65) return age < 70 ? (rand() < 0.09 ? "employed" : "retired") : age < 75 ? (rand() < 0.03 ? "employed" : "retired") : "retired";
  const b = ACTIVITY_BANDS.find((x) => age >= x[0] && age <= x[1])!;
  let [, , ps, pu, pr, pi] = b;
  if (age >= 18 && age <= 24) ps *= kind === "famille" || kind === "monoparentale" ? 1.8 : kind === "colocation" ? 1.5 : 0.5;
  else if (age >= 25 && kind === "colocation") ps *= 4;
  pi *= sex === "F" ? 1.6 : 0.4;
  if (youngKids && sex === "F") pi *= 3;
  if (kind === "colocation") pi = 0;
  let r = rand();
  if ((r -= ps) < 0) return "student";
  if ((r -= pu) < 0) return "unemployed";
  if ((r -= pr) < 0) return "retired";
  if ((r -= pi) < 0) return "inactive";
  return "employed";
}

/** Approx. age profile of each CSP, multiplied with the CSP shares (cadres skew 30-60, employees/workers young). */
function cspAgeWeight(csp: Csp, age: number) {
  switch (csp) {
    case "cadre": return age < 23 ? 0.1 : age < 28 ? 0.5 : age <= 60 ? 1.1 : 0.6;
    case "intermediaire": return age < 23 ? 0.4 : 1;
    case "employe": return age < 23 ? 1.8 : age < 28 ? 1.3 : 1;
    case "ouvrier": return age < 23 ? 1.5 : age >= 55 ? 1.1 : 1;
    case "artisan": return age < 23 ? 0.2 : age < 28 ? 0.5 : 1.1;
  }
}
const CSP_TOTAL = CSPS.reduce((s, c) => s + CSP_ACTIVE[c], 0);
/** Approx. multiplicative corrections so that the CSP shares after age weighting stay on target. */
const CSP_ADJ: Record<Csp, number> = { artisan: 1, cadre: 1.08, intermediaire: 1.06, employe: 0.88, ouvrier: 0.98 };
/** Approx.: extra calibration of the cross-border share (INSEE target ~10% of employed). */
const FRONTALIER_SCALE = 1.12;

function drawCsp(age: number, rand: () => number): Csp {
  const w = CSPS.map((c) => (CSP_ACTIVE[c] / CSP_TOTAL) * cspAgeWeight(c, age) * CSP_ADJ[c]);
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < CSPS.length; i++) if ((r -= w[i]) < 0) return CSPS[i];
  return "employe";
}

function partTimeRate(sex: Sex, age: number) {
  const bands = PART_TIME_RATE[sex];
  return (bands.find((b) => age >= b.from && age <= b.to) ?? bands[bands.length - 1]).rate;
}

function incomeFactor(p: Pick<Agent, "profile" | "csp">) {
  if (p.csp) return INCOME_FACTOR[p.csp] * (p.profile === "frontalier" ? INCOME_FACTOR.frontalier : 1);
  switch (p.profile) {
    case "retraite": case "chomeur": case "inactif": case "etudiant": return INCOME_FACTOR[p.profile];
    default: return INCOME_FACTOR.etudiant;
  }
}

// ---------------------------------------------------------------------------------------------

/** What is decided for each person before the Agent is built. */
interface Draft extends ShapePerson {
  profile: Profile;
  csp: Csp | null;
  partTime: boolean;
}

const BIKE_SHARE: Record<Profile, number> = {
  salarie: 0.35, frontalier: 0.1, etudiant: 0.45, retraite: 0.2, commercant: 0.25, enfant: 0.3, chomeur: 0.25, inactif: 0.2,
  touriste: 0.15, pendulaire: 0,
};
const DOG_RATE: Partial<Record<Profile, number>> = { retraite: 0.3, salarie: 0.12, frontalier: 0.12, commercant: 0.12, etudiant: 0.12, chomeur: 0.12, inactif: 0.12 };

function birthName(sex: Sex, age: number, rand: () => number) {
  const decades = FIRST_NAMES[sex];
  const year = 2026 - age;
  let list = decades[0][1];
  for (const [from, names] of decades) if (from <= year) list = names;
  return list[Math.floor(rand() * list.length)];
}

export function createPopulation(
  places: Places, residents: number, tourists: number, commuters: number, rand: () => number,
): { agents: Agent[]; households: Household[] } {
  const agents: Agent[] = [];
  const households: Household[] = [];
  const exits = places.list("exit");
  const genevaExits = [...exits].sort((a, b) => a.z + a.x - (b.z + b.x)).slice(0, Math.max(1, Math.ceil(exits.length / 3)));
  const lastName = () => LAST[Math.floor(rand() * LAST.length)];

  /** Work or school place, shared between siblings of similar age through `schools`. */
  const workPlace = (d: Draft, home: Place, schools: Map<string, Place>): Place | null => {
    switch (d.profile) {
      case "salarie": case "pendulaire": return places.pick("work", rand);
      case "commercant": return places.pick(rand() < 0.5 ? "shop" : rand() < 0.5 ? "food" : "grocery", rand);
      case "etudiant": return d.age < 18 ? places.near("school", home.x, home.z, rand, 6) : places.pick("school", rand);
      case "enfant": {
        const key = d.age < 3 ? "creche" : d.age < 11 ? "primaire" : "college";
        let s = schools.get(key);
        if (!s) schools.set(key, (s = places.near("school", home.x, home.z, rand, 6)));
        return s;
      }
      default: return null;
    }
  };

  /** Builds the household and its agents. Adults come first (reference person = highest income factor). */
  const build = (kind: HouseholdKind, home: Place, drafts: Draft[], distinctNames = false): Household => {
    const adults = drafts.filter((d) => !d.child), kids = drafts.filter((d) => d.child).sort((a, b) => b.age - a.age);
    adults.sort((a, b) => incomeFactor(b) - incomeFactor(a) || b.age - a.age);
    const ordered = [...adults, ...kids];
    const hh: Household = { id: households.length, kind, home, members: [], cars: 0, income: INCOME_MEDIAN };
    const schools = new Map<string, Place>();
    const refLast = lastName();
    ordered.forEach((d, i) => {
      const last = i === 0 ? refLast : !d.child && (distinctNames || kind === "colocation" || rand() >= 0.85) ? lastName() : refLast;
      const a: Agent = {
        id: agents.length,
        name: `${birthName(d.sex, d.age, rand)} ${last}`,
        profile: d.profile, age: d.age, sex: d.sex, csp: d.csp, partTime: d.partTime, household: hh,
        home, work: workPlace(d, home, schools), exit: d.profile === "pendulaire" ? home : null,
        hasCar: false,
        hasBike: d.age >= 5 && rand() < BIKE_SHARE[d.profile],
        needs: { energy: 0.8 + rand() * 0.2, social: 0.3 + rand() * 0.6, fun: 0.3 + rand() * 0.6 },
        habits: new Map(),
        satisfaction: 0.55 + (rand() - 0.5) * 0.2,
        plan: [], step: 0, tourMode: null, trip: null,
        x: home.x, z: home.z, heading: 0,
        travelMinutes: 0, delayMinutes: 0, spentToday: 0,
        hasDog: false, lastThought: -999, thoughtLog: [],
      };
      agents.push(a);
      hh.members.push(a);
    });
    households.push(hh);
    return hh;
  };

  // --- residents ---------------------------------------------------------------------------
  const shapes = sampleShapes(residents, rand);
  const residentHouseholds: Household[] = [];
  const rawLogIncome: number[] = [];
  for (const shape of shapes) {
    const youngKids = shape.persons.some((p) => p.child && p.age < 6);
    const drafts: Draft[] = shape.persons.map((p) => {
      const d: Draft = { ...p, profile: "enfant", csp: null, partTime: false };
      if (p.age < 15) return d;
      const act = drawActivity(p.age, p.sex, shape.kind, youngKids, rand);
      if (act === "student") d.profile = "etudiant";
      else if (act === "unemployed") d.profile = "chomeur";
      else if (act === "retired") d.profile = "retraite";
      else if (act === "inactive") d.profile = "inactif";
      else {
        d.csp = drawCsp(p.age, rand);
        d.profile = d.csp === "artisan" ? "commercant" : p.age >= 20 && rand() < FRONTALIER_RATE[d.csp] * FRONTALIER_SCALE ? "frontalier" : "salarie";
        if (d.profile === "salarie") d.partTime = rand() < partTimeRate(p.sex, p.age);
        else if (d.profile === "frontalier") d.partTime = rand() < partTimeRate(p.sex, p.age) * 0.3;
      }
      return d;
    });
    const hh = build(shape.kind, places.pick("home", rand), drafts);
    residentHouseholds.push(hh);
    // reference person weighs most; other adults contribute to the household income level
    const adults = hh.members.filter((m) => m.age >= 18 && m.profile !== "enfant");
    const ref = incomeFactor(hh.members[0]);
    const others = adults.slice(1);
    const f = others.length ? 0.65 * ref + (0.35 * others.reduce((s, m) => s + incomeFactor(m), 0)) / others.length : ref;
    rawLogIncome.push(Math.log(f) + 0.35 * gauss(rand));
  }

  // Affine map in log space: person-weighted median = INCOME_MEDIAN and poverty share = POVERTY_RATE exactly.
  {
    const order = residentHouseholds.map((_, i) => i).sort((a, b) => rawLogIncome[a] - rawLogIncome[b]);
    const quantile = (p: number) => {
      let acc = 0;
      for (const i of order) if ((acc += residentHouseholds[i].members.length) >= p * residents) return rawLogIncome[i];
      return rawLogIncome[order[order.length - 1]];
    };
    const m = quantile(0.5), q = quantile(POVERTY_RATE);
    const s = q < m ? Math.log(0.6) / (q - m) : 1;
    residentHouseholds.forEach((h, i) => (h.income = Math.round(INCOME_MEDIAN * Math.exp(s * (rawLogIncome[i] - m)))));
  }

  // Cars: rank households by a propensity score, then cut by the target shares (0 / 1 / 2 cars).
  {
    const [, share0] = CARS_PER_HOUSEHOLD[0];
    const share2 = CARS_PER_HOUSEHOLD[CARS_PER_HOUSEHOLD.length - 1][1];
    const score = residentHouseholds.map((h) => {
      const adultN = h.members.filter((m) => m.age >= 18).length;
      const kids = h.members.length - adultN;
      let sc = Math.log(h.income / INCOME_MEDIAN) + 0.35 * (adultN >= 2 ? 1 : 0) + 0.25 * Math.min(kids, 2) + 0.7 * gauss(rand);
      if (h.members.some((m) => m.profile === "frontalier")) sc += 0.7;
      if (adultN === 1 && h.members[0].age >= 75) sc -= 0.8;
      if (h.members.every((m) => m.profile === "etudiant" || m.profile === "chomeur")) sc -= 0.6;
      return sc;
    });
    const order = residentHouseholds.map((_, i) => i).sort((a, b) => score[a] - score[b]);
    const nH = order.length;
    const zeros = Math.round(share0 * nH);
    for (let k = zeros; k < nH; k++) residentHouseholds[order[k]].cars = 1;
    let twos = Math.round(share2 * nH);
    for (let k = nH - 1; k >= zeros && twos > 0; k--) {
      const h = residentHouseholds[order[k]];
      if (h.members.filter((m) => m.age >= 18).length >= 2) { h.cars = 2; twos--; }
    }
  }

  const assignCars = (h: Household) => {
    const priority = (m: Agent) =>
      m.profile === "frontalier" ? 4 : m.profile === "salarie" || m.profile === "commercant" || m.profile === "pendulaire" ? 3 :
      m.age >= 85 ? 0 : m.profile === "etudiant" ? 1 : 2;
    const drivers = h.members.filter((m) => m.age >= 18).map((m) => ({ m, k: priority(m) + rand() * 0.5 })).sort((a, b) => b.k - a.k);
    for (let i = 0; i < Math.min(h.cars, drivers.length); i++) drivers[i].m.hasCar = true;
  };
  for (const h of residentHouseholds) {
    assignCars(h);
    for (const m of h.members) {
      // cross-border workers without a car take the train (Léman Express) at the station
      if (m.profile === "frontalier") m.exit = m.hasCar ? genevaExits[Math.floor(rand() * genevaExits.length)] : places.list("station")[0];
    }
    // at most one dog per household, walked by an adult (retirees most likely)
    const walkers = h.members.filter((m) => m.age >= 18 && DOG_RATE[m.profile] !== undefined);
    const best = Math.max(0, ...walkers.map((m) => DOG_RATE[m.profile]!));
    if (best > 0 && rand() < best) {
      const cand = walkers.filter((m) => DOG_RATE[m.profile] === best);
      cand[Math.floor(rand() * cand.length)].hasDog = true;
    }
  }

  // --- tourists: groups of 1-4 sharing one hotel --------------------------------------------
  for (let left = tourists; left > 0; ) {
    let r = rand();
    let size = r < 0.15 ? 1 : r < 0.55 ? 2 : r < 0.75 ? 3 : 4;
    size = Math.min(size, left);
    const mk = (age: number, sex: Sex, child = false): Draft => ({ age, sex, child, profile: "touriste", csp: null, partTime: false });
    const rs = (): Sex => (rand() < 0.5 ? "M" : "F");
    const adultAge = () => 24 + Math.floor(rand() * 46);
    const drafts: Draft[] = [];
    let friends = false;
    if (size === 1) drafts.push(mk(adultAge(), rs()));
    else if (size === 2 && rand() < 0.75) {
      const w = adultAge();
      drafts.push(mk(clampInt(w + gauss(rand) * 3 + 2, 20, 85), "M"), mk(w, "F"));
    } else if (size === 3 && rand() >= 0.7) {
      friends = true;
      for (let i = 0; i < 3; i++) drafts.push(mk(20 + Math.floor(rand() * 16), rs()));
    } else {
      // parents with children (a lone parent when size is 2)
      const nPar = size === 2 ? 1 : 2, mother = 30 + Math.floor(rand() * 16);
      if (nPar === 2) drafts.push(mk(mother + clampInt(gauss(rand) * 3 + 2, 0, 8), "M"));
      drafts.push(mk(mother, "F"));
      for (let i = nPar; i < size; i++) drafts.push(mk(2 + Math.floor(rand() * 16), rs(), true));
    }
    const kind: HouseholdKind = "touristes";
    const hh = build(kind, places.pick("hotel", rand), drafts, friends);
    hh.income = Math.round(INCOME_MEDIAN * 1.3);
    hh.cars = rand() < 0.3 ? 1 : 0;
    assignCars(hh);
    left -= size;
  }

  // --- commuters: one-person households living outside the zone ------------------------------
  for (let i = 0; i < commuters; i++) {
    const age = 20 + Math.floor(rand() * 45);
    const csp = drawCsp(age, rand);
    const d: Draft = { age, sex: rand() < 0.5 ? "M" : "F", child: false, profile: "pendulaire", csp, partTime: rand() < partTimeRate(rand() < 0.5 ? "M" : "F", age) * 0.5 };
    const hh = build("pendulaire", exits.length ? places.pick("exit", rand) : places.pick("home", rand), [d]);
    hh.income = Math.round(INCOME_MEDIAN * INCOME_FACTOR[csp] * Math.exp(0.35 * gauss(rand)));
    hh.cars = 1;
    hh.members[0].hasCar = true;
  }
  return { agents, households };
}
