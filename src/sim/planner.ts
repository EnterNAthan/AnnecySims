// Planning de la journée de chaque habitant, selon son profil, ses besoins et le jour de la semaine.
import type { Place, PlaceKind, Places } from "./places";
import type { Activity, Agent, Household } from "./population";
import { INCOME_MEDIAN } from "./demographics";

const H = (h: number) => Math.round(h * 60);
/** probabilité de retourner à son lieu habituel plutôt que d'en essayer un autre */
const HABIT = 0.8;

/** Lieu proche de `anchor`, en privilégiant les habitudes de l'habitant. */
function habitual(agent: Agent, places: Places, kind: PlaceKind, anchor: Place, rand: () => number): Place {
  const key = `${kind}@${anchor.id}`;
  const fav = agent.habits.get(key);
  if (fav && rand() < HABIT) return fav;
  const p = places.near(kind, anchor.x, anchor.z, rand);
  if (!fav || rand() < 0.3) agent.habits.set(key, p);
  return p;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Spending-power factor: >1 for well-off households (more restaurants, culture), <1 for modest ones. */
const wealth = (agent: Agent) => clamp((agent.household.income / INCOME_MEDIAN) ** 0.5, 0.6, 1.6);
const youngKids = (agent: Agent) => agent.household.members.some((c) => c.profile === "enfant" && c.age < 12);
/** Children old enough for school or crèche who need an adult to take them there. */
const hasSchoolKids = (agent: Agent) => agent.household.members.some((c) => c.profile === "enfant" && c.age <= 10 && c.work);
/** Agents whose plan today is a "day with the children" (shared with young kids on Wednesday). */
const childrenDays = new WeakSet<Agent>();

export interface DayContext {
  /** 0 = dimanche … 6 = samedi */
  dow: number;
  rand: () => number;
  /** pluie ou neige : moins de sorties sportives */
  wet: boolean;
}

/**
 * Insère une sortie (jogging, promenade du chien…) dans une plage passée à la maison.
 * Renvoie false si l'habitant n'est pas chez lui à ce moment-là.
 */
export function insertOuting(agent: Agent, place: Place, t: number, duration: number, travel?: Activity["travel"]): boolean {
  const plan = agent.plan;
  const i = plan.findIndex((act) => act.until > t);
  if (i < 0 || plan[i].place !== agent.home) return false;
  const until = plan[i].until;
  if (until < t + duration + 20) return false;
  plan.splice(i, 1, { place: agent.home, until: t }, { place, until: t + duration, travel }, { place: agent.home, until, travel });
  return true;
}

/** Joggeurs le long du lac, promenades du chien matin et soir. */
export function addOutings(agent: Agent, places: Places, ctx: DayContext) {
  const { rand } = ctx;
  const u = (a: number, b: number) => H(a + (b - a) * rand());
  if (agent.hasDog) {
    insertOuting(agent, habitual(agent, places, rand() < 0.6 ? "park" : "lake", agent.home, rand), u(7, 8.5), u(0.3, 0.6), "dog");
    insertOuting(agent, habitual(agent, places, "park", agent.home, rand), u(18.5, 21), u(0.25, 0.5), "dog");
  }
  const sporty = agent.profile === "salarie" || agent.profile === "etudiant" || agent.profile === "frontalier";
  if (sporty && agent.age < 55 && !ctx.wet && rand() < 0.14) {
    const spot = places.pick("lake", rand);
    const morning = rand() < 0.45;
    insertOuting(agent, spot, morning ? u(6.2, 7) : u(18.3, 20), u(0.1, 0.3), "run");
  }
}

export function planDay(agent: Agent, places: Places, ctx: DayContext): Activity[] {
  const { rand } = ctx;
  const u = (a: number, b: number) => H(a + (b - a) * rand());
  const weekend = ctx.dow === 0 || ctx.dow === 6;
  const plan: Activity[] = [];
  let anchor: Place = agent.home;
  const go = (place: Place, until: number) => {
    plan.push({ place, until });
    anchor = place;
  };
  const near = (kind: PlaceKind) => habitual(agent, places, kind, anchor, rand);
  const { needs } = agent;

  // Sortie du soir guidée par le besoin le plus bas.
  const rich = wealth(agent);
  const evening = (from: number, chance: number) => {
    if (agent.household.kind === "colocation" && agent.profile === "etudiant") chance += 0.15;
    if (rand() > Math.min(0.95, chance * rich)) return;
    if (needs.social < needs.fun) {
      // modest households go for a free walk instead of a paid drink half of the time
      if (rich < 0.85 && rand() < 0.5) go(near(rand() < 0.5 ? "lake" : "park"), from + u(0.75, 1.5));
      else go(near(rand() < 0.6 ? "bar" : "food"), from + u(1.5, 3.5));
    } else go(near(rand() < 0.2 * rich ? "culture" : rand() < 0.5 ? "lake" : "park"), from + u(0.75, 2));
  };
  /** end of an afternoon outing: earlier when someone has to pick the children up at school */
  const outingEnd = () => (hasSchoolKids(agent) ? u(15.2, 15.9) : u(16.3, 17.8));

  // Le premier élément est toujours le logement, jusqu'à l'heure de départ.
  switch (agent.profile) {
    case "salarie": {
      if (!weekend) {
        if (agent.partTime && ctx.dow === 3 && rand() < (youngKids(agent) ? 0.7 : 0.25)) {
          // Wednesday off
          if (youngKids(agent)) childrenDay(agent, places, ctx, go);
          else leisureDay(agent, places, ctx, go);
          break;
        }
        go(agent.home, u(7.1, 8.7));
        const lunch = agent.partTime ? u(12.5, 14) : u(12, 12.6);
        if (agent.partTime) {
          // leaves around lunch time, back home or running errands
          go(agent.work!, lunch);
          if (rand() < 0.4) go(near("grocery"), lunch + u(0.3, 0.6));
          break;
        }
        go(agent.work!, lunch);
        if (rand() < 0.45 * rich) go(near("food"), lunch + u(0.7, 1.2));
        const leave = u(16.9, 18.8);
        go(agent.work!, leave);
        if (rand() < 0.3) go(near("grocery"), leave + u(0.3, 0.6));
        evening(leave + H(0.6), 0.4);
      } else leisureDay(agent, places, ctx, go);
      break;
    }
    case "frontalier": {
      if (!weekend) {
        go(agent.home, u(6, 7.2));
        go(agent.exit!, u(18.2, 19.5));
        if (rand() < 0.25) go(near("grocery"), u(19.6, 20));
      } else leisureDay(agent, places, ctx, go);
      break;
    }
    case "pendulaire": {
      // vit hors de la zone : son « logement » est un point d'entrée
      if (!weekend) {
        go(agent.home, u(7.2, 8.9));
        const lunch = u(12, 12.5);
        go(agent.work!, lunch);
        if (rand() < 0.55) go(near("food"), lunch + u(0.7, 1.1));
        go(agent.work!, u(16.5, 18.5));
      } else if (rand() < 0.35) {
        go(agent.home, u(13.5, 15.5));
        go(places.pick(rand() < 0.6 ? "shop" : "lake", rand), u(16.5, 18.5));
      } else go(agent.home, H(30));
      break;
    }
    case "etudiant": {
      if (!weekend) {
        go(agent.home, u(7.6, 9.4));
        const lunch = u(11.9, 12.4);
        go(agent.work!, lunch);
        if (rand() < 0.5 * Math.min(rich, 1.2)) go(near("food"), lunch + u(0.6, 1));
        const leave = u(15.8, 18);
        go(agent.work!, leave);
        // jeudi soir étudiant
        evening(leave + H(0.3), ctx.dow === 4 ? (agent.household.kind === "colocation" ? 0.9 : 0.75) : 0.4);
      } else {
        go(agent.home, u(11, 14));
        go(near(rand() < 0.5 ? "lake" : "shop"), u(15, 18));
        evening(H(19), agent.household.kind === "colocation" ? 0.75 : 0.6);
      }
      break;
    }
    case "retraite": {
      // over 80: later start, one short errand, rarely out in the afternoon
      const old = agent.age > 80;
      go(agent.home, old ? u(9.4, 10.8) : u(8.6, 10.5));
      go(near(rand() < 0.6 ? "grocery" : rich > 1 && rand() < 0.5 ? "shop" : "grocery"), old ? u(10.8, 11.5) : u(10.8, 11.8));
      if (!old && rand() < 0.15 * rich) go(near("food"), u(13.6, 14.3));
      else go(agent.home, u(14.2, 15));
      if (rand() < (old ? 0.2 : 0.65)) {
        const kind: PlaceKind = rand() < 0.45 ? "lake" : rand() < 0.6 * (rich < 0.85 ? 1.3 : 1) ? "park" : "culture";
        go(near(kind), old ? u(15.5, 16.5) : u(16.3, 17.8));
      }
      break;
    }
    case "chomeur": {
      if (!weekend) {
        go(agent.home, u(8.5, 10));
        // some mornings: job centre / training
        if (rand() < 0.3) go(places.near("work", agent.home.x, agent.home.z, rand), u(11, 12));
        const poor = agent.household.income < 0.6 * INCOME_MEDIAN;
        go(near(poor || rand() < 0.7 ? "grocery" : "shop"), u(11.2, 12.6));
        go(agent.home, u(13.5, 14.8));
        if (rand() < 0.6) go(near(rand() < 0.5 ? "park" : "lake"), outingEnd());
        evening(H(19), poor ? 0.1 : 0.2);
      } else leisureDay(agent, places, ctx, go);
      break;
    }
    case "inactif": {
      if (ctx.dow === 3 && youngKids(agent)) childrenDay(agent, places, ctx, go);
      else if (!weekend || rand() < 0.4) {
        go(agent.home, u(8.6, 10));
        go(near(rand() < 0.3 * rich ? "shop" : "grocery"), u(10.8, 11.8));
        go(agent.home, u(13.8, 15));
        if (rand() < 0.7) go(near(rand() < 0.4 ? "lake" : rand() < 0.6 ? "park" : rand() < 0.5 * rich ? "culture" : "park"), outingEnd());
        evening(H(19), 0.15);
      } else leisureDay(agent, places, ctx, go);
      break;
    }
    case "commercant": {
      if (ctx.dow !== 0) {
        go(agent.home, u(7.9, 8.6));
        go(agent.work!, u(19, 19.6));
        evening(H(19.6), 0.2);
      } else leisureDay(agent, places, ctx, go);
      break;
    }
    case "enfant": {
      if (!weekend && ctx.dow !== 3) {
        go(agent.home, u(7.75, 8.15));
        go(agent.work!, u(16.2, 16.7));
        if (rand() < 0.4) go(near("park"), u(17.3, 18.3));
      } else if (!weekend) {
        // mercredi : école le matin
        go(agent.home, u(7.75, 8.15));
        go(agent.work!, u(11.6, 12));
        go(agent.home, u(14, 15));
        if (rand() < 0.6) go(near(rand() < 0.5 ? "park" : "sport"), u(16.5, 18));
      } else if (rand() < 0.6) {
        go(agent.home, u(10, 15));
        go(near(rand() < 0.5 ? "park" : "lake"), u(16, 18));
      }
      break;
    }
    case "touriste": {
      go(agent.home, u(9, 10.6));
      go(places.pick(rand() < 0.5 ? "culture" : "lake", rand), u(11.2, 12.3));
      go(near("food"), u(13.4, 14.2));
      go(places.pick("lake", rand), u(15.3, 16.6));
      if (rand() < 0.5) go(near(rand() < 0.5 ? "shop" : "culture"), u(17.2, 18.5));
      go(near("food"), u(20.5, 21.8));
      if (rand() < 0.4) go(near("bar"), u(22.5, 23.7));
      break;
    }
  }

  return finish(agent, plan);
}

/** Enforces the plan invariants: starts and ends at home, no late departures. */
function finish(agent: Agent, plan: Activity[]): Activity[] {
  if (plan.length === 0) plan.push({ place: agent.home, until: H(30) });
  // on termine toujours la journée chez soi
  if (plan[plan.length - 1].place !== agent.home) plan.push({ place: agent.home, until: H(30) });
  else plan[plan.length - 1].until = H(30);
  // pas de départ après 23h50 : on raccourcit
  for (const a of plan) a.until = Math.min(a.until, a === plan[plan.length - 1] ? H(30) : H(23.8));
  return plan;
}

/** Wednesday with young children: errand in the morning, then an afternoon outing the kids can join. */
function childrenDay(agent: Agent, places: Places, ctx: DayContext, go: (p: Place, until: number) => void) {
  const { rand } = ctx;
  const u = (a: number, b: number) => H(a + (b - a) * rand());
  const poor = agent.household.income < 0.6 * INCOME_MEDIAN;
  go(agent.home, u(8.6, 9.6));
  go(habitual(agent, places, "grocery", agent.home, rand), u(10.5, 11.5));
  go(agent.home, u(13.6, 14.4)); // index 2: shared departure
  const kind: PlaceKind = rand() < 0.45 ? "park" : rand() < 0.5 ? "lake" : poor || rand() < 0.5 ? "sport" : "culture";
  go(places.pick(kind, rand), u(16.3, 17.8));
  childrenDays.add(agent);
}

/** Journée de repos : course, loisir l'après-midi, éventuellement sortie le soir. */
function leisureDay(agent: Agent, places: Places, ctx: DayContext, go: (p: Place, until: number) => void) {
  const { rand } = ctx;
  const u = (a: number, b: number) => H(a + (b - a) * rand());
  const at = agent.home;
  go(agent.home, u(9.5, 11.5));
  // marché du samedi matin, courses
  go(habitual(agent, places, rand() < 0.6 ? "grocery" : "shop", at, rand), u(11.8, 12.6));
  go(agent.home, u(14, 15.5));
  if (rand() < 0.75) {
    const kind: PlaceKind = agent.needs.fun < 0.6 ? (rand() < 0.6 ? "lake" : "park") : rand() < 0.5 ? "shop" : "culture";
    go(places.pick(kind, rand), u(16.5, 18.8));
  }
  if (rand() < (agent.needs.social < 0.5 ? 0.5 : 0.25)) go(habitual(agent, places, rand() < 0.5 ? "food" : "bar", at, rand), u(21.5, 23.6));
}

const copyAct = (a: Activity): Activity => ({ ...a });
const FAMILY_KINDS: ReadonlySet<Household["kind"]> = new Set(["couple", "famille", "monoparentale"]);

/**
 * Plans the day of every member of a household (sets `a.plan`).
 * Call it once per household instead of `planDay` per agent; rain adjustments, event attendance
 * and `addOutings` are then applied per agent afterwards (they only touch time slots spent at home).
 */
export function planHousehold(hh: Household, places: Places, ctx: DayContext): void {
  const [lead] = hh.members;
  if (!lead) return;
  if (hh.kind === "touristes") {
    // the whole group does the same thing every day
    lead.plan = planDay(lead, places, ctx);
    for (const a of hh.members.slice(1)) a.plan = lead.plan.map(copyAct);
    return;
  }
  for (const a of hh.members) a.plan = planDay(a, places, ctx);
  shareOutings(hh, places, ctx);
  schoolRuns(hh, places, ctx);
}

/** Makes `follower` join the leader's plan from the leader's activity `k` (the departure from home). */
function join(follower: Agent, leader: Agent, k: number): boolean {
  const cut = leader.plan[k].until;
  // not free: still has to be at work after the shared departure
  if (follower.work && follower.plan.some((a) => a.until > cut && a.place === follower.work)) return false;
  const kept = follower.plan.filter((a) => a.until <= cut);
  const last = kept[kept.length - 1];
  if (last && last.place === follower.home) last.until = cut;
  else kept.push({ place: follower.home, until: cut });
  follower.plan = kept.concat(leader.plan.slice(k + 1).map(copyAct));
  return true;
}

/** Family leisure: weekends, and Wednesday afternoons with the stay-at-home / part-time parent. */
function shareOutings(hh: Household, places: Places, ctx: DayContext) {
  if (!FAMILY_KINDS.has(hh.kind)) return;
  const { rand, dow } = ctx;
  if (dow === 0 || dow === 6) {
    const lead = hh.members[0];
    const working = lead.work && lead.plan.some((a) => a.place === lead.work);
    if (lead.age > 80 || working || rand() < 0.15) return;
    const plan: Activity[] = [];
    leisureDay(lead, places, ctx, (place, until) => plan.push({ place, until }));
    lead.plan = finish(lead, plan);
    for (const f of hh.members.slice(1)) {
      const chance = f.age >= 18 ? 0.85 : f.age >= 15 ? 0.35 : 0.7;
      if (rand() < chance) join(f, lead, 0);
    }
  } else if (dow === 3) {
    const lead = hh.members.find((a) => a.age >= 18 && childrenDays.has(a));
    if (!lead) return;
    for (const f of hh.members) {
      if (f.profile === "enfant" && f.age < 12 && rand() < 0.85) join(f, lead, 2);
    }
  }
}

/** Lower rank = more available to take the children to school. */
function availability(a: Agent): number {
  if (a.profile === "inactif") return 0;
  if (a.profile === "chomeur") return 1;
  if (a.partTime) return 2;
  if (a.profile === "retraite") return 3;
  // otherwise the one who starts work latest; cross-border workers leave far too early
  return 10 + (a.profile === "frontalier" ? 100 : 0) - (a.plan[0]?.until ?? 0) / 100;
}

/** Morning drop-off (and afternoon pickup) of children aged 0-10 at their school / crèche. */
function schoolRuns(hh: Household, places: Places, ctx: DayContext) {
  const { rand, dow } = ctx;
  if (dow < 1 || dow > 5) return;
  const u = (a: number, b: number) => H(a + (b - a) * rand());
  const kids = hh.members.filter((c) => c.profile === "enfant" && c.age <= 10 && c.work && c.plan[0]?.place === c.home && c.plan[1]?.place === c.work);
  if (kids.length === 0) return;
  const adults = hh.members
    .filter((a) => a.age >= 18 && a.profile !== "touriste" && a.plan[0]?.place === a.home)
    .sort((a, b) => availability(a) - availability(b));
  if (adults.length === 0) return;

  const schools = [...new Set(kids.map((c) => c.work!))];
  const dropper = adults[0];
  const first = dropper.plan[0];
  // leave at ~8:05-8:25, or earlier if the adult normally goes out before
  const td = clamp(Math.min(first.until, u(8.05, 8.25)), H(7.6), H(8.25));
  const stops: Activity[] = schools.map((s, i) => ({ place: s, until: td + H(0.17) * (i + 1) }));
  const rest = dropper.plan.slice(1);
  if (rest.length === 0) rest.push({ place: dropper.home, until: first.until });
  dropper.plan = [{ place: dropper.home, until: td }, ...stops, ...rest];
  for (const c of kids) c.plan[0].until = td;

  // pickup around 16:20-16:40 by someone available at home, but not on Wednesday (school ends at noon)
  if (dow === 3) return;
  const pickers = adults.filter((a) => a.profile === "inactif" || a.profile === "chomeur" || a.partTime || a.profile === "retraite");
  const tp = u(16.33, 16.67);
  schools.forEach((s, i) => {
    const t = tp + H(0.25) * i;
    if (!pickers.some((a) => insertOuting(a, s, t, H(0.12)))) return;
    for (const c of kids) {
      const act = c.plan[1];
      if (c.work !== s || act.place !== s) continue;
      const until = t + H(0.05);
      if (until > c.plan[0].until && (!c.plan[2] || until < c.plan[2].until)) act.until = until;
    }
  });
}
