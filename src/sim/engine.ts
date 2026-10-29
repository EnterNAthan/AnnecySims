// Moteur de la simulation : fait vivre les habitants minute par minute et produit le bilan du jour.
import type { City } from "../shared/city";
import { BIKE_SPEED, Graph, Mode, WALK_SPEED } from "./graph";
import { OUTDOOR, PLACE_LABEL, Places, type Place, type PlaceKind } from "./places";
import { generateDayPlan, type CityEvent, type DayPlan } from "./events";
import { createPopulation, PROFILES, type Agent, type Profile } from "./population";
import { addOutings, insertOuting, planDay } from "./planner";
import type { AgentInfo, DayReport, Policy, Thought } from "./protocol";
import { ROAD_FLAGS } from "../shared/city";
import { WaterMask } from "./water";

/** Un agent simulé représente ce nombre de personnes réelles (trafic, chiffre d'affaires, CO₂). */
export const AGENT_SCALE = 4;
const RUN_SPEED = 2.8;
/** une pensée au plus toutes les 90 minutes par habitant */
const THOUGHT_COOLDOWN = 90;
const CO2_PER_CAR_KM = 0.12;

const SPEND: Partial<Record<PlaceKind, number>> = { food: 16, bar: 11, grocery: 28, shop: 35, culture: 9, sport: 6, lake: 4, event: 12 };
const EFFECT: Partial<Record<PlaceKind, Partial<Agent["needs"]>>> = {
  bar: { social: 0.35, fun: 0.1 },
  food: { social: 0.12, fun: 0.05 },
  shop: { fun: 0.05 },
  culture: { fun: 0.3 },
  lake: { fun: 0.3, social: 0.05 },
  park: { fun: 0.22, social: 0.05 },
  sport: { fun: 0.2 },
  event: { fun: 0.35, social: 0.25 },
  work: { fun: -0.1, energy: -0.2 },
  school: { fun: -0.05, energy: -0.15 },
};

export interface EngineOptions {
  residents: number;
  tourists: number;
  commuters: number;
  seed: number;
  startDate: Date;
}

export const DEFAULT_POLICY: Policy = { parkingPrice: 2.5, bikeComfort: 1, carFriction: 1 };

export class Engine {
  readonly graph: Graph;
  readonly places: Places;
  readonly agents: Agent[];
  policy: Policy = { ...DEFAULT_POLICY };
  day = 1;
  minute = 0;
  dayPlan!: DayPlan;
  /** lieu temporaire de chaque événement du jour */
  private eventPlaces = new Map<number, Place>();
  private closuresApplied = new Set<number>();
  /** pensées émises depuis la dernière trame */
  thoughts: Thought[] = [];
  private readonly rand: () => number;
  private readonly startDate: Date;
  private readonly city: City;
  private readonly water: WaterMask;

  // trafic, agrégé par rue (way OSM) : la saturation d'un tronçon de 5 m n'a pas de sens
  private readonly roadStorage: Float32Array;
  private readonly roadLoad: Float32Array;
  private readonly roadFactor: Float32Array;
  private readonly touched: number[] = [];
  private readonly obsSum: Float32Array;
  private readonly obsW: Float32Array;


  // statistiques du jour
  private trips = { walk: 0, bike: 0, car: 0 };
  private carMeters = 0;
  private carDelay = 0;
  private carFree = 0;
  private hourly: number[][] = [];

  constructor(city: City, opts: EngineOptions) {
    this.city = city;
    this.rand = mulberry32(opts.seed);
    this.startDate = opts.startDate;
    this.graph = new Graph(city);
    this.water = new WaterMask(city);
    this.places = new Places(city, this.graph);
    this.agents = createPopulation(this.places, opts.residents, opts.tourists, opts.commuters, this.rand);
    const g = this.graph, nr = city.roads.length;
    this.roadStorage = new Float32Array(nr);
    for (let e = 0; e < g.to.length; e++) this.roadStorage[g.edgeRoad[e]] += g.storage[e];
    this.roadLoad = new Float32Array(nr);
    this.roadFactor = new Float32Array(nr).fill(1);
    this.obsSum = new Float32Array(nr);
    this.obsW = new Float32Array(nr);

    this.startDay();
  }

  get date(): Date {
    const d = new Date(this.startDate);
    d.setDate(d.getDate() + this.day - 1);
    return d;
  }

