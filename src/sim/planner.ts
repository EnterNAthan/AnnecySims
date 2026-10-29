// Planning de la journée de chaque habitant, selon son profil, ses besoins et le jour de la semaine.
import type { Place, PlaceKind, Places } from "./places";
import type { Activity, Agent } from "./population";

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
  const evening = (from: number, chance: number) => {
    if (rand() > chance) return;
    if (needs.social < needs.fun) go(near(rand() < 0.6 ? "bar" : "food"), from + u(1.5, 3.5));
    else go(near(rand() < 0.5 ? "lake" : rand() < 0.5 ? "park" : "culture"), from + u(0.75, 2));
  };

  // Le premier élément est toujours le logement, jusqu'à l'heure de départ.
  switch (agent.profile) {
    case "salarie": {
      if (!weekend) {
        go(agent.home, u(7.1, 8.7));
        const lunch = u(12, 12.6);
        go(agent.work!, lunch);
        if (rand() < 0.45) go(near("food"), lunch + u(0.7, 1.2));
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
        if (rand() < 0.5) go(near("food"), lunch + u(0.6, 1));
        const leave = u(15.8, 18);
        go(agent.work!, leave);
        // jeudi soir étudiant
        evening(leave + H(0.3), ctx.dow === 4 ? 0.75 : 0.4);
      } else {
        go(agent.home, u(11, 14));
        go(near(rand() < 0.5 ? "lake" : "shop"), u(15, 18));
        evening(H(19), 0.6);
      }
      break;
    }
    case "retraite": {
      go(agent.home, u(8.6, 10.5));
      go(near(rand() < 0.6 ? "grocery" : "shop"), u(10.8, 11.8));
      if (rand() < 0.15) go(near("food"), u(13.6, 14.3));
      else go(agent.home, u(14.2, 15));
      if (rand() < 0.65) go(near(rand() < 0.45 ? "lake" : rand() < 0.6 ? "park" : "culture"), u(16.3, 17.8));
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

  if (plan.length === 0) go(agent.home, H(30));
  // on termine toujours la journée chez soi
  if (plan[plan.length - 1].place !== agent.home) plan.push({ place: agent.home, until: H(30) });
  else plan[plan.length - 1].until = H(30);
  // pas de départ après 23h50 : on raccourcit
  for (const a of plan) a.until = Math.min(a.until, a === plan[plan.length - 1] ? H(30) : H(23.8));
  return plan;
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
