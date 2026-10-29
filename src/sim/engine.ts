// Moteur de la simulation : fait vivre les habitants minute par minute et produit le bilan du jour.
import type { City } from "../shared/city";
import { BIKE_SPEED, Graph, Mode, WALK_SPEED } from "./graph";
import { OUTDOOR, PLACE_LABEL, Places, type Place, type PlaceKind } from "./places";
import { cortege, generateDayPlan, type CityEvent, type DayPlan } from "./events";
import { createPopulation, PROFILES, type Agent, type Household, type Profile } from "./population";
import { addOutings, insertOuting, planHousehold } from "./planner";
import { CSP_LABEL, INCOME_MEDIAN } from "./demographics";
import type { AgentInfo, DayReport, EngineMessage, Policy, Preview, Thought } from "./protocol";
import { ROAD_FLAGS } from "../shared/city";
import { WaterMask } from "./water";
import { EVENT_SPECS, isProcession, traitsOf, type EventProposal, type EventTraits } from "../shared/catalog";
import { crowdSpot, venueLayout, type VenueLayout } from "./venue";
import { TRANSIT_POOL, VISITOR_POOL, type EventBilan } from "./protocol";
import { INCOME_MEDIAN as VISITOR_INCOME } from "./demographics";
import { localCohortResponses, type CohortResponse, type CohortStat, type EventSummary } from "../shared/advisors";
import { eventGeometry, pointAt, rollingClosure, type EventGeometry, type RoutePath } from "./eventGeometry";
import { cohortId, cohortStats, districtOf, isAffected } from "./cohorts";
import { cellKey } from "./eventGeometry";
import { DayLog } from "./kpis";

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

/** un cortège ou une course se prépare : les participants s'organisent 45 min avant le départ */
const MOBILIZE = 45;

/** Lieux de loisirs et de courses, que l'on peut annuler ou déplacer. */
const LEISURE: ReadonlySet<PlaceKind> = new Set(["food", "bar", "grocery", "shop", "culture", "sport", "lake", "park"]);

/** Suivi d'un événement du joueur pendant une journée. */
interface EventStats {
  ev: CityEvent;
  place: Place;
  seen: Set<number>;
  residents: number;
  outsiders: number;
  peak: number;
  timeline: number[];
  ticket: number;
  visitorCarTrips: number;
  visitorCarKm: number;
  visitorTravel: number;
  visitorArrivals: number;
  complaints: number;
  bilanSent: boolean;
}

/** Décision du joueur, éventuellement sur plusieurs jours. */
interface Scheduled {
  sid: number;
  p: EventProposal;
  traits: EventTraits;
  geo: EventGeometry;
  summary: EventSummary;
  firstDay: number;
  lastDay: number;
  /** début et fin le premier jour, puis les jours suivants (minutes) */
  firstStart: number;
  firstEnd: number;
  start: number;
  end: number;
  cohorts: CohortStat[];
  /** habitants concernés (domicile, trajet ou destination dans la zone), mesurés à la décision */
  affected: Uint8Array;
  affectedCount: number;
  /** réactions des groupes reçues de Claude (null tant qu'elles ne sont pas arrivées) */
  responses: CohortResponse[] | null;
  /** réactions déjà appliquées aujourd'hui, pour n'appliquer que la différence */
  applied: { day: number; byId: Map<string, CohortResponse> } | null;
  /** journal de la veille du premier jour : la ville sans l'événement */
  baseline: DayLog | null;
  analysisSent: boolean;
  rerouted: number;
  /** commerces de la zone (piétonnisation) */
  zoneShops: Place[];
}

export const DEFAULT_POLICY: Policy = { parkingPrice: 2.5, bikeComfort: 1, carFriction: 1 };