  /** Prépare la journée : météo, événements, planning de chacun. */
  startDay(plan?: DayPlan) {
    this.dayPlan = plan ?? generateDayPlan(this.city, this.date, this.rand);
    this.eventPlaces.clear();
    for (const ev of this.dayPlan.events) this.eventPlaces.set(ev.id, this.places.transient("event", ev.x, ev.z, ev.title));
    const wet = this.dayPlan.weather.kind === "pluie" || this.dayPlan.weather.kind === "neige";
    const ctx = { dow: this.date.getDay(), rand: this.rand, wet };
    for (const a of this.agents) {
      a.plan = planDay(a, this.places, ctx);
      // sous la pluie, la plupart renoncent au lac et au parc
      if (wet) for (const act of a.plan) if (OUTDOOR.has(act.place.kind) && this.rand() < 0.7) act.place = a.home;
      for (const ev of this.dayPlan.events) this.maybeAttend(a, ev);
      addOutings(a, this.places, ctx);
      a.step = 0;
      a.trip = null;
      a.tourMode = null;
      a.x = a.home.x;
      a.z = a.home.z;
      a.travelMinutes = a.delayMinutes = a.spentToday = 0;
    }
    for (const p of this.places.all) p.revenue = p.visits = 0;
    this.trips = { walk: 0, bike: 0, car: 0 };
    this.carMeters = this.carDelay = this.carFree = 0;
    this.hourly = Array.from({ length: 24 }, () => [0, 0, 0]);
    this.obsSum.fill(0);
    this.obsW.fill(0);
    this.minute = 0;
  }

  /** Insère une visite à l'événement si l'habitant est chez lui à ce moment-là. */
  private maybeAttend(a: Agent, ev: CityEvent) {
    if (ev.attraction <= 0 || a.profile === "pendulaire") return;
    const interest = ev.kind === "marche" ? (a.profile === "retraite" ? 2 : 1) : ev.kind === "concert" ? (a.profile === "etudiant" ? 2.5 : a.profile === "retraite" ? 0.3 : 1) : 1;
    if (this.rand() > ev.attraction * interest) return;
    const t = ev.start + this.rand() * Math.max(0, ev.end - ev.start - 45);
    insertOuting(a, this.eventPlaces.get(ev.id)!, t, 40 + this.rand() * 80);
  }

  /** L'habitant exprime une pensée (bulle au-dessus de sa tête, fil d'actualité). */
  private think(a: Agent, icon: string, text: string, chance = 1) {
    if (this.minute - a.lastThought < THOUGHT_COOLDOWN || this.rand() > chance) return;
    a.lastThought = this.minute;
    this.thoughts.push({ id: a.id, name: a.name, profile: a.profile, icon, text, minute: Math.round(this.minute) });
  }

  /** Ferme ou rouvre les rues des événements selon l'heure. */
  private applyClosures() {
    let changed = false;
    for (const ev of this.dayPlan.events) {
      if (!ev.closedRoads.length) continue;
      const active = this.minute >= ev.start && this.minute < ev.end;
      if (active === this.closuresApplied.has(ev.id)) continue;
      const roads = new Set(ev.closedRoads);
      const g = this.graph;
      for (let e = 0; e < g.to.length; e++) if (roads.has(g.edgeRoad[e])) g.closed[e] = active ? 1 : 0;
      if (active) this.closuresApplied.add(ev.id);
      else this.closuresApplied.delete(ev.id);
      changed = true;
    }
    if (changed) this.graph.updateCarCosts(true);
  }

  /** Avance jusqu'à `target` minutes (dans la journée courante), par pas d'au plus une minute. */
  advanceTo(target: number) {
    target = Math.min(target, 1440);
    while (this.minute < target) {
      const dt = Math.min(1, target - this.minute);
      this.step(dt);
      this.minute += dt;
    }
  }

  private step(dtMin: number) {
    this.applyClosures();
    this.updateTraffic(dtMin);
    const dtSec = dtMin * 60;
    const hour = Math.min(23, Math.floor(this.minute / 60));
    for (const a of this.agents) {
      if (a.trip) {
        this.move(a, dtSec);
        if (a.trip) this.hourly[hour][a.trip.mode - 1] += dtMin;
      } else if (a.step < a.plan.length - 1 && this.minute >= a.plan[a.step].until) {
        this.depart(a);
      }
    }
  }

  private updateTraffic(dtMin: number) {
    for (const r of this.touched) {
      this.roadLoad[r] = 0;
      this.roadFactor[r] = 1;
    }
    this.touched.length = 0;
    const g = this.graph;
    for (const a of this.agents) {
      const t = a.trip;
      if (!t || t.mode !== Mode.Car) continue;
      const r = g.edgeRoad[t.path.edges[t.seg]];
      if (this.roadLoad[r] === 0) this.touched.push(r);
      this.roadLoad[r] += AGENT_SCALE;
    }
    for (const r of this.touched) {
      const ratio = this.roadLoad[r] / this.roadStorage[r];
      // courbe type BPR : fluide jusqu'à ~40 % d'occupation, puis ralentit fortement
      this.roadFactor[r] = Math.max(0.08, 1 / (1 + 4 * ratio ** 2.5));
      this.obsSum[r] += this.roadFactor[r] * dtMin;
      this.obsW[r] += dtMin;
    }
  }

  private chooseMode(a: Agent, from: Place, to: Place): Mode {
    if (a.profile === "frontalier" || a.profile === "pendulaire") {
      // sans voiture, le frontalier rejoint la gare à vélo ou à pied
      return a.hasCar ? Mode.Car : a.hasBike ? Mode.Bike : Mode.Walk;
    }
    const d = Math.hypot(to.x - from.x, to.z - from.z) * 1.3;
    const centre = Math.hypot(to.x, to.z) < 1100;
    // utilités en « minutes équivalentes » (plus c'est bas, mieux c'est)
    const w = this.dayPlan.weather.kind;
    const wet = w === "pluie" || w === "neige";
    const options: [Mode, number][] = [[Mode.Walk, (d / WALK_SPEED / 60) * (a.age > 70 ? 1.6 : 1) * (wet ? 1.4 : 1) + (d > 2500 ? 30 : 0)]];
    if (a.hasBike && a.age >= 8) options.push([Mode.Bike, d / BIKE_SPEED / 60 + 4 / this.policy.bikeComfort + (wet ? 12 : 0) + (w === "neige" ? 20 : 0)]);
    if (a.hasCar && a.profile !== "enfant") {
      const parking = centre && to !== a.home ? this.policy.parkingPrice * 4 : 0; // 1 € ≈ 4 min de « valeur »
      options.push([Mode.Car, (d / 8.5 / 60) * this.policy.carFriction + 6 + parking]);
    }
    if (a.profile === "touriste") options[0][1] *= 0.6;
    // logit
    const beta = 0.25;
    const best = Math.min(...options.map((o) => o[1]));
    const weights = options.map(([, c]) => Math.exp(-beta * (c - best)));
    let r = this.rand() * weights.reduce((s, x) => s + x, 0);
    for (let i = 0; i < options.length; i++) if ((r -= weights[i]) <= 0) return options[i][0];
    return options[0][0];
  }

  private depart(a: Agent) {
    const from = a.plan[a.step].place, to = a.plan[a.step + 1].place;
    if (from === to) {
      a.step++;
      return;
    }
    const style = a.plan[a.step + 1].travel;
    if (!style && (a.tourMode === null || from === a.home)) a.tourMode = this.chooseMode(a, from, to);
    let mode = style ? Mode.Walk : a.tourMode!;
    const node = (p: Place, m: Mode) => (m === Mode.Car ? p.car : m === Mode.Bike ? p.bike : p.walk);
    // 30 % des automobilistes réévaluent leur itinéraire avec les temps de parcours de la veille
    let path = this.graph.route(node(from, mode), node(to, mode), mode, this.rand() < 0.3);
    if (!path && mode !== Mode.Walk) {
      mode = Mode.Walk;
      path = this.graph.route(from.walk, to.walk, mode);
    }
    if (!path || path.edges.length === 0) {
      this.arrive(a); // inaccessible ou trop proche : on « téléporte »
      return;
    }
    let free = 0;
    for (const e of path.edges) {
      free += mode === Mode.Car ? this.graph.len[e] / this.graph.carSpeed[e] : this.graph.len[e] / (mode === Mode.Bike ? BIKE_SPEED : WALK_SPEED);
    }
    a.trip = { path, mode, d: 0, seg: 0, startMinute: this.minute, freeMinutes: free / 60, style };
    if (style === "run") a.trip.freeMinutes *= WALK_SPEED / RUN_SPEED;
    this.trips[mode === Mode.Car ? "car" : mode === Mode.Bike ? "bike" : "walk"]++;
    if (mode === Mode.Car) {
      this.carMeters += path.length;
      this.carFree += free / 60;
    }
  }