export class Engine {
  readonly graph: Graph;
  readonly places: Places;
  readonly agents: Agent[];
  readonly households: Household[];
  policy: Policy = { ...DEFAULT_POLICY };
  day = 1;
  minute = 0;
  dayPlan!: DayPlan;
  /** lieu temporaire de chaque événement du jour */
  private eventPlaces = new Map<number, Place>();
  /** pensées émises depuis la dernière trame */
  thoughts: Thought[] = [];
  /** événements du joueur dont la réaction des habitants n'a pas encore eu lieu */
  private pendingReactions: CityEvent[] = [];
  /** décisions du joueur, par identifiant */
  private scheduled = new Map<number, Scheduled>();
  private nextSid = 1;
  /** messages pour la page (réactions des groupes à demander, analyses, impact) */
  outbox: EngineMessage[] = [];
  /** visiteurs extérieurs en réserve, mobilisés par les grands événements */
  readonly visitors: Agent[] = [];
  /** véhicules qui traversent Annecy ou viennent livrer */
  readonly transit: Agent[] = [];
  /** habitants et visiteurs : tous ceux qui se déplacent et s'affichent */
  readonly everyone: Agent[];
  /** grands rassemblements : lieu → aménagement (scène, zone du public) */
  private venues = new Map<Place, { ev: CityEvent; layout: VenueLayout }>();
  /** événements du joueur : lieu → suivi de la journée */
  private stats = new Map<Place, EventStats>();
  /** visiteur → lieu de l'événement qu'il est venu voir aujourd'hui */
  private visitorTarget = new Map<number, Place>();
  /** cortèges et courses : lieu de l'événement → parcours */
  private routeStays = new Map<Place, { ev: CityEvent; path: RoutePath }>();
  private closureKey = "";
  private dangerKey = "";
  private closedRoads = new Set<number>();
  /** zones piétonnes actives (bonus pour les commerces) */
  private pedestrianZones: Scheduled[] = [];
  private log = new DayLog();
  private prevLog: DayLog | null = null;
  private lastHourLogged = -1;
  private lastImpact = 0;
  private readonly genevaExits: Place[];
  // trafic lissé par rue, pour la couche « trafic »
  private readonly emaFactor: Float32Array;
  private readonly emaLoad: Float32Array;
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
  /** cumulative home-to-work trips by mode, employed residents only (not reset daily) */
  readonly commuteTrips = { walk: 0, bike: 0, car: 0 };
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
    ({ agents: this.agents, households: this.households } = createPopulation(this.places, opts.residents, opts.tourists, opts.commuters, this.rand));
    for (const a of this.agents) a.district = districtOf(a);
    this.createVisitors(VISITOR_POOL);
    this.createTransit(TRANSIT_POOL);
    this.everyone = [...this.agents, ...this.visitors, ...this.transit];
    const exits = this.places.list("exit");
    this.genevaExits = [...exits].sort((a, b) => a.z + a.x - (b.z + b.x)).slice(0, Math.max(1, Math.ceil(exits.length / 3)));
    const g = this.graph, nr = city.roads.length;
    this.roadStorage = new Float32Array(nr);
    for (let e = 0; e < g.to.length; e++) this.roadStorage[g.edgeRoad[e]] += g.storage[e];
    this.roadLoad = new Float32Array(nr);
    this.roadFactor = new Float32Array(nr).fill(1);
    this.obsSum = new Float32Array(nr);
    this.obsW = new Float32Array(nr);
    this.emaFactor = new Float32Array(nr).fill(1);
    this.emaLoad = new Float32Array(nr);

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
    this.routeStays.clear();
    this.venues.clear();
    this.stats.clear();
    this.visitorTarget.clear();
    this.pendingReactions = [];
    this.planTransit();
    for (const v of this.visitors) {
      v.plan = [{ place: v.home, until: 1800 }];
      v.step = 0;
      v.trip = null;
      v.tourMode = null;
      v.x = v.home.x;
      v.z = v.home.z;
      v.travelMinutes = v.delayMinutes = v.spentToday = 0;
    }
    for (const ev of this.dayPlan.events) this.eventPlaces.set(ev.id, this.places.transient("event", ev.x, ev.z, ev.title));
    // décisions du joueur qui couvrent aujourd'hui (avant la planification : la météo peut changer)
    for (const [sid, s] of this.scheduled) {
      if (s.lastDay < this.day) this.scheduled.delete(sid);
      else if (s.firstDay === this.day) this.instantiate(s, s.firstStart, s.firstEnd);
      else if (s.firstDay < this.day) this.instantiate(s, s.start, s.end);
    }
    const wet = this.dayPlan.weather.kind === "pluie" || this.dayPlan.weather.kind === "neige";
    const ctx = { dow: this.date.getDay(), rand: this.rand, wet };
    for (const hh of this.households) planHousehold(hh, this.places, ctx);
    for (const a of this.agents) {
      // sous la pluie, la plupart renoncent au lac et au parc
      if (wet) for (const act of a.plan) if (OUTDOOR.has(act.place.kind) && this.rand() < 0.7) act.place = a.home;
      for (const ev of this.dayPlan.events) if (!ev.byPlayer) this.maybeAttend(a, ev);
      addOutings(a, this.places, ctx);
      a.bias = null;
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
    this.lastHourLogged = -1;
    this.lastImpact = 0;
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
  private think(a: Agent, icon: string, text: string, chance = 1, voice?: string) {
    // les véhicules de transit ne sont pas des habitants : pas de bulles
    if (a.profile === "transit") return;
    if (this.minute - a.lastThought < THOUGHT_COOLDOWN || this.rand() > chance) return;
    a.lastThought = this.minute;
    this.thoughts.push({ id: a.id, name: a.name, profile: a.profile, icon, text, minute: Math.round(this.minute), ...(voice ? { voice } : {}) });
    a.thoughtLog.push({ icon, text, day: this.day, minute: Math.round(this.minute) });
    if (a.thoughtLog.length > 8) a.thoughtLog.shift();
  }

  /**
   * Ce que l'habitant a en tête à cet instant, déduit de sa situation (trajet, lieu, heure, météo, besoins).
   * Contrairement aux pensées « exprimées », il y en a toujours une.
   */
  private mind(a: Agent): { icon: string; text: string } {
    const h = this.minute / 60;
    const w = this.dayPlan.weather.kind;
    const wet = w === "pluie" || w === "neige";
    const t = a.trip;
    const next = a.plan[a.step + 1];
    for (const ev of this.dayPlan.events) {
      if (!ev.byPlayer || this.minute < ev.start || this.minute >= ev.end) continue;
      const d = Math.hypot(a.x - ev.x, a.z - ev.z);
      const spec = EVENT_SPECS[ev.kind];
      if (spec.danger && d < ev.radius * 1.5) return { icon: "😱", text: (PANIC[ev.kind] ?? ["Il faut partir d'ici !"])[a.id % 2] };
      if (!spec.danger && d < ev.radius * 2) return { icon: spec.icon, text: (CURIOUS[ev.kind] ?? [`Incroyable : ${ev.title} !`])[a.id % 2 ? 0 : 1] ?? `Incroyable : ${ev.title} !` };
      if (spec.weather || ev.kind === "panne" || ev.kind === "tempete") return { icon: spec.icon, text: (WEATHER_TALK[ev.kind] ?? ["Quelle journée…"])[0] };
    }
    const nextAt = next ? `${Math.floor(a.plan[a.step].until / 60)}h${String(Math.floor(a.plan[a.step].until % 60)).padStart(2, "0")}` : "";
    if (t) {
      const dest = a.plan[a.step + 1].place;
      const late = this.minute - t.startMinute > t.freeMinutes * 1.3 + 3;
      if (t.mode === Mode.Car) {
        const r = this.graph.edgeRoad[t.path.edges[t.seg]];
        const road = this.city.roads[r].name;
        if (this.roadFactor[r] < 0.6) return { icon: "😤", text: `Ça n'avance pas${road ? ` ${road}` : ""}… je vais être en retard.` };
        if (dest.kind === "exit" && a.profile === "frontalier") return { icon: "🇨🇭", text: "Direction Genève, pourvu que la douane soit fluide." };
        return { icon: "🚗", text: late ? "Toujours ces bouchons, c'est usant." : `Ça roule bien, j'arrive bientôt${road ? ` par ${road}` : ""}.` };
      }
      if (t.style === "run") return { icon: "🏃", text: "Garder le rythme… encore un kilomètre." };
      if (t.style === "dog") return { icon: "🐕", text: "Allez, on rentre ! Lâche ce bâton." };
      if (wet) return { icon: w === "neige" ? "🥶" : "☔", text: w === "neige" ? "Attention, ça glisse." : "Vite, à l'abri !" };
      if (dest.kind === "event") return { icon: "✨", text: `J'ai hâte d'arriver : ${dest.name}.` };
      if (dest.kind === "work" && h < 10) return { icon: "☕", text: "Pas encore tout à fait réveillé·e…" };
      if (dest === a.home && h > 17) return { icon: "🏠", text: "Enfin la fin de journée, je rentre." };
      if (t.mode === Mode.Bike) return { icon: "🚲", text: "Le vent dans les cheveux, ça fait du bien." };
      return { icon: "🚶", text: "Je profite de la balade en ville." };
    }
    const place = a.plan[a.step]?.place;
    if (!place) return { icon: "🙂", text: "Rien de spécial." };
    if (a.needs.social < 0.2) return { icon: "😔", text: "Ça me ferait du bien de voir du monde." };
    switch (place.kind) {
      case "home":
        if (h < 6 || h >= 23) return { icon: "😴", text: "Zzz…" };
        if (a.profile === "pendulaire") return { icon: "🏡", text: "Chez moi, en dehors d'Annecy." };
        if (next && a.plan[a.step].until - this.minute < 30) return { icon: "⏰", text: `Je dois partir à ${nextAt}.` };
        if (a.profile === "chomeur" && h >= 8 && h < 18) return { icon: "📄", text: h < 12 ? "Je mets à jour mon CV et je regarde les offres." : "Encore une candidature à envoyer…" };
        if (a.profile === "inactif" && h >= 8 && h < 18) return { icon: "🧺", text: h < 12 ? "Le ménage, puis la liste des courses." : "Il faut penser au goûter des enfants." };
        if (wet) return { icon: "🌧️", text: "Il pleut, je reste au chaud." };
        return { icon: "🏠", text: h < 9 ? "Petit-déjeuner tranquille." : h > 19 ? "Soirée tranquille à la maison." : "Un moment au calme chez moi." };
      case "work":
        if (a.profile === "commercant") return { icon: "🏪", text: place.revenue > 300 ? "Bonne journée, la caisse se remplit !" : "Peu de clients aujourd'hui…" };
        if (a.profile === "chomeur") return { icon: "🤝", text: "Rendez-vous France Travail, croisons les doigts." };
        return a.needs.energy < 0.4 ? { icon: "😩", text: `Vivement ${nextAt}…` } : { icon: "💼", text: "Concentré·e sur le travail." };
      case "school": return a.profile === "enfant" ? { icon: "🎒", text: "Vivement la récré !" } : { icon: "📚", text: "Les partiels approchent…" };
      case "exit": return a.profile === "frontalier" ? { icon: "🇨🇭", text: "Au bureau à Genève." } : { icon: "🚘", text: "Hors d'Annecy." };
      case "station": return { icon: "🚆", text: "Dans le Léman Express vers Genève." };
      case "lake": return { icon: "😍", text: wet ? "Le lac sous la pluie a son charme." : "Le lac est magnifique aujourd'hui." };
      case "park": return { icon: "🌳", text: "Un peu d'air frais au parc." };
      case "bar": return { icon: "🍻", text: "Santé ! Une bonne soirée entre amis." };
      case "food": return { icon: "🍝", text: "Qu'est-ce que je vais prendre…" };
      case "grocery":
        if (this.lowIncome(a)) return { icon: "🧮", text: "Je regarde les prix, il faut tenir jusqu'à la fin du mois." };
        return { icon: "🛒", text: a.profile === "inactif" ? "Courses pour toute la famille, ne rien oublier." : "Ne rien oublier sur la liste." };
      case "shop": return { icon: "🛍️", text: "Juste regarder… bon, peut-être acheter." };
      case "culture": return { icon: "🎨", text: "Fascinant." };
      case "event": return { icon: "🎉", text: `Quelle ambiance : ${place.name} !` };
      case "hotel": return { icon: "🧳", text: "On prépare la visite de demain." };
      default: return { icon: "🙂", text: PLACE_LABEL[place.kind] };
    }
  }

  /** Événement actif de ce type à cette minute, s'il y en a un. */
  private active(kind: CityEvent["kind"]) {
    return this.dayPlan.events.find((e) => e.kind === kind && this.minute >= e.start && this.minute < e.end);
  }

  /** Aperçu d'une proposition : rues fermées, parcours, zone. */
  preview(p: EventProposal): Preview {
    const g = eventGeometry(this.city, this.graph, p);
    const roads = g.path && !g.closedRoads.length ? [...new Set(g.path.roads.filter((r) => r >= 0))] : g.closedRoads;
    return { roads, path: g.path ? flatten(g.path) : null, x: g.x, z: g.z, radius: g.radius };
  }

  /**
   * Programme une décision du joueur (éventuellement sur plusieurs jours) et demande à la page
   * la réaction des groupes d'habitants concernés. Renvoie son identifiant.
   */
  addEvent(p: EventProposal): number {
    const geo = eventGeometry(this.city, this.graph, p);
    const parsed = parseHHMM(p.startTime);
    const duration = Math.max(10, Math.min(1440, Math.round(p.durationMinutes)));
    const days = Math.max(1, Math.min(60, Math.round(p.days)));
    let firstDay = this.day + Math.max(0, Math.min(14, Math.round(p.dayOffset)));
    const start = parsed ?? 0;
    const end = Math.min(1440, start + duration);
    let firstStart = start, firstEnd = end;
    if (firstDay === this.day) {
      const now = Math.ceil(this.minute);
      if (parsed === null) [firstStart, firstEnd] = [now, Math.min(1440, now + duration)];
      else if (end <= now + 10) firstDay++; // déjà passé aujourd'hui : dès demain à la même heure
      else firstStart = Math.max(start, now);
    }
    // une grève des trains concerne ceux qui prennent le train, pas ceux qui habitent près de la gare
    const affected = Uint8Array.from(this.agents, (a) =>
      (p.kind === "greve" ? a.plan.some((act) => act.place.kind === "station") : isAffected(a, geo.zone)) ? 1 : 0);
    const sid = this.nextSid++;
    const when = `${firstDay === this.day ? "aujourd'hui" : firstDay === this.day + 1 ? "demain" : `dans ${firstDay - this.day} jours`} à ${hhmm(firstStart)}` +
      `, ${duration >= 1440 ? "toute la journée" : `${Math.round(duration / 6) / 10} h par jour`}${days > 1 ? `, pendant ${days} jours` : ""}`;
    const s: Scheduled = {
      sid, p, geo, traits: traitsOf(p),
      summary: { kind: p.kind, title: p.title, description: p.description, location: p.location, streets: p.streets, route: p.route, days, when, traits: traitsOf(p) },
      firstDay, lastDay: firstDay + days - 1, firstStart, firstEnd, start, end,
      cohorts: [],
      affected,
      affectedCount: affected.reduce((n, v) => n + v, 0),
      responses: null, applied: null, baseline: null, analysisSent: false, rerouted: 0,
      zoneShops: p.kind === "pietonnisation" ? this.places.all.filter((pl) => (pl.kind === "shop" || pl.kind === "food" || pl.kind === "bar") && geo.zone.contains(pl.x, pl.z)) : [],
    };
    s.cohorts = cohortStats(this.agents, affected, AGENT_SCALE, (a) => a.delayMinutes);
    this.scheduled.set(sid, s);
    if (firstDay === this.day) this.instantiate(s, firstStart, firstEnd);
    this.outbox.push({ type: "cohortRequest", sid, event: s.summary, cohorts: s.cohorts });
    return sid;
  }

  /** Annule une décision : les jours suivants sont supprimés, l'événement en cours s'arrête maintenant. */
  cancelEvent(sid: number) {
    this.scheduled.delete(sid);
    this.dayPlan.events = this.dayPlan.events.filter((ev) => ev.sid !== sid || ev.start < this.minute);
    for (const ev of this.dayPlan.events) if (ev.sid === sid) ev.end = Math.min(ev.end, Math.max(ev.start + 1, Math.ceil(this.minute)));
    this.pendingReactions = this.pendingReactions.filter((ev) => ev.sid !== sid);
  }

  /** Place l'événement du jour correspondant à une décision dans le plan de la journée. */
  private instantiate(s: Scheduled, start: number, end: number) {
    const spec = EVENT_SPECS[s.p.kind], g = s.geo, intensity = Math.max(1, Math.min(3, s.p.intensity)), traits = s.traits;
    const ev: CityEvent = {
      id: Math.max(-1, ...this.dayPlan.events.map((e) => e.id)) + 1,
      kind: s.p.kind, title: s.p.title, description: s.p.description, x: g.x, z: g.z, start, end,
      attraction: traits.attraction * (intensity / 2), closedRoads: g.closedRoads, radius: g.radius, intensity, byPlayer: true, traits,
      sid: s.sid, dayIndex: this.day - s.firstDay + 1, days: s.lastDay - s.firstDay + 1, streets: s.p.streets,
      ...(g.path ? { path: flatten(g.path), pathLength: g.path.length } : {}),
    };
    this.dayPlan.events.push(ev);
    // grand rassemblement : scène, public et stands sur la terre ferme ; le lieu est au milieu du public
    const layout = traits.attendance > 0 && traits.needs === "place" && !traits.danger
      ? venueLayout({ id: ev.id, x: g.x, z: g.z, attendance: traits.attendance, setup: traits.setup }, (x, z) => this.water.isWater(x, z))
      : null;
    const place = this.places.transient("event", layout?.crowd.x ?? g.x, layout?.crowd.z ?? g.z, ev.title);
    this.eventPlaces.set(ev.id, place);
    if (g.path) this.routeStays.set(place, { ev, path: g.path });
    if (layout) this.venues.set(place, { ev, layout });
    this.stats.set(place, {
      ev, place, seen: new Set(), residents: 0, outsiders: 0, peak: 0, timeline: [], ticket: 0,
      visitorCarTrips: 0, visitorCarKm: 0, visitorTravel: 0, visitorArrivals: 0, complaints: 0, bilanSent: false,
    });
    if (traits.attendance > 0 && !traits.danger) {
      this.bringVisitors(ev, place, traits);
      // part des habitants à faire venir pour atteindre la fréquentation annoncée (environ 60 % sont disponibles)
      const wanted = (traits.attendance * (1 - traits.outsiders)) / AGENT_SCALE;
      ev.attraction = Math.min(0.9, wanted / (this.agents.length * 0.6));
    }
    if (spec.weather) {
      const tempC = s.p.kind === "canicule" ? 33 + intensity * 2 : s.p.kind === "blizzard" ? -2 - intensity * 3 : this.dayPlan.weather.tempC;
      this.dayPlan.weather = { kind: spec.weather, tempC };
    }
    if (this.day === s.firstDay) s.baseline = this.prevLog;
    this.pendingReactions.push(ev);
  }

  /** Réserve de visiteurs d'un jour : ils arrivent par les routes d'accès (voiture) ou par le train. */
  private createVisitors(n: number) {
    const exits = this.places.list("exit"), station = this.places.list("station")[0];
    const firsts = this.agents.map((a) => a.name.split(" ")[0]), lasts = this.agents.map((a) => a.name.split(" ").slice(1).join(" "));
    for (let i = 0; i < n; i++) {
      const byTrain = !exits.length || this.rand() < 0.25;
      const home = byTrain ? station : exits[Math.floor(this.rand() * exits.length)];
      const a = {
        id: this.agents.length + i,
        name: `${firsts[Math.floor(this.rand() * firsts.length)]} ${lasts[Math.floor(this.rand() * lasts.length)]}`,
        profile: "visiteur", age: 18 + Math.floor(this.rand() * 45), sex: this.rand() < 0.5 ? "M" : "F", csp: null, partTime: false,
        household: null as unknown as Agent["household"],
        home, work: null, exit: null, hasCar: !byTrain, hasBike: false,
        needs: { energy: 1, social: 0.5, fun: 0.4 }, habits: new Map(), satisfaction: 0.6,
        plan: [{ place: home, until: 1800 }], step: 0, tourMode: null, trip: null,
        x: home.x, z: home.z, heading: 0, travelMinutes: 0, delayMinutes: 0, spentToday: 0,
        hasDog: false, lastThought: -999, thoughtLog: [],
        district: "hors Annecy", usualMode: byTrain ? 1 : 3, bias: null, carpoolDay: -1,
      } as Agent;
      a.household = { id: -1 - i, kind: "touristes", home, members: [a], cars: byTrain ? 0 : 1, income: VISITOR_INCOME };
      this.visitors.push(a);
    }
  }

  /** Véhicules de transit et de livraison : ils entrent par une route d'accès et ressortent par une autre. */
  private createTransit(n: number) {
    const exits = this.places.list("exit");
    if (!exits.length) return;
    const base = this.agents.length + this.visitors.length;
    for (let i = 0; i < n; i++) {
      const home = exits[Math.floor(this.rand() * exits.length)];
      const a = {
        ...this.visitors[0], id: base + i, name: i % 3 ? "Véhicule de transit" : "Livreur", profile: "transit", age: 40, csp: null,
        home, exit: null, work: null, hasCar: true, plan: [{ place: home, until: 1800 }], habits: new Map(), thoughtLog: [],
        x: home.x, z: home.z, needs: { energy: 1, social: 0.5, fun: 0.5 }, satisfaction: 0.6, usualMode: 3,
      } as Agent;
      a.household = { id: -100000 - i, kind: "touristes", home, members: [a], cars: 1, income: VISITOR_INCOME };
      this.transit.push(a);
    }
  }

  /**
   * Programme de la journée des véhicules de transit : deux pointes (8 h et 17 h 30) pour la traversée,
   * le matin pour les livraisons (3 arrêts dans les commerces). Moins de monde le week-end.
   */
  private planTransit() {
    const exits = this.places.list("exit");
    const dow = this.date.getDay(), weekend = dow === 0 || dow === 6;
    const shops = [...this.places.list("shop"), ...this.places.list("food"), ...this.places.list("grocery")];
    const peak = () => {
      // mélange de deux gaussiennes et d'un fond diurne
      const u = this.rand();
      const g = () => (this.rand() + this.rand() + this.rand() - 1.5) * 60;
      return u < 0.35 ? 8 * 60 + g() : u < 0.7 ? 17.5 * 60 + g() : 7 * 60 + this.rand() * 13 * 60;
    };
    for (const a of this.transit) {
      a.step = 0;
      a.trip = null;
      a.tourMode = null;
      a.x = a.home.x;
      a.z = a.home.z;
      a.travelMinutes = a.delayMinutes = a.spentToday = 0;
      if (this.rand() < (weekend ? 0.55 : 0.1)) {
        a.plan = [{ place: a.home, until: 1800 }];
        continue;
      }
      if (a.name === "Livreur" && shops.length && !weekend) {
        let t = 6 * 60 + this.rand() * 5 * 60;
        a.plan = [{ place: a.home, until: t }];
        for (let k = 0; k < 3; k++) a.plan.push({ place: shops[Math.floor(this.rand() * shops.length)], until: (t += 25 + this.rand() * 20) });
        a.plan.push({ place: a.home, until: 1800 });
        continue;
      }
      // traversée : vers une sortie éloignée, parfois retour le soir
      let to = a.home;
      for (let k = 0; k < 6 && Math.hypot(to.x - a.home.x, to.z - a.home.z) < 1500; k++) to = exits[Math.floor(this.rand() * exits.length)];
      const t = Math.max(5 * 60, Math.min(22 * 60, peak()));
      a.plan = [{ place: a.home, until: t }, { place: to, until: this.rand() < 0.4 ? Math.max(t + 60, 17 * 60 + this.rand() * 120) : 1800 }];
      if (a.plan[1].until < 1800) a.plan.push({ place: a.home, until: 1800 });
    }
  }

  /**
   * Fait venir les visiteurs extérieurs d'un grand événement : arrivées étalées (surtout au début),
   * départs groupés à la fin pour un concert, plus dispersés pour une foire. Avec des navettes,
   * la moitié vient en train.
   */
  private bringVisitors(ev: CityEvent, place: Place, traits: EventTraits) {
    const want = Math.round((traits.attendance * traits.outsiders) / AGENT_SCALE);
    const free = this.visitors.filter((v) => v.plan.length === 1);
    const train = free.filter((v) => !v.hasCar), car = free.filter((v) => v.hasCar);
    const trainShare = traits.shuttles ? 0.5 : 0.2;
    const pick = [...train.slice(0, Math.round(want * trainShare)), ...car];
    const stage = !!this.venues.get(place)?.layout.facing;
    for (const v of pick.slice(0, want)) {
      const k = this.rand();
      const arrive = ev.start - 20 + (ev.end - ev.start) * 0.7 * k * k;
      const leave = stage ? ev.end - this.rand() * this.rand() * 40 : Math.min(ev.end, arrive + 60 + this.rand() * 150);
      if (leave - arrive < 25) continue;
      const d = Math.hypot(v.home.x - place.x, v.home.z - place.z) * 1.4;
      const travel = v.hasCar ? d / 8 / 60 + 12 : d / 1.35 / 60;
      v.plan = [{ place: v.home, until: Math.max(this.minute, arrive - travel) }, { place, until: leave }, { place: v.home, until: 1800 }];
      this.visitorTarget.set(v.id, place);
    }
  }

  /** Attrait d'un événement selon le public visé. */
  private interest(a: Agent, t: EventTraits | undefined) {
    if (!t) return 1;
    const young = a.profile === "etudiant" || (a.age >= 16 && a.age < 30);
    switch (t.audience) {
      case "jeunes": return young ? 2.2 : a.profile === "retraite" || a.profile === "enfant" ? 0.25 : 0.8;
      case "familles": return a.profile === "enfant" || a.household?.kind === "famille" || a.household?.kind === "monoparentale" ? 1.8 : a.profile === "retraite" ? 0.8 : 0.6;
      case "seniors": return a.profile === "retraite" ? 2.2 : young ? 0.4 : 0.8;
      default: return 1;
    }
  }

  /** Lieu sûr hors de la zone : le domicile s'il est épargné, sinon un parc à l'écart. */
  private safePlace(a: Agent, ev: CityEvent, preferPark: boolean): Place {
    const out = (p: Place) => Math.hypot(p.x - ev.x, p.z - ev.z) > ev.radius * 1.2;
    if (!preferPark && out(a.home)) return a.home;
    for (let i = 0; i < 12; i++) {
      const p = this.places.near(preferPark ? "park" : i < 6 ? "park" : "lake", a.x, a.z, this.rand, 8);
      if (out(p)) return p;
    }
    return a.home;
  }

  /** Réaction de la ville au début d'un événement du joueur. */
  private react(ev: CityEvent) {
    const spec = { ...EVENT_SPECS[ev.kind], ...(ev.traits ? { danger: ev.traits.danger, icon: ev.traits.icon, label: ev.traits.label } : {}) };
    const s = ev.sid !== undefined ? this.scheduled.get(ev.sid) : undefined;
    const place = this.eventPlaces.get(ev.id)!;
    const dist = (x: number, z: number) => Math.hypot(x - ev.x, z - ev.z);
    const inZone = (p: Place) => dist(p.x, p.z) < ev.radius;
    const say = (a: Agent, icon: string, lines: string[], force = false) => {
      if (force) a.lastThought = -999;
      this.think(a, icon, lines[Math.floor(this.rand() * lines.length)]);
    };
    const wet = spec.weather === "pluie" || spec.weather === "neige";

    for (const a of this.agents) {
      const d = dist(a.x, a.z);
      const here = a.plan[a.step]?.place;
      const free = !a.trip && here === a.home && here.kind !== "exit";

      if (spec.danger && ev.kind !== "tempete") {
        const near = d < ev.radius * 1.3;
        const safe = this.safePlace(a, ev, ev.kind === "seisme");
        if (near) {
          a.satisfaction = Math.max(0, a.satisfaction - 0.08 * ev.intensity);
          // part en courant vers un lieu sûr
          if (!a.trip && a.step < a.plan.length && a.plan[a.step].place !== safe) {
            a.plan.splice(a.step + 1, 0, { place: safe, until: ev.end + 20, travel: "run" });
            a.plan[a.step].until = this.minute;
            // la journée doit toujours finir à la maison
            if (a.step + 2 === a.plan.length && safe !== a.home) a.plan.push({ place: a.home, until: 1800 });
          }
          say(a, "😱", PANIC[ev.kind] ?? ["Au secours !!", "Il faut partir d'ici !"], this.rand() < 0.5);
        } else if (this.rand() < 0.03) say(a, "📱", [`Vous avez vu ? ${spec.label} vers ${place.name?.split(" — ").pop() ?? "le centre"} !`, `${spec.icon} Ma tante m'a envoyé une vidéo, c'est fou.`], true);
        // plus personne ne va dans la zone pendant l'événement
        for (let i = a.step + 1; i < a.plan.length; i++) {
          const act = a.plan[i];
          if (inZone(act.place) && act.place !== safe && a.plan[i - 1].until < ev.end) act.place = this.safePlace(a, ev, false);
        }
      }

      if (wet || ev.kind === "tempete") {
        // on rentre, on annule les sorties
        for (let i = a.step + 1; i < a.plan.length; i++) if (OUTDOOR.has(a.plan[i].place.kind) && this.rand() < 0.8) a.plan[i].place = a.home;
        if (!a.trip && here && OUTDOOR.has(here.kind)) a.plan[a.step].until = this.minute;
        if (this.rand() < 0.02) say(a, spec.icon, WEATHER_TALK[ev.kind] ?? ["Quel temps !"], true);
      }

      if (ev.kind === "canicule" && free && this.rand() < 0.25) {
        insertOuting(a, this.places.pick("lake", this.rand), this.minute + 10 + this.rand() * 60, 60 + this.rand() * 90);
        if (this.rand() < 0.1) say(a, "🥵", ["Il fait une chaleur… direction le lac !", "Vivement une baignade."], true);
      }

      if (ev.kind === "panne" && this.rand() < 0.03) say(a, "🕯️", ["Plus de courant… où sont les bougies ?", "Mon frigo va tout décongeler !", "Toute la ville est dans le noir !"], true);

      if (ev.kind === "greve" && a.profile === "frontalier" && a.exit?.kind === "station") this.strike(a);

      // une rue piétonne attire les flâneurs des quartiers voisins
      if (ev.kind === "pietonnisation" && s?.zoneShops.length && free && d < 1500 && this.rand() < 0.08) {
        const shop = s.zoneShops[Math.floor(this.rand() * s.zoneShops.length)];
        insertOuting(a, shop, Math.max(this.minute + 10, 10 * 60 + this.rand() * 8 * 60), 30 + this.rand() * 60);
      }

      // sans avis des groupes (événements extrêmes), les curieux des environs viennent voir
      // fréquentation annoncée : elle fixe la venue des habitants ; sinon ce sont les avis des groupes qui décident
      const byAttendance = (ev.traits?.attendance ?? 0) > 0;
      if ((byAttendance || !s?.cohorts.length) && ev.attraction > 0 && free && a.profile !== "pendulaire") this.maybeJoin(a, ev, place, ev.attraction * this.interest(a, ev.traits) * (ev.kind === "ovni" && (a.profile === "enfant" || a.profile === "etudiant") ? 2 : 1), spec.icon);
    }

    if (s) this.applyCohorts(s, ev, s.responses ?? localCohortResponses(s.summary, s.cohorts));
  }

  /** Grève du Léman Express : télétravail ou covoiturage vers Genève. */
  private strike(a: Agent) {
    const telework = this.rand() < 0.55;
    const exit = this.genevaExits[a.id % this.genevaExits.length];
    let changed = false;
    for (let i = a.step + 1; i < a.plan.length; i++) {
      if (a.plan[i].place.kind !== "station") continue;
      a.plan[i].place = telework ? a.home : exit;
      changed = true;
    }
    if (!changed) return;
    if (!telework) a.carpoolDay = this.day;
    a.lastThought = -999;
    this.think(a, telework ? "💻" : "🚘", telework
      ? ["Pas de Léman Express : télétravail aujourd'hui.", "Grève des trains, je bosse depuis chez moi."][a.id % 2]
      : ["Grève du Léman Express : je covoiture avec un collègue jusqu'à Genève.", "Covoiturage ce matin, la douane va être chargée."][a.id % 2], 0.4);
  }

  /** L'habitant décide d'aller voir l'événement, s'il est libre et pas trop loin. */
  private maybeJoin(a: Agent, ev: CityEvent, place: Place, chance: number, icon: string) {
    const route = this.routeStays.has(place);
    // un grand événement annoncé attire de toute la ville, une curiosité surtout les voisins
    const big = (ev.traits?.attendance ?? 0) > 0;
    const reach = route ? 1 : Math.max(big ? 0.6 : 0.25, 1 - Math.hypot(a.x - ev.x, a.z - ev.z) / (big ? 8000 : 3000));
    if (this.rand() >= chance * reach) return false;
    // un cortège se rejoint au départ ; ailleurs on passe un moment pendant l'événement
    const t = route
      ? Math.max(this.minute + 5, ev.start - 25 + this.rand() * 30)
      : this.minute + 5 + this.rand() * Math.min(big ? 200 : 60, Math.max(0, (ev.end - Math.max(ev.start, this.minute)) / 2));
    const stage = !!this.venues.get(place)?.layout.facing;
    const stay = route ? ev.end - t - this.rand() * 15 : stage ? Math.min(ev.end - t, 90 + this.rand() * 180) : 30 + this.rand() * Math.min(120, ev.end - t);
    if (stay < 20) return false;
    // on peut quitter le bureau ou l'amphi pour manifester ; sinon il faut être chez soi
    if (!insertOuting(a, place, t, stay) && !(ev.kind === "manifestation" && this.leaveFor(a, place, t, stay))) return false;
    if (this.rand() < 0.12) this.think(a, icon, (CURIOUS[ev.kind] ?? GOING[ev.traits?.nature ?? "festif"] ?? [`Je vais voir : ${ev.title} !`])[a.id % 2] ?? `Je vais voir : ${ev.title} !`);
    return true;
  }

  /** Quitte le travail ou l'école le temps d'un événement, puis y retourne. */
  private leaveFor(a: Agent, place: Place, t: number, stay: number): boolean {
    const i = a.plan.findIndex((act) => act.until > t);
    if (i < 0 || i < a.step || (i === a.step && a.trip)) return false;
    const cur = a.plan[i];
    if (cur.place !== a.work || cur.until < t + stay + 20) return false;
    a.plan.splice(i, 1, { place: cur.place, until: t }, { place, until: t + stay }, { place: cur.place, until: cur.until });
    return true;
  }

  /**
   * Applique les réactions décidées pour chaque groupe à ses membres, avec de la variabilité individuelle.
   * Si des réactions ont déjà été appliquées aujourd'hui, seule la différence l'est.
   */
  private applyCohorts(s: Scheduled, ev: CityEvent, responses: CohortResponse[]) {
    const prev = s.applied?.day === this.day ? s.applied.byId : null;
    const byId = new Map(responses.map((r) => [r.id, r]));
    const attraction = s.traits.attraction;
    const zone = s.geo.zone;
    const place = this.eventPlaces.get(ev.id)!;
    const speakers = new Map<string, Agent[]>();
    for (const a of this.agents) {
      const r = byId.get(cohortId(a));
      if (!r) continue;
      const old = prev?.get(r.id);
      const hit = s.affected[a.id] === 1;
      const more = (v: number, o = 0) => Math.max(0, v - (old ? o : 0));
      if (hit) a.bias = { car: r.car, bike: r.bike, walk: r.walk };
      // départ avancé ou retardé, si la personne n'est pas encore partie
      const shift = r.departShift - (old?.departShift ?? 0);
      if (hit && shift && a.step === 0 && !a.trip && a.plan.length > 1 && a.plan[0].until > this.minute) {
        a.plan[0].until = Math.max(this.minute, a.plan[0].until + shift * (0.5 + this.rand()));
      }
      const avoid = r.avoidZone && !old?.avoidZone;
      const cancel = more(r.cancelLeisure, old?.cancelLeisure);
      for (let i = a.step + 1; i < a.plan.length; i++) {
        const act = a.plan[i];
        if (!LEISURE.has(act.place.kind) || act.place === a.work) continue;
        if (cancel && this.rand() < cancel) act.place = a.home;
        else if (avoid && zone.contains(act.place.x, act.place.z)) {
          for (let k = 0; k < 6; k++) {
            const alt = this.places.near(act.place.kind, a.home.x, a.home.z, this.rand, 8);
            if (!zone.contains(alt.x, alt.z)) {
              act.place = alt;
              break;
            }
          }
        }
      }
      const join = more(r.joinEvent, old?.joinEvent);
      if (join > 0 && attraction > 0 && !s.traits.attendance && a.profile !== "pendulaire" && !a.trip) this.maybeJoin(a, ev, place, join * Math.min(1.5, this.interest(a, s.traits)), s.traits.icon);
      a.satisfaction = clamp01(a.satisfaction + (r.mood - (old?.mood ?? 0)) * (hit ? 0.02 : 0.006));
      const trivial = !r.mood && !r.departShift && !r.joinEvent && !r.cancelLeisure && !r.avoidZone && Math.abs(r.car) + Math.abs(r.bike) + Math.abs(r.walk) < 0.1;
      if (r.quote && !trivial && r.quote !== old?.quote && (hit || this.rand() < 0.2)) {
        let list = speakers.get(r.id);
        if (!list) speakers.set(r.id, (list = []));
        if (list.length < 12) list.push(a);
      }
    }
    // deux porte-parole par groupe expriment la réaction collective
    for (const [id, list] of speakers) {
      const r = byId.get(id)!;
      const label = s.cohorts.find((c) => c.id === id)?.label ?? id;
      for (const a of list.sort(() => this.rand() - 0.5).slice(0, 2)) {
        a.lastThought = -999;
        this.think(a, r.mood > 0 ? "😊" : r.mood < 0 ? "😠" : "💬", r.quote, 1, label);
      }
    }
    s.applied = { day: this.day, byId };
  }

  /** Réactions des groupes reçues de Claude : appliquées tout de suite si l'événement a commencé. */
  setCohortPlan(sid: number, responses: CohortResponse[]) {
    const s = this.scheduled.get(sid);
    if (!s) return;
    s.responses = responses;
    const ev = this.dayPlan.events.find((e) => e.sid === sid && this.minute >= e.start - (e.path ? MOBILIZE : 0) && this.minute < e.end);
    if (ev && !this.pendingReactions.includes(ev)) this.applyCohorts(s, ev, responses);
  }

  /** Rues fermées à cette minute : décisions fixes, et rues autour du cortège qui avance. */
  private applyClosures() {
    const set = new Set<number>();
    this.pedestrianZones = [];
    for (const ev of this.dayPlan.events) {
      if (this.minute < ev.start || this.minute >= ev.end) continue;
      const s = ev.sid !== undefined ? this.scheduled.get(ev.sid) : undefined;
      if (ev.kind === "pietonnisation" && s) this.pedestrianZones.push(s);
      if (s?.geo.path && isProcession(ev.kind, s.traits.nature)) {
        const [head, tail] = cortege(ev, s.geo.path.length, this.minute);
        for (const r of rollingClosure(s.geo.path, head, tail)) set.add(r);
        // arrivé au bout, le rassemblement se poursuit à l'arrivée : on y déplace le lieu de l'événement
        const place = this.eventPlaces.get(ev.id)!;
        if (head >= s.geo.path.length && place.x === ev.x) this.movePlace(place, s.geo.path.xs.at(-1)!, s.geo.path.zs.at(-1)!);
      } else for (const r of ev.closedRoads) set.add(r);
    }
    this.applyDanger();
    const key = [...set].sort((a, b) => a - b).join(",");
    if (key === this.closureKey) return;
    this.closureKey = key;
    this.closedRoads = set;
    const g = this.graph;
    for (let e = 0; e < g.to.length; e++) g.closed[e] = set.has(g.edgeRoad[e]) ? 1 : 0;
    g.updateCarCosts(true);
    this.rerouteBlocked();
  }

  /**
   * Zones dangereuses en cours : plus personne n'y passe (tous modes, sauf si c'est la seule issue),
   * et ceux qui s'y rendaient ou devaient la traverser changent de route sur-le-champ.
   */
  private applyDanger() {
    const zones = this.dayPlan.events.filter((ev) => this.minute >= ev.start && this.minute < ev.end && (ev.traits?.danger ?? EVENT_SPECS[ev.kind].danger));
    const key = zones.map((ev) => ev.id).join(",");
    if (key === this.dangerKey) return;
    this.dangerKey = key;
    const g = this.graph;
    const inside = (x: number, z: number) => zones.some((ev) => Math.hypot(x - ev.x, z - ev.z) < ev.radius);
    const edges: number[] = [];
    for (let a = 0; a < g.n; a++) {
      const ina = inside(g.x[a], g.z[a]);
      for (let e = g.offset[a]; e < g.offset[a + 1]; e++) if (ina || inside(g.x[g.to[e]], g.z[g.to[e]])) edges.push(e);
    }
    g.setAvoid(edges, 40);
    if (!zones.length) return;
    for (const a of this.everyone) {
      const t = a.trip;
      if (!t) continue;
      const next = a.plan[a.step + 1];
      const threat = zones.find((ev) => Math.hypot(next.place.x - ev.x, next.place.z - ev.z) < ev.radius);
      if (threat && next.travel !== "run") {
        // il se rendait dans la zone : demi-tour vers un lieu sûr
        next.place = this.safePlace(a, threat, false);
        if (this.splice(a, next.place)) this.think(a, "⚠️", "Demi-tour, il ne faut surtout pas aller par là !", 0.5);
        continue;
      }
      let crosses = false;
      for (let i = t.seg + 1; i < t.path.nodes.length && !crosses; i += 3) crosses = inside(g.x[t.path.nodes[i]], g.z[t.path.nodes[i]]);
      if (crosses && this.splice(a, next.place)) this.think(a, "↪️", "Je fais un détour pour éviter la zone dangereuse.", 0.3);
    }
  }

  /** Recalcule la fin du trajet en cours vers `dest`, en gardant l'arête où se trouve l'habitant. */
  private splice(a: Agent, dest: Place): boolean {
    const t = a.trip!, g = this.graph;
    const node = t.mode === Mode.Car ? dest.car : t.mode === Mode.Bike ? dest.bike : dest.walk;
    const detour = g.route(t.path.nodes[t.seg + 1], node, t.mode, true);
    if (!detour) return false;
    const nodes = new Int32Array(detour.nodes.length + 1);
    nodes[0] = t.path.nodes[t.seg];
    nodes.set(detour.nodes, 1);
    const edges = new Int32Array(detour.edges.length + 1);
    edges[0] = t.path.edges[t.seg];
    edges.set(detour.edges, 1);
    const cum = new Float32Array(nodes.length);
    for (let i = 0; i < edges.length; i++) cum[i + 1] = cum[i] + g.len[edges[i]];
    t.d -= t.path.cum[t.seg];
    t.seg = 0;
    t.path = { nodes, edges, cum, length: cum[edges.length] };
    return true;
  }

  private movePlace(p: Place, x: number, z: number) {
    p.x = x;
    p.z = z;
    p.walk = this.graph.nearest(x, z, Mode.Walk);
    p.bike = this.graph.nearest(x, z, Mode.Bike);
    p.car = this.graph.nearest(x, z, Mode.Car);
  }

  /** Les automobilistes dont l'itinéraire passe par une rue qui vient de fermer prennent une déviation. */
  private rerouteBlocked() {
    const g = this.graph;
    const closing = this.dayPlan.events
      .filter((ev) => ev.sid !== undefined && this.minute >= ev.start && this.minute < ev.end && (ev.closedRoads.length || !!ev.path))
      .map((ev) => this.scheduled.get(ev.sid!))
      .filter((s): s is Scheduled => !!s);
    for (const a of this.everyone) {
      const t = a.trip;
      if (!t || t.mode !== Mode.Car) continue;
      let blocked = -1;
      for (let i = t.seg + 1; i < t.path.edges.length; i++) if (g.closed[t.path.edges[i]]) { blocked = i; break; }
      if (blocked < 0) continue;
      if (!this.splice(a, a.plan[a.step + 1].place)) continue;
      for (const s of closing) s.rerouted += AGENT_SCALE;
      const name = this.city.roads[g.edgeRoad[t.path.edges[0]]].name;
      this.think(a, "↪️", name ? `Route barrée, je contourne par ${name}.` : "Route barrée, je prends la déviation.", 0.25);
    }
  }

  /** Journal horaire, impact en direct et analyse des décisions du joueur. */
  private monitor() {
    const h = Math.floor(this.minute / 60);
    if (h !== this.lastHourLogged && h < 24) {
      this.lastHourLogged = h;
      const cells = new Map<number, number>();
      let sat = 0;
      for (const a of this.everyone) {
        if (a.profile !== "visiteur") sat += a.satisfaction;
        if (!a.trip && a.plan[a.step]?.place === a.home) continue;
        const k = cellKey(a.x, a.z);
        cells.set(k, (cells.get(k) ?? 0) + 1);
      }
      this.log.people[h] = cells;
      this.log.satisfaction[h] = sat / this.agents.length;
    }
    if (this.minute - this.lastImpact < 10) return;
    this.lastImpact = this.minute;
    for (const ev of this.dayPlan.events) {
      const s = ev.sid !== undefined ? this.scheduled.get(ev.sid) : undefined;
      if (!s || this.minute < ev.start + 15 || this.minute > ev.end + 10) continue;
      const to = Math.min(this.minute, ev.end), from = Math.max(ev.start, to - 60);
      const now = this.log.kpis(from, to, s.geo.zone, s.affected, AGENT_SCALE);
      let before = s.baseline?.kpis(from, to, s.geo.zone, s.affected, AGENT_SCALE), reference = "hier à la même heure";
      if (!before || s.baseline!.count(from, to, s.affected) < 10) {
        before = this.log.kpis(ev.start - 60, ev.start, s.geo.zone, s.affected, AGENT_SCALE);
        reference = "juste avant le début";
      }
      const active = this.minute < ev.end;
      const place = this.eventPlaces.get(ev.id)!;
      const st = this.stats.get(place);
      let participants = 0;
      if (ev.attraction > 0) for (const a of this.everyone) if (!a.trip && a.plan[a.step]?.place === place) participants += AGENT_SCALE;
      if (st && active && ev.attraction > 0) {
        st.timeline.push(participants);
        st.peak = Math.max(st.peak, participants);
        this.nuisance(st, s);
      }
      // bilan de fréquentation : seulement pour un rassemblement (pas une fermeture ni un sinistre)
      const bilan = st && !active && !s.traits.danger && ev.attraction > 0 ? this.bilan(st, s) : null;
      this.outbox.push({ type: "impact", impact: { sid: s.sid, title: ev.title, kind: ev.kind, minute: Math.round(this.minute), active, reference, before, now, rerouted: s.rerouted, participants, timeline: st?.timeline ?? [], bilan } });
      if (st && bilan && !st.bilanSent) {
        st.bilanSent = true;
        this.outbox.push({ type: "bilanRequest", sid: s.sid, event: s.summary, bilan });
      }
      // l'analyse attend une heure de recul et assez de trajets mesurés (pas en pleine nuit)
      if (!s.analysisSent && this.minute - ev.start >= Math.min(60, (ev.end - ev.start) * 0.6) && this.log.count(from, to, s.affected) >= Math.min(30, 5 + s.affectedCount * 0.05)) {
        s.analysisSent = true;
        this.outbox.push({ type: "analysisRequest", sid: s.sid, event: s.summary, before, after: now, reference });
      }
    }
  }

  /** Riverains gênés par le bruit et la foule, surtout tard le soir près d'une scène. */
  private nuisance(st: EventStats, s: Scheduled) {
    const t = s.traits, ev = st.ev;
    if (ev.attraction <= 0 || t.nature === "perturbation" || t.nature === "danger") return;
    const late = this.minute >= 22 * 60;
    const loud = this.venues.get(st.place)?.layout.facing != null;
    const p = (late ? 0.006 : 0.001) * (loud ? 2 : 0.6) * Math.max(0.1, 1 - t.mood * 0.35);
    const reach = ev.radius + 250;
    for (const a of this.agents) {
      if (a.trip || a.plan[a.step]?.place !== a.home || a.profile === "touriste") continue;
      if (Math.abs(a.home.x - st.place.x) > reach || Math.abs(a.home.z - st.place.z) > reach) continue;
      if (Math.hypot(a.home.x - st.place.x, a.home.z - st.place.z) > reach || this.rand() >= p) continue;
      st.complaints += AGENT_SCALE;
      a.satisfaction = clamp01(a.satisfaction - 0.01);
      a.lastThought = -999;
      this.think(a, "😠", late
        ? ["Il est presque minuit et la musique résonne encore jusqu'ici…", "Impossible de dormir avec ce concert.", "J'ai des enfants qui dorment, quand même !"][a.id % 3]
        : ["Plus une place pour se garer dans le quartier.", "Que de monde en bas de chez moi aujourd'hui…", "Les voitures des visiteurs partout sur les trottoirs."][a.id % 3], 0.6);
    }
  }

  /** Bilan d'un événement de la journée, une fois terminé. */
  private bilan(st: EventStats, s: Scheduled): EventBilan {
    const ev = st.ev, zone = s.geo.zone, end = Math.min(ev.end, 1440);
    const during = this.log.kpis(ev.start, end, zone, null, AGENT_SCALE).zoneRevenue - st.place.revenue;
    const before = s.baseline?.kpis(ev.start, end, zone, null, AGENT_SCALE).zoneRevenue ?? 0;
    return {
      attendees: st.residents + st.outsiders, residents: st.residents, outsiders: st.outsiders, peak: st.peak,
      ticketRevenue: Math.round(st.ticket), onsiteSpend: Math.round(st.place.revenue),
      zoneRevenue: Math.max(0, Math.round(during)), zoneRevenueBefore: Math.round(before),
      visitorCarTrips: st.visitorCarTrips, visitorCarKm: Math.round(st.visitorCarKm),
      co2Tonnes: +((st.visitorCarKm * CO2_PER_CAR_KM) / 1000).toFixed(2),
      visitorTravel: Math.round(st.visitorTravel / Math.max(1, st.visitorArrivals)),
      complaints: st.complaints, rerouted: s.rerouted,
    };
  }

  /** État du trafic par rue pour la carte : 0 vide, 1 fermée, 2..255 du plus lent au plus fluide. */
  traffic(): Uint8Array {
    const out = new Uint8Array(this.city.roads.length);
    for (let r = 0; r < out.length; r++) {
      if (this.closedRoads.has(r)) out[r] = 1;
      else if (this.emaLoad[r] > 0.004) out[r] = 2 + Math.round(clamp01(this.emaFactor[r]) * 253);
    }
    return out;
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
    for (const ev of [...this.pendingReactions]) {
      if (this.minute < ev.start - (ev.path ? MOBILIZE : 0)) continue;
      this.pendingReactions.splice(this.pendingReactions.indexOf(ev), 1);
      this.react(ev);
    }
    this.applyClosures();
    this.updateTraffic(dtMin);
    this.monitor();
    const dtSec = dtMin * 60;
    const hour = Math.min(23, Math.floor(this.minute / 60));
    for (const a of this.everyone) {
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
    for (const a of this.everyone) {
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
    // moyenne glissante (~10 min) pour la couche trafic
    const k = Math.min(1, 0.1 * dtMin);
    for (let r = 0; r < this.emaLoad.length; r++) {
      const load = this.roadLoad[r] > 0 ? this.roadLoad[r] / Math.max(1, this.roadStorage[r]) : 0;
      this.emaLoad[r] += (load - this.emaLoad[r]) * k;
      this.emaFactor[r] += (this.roadFactor[r] - this.emaFactor[r]) * k;
    }
  }

  /** Spending scales with household income per consumption unit (elasticity 0.6, bounded). */
  private spendFactor(a: Agent): number {
    return clamp((a.household.income / INCOME_MEDIAN) ** 0.6, 0.5, 2);
  }

  private lowIncome(a: Agent): boolean {
    return a.profile !== "touriste" && a.household.income < 0.6 * INCOME_MEDIAN;
  }

  private chooseMode(a: Agent, from: Place, to: Place): Mode {
    if (a.carpoolDay === this.day) return Mode.Car;
    // le visiteur venu en train marche depuis la gare (ou prend la navette) ; sinon il vient en voiture
    if (a.profile === "visiteur") return a.hasCar ? Mode.Car : Mode.Walk;
    if (a.profile === "transit") return Mode.Car;
    if (a.profile === "frontalier" || a.profile === "pendulaire") {
      // sans voiture, le frontalier rejoint la gare à vélo ou à pied
      return a.hasCar ? Mode.Car : a.hasBike ? Mode.Bike : Mode.Walk;
    }
    const d = Math.hypot(to.x - from.x, to.z - from.z) * 1.3;
    const centre = Math.hypot(to.x, to.z) < 1100;
    // utilités en « minutes équivalentes » (plus c'est bas, mieux c'est)
    const w = this.dayPlan.weather.kind;
    const wet = w === "pluie" || w === "neige";
    // la marche reste naturelle sous 800 m environ, puis devient vite pénible (enquêtes ménages-déplacements)
    const walkMin = d / WALK_SPEED / 60;
    const options: [Mode, number][] = [[Mode.Walk, walkMin * (1 + Math.max(0, d - 800) / 1200) * (a.age > 70 ? 1.6 : 1) * (a.age < 11 ? 1.3 : 1) * (wet ? 1.4 : 1) + (d > 2500 ? 30 : 0)]];
    // le vélo demande un effort et un équipement : une minorité l'utilise au quotidien (~5 % à Annecy)
    if (a.hasBike && a.age >= 8) options.push([Mode.Bike, d / BIKE_SPEED / 60 + 11 / this.policy.bikeComfort + (wet ? 15 : 0) + (w === "neige" ? 25 : 0)]);
    if (a.hasCar && a.age >= 18 && a.profile !== "enfant") {
      const parking = centre && to !== a.home ? this.policy.parkingPrice * 4 : 0; // 1 € ≈ 4 min de « valeur »
      // l'habitude compte : celui qui prend sa voiture tous les jours la reprend
      options.push([Mode.Car, (d / 8.5 / 60) * this.policy.carFriction + 3 + parking - (a.usualMode === 3 ? 3 : 0)]);
    }
    if (a.profile === "touriste") options[0][1] *= 0.6;
    // préférences décidées pour son groupe face à un événement (1 point ≈ 12 min de « valeur »)
    if (a.bias) for (const o of options) o[1] -= 12 * (o[0] === Mode.Car ? a.bias.car : o[0] === Mode.Bike ? a.bias.bike : a.bias.walk);
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
    const key = mode === Mode.Car ? "car" : mode === Mode.Bike ? "bike" : "walk";
    this.trips[key]++;
    // home -> work trips of employed residents (cumulative, for calibration against INSEE)
    if (to.kind === "work" && from === a.home && !style && (a.profile === "salarie" || a.profile === "commercant")) this.commuteTrips[key]++;
    if (!style && from === a.home) a.usualMode = mode;
    if (a.profile === "visiteur" && mode === Mode.Car) {
      const st = this.stats.get(this.visitorTarget.get(a.id)!);
      if (st) {
        st.visitorCarTrips += AGENT_SCALE;
        st.visitorCarKm += (path.length / 1000) * AGENT_SCALE;
      }
    }
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
      if (!t.style) this.log.arrival(this.minute, a.id, t.mode, actual, t.freeMinutes);
    }
    a.step++;
    const place = a.plan[a.step].place;
    a.x = place.x;
    a.z = place.z;
    if (place === a.home) a.tourMode = null;
    const blackout = !!this.active("panne") && place.kind !== "event" && place.kind !== "lake";
    // dans une rue piétonne, on flâne plus longtemps et on dépense davantage
    const pedestrian = this.pedestrianZones.some((s) => s.geo.zone.contains(place.x, place.z));
    const st = this.stats.get(place);
    if (st && !st.seen.has(a.id)) {
      st.seen.add(a.id);
      if (a.profile === "visiteur") {
        st.outsiders += AGENT_SCALE;
        if (t) {
          st.visitorTravel += this.minute - t.startMinute;
          st.visitorArrivals++;
        }
      } else st.residents += AGENT_SCALE;
      if (a.age >= 12) st.ticket += (st.ev.traits?.ticket ?? 0) * AGENT_SCALE;
    }
    const base = st?.ev.traits ? st.ev.traits.spend : SPEND[place.kind] ?? 0;
    const spend = blackout ? 0 : (a.age < 12 ? 0 : base) * this.spendFactor(a) * (a.profile === "touriste" ? 1.5 : 1) * (pedestrian ? 1.3 : 1) * (0.6 + this.rand() * 0.8);
    if (spend > 0) {
      place.revenue += spend * AGENT_SCALE;
      a.spentToday += spend;
      this.log.spend(this.minute, place.x, place.z, spend * AGENT_SCALE);
    }
    if (pedestrian && SPEND[place.kind]) {
      a.needs.fun = clamp01(a.needs.fun + 0.1);
      this.think(a, "🚶", ["Agréable, cette rue sans voitures.", "On entend enfin les terrasses plutôt que les moteurs.", "Je reste un peu plus longtemps, c'est calme."][a.id % 3], 0.2);
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
      case "food":
        if (this.lowIncome(a)) say("💸", 0.2, "Un restau, c'est cher… faut faire attention en fin de mois.", "Je me suis privé·e, mais ça fait plaisir.");
        else say("🍝", 0.15, "Bien mangé ce midi.", "Une bonne tartiflette, parfait.", "Un peu cher, ce restaurant…");
        break;
      case "grocery":
        if (this.lowIncome(a)) say("💸", 0.25, "Les prix ont encore augmenté, la fin de mois approche…", "J'ai pris les marques distributeur, il faut compter.");
        else if (a.profile === "inactif") say("🛒", 0.15, "Le frigo est plein pour la semaine.", "Les courses, c'est fait, direction la maison.");
        else say("🛒", 0.1, "Les courses, c'est fait.", "Les prix ont encore augmenté…");
        break;
      case "shop": if (this.lowIncome(a)) { say("💸", 0.2, "Tout est trop cher, j'attendrai les soldes.", "Je regarde mais je n'achète pas, fin de mois oblige."); break; }
        say("🛍️", 0.15, "Trouvé exactement ce que je cherchais.", "Il y a trop de vitrines vides en ville."); break;
      case "culture": say("🎨", 0.3, "Belle expo, je recommande.", "Le château d'Annecy vaut le détour."); break;
      case "school": if (a.profile === "enfant") say("🎒", 0.1, "Vivement la récré !", "J'ai oublié mes devoirs…"); break;
      case "event": {
        const ev = this.dayPlan.events.find((e) => this.eventPlaces.get(e.id) === place);
        if (ev?.kind === "marche") say("🧀", 0.6, "Du reblochon au marché, parfait.", "Les fruits du marché sont superbes.", "Le marché de la vieille ville, une institution.");
        else if (ev?.kind === "concert") say("🎶", 0.7, "Super ambiance au concert !", "Ce groupe est génial.", "Le son porte jusqu'au lac !");
        else if (ev?.kind === "brocante") say("🪑", 0.6, "Dégoté une vieille lampe à la brocante.", "Que de trésors à la brocante !");
        else if (ev?.traits) say(ev.traits.icon, 0.5, ...(ENJOY[ev.traits.nature] ?? [`Sympa, ${place.name}.`]).map((l) => l.replace("{}", ev.title)));
        else say("✨", 0.5, `Sympa, ${place.name}.`);
        break;
      }
      case "home":
        if (a.profile === "chomeur") say("📄", 0.1, "Une réponse à ma candidature ? Toujours rien…", "Je retravaille mon CV ce soir.", "France Travail m'a proposé une formation.");
        break;
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
    // événements qui finissent à minuit : bilan avant de tourner la page
    for (const st of this.stats.values()) {
      const s = st.ev.sid !== undefined ? this.scheduled.get(st.ev.sid) : undefined;
      if (!s || st.bilanSent || s.traits.danger || st.ev.attraction <= 0) continue;
      st.bilanSent = true;
      const bilan = this.bilan(st, s);
      this.outbox.push({ type: "bilanRequest", sid: s.sid, event: s.summary, bilan });
      const k = this.log.kpis(st.ev.start, 1440, s.geo.zone, s.affected, AGENT_SCALE);
      this.outbox.push({ type: "impact", impact: { sid: s.sid, title: st.ev.title, kind: st.ev.kind, minute: 1440, active: false, reference: "fin de journée", before: k, now: k, rerouted: s.rerouted, participants: 0, timeline: st.timeline, bilan } });
    }
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
      households: this.households.length,
      meanHouseholdSize: +(this.agents.length / Math.max(1, this.households.length)).toFixed(2),
      events: this.dayPlan.events.map((e) => ({
        kind: e.kind, title: e.title, visits: this.eventPlaces.get(e.id)!.visits * AGENT_SCALE,
        icon: e.traits?.icon ?? EVENT_SPECS[e.kind].icon, start: e.start, end: e.end, byPlayer: !!e.byPlayer, ...(e.sid !== undefined ? { sid: e.sid } : {}),
      })),
    };
    this.graph.closed.fill(0);
    this.graph.updateCarCosts(true);
    this.closureKey = "";
    if (this.dangerKey) this.graph.setAvoid([], 1);
    this.dangerKey = "";
    this.closedRoads = new Set();
    this.prevLog = this.log;
    this.log = new DayLog();
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
    for (const a of this.everyone) {
      if ((n + 1) * STRIDE > out.length) break;
      let mode = 0, x = a.x, z = a.z, heading = a.heading, extra = 0;
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
        // les voitures suivantes s'écrivent juste après celle-ci
        if (mode === Mode.Car) extra = this.followers(a, out, n + 1);
      } else {
        const place = a.plan[a.step]?.place;
        if (!place || !OUTDOOR.has(place.kind)) continue;
        const venue = this.venues.get(place);
        if (venue && this.minute < venue.ev.end) {
          const facing = venue.layout.facing;
          [x, z] = crowdSpot(venue.layout, hash01(a.id * 7 + 3), hash01(a.id * 5 + 1), (px, pz) => this.water.isWater(px, pz));
          // face à la scène (mode 6, ils dansent) ; sans scène, ils déambulent en petits groupes (mode 0)
          heading = facing !== null ? facing + (hash01(a.id * 13) - 0.5) * 0.6 : hash01(a.id * 3 + 2) * Math.PI * 2;
          mode = facing !== null ? 6 : 0;
          a.x = x;
          a.z = z;
          out.set([x, z, heading, mode, PROFILES.indexOf(a.profile), a.id], n * STRIDE);
          n++;
          continue;
        }
        const stay = this.routeStays.get(place);
        if (stay && this.minute < stay.ev.end) {
          const p = this.onRoute(a, stay.ev, stay.path);
          if (p) {
            [x, z, heading, mode] = p;
            a.x = x;
            a.z = z;
            const o = n * STRIDE;
            out.set([x, z, heading, mode, PROFILES.indexOf(a.profile), a.id], o);
            n++;
            continue;
          }
        }
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
      n += 1 + extra;
    }
    return n;
  }

  /**
   * Une voiture simulée en représente AGENT_SCALE : on dessine les autres en file derrière elle sur
   * le même itinéraire, collées dans un bouchon, espacées quand ça roule. Profil 100 + k = voiture suiveuse.
   */
  private followers(a: Agent, out: Float32Array, start: number): number {
    let n = start;
    const t = a.trip!, g = this.graph, p = t.path;
    const flow = this.roadFactor[g.edgeRoad[p.edges[t.seg]]];
    const gap = 7 + 28 * flow;
    let seg = t.seg;
    for (let k = 1; k < AGENT_SCALE; k++) {
      const d = t.d - k * gap;
      if (d < 0 || (n + 1) * 6 > out.length) break;
      while (seg > 0 && p.cum[seg] > d) seg--;
      const e = p.edges[seg], n0 = p.nodes[seg], n1 = p.nodes[seg + 1];
      const kk = (d - p.cum[seg]) / (g.len[e] || 1);
      const heading = Math.atan2(g.x[n1] - g.x[n0], g.z[n1] - g.z[n0]);
      const lat = this.city.roads[g.edgeRoad[e]].w / 4;
      const x = g.x[n0] + (g.x[n1] - g.x[n0]) * kk - Math.cos(heading) * lat;
      const z = g.z[n0] + (g.z[n1] - g.z[n0]) * kk + Math.sin(heading) * lat;
      if (this.water.isWater(x, z)) continue;
      out.set([x, z, heading, Mode.Car, 100 + k, a.id], n++ * 6);
    }
    return n - start;
  }

  /**
   * Position d'un participant sur le parcours : dans le cortège qui avance (manifestation),
   * en course ou au bord du parcours (course à pied). [x, z, cap, mode] ou null.
   */
  private onRoute(a: Agent, ev: CityEvent, path: RoutePath): [number, number, number, number] | null {
    const u = hash01(a.id * 7 + 3), v = hash01(a.id * 5 + 1);
    let d: number, mode: number, lateral: number;
    if (isProcession(ev.kind, ev.traits?.nature ?? "civique")) {
      const [head, tail] = cortege(ev, path.length, this.minute);
      if (head <= 0) {
        // rassemblement : petits groupes sur les premières dizaines de mètres
        d = u * 70;
        mode = 0;
      } else {
        d = tail + (head - tail) * u;
        mode = head >= path.length ? 0 : 1;
      }
      lateral = (v - 0.5) * 12;
    } else if (u < 0.65) {
      // coureurs : 9 à 15 km/h, en boucle sur le parcours
      const speed = 150 + v * 100;
      d = this.minute < ev.start ? v * 40 : ((this.minute - ev.start) * speed + v * 120) % path.length;
      mode = this.minute < ev.start ? 0 : 4;
      lateral = (hash01(a.id * 11) - 0.5) * 5;
    } else {
      // spectateurs le long du parcours
      d = v * path.length;
      mode = 0;
      lateral = (hash01(a.id * 13) < 0.5 ? -1 : 1) * (7 + u * 4);
    }
    const [px, pz, heading] = pointAt(path, d);
    const x = px - Math.cos(heading) * lateral, z = pz + Math.sin(heading) * lateral;
    if (this.water.isWater(x, z)) return [px, pz, heading, mode];
    return [x, z, mode === 0 ? hash01(a.id * 3 + 2) * Math.PI * 2 : heading, mode];
  }

  /** Household summary and each member's relation to `a`, derived from roles (adult / child) and household kind. */
  private householdInfo(a: Agent): AgentInfo["household"] {
    const hh = a.household;
    const nAdults = hh.kind === "famille" ? 2 : hh.kind === "monoparentale" ? 1 : hh.members.length;
    const isChild = (m: Agent) => (hh.kind === "famille" || hh.kind === "monoparentale" ? hh.members.indexOf(m) >= nAdults : m.age < 18);
    const kids = hh.members.filter(isChild).length;
    const plural = (n: number) => `${n} enfant${n > 1 ? "s" : ""}`;
    const kind = {
      seul: "personne seule", colocation: "colocation", couple: "couple sans enfant",
      famille: `couple avec ${plural(kids)}`, monoparentale: `famille monoparentale, ${plural(kids)}`,
      touristes: "groupe de touristes", pendulaire: "vit hors de la zone",
    }[hh.kind];
    const relation = (m: Agent) => {
      const c = isChild(m);
      if (isChild(a)) return c ? "frère / sœur" : "parent";
      if (c) return "enfant";
      return hh.kind === "colocation" ? "colocataire" : hh.kind === "couple" || hh.kind === "famille" ? "conjoint·e" : "compagnon de voyage";
    };
    return {
      kind, cars: hh.cars,
      members: hh.members.filter((m) => m !== a).map((m) => ({ id: m.id, name: m.name, age: m.age, relation: relation(m) })),
    };
  }

  /** Fiche détaillée d'un habitant, pour l'interface. */
  inspect(id: number): AgentInfo | null {
    const a = this.everyone[id];
    if (!a) return null;
    const label = (p: Place) => (p === a.home ? (a.profile === "pendulaire" ? "Domicile (hors zone)" : "Domicile") : p === a.work ? `Travail${p.name ? ` · ${p.name}` : ""}` : p.name ?? PLACE_LABEL[p.kind]);
    const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
    const current = a.plan[a.step];
    const mode = a.trip ? (a.trip.style === "run" ? "en courant" : a.trip.style === "dog" ? "avec son chien 🐕" : ["", "à pied", "à vélo", "en voiture"][a.trip.mode]) : null;
    return {
      id: a.id, name: a.name, age: a.age, sex: a.sex, csp: a.csp ? CSP_LABEL[a.csp] : null, partTime: a.partTime,
      monthlyIncome: Math.round(a.household.income / 12 / 10) * 10,
      household: this.householdInfo(a),
      profile: a.profile,
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
      mind: this.mind(a),
      thoughts: a.thoughtLog.slice().reverse().map((th) => ({ icon: th.icon, text: th.text, when: th.day === this.day ? hhmm(th.minute) : "hier" })),
    };
  }

  /** Compteurs en direct pour l'interface. */
  liveCounts() {
    const c = { walk: 0, bike: 0, car: 0, outdoor: 0, outside: 0, run: 0, dog: 0, satisfaction: 0 };
    for (const a of this.everyone) {
      if (a.profile === "visiteur") {
        if (a.plan.length === 1) continue;
      } else c.satisfaction += a.satisfaction / this.agents.length;
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

const PANIC: Partial<Record<CityEvent["kind"], string[]>> = {
  meteorite: ["Une MÉTÉORITE !! Courez !", "Le ciel nous tombe sur la tête !"],
  inondation: ["L'eau monte, vite, en hauteur !", "Ma cave est inondée !"],
  tsunami: ["Une vague géante sur le lac !!", "Fuyez les quais !"],
  incendie: ["Au feu ! Au feu !", "Il y a une fumée noire partout !"],
  seisme: ["Ça tremble ! Sortez des bâtiments !", "J'ai cru que l'immeuble allait tomber !"],
  tempete: ["Les arbres plient, c'est dangereux !", "Mon parapluie s'est envolé !"],
};
const CURIOUS: Partial<Record<CityEvent["kind"], string[]>> = {
  ovni: ["Un OVNI ! Il faut que je filme ça !", "Ils viennent en paix… j'espère ?"],
  feu_artifice: ["Oooh ! Aaah ! Magnifique !", "Le feu d'artifice se reflète dans le lac !"],
  pique_nique: ["J'apporte la tomme et le saucisson !", "Pique-nique au soleil, le rêve."],
  concert: ["J'entends la musique d'ici !", "Allez, on y va !"],
  festival: ["L'ambiance du festival est géniale !", "Il y a un monde fou !"],
  marche: ["Je vais faire un tour au marché.", "Des produits frais, parfait."],
  manifestation: ["Il y a du monde dans la rue !", "C'est pour quoi, cette manif ?"],
};
/** En route vers un événement, selon sa nature. */
const GOING: Partial<Record<string, string[]>> = {
  festif: ["Ce soir on sort, j'ai hâte !", "Tout le monde sera là-bas."],
  culturel: ["Je ne voulais pas rater ça.", "Ça a l'air passionnant."],
  sportif: ["Allez, on va encourager !", "J'espère qu'il y aura de l'ambiance."],
  commercial: ["Je vais faire un tour, on trouve toujours quelque chose.", "Il paraît qu'il y a de bonnes affaires."],
  civique: ["C'est important d'être présent·e.", "On sera nombreux, j'espère."],
};
/** Sur place, selon la nature de l'événement ({} = son nom). */
const ENJOY: Partial<Record<string, string[]>> = {
  festif: ["Quelle ambiance à {} !", "Le son est énorme, je ne regrette pas d'être venu·e.", "On danse depuis une heure, génial."],
  culturel: ["Vraiment réussi, {}.", "Une belle découverte.", "Le cadre au bord du lac est magique."],
  sportif: ["Quel match ! L'ambiance est folle.", "Bravo aux athlètes !", "Belle organisation, {}."],
  commercial: ["J'ai trouvé un cadeau, parfait.", "Les exposants sont passionnés.", "Un peu cher, mais sympa."],
  civique: ["Beaucoup de monde, c'est réconfortant.", "Le message passe bien."],
  perturbation: ["Quelle galère…"],
};

const WEATHER_TALK: Partial<Record<CityEvent["kind"], string[]>> = {
  tempete: ["Quelle tempête ! Restez chez vous.", "Les éclairs au-dessus du lac, impressionnant."],
  blizzard: ["Tout est blanc, la ville est paralysée !", "On se croirait au Semnoz !"],
  canicule: ["Il fait une chaleur écrasante !", "Vivement l'air frais du lac."],
  inondation: ["Les rues sont inondées…", "Quelle pluie, ça déborde partout."],
  panne: ["Toute la ville est dans le noir !", "Plus de courant nulle part…"],
};

function hash01(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
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

function flatten(path: RoutePath): number[] {
  const out: number[] = [];
  for (let i = 0; i < path.xs.length; i++) out.push(Math.round(path.xs[i] * 10) / 10, Math.round(path.zs[i] * 10) / 10);
  return out;
}

/** "HH:MM" → minutes, ou null. */
function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2})[:h](\d{2})?$/.exec(s.trim());
  return m ? Math.min(1439, Number(m[1]) * 60 + Number(m[2] ?? 0)) : null;
}

const hhmm = (m: number) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;