  private move(a: Agent, dtSec: number) {
    const t = a.trip!, g = this.graph, path = t.path;
    let time = dtSec;
    while (time > 0) {
      const e = path.edges[t.seg];
      const v =
        t.mode === Mode.Car ? (g.carSpeed[e] * this.roadFactor[g.edgeRoad[e]]) / this.policy.carFriction :
        t.mode === Mode.Bike ? (g.flags[e] & ROAD_FLAGS.BIKE ? BIKE_SPEED : BIKE_SPEED * 0.6) * this.policy.bikeComfort :
        t.style === "run" ? RUN_SPEED :
        WALK_SPEED;
      const rem = path.cum[t.seg + 1] - t.d;
      if (v * time < rem) {
        t.d += v * time;
        time = 0;
      } else {
        t.d = path.cum[t.seg + 1];
        time -= rem / v;
        t.seg++;
        if (t.seg >= path.edges.length) {
          this.arrive(a);
          return;
        }
      }
    }
    const e = path.edges[t.seg];
    const n0 = path.nodes[t.seg], n1 = path.nodes[t.seg + 1];
    const k = (t.d - path.cum[t.seg]) / (g.len[e] || 1);
    a.x = g.x[n0] + (g.x[n1] - g.x[n0]) * k;
    a.z = g.z[n0] + (g.z[n1] - g.z[n0]) * k;
    a.heading = Math.atan2(g.x[n1] - g.x[n0], g.z[n1] - g.z[n0]);
  }

  private arrive(a: Agent) {
    const t = a.trip;
    a.trip = null;
    if (t) {
      const actual = this.minute - t.startMinute;
      a.travelMinutes += actual;
      const delay = Math.max(0, actual - t.freeMinutes);
      a.delayMinutes += delay;
      if (t.mode === Mode.Car) this.carDelay += delay;
    }
    a.step++;
    const place = a.plan[a.step].place;
    a.x = place.x;
    a.z = place.z;
    if (place === a.home) a.tourMode = null;
    const spend = (SPEND[place.kind] ?? 0) * (a.profile === "touriste" ? 1.5 : 1) * (0.6 + this.rand() * 0.8);
    if (spend > 0) {
      place.revenue += spend * AGENT_SCALE;
      a.spentToday += spend;
    }
    place.visits++;
    const eff = EFFECT[place.kind];
    if (eff) for (const k of Object.keys(eff) as (keyof Agent["needs"])[]) a.needs[k] = clamp01(a.needs[k] + eff[k]!);
    this.reactToArrival(a, place, t);
  }

  /** Petites pensées à l'arrivée, selon le trajet et le lieu. */
  private reactToArrival(a: Agent, place: Place, t: Agent["trip"]) {
    const w = this.dayPlan.weather.kind;
    const say = (icon: string, chance: number, ...lines: string[]) => this.think(a, icon, lines[Math.floor(this.rand() * lines.length)], chance);
    const delay = t ? this.minute - t.startMinute - t.freeMinutes : 0;
    const spot = place.name ?? "la rive";
    if (t?.mode === Mode.Car && delay > 8) {
      const road = this.slowestRoad(t);
      const d = Math.round(delay);
      say("😤", 0.8,
        road ? `${d} min de bouchons ${road}…` : `${d} min perdues dans les bouchons.`,
        road ? `Encore coincé·e ${road}, c'est infernal.` : "La circulation est infernale aujourd'hui.",
        "Il faudrait vraiment que la mairie fasse quelque chose pour le trafic.");
    } else if (t?.style === "run") say("🏃", 0.5, "Petit footing au bord du lac, ça fait du bien !", "5 km avant le boulot, je suis fier·e de moi.", "Le lac au petit matin, magique.");
    else if (t?.style === "dog") say("🐕", 0.3, "Le chien était content de sortir.", "Rex a encore voulu courir après les cygnes.", "Promenade du soir avec le toutou.");
    else if (t && (w === "pluie" || w === "neige") && t.mode !== Mode.Car)
      say(w === "neige" ? "🥶" : "☔", 0.4, w === "neige" ? "Glissant, ces trottoirs enneigés." : "Trempé·e jusqu'aux os…", "J'aurais dû prendre un parapluie.", "Vivement le soleil.");
    else if (t?.mode === Mode.Bike) say("🚲", 0.12, "Rien de tel que le vélo pour traverser Annecy.", "Il manque une piste cyclable par ici.", "En vélo, je double toutes les voitures !");
    else if (t?.mode === Mode.Walk && t.path.length > 1800) say("🥵", 0.25, "Ça fait une trotte à pied…", "J'aurais dû prendre le bus.");
    switch (place.kind) {
      case "lake": say("😍", 0.35, `Quelle vue sur le lac depuis ${spot} !`, "Les montagnes se reflètent dans le lac, sublime.", `On est bien à ${spot}.`, "Annecy, la Venise des Alpes."); break;
      case "park": say("🌳", 0.2, "Un peu de calme au parc.", "Les enfants adorent ce parc.", "Joli, les couleurs d'automne."); break;
      case "bar": say("🍻", 0.35, "Un verre entre amis, enfin !", "L'apéro savoyard, il n'y a que ça de vrai.", "Ambiance sympa ce soir."); break;
      case "food": say("🍝", 0.15, "Bien mangé ce midi.", "Une bonne tartiflette, parfait.", "Un peu cher, ce restaurant…"); break;
      case "grocery": say("🛒", 0.1, "Les courses, c'est fait.", "Les prix ont encore augmenté…"); break;
      case "shop": say("🛍️", 0.15, "Trouvé exactement ce que je cherchais.", "Il y a trop de vitrines vides en ville."); break;
      case "culture": say("🎨", 0.3, "Belle expo, je recommande.", "Le château d'Annecy vaut le détour."); break;
      case "school": if (a.profile === "enfant") say("🎒", 0.1, "Vivement la récré !", "J'ai oublié mes devoirs…"); break;
      case "event": {
        const ev = this.dayPlan.events.find((e) => this.eventPlaces.get(e.id) === place);
        if (ev?.kind === "marche") say("🧀", 0.6, "Du reblochon au marché, parfait.", "Les fruits du marché sont superbes.", "Le marché de la vieille ville, une institution.");
        else if (ev?.kind === "concert") say("🎶", 0.7, "Super ambiance au concert !", "Ce groupe est génial.", "Le son porte jusqu'au lac !");
        else if (ev?.kind === "brocante") say("🪑", 0.6, "Dégoté une vieille lampe à la brocante.", "Que de trésors à la brocante !");
        else say("✨", 0.5, `Sympa, ${place.name}.`);
        break;
      }
      case "work":
        if (a.needs.energy < 0.35) say("😩", 0.4, "Encore une longue journée…", "Besoin de vacances.");
        break;
    }
    if (a.needs.social < 0.15) say("😔", 0.3, "Je me sens un peu seul·e ces temps-ci.", "Personne avec qui sortir ce soir…");
    if (a.needs.fun < 0.12) say("😐", 0.3, "Il ne se passe jamais rien.", "Je m'ennuie un peu à Annecy en ce moment.");
  }

  /** Nom de la rue la plus ralentie du trajet. */
  private slowestRoad(t: NonNullable<Agent["trip"]>): string | null {
    let best: string | null = null, worst = 0.85;
    for (const e of t.path.edges) {
      const r = this.graph.edgeRoad[e];
      const f = this.obsW[r] > 0 ? this.obsSum[r] / this.obsW[r] : 1;
      const name = this.city.roads[r].name;
      if (name && f < worst) { worst = f; best = name; }
    }
    return best;
  }

  /** Termine la journée : bilan, satisfaction, apprentissage des temps de parcours. */
  endDay(): DayReport {
    this.advanceTo(1440);
    const bySat: Record<string, number[]> = {};
    for (const a of this.agents) {
      const n = a.needs;
      const score =
        0.55 + 0.25 * (n.fun - 0.5) + 0.2 * (n.social - 0.5) -
        0.5 * Math.min(1, a.delayMinutes / 30) - 0.15 * Math.min(1, Math.max(0, a.travelMinutes - 45) / 90);
      a.satisfaction = clamp01(0.85 * a.satisfaction + 0.15 * clamp01(score));
      n.social = clamp01(n.social - 0.12);
      n.fun = clamp01(n.fun - 0.1);
      n.energy = 1;
      (bySat[a.profile] ??= []).push(a.satisfaction);
    }

    const revenue: Record<string, number> = {};
    const visited = this.places.all.filter((p) => p.name && p.visits > 0);
    for (const p of this.places.all) if (p.revenue > 0) revenue[p.kind] = (revenue[p.kind] ?? 0) + p.revenue;

    // rues les plus ralenties (par nom), en ignorant les tronçons très courts
    const g = this.graph;
    const roadSlow = new Map<string, number>();
    this.city.roads.forEach((road, r) => {
      if (!road.name || this.obsW[r] < 20 || this.roadStorage[r] < 25) return;
      const slowdown = 1 - this.obsSum[r] / this.obsW[r];
      if (slowdown > 0.15) roadSlow.set(road.name, Math.max(roadSlow.get(road.name) ?? 0, slowdown));
    });

    // les automobilistes retiennent les rues lentes de la veille
    for (let e = 0; e < g.to.length; e++) {
      const r = g.edgeRoad[e];
      const observed = this.obsW[r] > 0 ? this.obsSum[r] / this.obsW[r] : 1;
      g.learnedFactor[e] = 0.5 * g.learnedFactor[e] + 0.5 * observed;
    }
    g.updateCarCosts();

    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
    const satisfactionByProfile = Object.fromEntries(PROFILES.filter((p) => bySat[p]).map((p) => [p, mean(bySat[p])])) as Record<Profile, number>;
    const report: DayReport = {
      day: this.day,
      date: this.date.toISOString().slice(0, 10),
      dow: this.date.getDay(),
      population: this.agents.length * AGENT_SCALE,
      trips: { walk: this.trips.walk * AGENT_SCALE, bike: this.trips.bike * AGENT_SCALE, car: this.trips.car * AGENT_SCALE },
      carKm: Math.round((this.carMeters / 1000) * AGENT_SCALE),
      co2Tonnes: +(((this.carMeters / 1000) * AGENT_SCALE * CO2_PER_CAR_KM) / 1000).toFixed(2),
      congestion: this.carFree > 0 ? +(this.carDelay / this.carFree).toFixed(3) : 0,
      revenue: Object.fromEntries(Object.entries(revenue).map(([k, v]) => [k, Math.round(v)])),
      revenueTotal: Math.round(Object.values(revenue).reduce((s, v) => s + v, 0)),
      satisfaction: +mean(this.agents.map((a) => a.satisfaction)).toFixed(3),
      satisfactionByProfile,
      hourly: this.hourly.map((h) => h.map((m) => Math.round(m * AGENT_SCALE))),
      topPlaces: visited.sort((a, b) => b.visits - a.visits).slice(0, 6).map((p) => ({ name: p.name!, kind: p.kind, visits: p.visits * AGENT_SCALE })),
      jams: [...roadSlow].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, s]) => ({ name, slowdown: +s.toFixed(2) })),
      policy: { ...this.policy },
      weather: this.dayPlan.weather,
      events: this.dayPlan.events.map((e) => ({ kind: e.kind, title: e.title, visits: this.eventPlaces.get(e.id)!.visits * AGENT_SCALE })),
    };
    for (const id of [...this.closuresApplied]) this.closuresApplied.delete(id);
    this.graph.closed.fill(0);
    this.graph.updateCarCosts(true);
    this.day++;
    this.startDay();
    return report;
  }

  /**
   * Remplit `out` avec les habitants visibles : [x, z, cap, mode, profil, id] par habitant.
   * mode 0 = à l'arrêt dehors (x, z = centre du groupe, cap = angle autour), 1 = marche, 2 = vélo,
   * 3 = voiture, 4 = course à pied, 5 = promenade du chien.
   * Les positions tiennent compte du côté de la chaussée et ne tombent jamais dans l'eau.
   */
  snapshot(out: Float32Array): number {
    let n = 0;
    const STRIDE = 6, g = this.graph;
    for (const a of this.agents) {
      if ((n + 1) * STRIDE > out.length) break;
      let mode = 0, x = a.x, z = a.z, heading = a.heading;
      if (a.trip) {
        mode = a.trip.style === "run" ? 4 : a.trip.style === "dog" ? 5 : a.trip.mode;
        const e = a.trip.path.edges[a.trip.seg];
        const road = this.city.roads[g.edgeRoad[e]];
        const carRoad = (g.flags[e] & ROAD_FLAGS.CAR) !== 0;
        // voitures sur leur voie, vélos au bord, piétons sur le trottoir ; au milieu des chemins piétons
        const lateral =
          mode === Mode.Car ? road.w / 4 :
          mode === Mode.Bike ? (carRoad ? road.w / 2 - 0.8 : 0.5) :
          (a.id % 2 ? 1 : -1) * (carRoad ? road.w / 2 + 1 : Math.min(0.8, road.w / 4));
        const ox = x - Math.cos(heading) * lateral, oz = z + Math.sin(heading) * lateral;
        if (!this.water.isWater(ox, oz)) {
          x = ox;
          z = oz;
        }
      } else {
        const place = a.plan[a.step]?.place;
        if (!place || !OUTDOOR.has(place.kind)) continue;
        // petits groupes qui discutent autour du point d'accès piéton, toujours sur la terre ferme ;
        // on envoie le centre du groupe et l'angle de la personne autour (le rendu les écarte selon le zoom)
        const ax = g.x[place.walk], az = g.z[place.walk];
        const group = Math.floor(hash01(a.id * 3 + 1) * 10);
        const gAng = hash01(group * 97 + place.walk) * Math.PI * 2;
        x = ax;
        z = az;
        for (let r = 4 + hash01(group * 31 + place.walk) * 30; r > 1; r *= 0.5) {
          const cx = ax + Math.cos(gAng) * r, cz = az + Math.sin(gAng) * r;
          if (!this.water.isWater(cx, cz)) {
            x = cx;
            z = cz;
            break;
          }
        }
        heading = hash01(a.id * 3 + 2) * Math.PI * 2 + Math.sin(this.minute * 0.02 + a.id) * 0.2;
      }
      const o = n * STRIDE;
      out[o] = x;
      out[o + 1] = z;
      out[o + 2] = heading;
      out[o + 3] = mode;
      out[o + 4] = PROFILES.indexOf(a.profile);
      out[o + 5] = a.id;
      n++;
    }
    return n;
  }

  /** Fiche détaillée d'un habitant, pour l'interface. */
  inspect(id: number): AgentInfo | null {
    const a = this.agents[id];
    if (!a) return null;
    const label = (p: Place) => (p === a.home ? (a.profile === "pendulaire" ? "Domicile (hors zone)" : "Domicile") : p === a.work ? `Travail${p.name ? ` · ${p.name}` : ""}` : p.name ?? PLACE_LABEL[p.kind]);
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
    const current = a.plan[a.step];
    const mode = a.trip ? (a.trip.style === "run" ? "en courant" : a.trip.style === "dog" ? "avec son chien 🐕" : ["", "à pied", "à vélo", "en voiture"][a.trip.mode]) : null;
    return {
      id: a.id, name: a.name, age: a.age, profile: a.profile,
      hasCar: a.hasCar, hasBike: a.hasBike,
      needs: { ...a.needs }, satisfaction: a.satisfaction,
      x: a.x, z: a.z, visible: !!a.trip || (!!current && OUTDOOR.has(current.place.kind)),
      now: a.trip ? `En route vers ${label(a.plan[a.step + 1].place)} ${mode}` : current ? label(current.place) : "—",
      // en trajet, l'étape « en cours » est la destination
      schedule: a.plan.map((act, i) => {
        const current = a.trip ? a.step + 1 : a.step;
        return { from: i === 0 ? "00:00" : hhmm(a.plan[i - 1].until), place: label(act.place), done: i < current, current: i === current };
      }),
      travelMinutes: Math.round(a.travelMinutes), spentToday: Math.round(a.spentToday),
    };
  }

  /** Compteurs en direct pour l'interface. */
  liveCounts() {
    const c = { walk: 0, bike: 0, car: 0, outdoor: 0, outside: 0, run: 0, dog: 0, satisfaction: 0 };
    for (const a of this.agents) {
      c.satisfaction += a.satisfaction / this.agents.length;
      if (a.trip?.style) {
        c[a.trip.style]++;
        continue;
      }
      if (a.trip) c[a.trip.mode === Mode.Car ? "car" : a.trip.mode === Mode.Bike ? "bike" : "walk"]++;
      else {
        const k = a.plan[a.step]?.place.kind;
        if (k && OUTDOOR.has(k)) c.outdoor++;
        else if (k === "exit" || k === "station") c.outside++;
      }
    }
    return c;
  }
}

function hash01(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
