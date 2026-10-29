// Compte rendu d'une décision du joueur : un grand panneau qui raconte l'événement étape par étape
// (annonce → réactions des habitants → en direct → note d'impact → bilan), avec les chiffres clés en tête.
import { EVENT_SPECS } from "../shared/catalog";
import type { Analysis, CohortResponse, CohortStat, EventSummary, Kpis } from "../shared/advisors";
import type { EventBilan, EventSchedule, Impact } from "../sim/protocol";

interface FinalReport {
  verdict: "réussite" | "mitigé" | "à revoir";
  headline: string;
  summary: string;
  positives: string[];
  negatives: string[];
  recommendation: string;
  source: "claude" | "local";
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const hhmm = (m: number) => `${Math.floor(m / 60) % 24}h${String(Math.round(m % 60)).padStart(2, "0")}`;
/** « 2 h 15 », « 40 min » */
const span = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")}` : `${Math.max(1, Math.round(min))} min`);

export interface Decision {
  sid: number;
  /** jour de la simulation où la décision a été prise */
  day: number;
  event: EventSummary;
  cohorts: CohortStat[];
  responses: CohortResponse[] | null;
  source: "claude" | "local" | null;
  ready: Promise<void>;
  impact: Impact | null;
  analysis: Analysis | null;
  analysing: boolean;
  bilan: EventBilan | null;
  report: FinalReport | null;
  reporting: boolean;
  cancelled?: boolean;
  /** événement courant de la ville (pas une décision) : pas d'avis des groupes, analyse sur demande */
  auto?: boolean;
  /** premier jour et horaires, pour le compte à rebours et l'avance rapide */
  schedule?: EventSchedule;
  /** compte rendu fourni par la page (bouchon de Marc), redessiné à chaque rafraîchissement */
  custom?: () => string;
}

/** Où en est une décision : programmée, en cours, terminée. */
type Phase = "scheduled" | "live" | "ended";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export class DecisionsPanel {
  private decisions = new Map<number, Decision>();
  private readonly el = $("#decisions");
  /** décision affichée dans le compte rendu (-1 : panneau fermé) */
  private focused = -1;
  private now = { day: 1, minute: 0 };

  constructor(
    private readonly send: {
      cohortPlan(sid: number, responses: CohortResponse[]): void;
      cancel(sid: number): void;
      goTo(sid: number): void;
      follow(sid: number): void;
      /** avance rapide jusqu'au jour et à la minute donnés */
      skipTo(day: number, minute: number, label: string): void;
      /** nouvelle décision : place le curseur dans la barre de commande */
      newDecision(): void;
    },
  ) {
    this.el.addEventListener("click", (e) => {
      const ask = (e.target as HTMLElement).closest<HTMLElement>("[data-ask]");
      if (ask) this.requestReport(Number(ask.dataset.ask));
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!t) return;
      const sid = Number(t.dataset.sid);
      const d = this.decisions.get(sid);
      const act = t.dataset.act;
      if (act === "cancel") {
        this.send.cancel(sid);
        // la décision reste dans l'historique, marquée annulée
        if (d) d.cancelled = true;
        this.focus(-1);
      } else if (act === "goto") this.send.goTo(sid);
      else if (act === "follow") this.send.follow(sid);
      else if (act === "close") this.focus(-1);
      else if (act === "tab") this.focus(sid);
      else if (act === "new") this.send.newDecision();
      else if (act === "skip-start" && d?.schedule) this.send.skipTo(d.schedule.day, d.schedule.start, `début · ${hhmm(d.schedule.start)}`);
      else if (act === "skip-end" && d) {
        const end = this.endOf(d);
        // le bilan tombe 10 min après la fin, ou à minuit pour un événement qui finit avec la journée
        if (end && end.minute >= 1425) this.send.skipTo(end.day + 1, 2, `bilan · minuit`);
        else if (end) this.send.skipTo(end.day, end.minute + 11, `bilan · ${hhmm(end.minute)}`);
      }
    });
  }

  /** appelé à chaque changement (pour l'historique) */
  onChange: () => void = () => {};

  /** Toutes les décisions, de la plus récente à la plus ancienne. */
  all(): Decision[] {
    return [...this.decisions.values()].reverse();
  }

  /** Rapport complet d'une décision (pour l'historique). */
  detail(sid: number): string {
    const d = this.decisions.get(sid);
    return d ? `<div class="f-report">${this.head(d, true)}${d.custom ? d.custom() : this.body(d)}</div>` : "";
  }

  /** Ouvre (ou ferme avec -1) le compte rendu d'une décision. */
  focus(sid: number) {
    this.focused = this.decisions.has(sid) ? sid : -1;
    this.render();
  }

  get focusedSid() {
    return this.focused;
  }

  has(sid: number) {
    return this.decisions.has(sid);
  }

  /** Compte rendu fourni par la page (hors simulation), ouvert aussitôt. */
  showCustom(sid: number, event: EventSummary, day: number, schedule: EventSchedule, custom: () => string) {
    if (!this.decisions.has(sid)) {
      this.decisions.set(sid, { sid, day, event, cohorts: [], responses: null, source: null, ready: Promise.resolve(), impact: null, analysis: null, analysing: false, bilan: null, report: null, reporting: false, auto: true, schedule, custom });
    }
    this.focus(sid);
  }

  /** Redessine le compte rendu ouvert (chiffres en direct). */
  refresh() {
    if (this.focused !== -1) this.render();
  }

  /** Heure de la simulation : compte à rebours et phase (appelé régulièrement par la page). */
  tick(day: number, minute: number) {
    const prev = this.now;
    this.now = { day, minute };
    const d = this.decisions.get(this.focused);
    if (!d) return;
    // la phase a changé (début atteint) : on redessine, sinon on met juste à jour le compte à rebours
    if (this.phase(d, prev) !== this.phase(d)) this.render();
    else {
      const c = this.el.querySelector(".f-countdown");
      if (c) c.textContent = this.countdown(d);
    }
  }

  /** Événement courant de la ville : suivi dans l'historique, pas dans le panneau. */
  track(sid: number, event: EventSummary, day: number) {
    this.decisions.set(sid, { sid, day, event, cohorts: [], responses: null, source: null, ready: Promise.resolve(), impact: null, analysis: null, analysing: false, bilan: null, report: null, reporting: false, auto: true });
    this.onChange();
  }

  /** Analyse de Claude à la demande (événements de la ville). */
  async requestReport(sid: number) {
    const d = this.decisions.get(sid);
    if (!d?.bilan) return;
    d.reporting = true;
    this.render();
    try {
      d.report = await post<FinalReport>("/api/bilan", { event: d.event, bilan: d.bilan });
    } catch {
      /* facultatif */
    }
    d.reporting = false;
    this.render();
  }

  /** Nouvelle décision : on demande à Claude comment chaque groupe concerné va s'organiser, et on l'affiche. */
  request(sid: number, event: EventSummary, cohorts: CohortStat[], day: number, schedule: EventSchedule) {
    const d: Decision = { sid, day, event, cohorts, responses: null, source: null, ready: Promise.resolve(), impact: null, analysis: null, analysing: false, bilan: null, report: null, reporting: false, schedule };
    this.decisions.set(sid, d);
    if (cohorts.length) {
      d.ready = post<{ responses: CohortResponse[]; source: "claude" | "local" }>("/api/cohorts", { event, cohorts })
        .then((out) => {
          d.responses = out.responses;
          d.source = out.source;
          this.send.cohortPlan(sid, out.responses);
        })
        .catch(() => {})
        .finally(() => this.render());
    }
    this.focus(sid);
  }

  impact(i: Impact) {
    const d = this.decisions.get(i.sid);
    if (!d) return;
    d.impact = i;
    if (!d.auto) this.render();
  }

  /** Événement terminé : chiffres du bilan, puis note de Claude pour la prochaine édition. */
  async bilan(sid: number, event: EventSummary, bilan: EventBilan) {
    const d = this.decisions.get(sid);
    if (!d) return;
    d.bilan = bilan;
    // événement courant : pas d'appel automatique à Claude (il y en a plusieurs par jour)
    if (d.auto) {
      this.onChange();
      return;
    }
    d.reporting = true;
    this.render();
    try {
      d.report = await post<FinalReport>("/api/bilan", { event, bilan });
    } catch {
      /* facultatif */
    }
    d.reporting = false;
    this.render();
  }

  /** Une heure après le début : note d'impact chiffrée, rédigée par Claude à partir des mesures. */
  async analyse(sid: number, before: Kpis, after: Kpis) {
    const d = this.decisions.get(sid);
    if (!d) return;
    d.analysing = true;
    this.render();
    await d.ready;
    try {
      d.analysis = await post<Analysis>("/api/analyze", { event: d.event, before, after, cohorts: d.cohorts, responses: d.responses ?? [] });
    } catch {
      /* l'analyse est facultative */
    }
    d.analysing = false;
    this.render();
  }

  // ---------- état ----------

  private phase(d: Decision, now = this.now): Phase {
    if (d.impact) return d.impact.active ? "live" : "ended";
    const s = d.schedule;
    if (!s) return "scheduled";
    const t = now.day * 1440 + now.minute;
    if (t < s.day * 1440 + s.start) return "scheduled";
    return t < s.day * 1440 + s.end ? "live" : "ended";
  }

  /** Fin de l'occurrence en cours (ou de la première) de l'événement. */
  private endOf(d: Decision): { day: number; minute: number } | null {
    const s = d.schedule;
    if (!s) return null;
    const day = Math.min(Math.max(this.now.day, s.day), s.lastDay);
    return { day, minute: s.end };
  }

  private countdown(d: Decision): string {
    const s = d.schedule;
    if (!s) return "";
    const ph = this.phase(d);
    const t = this.now.day * 1440 + this.now.minute;
    if (ph === "scheduled") return `dans ${span(s.day * 1440 + s.start - t)}`;
    if (ph === "live") {
      const end = this.endOf(d)!;
      return `encore ${span(Math.max(0, end.day * 1440 + end.minute - t))}`;
    }
    return "";
  }

  /** Événement de rassemblement (public attendu) plutôt qu'une perturbation. */
  private gathering(d: Decision) {
    return (d.event.traits?.attendance ?? 0) > 0 || (d.impact?.participants ?? 0) > 0;
  }

  // ---------- rendu ----------

  private render() {
    this.onChange();
    const d = this.decisions.get(this.focused);
    document.body.classList.toggle("focusing", !!d);
    this.el.classList.toggle("hidden", !d);
    if (!d) {
      this.el.innerHTML = "";
      return;
    }
    // garder la position de lecture et les sections dépliées d'un rendu à l'autre
    const body = this.el.querySelector(".f-body");
    const scroll = body?.scrollTop ?? 0;
    const open = new Set([...this.el.querySelectorAll<HTMLDetailsElement>("details[data-k]")].filter((x) => x.open).map((x) => x.dataset.k));
    const others = [...this.decisions.values()].filter((x) => !x.auto && !x.cancelled && x.sid !== d.sid && this.phase(x) !== "ended");
    this.el.innerHTML = `
      ${others.length ? `<div class="f-tabs">${others.map((x) => `<button data-act="tab" data-sid="${x.sid}">${x.event.traits?.icon ?? EVENT_SPECS[x.event.kind].icon} ${x.event.title}</button>`).join("")}</div>` : ""}
      ${this.head(d)}
      ${d.custom ? "" : this.steps(d)}
      <div class="f-body">${d.custom ? d.custom() : this.body(d)}</div>
      ${d.custom ? "" : this.actions(d)}`;
    const nb = this.el.querySelector(".f-body");
    if (nb) nb.scrollTop = scroll;
    this.el.querySelectorAll<HTMLDetailsElement>("details[data-k]").forEach((x) => open.has(x.dataset.k) && (x.open = true));
  }

  private head(d: Decision, inHistory = false) {
    const icon = d.event.traits?.icon ?? EVENT_SPECS[d.event.kind].icon;
    const ph = this.phase(d);
    const status = d.cancelled ? `<span class="f-pill">annulé</span>`
      : ph === "live" ? `<span class="f-pill live">● En direct</span>`
      : ph === "ended" ? `<span class="f-pill done">✔ Terminé</span>`
      : `<span class="f-pill">Programmé</span>`;
    return `<div class="f-head">
      <span class="f-icon">${icon}</span>
      <div class="f-title">
        <div class="f-status">${status}<span class="f-countdown">${inHistory ? "" : this.countdown(d)}</span></div>
        <h2>${d.event.title}</h2>
        <small>${d.event.when}</small>
      </div>
      ${inHistory ? "" : `<button class="f-x" data-act="close" title="Fermer le compte rendu">✕</button>`}
    </div>`;
  }

  /** Les cinq étapes du compte rendu, avec ce qui est fait, en cours, à venir. */
  private steps(d: Decision) {
    const ph = this.phase(d);
    const ended = ph === "ended";
    const gathering = this.gathering(d);
    const state = (done: boolean, active: boolean) => (done ? "done" : active ? "active" : "");
    const steps: [string, string][] = [
      ["Décision", "done"],
      ["Réactions", state(!d.cohorts.length || !!d.responses, true)],
      ["En direct", state(ended, ph === "live")],
      ["Analyse", state(!!d.analysis || (ended && !d.analysing), d.analysing)],
      ["Bilan", state(!!d.report || (ended && !gathering), d.reporting || (ended && gathering && !d.bilan))],
    ];
    return `<ol class="f-steps">${steps.map(([label, s]) => `<li class="${s}"><i></i>${label}</li>`).join("")}</ol>`;
  }

  private body(d: Decision) {
    return [this.hero(d), this.tiles(d), this.bilanBlock(d), this.analysisBlock(d), this.voices(d), this.params(d), this.details(d)].join("");
  }

  /** Le message principal, en grand : ce qui compte maintenant. */
  private hero(d: Decision) {
    const ph = this.phase(d);
    const r = d.report, a = d.analysis, i = d.impact;
    if (r) {
      const cls = r.verdict === "réussite" ? "good" : r.verdict === "mitigé" ? "flat" : "bad";
      return `<div class="f-hero ${cls}"><span class="f-verdict">${r.verdict}</span><b>${r.headline}</b></div>`;
    }
    if (a) return `<div class="f-hero"><span class="f-kicker">Note d'impact ${a.source === "claude" ? "✨" : ""}</span><b>${a.headline}</b></div>`;
    if (ph === "live" && i) {
      const people = i.participants;
      const trip = i.before.tripMinutes > 0 ? i.now.tripMinutes / i.before.tripMinutes - 1 : 0;
      const tripLine = Math.abs(trip) >= 0.02 ? `trajets ${trip > 0 ? "rallongés" : "raccourcis"} de ${Math.round(Math.abs(trip) * 100)} %` : "circulation inchangée";
      const line = people ? `${fmt(people)} personnes sur place, ${tripLine} pour les habitants concernés` : tripLine[0].toUpperCase() + tripLine.slice(1) + (i.rerouted ? `, ${fmt(i.rerouted)} automobilistes déviés` : "");
      return `<div class="f-hero"><span class="f-kicker">En direct · ${hhmm(i.minute)}</span><b>${line}</b></div>`;
    }
    if (ph === "live") return `<div class="f-hero"><span class="f-kicker">C'est parti</span><b>Premières mesures dans quelques instants…</b></div>`;
    if (ph === "ended") return `<div class="f-hero"><span class="f-kicker">Terminé</span><b>${d.reporting ? "Claude rédige le bilan…" : "Événement terminé"}</b></div>`;
    return `<div class="f-hero"><span class="f-kicker">Programmé</span><b>Début ${d.event.when.split(",")[0]}</b></div>`;
  }

  /** Quatre chiffres clés, comparés à la situation sans l'événement. */
  private tiles(d: Decision) {
    const i = d.impact;
    const gathering = this.gathering(d);
    const labels = gathering ? ["Sur place", "Trajet moyen", "Parkings proches", "Commerces / h"] : ["Trajet moyen", "Retard voiture", "Automobilistes déviés", "Commerces / h"];
    if (!i) return `<div class="f-tiles">${labels.map((l) => `<div class="tile wait"><small>${l}</small><b>—</b><em>mesuré dès le début</em></div>`).join("")}</div>`;
    const b = i.before, n = i.now;
    // sens : +1 = une hausse est une bonne nouvelle, -1 = mauvaise
    const tile = (label: string, value: string, delta: string, change: number, sense: number, extra = "") => {
      const cls = Math.abs(change) < 0.03 || !sense ? "flat" : change * sense > 0 ? "good" : "bad";
      return `<div class="tile ${cls}"><small>${label}</small><b>${value}</b><em>${delta}</em>${extra}</div>`;
    };
    const rel = (a: number, c: number) => (a > 0 ? c / a - 1 : 0);
    // au-delà du triple, un multiplicateur se lit mieux qu'un pourcentage
    const relLabel = (v: number) => (Math.abs(v) < 0.005 ? "inchangé" : v >= 2 ? `×${fmt(v + 1)}` : `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`);
    const pts = (v: number) => (Math.abs(v) < 0.005 ? "inchangé" : `${v > 0 ? "+" : ""}${Math.round(v * 100)} pts`);
    const trip = rel(b.tripMinutes, n.tripMinutes);
    const shops = rel(b.zoneRevenue, n.zoneRevenue);
    const tripTile = tile("Trajet moyen", `${n.tripMinutes} min`, `${relLabel(trip)} · avant ${b.tripMinutes} min`, trip, -1);
    const shopTile = tile("Commerces / h", `${fmt(n.zoneRevenue)} €`, `${relLabel(shops)} vs sans événement`, shops, 1);
    if (gathering) {
      const peak = Math.max(0, ...i.timeline);
      const people = tile("Sur place", fmt(i.participants), i.active ? `pic ${fmt(peak)}` : `pic ${fmt(peak)} · terminé`, 0, 0, this.spark(i.timeline));
      const park = n.parking >= 0
        ? tile("Parkings proches", pct(n.parking), `${pts(n.parking - Math.max(0, b.parking))}`, n.parking - Math.max(0, b.parking), -1)
        : tile("Automobilistes déviés", fmt(i.rerouted), "depuis le début", 0, 0);
      return `<div class="f-tiles">${people}${tripTile}${park}${shopTile}</div>`;
    }
    const delay = n.congestion - b.congestion;
    return `<div class="f-tiles">${tripTile}${tile("Retard voiture", pct(n.congestion), `${pts(delay)} · avant ${pct(b.congestion)}`, delay, -1)}${tile("Automobilistes déviés", fmt(i.rerouted), "depuis le début", i.rerouted ? -1 : 0, i.rerouted ? 1 : 0)}${shopTile}</div>
      <div class="f-ref">Habitants concernés, dernière heure, comparé à ${i.reference}.</div>`;
  }

  /** Courbe de fréquentation (toutes les 10 min). */
  private spark(pts: number[]) {
    if (pts.length < 2) return "";
    const max = Math.max(1, ...pts), w = 120, h = 28;
    const path = pts.map((v, k) => `${k ? "L" : "M"}${((k / (pts.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 3)).toFixed(1)}`).join(" ");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${path} L${w},${h} L0,${h} Z" class="area"/><path d="${path}" class="line"/></svg>`;
  }

  private bilanBlock(d: Decision) {
    const b = d.bilan;
    if (!b) return "";
    const r = d.report;
    const shops = b.zoneRevenue - b.zoneRevenueBefore;
    const cell = (label: string, value: string) => `<div><small>${label}</small><b>${value}</b></div>`;
    return `<section class="f-card">
      <h4>📊 Bilan de l'événement</h4>
      <div class="f-grid">
        ${cell("Participants", fmt(b.attendees))}
        ${cell("Dont extérieurs", fmt(b.outsiders))}
        ${cell("Pic de foule", fmt(b.peak))}
        ${cell("Billetterie", `${fmt(b.ticketRevenue / 1000)} k€`)}
        ${cell("Dépenses sur place", `${fmt(b.onsiteSpend / 1000)} k€`)}
        ${cell("Commerces voisins", `${shops >= 0 ? "+" : ""}${fmt(shops / 1000)} k€`)}
        ${cell("Km en voiture", fmt(b.visitorCarKm))}
        ${cell("CO₂", `${b.co2Tonnes} t`)}
        ${cell("Plaintes riverains", fmt(b.complaints))}
      </div>
      ${d.reporting ? `<div class="f-wait"><span class="spinner"></span> Claude rédige le bilan…</div>` : ""}
      ${r ? `<p>${r.summary}</p>
        ${r.positives.length || r.negatives.length ? `<div class="f-pn">${r.positives.map((x) => `<span class="good">＋ ${x}</span>`).join("")}${r.negatives.map((x) => `<span class="bad">－ ${x}</span>`).join("")}</div>` : ""}
        <div class="reco">💡 Prochaine édition : ${r.recommendation}</div>` : ""}
      ${d.auto && !r && !d.reporting ? `<button class="ask" data-ask="${d.sid}">✨ Demander l'analyse à Claude</button>` : ""}
    </section>`;
  }

  private analysisBlock(d: Decision) {
    const ph = this.phase(d);
    if (d.analysing) return `<section class="f-card"><h4>📝 Note d'impact</h4><div class="f-wait"><span class="spinner"></span> Claude compare la ville avant et pendant l'événement…</div></section>`;
    const a = d.analysis;
    if (!a) return ph === "live" && !d.auto ? `<section class="f-card dim"><h4>📝 Note d'impact</h4><div class="muted small">Rédigée par Claude après une heure de mesures.</div></section>` : "";
    return `<section class="f-card">
      <h4>📝 Note d'impact <span class="badge">${a.source === "claude" ? "✨ Claude" : "règles"}</span></h4>
      ${d.report ? `<b>${a.headline}</b>` : ""}
      <p>${a.summary}</p>
      ${a.winners.length || a.losers.length ? `<div class="f-pn">${a.winners.map((x) => `<span class="good">＋ ${x}</span>`).join("")}${a.losers.map((x) => `<span class="bad">－ ${x}</span>`).join("")}</div>` : ""}
      <div class="reco">💡 ${a.recommendation}</div>
    </section>`;
  }

  private voices(d: Decision) {
    if (!d.cohorts.length) return "";
    if (!d.responses) return `<section class="f-card"><h4>🗣️ Réactions des habitants</h4><div class="f-wait"><span class="spinner"></span> Claude consulte ${d.cohorts.length} groupes d'habitants concernés…</div></section>`;
    const byId = new Map(d.cohorts.map((c) => [c.id, c]));
    const shown = d.responses
      .map((r) => ({ r, c: byId.get(r.id)! }))
      .filter((x) => x.c && x.r.quote)
      .sort((a, b) => b.c.people * (0.2 + b.c.affectedShare) * (1 + Math.abs(b.r.mood)) - a.c.people * (0.2 + a.c.affectedShare) * (1 + Math.abs(a.r.mood)))
      .slice(0, 3);
    const mood = (m: number) => (m >= 2 ? "😄" : m === 1 ? "🙂" : m === 0 ? "😐" : m === -1 ? "😕" : "😠");
    const what = (r: CohortResponse) =>
      [
        r.departShift ? `départ ${r.departShift > 0 ? "+" : ""}${r.departShift} min` : "",
        r.car <= -0.3 ? "moins de voiture" : r.car >= 0.3 ? "plus de voiture" : "",
        r.bike >= 0.3 ? "plus de vélo" : "",
        r.walk >= 0.3 ? "plus de marche" : "",
        r.joinEvent >= 0.05 ? `${Math.round(r.joinEvent * 100)} % y vont` : "",
        r.cancelLeisure >= 0.2 ? "sorties annulées" : "",
        r.avoidZone ? "évitent la zone" : "",
      ].filter(Boolean).join(" · ");
    const moods = d.responses.map((r) => r.mood);
    const avg = moods.reduce((s, m) => s + m, 0) / Math.max(1, moods.length);
    return `<section class="f-card">
      <h4>🗣️ Réactions des habitants <span class="badge">${d.source === "claude" ? "✨ Claude" : "règles"}</span><span class="f-mood">${mood(Math.round(avg))} ${d.responses.length} groupes</span></h4>
      ${shown.map(({ r, c }) => `<div class="voice"><span class="m">${mood(r.mood)}</span><div><b>${c.label}</b> <small>${fmt(c.people)} pers. · ${pct(c.affectedShare)} concernés</small><em>« ${r.quote} »</em>${what(r) ? `<div class="acts">${what(r)}</div>` : ""}</div></div>`).join("")}
    </section>`;
  }

  /** Paramètres principaux de l'événement, en une ligne. */
  private params(d: Decision) {
    const t = d.event.traits;
    if (!t || (!t.attendance && !t.setup.length)) return "";
    const bits = [
      t.attendance ? `👥 ${fmt(t.attendance)} attendus / jour` : "",
      t.attendance ? (t.ticket ? `🎟️ ${t.ticket} €` : "🎟️ gratuit") : "",
      t.shuttles ? "🚌 navettes" : "",
      t.audience !== "tous" ? `public : ${t.audience}` : "",
    ].filter(Boolean);
    return `<div class="chips-row">${bits.map((b) => `<span>${b}</span>`).join("")}</div>`;
  }

  /** Tous les indicateurs mesurés, repliés par défaut. */
  private details(d: Decision) {
    const i = d.impact;
    if (!i) return "";
    const b = i.before, n = i.now;
    const row = (label: string, before: string, now: string, delta: number, sense: number, unit = "%") => {
      const cls = Math.abs(delta) < 0.03 || !sense ? "flat" : delta * sense > 0 ? "good" : "bad";
      const v = unit === "%" ? `${delta > 0 ? "+" : ""}${Math.round(delta * 100)} %` : `${delta > 0 ? "+" : ""}${Math.round(delta * 100)} pts`;
      return `<tr><td>${label}</td><td>${before}</td><td><b>${now}</b></td><td class="${cls}">${Math.abs(delta) < 0.005 ? "=" : v}</td></tr>`;
    };
    const rel = (a: number, c: number) => (a > 0 ? c / a - 1 : 0);
    return `<details class="f-more" data-k="more-${d.sid}">
      <summary>Tous les indicateurs</summary>
      <table class="impact">
        <tr><th></th><th>avant</th><th>pendant</th><th></th></tr>
        ${row("Trajet moyen", `${b.tripMinutes} min`, `${n.tripMinutes} min`, rel(b.tripMinutes, n.tripMinutes), -1)}
        ${row("Retard voiture", pct(b.congestion), pct(n.congestion), n.congestion - b.congestion, -1, "pts")}
        ${row("Part voiture", pct(b.carShare), pct(n.carShare), n.carShare - b.carShare, 0, "pts")}
        ${row("Part vélo", pct(b.bikeShare), pct(n.bikeShare), n.bikeShare - b.bikeShare, 0, "pts")}
        ${row("Part bus", pct(b.busShare ?? 0), pct(n.busShare ?? 0), (n.busShare ?? 0) - (b.busShare ?? 0), 0, "pts")}
        ${n.parking >= 0 ? row("Parkings proches", pct(Math.max(0, b.parking)), pct(n.parking), n.parking - Math.max(0, b.parking), -1, "pts") : ""}
        ${row("Présents (zone)", fmt(b.zonePeople), fmt(n.zonePeople), rel(b.zonePeople, n.zonePeople), 0)}
        ${row("CA zone / h", `${fmt(b.zoneRevenue)} €`, `${fmt(n.zoneRevenue)} €`, rel(b.zoneRevenue, n.zoneRevenue), 1)}
      </table>
      <div class="f-ref">Habitants concernés, dernière heure, comparé à ${i.reference}.${i.rerouted ? ` ${fmt(i.rerouted)} automobilistes déviés.` : ""}</div>
    </details>`;
  }

  /** Le bouton qui fait avancer la démonstration, selon l'étape. */
  private actions(d: Decision) {
    const ph = this.phase(d);
    const s = d.schedule;
    const primary = ph === "scheduled" && s
      ? `<button class="primary" data-act="skip-start" data-sid="${d.sid}">⏩ Avancer jusqu'au début · ${hhmm(s.start)}</button>`
      : ph === "live" && s
        ? `<button class="primary" data-act="skip-end" data-sid="${d.sid}">⏭ Aller au bilan · ${hhmm(s.end)}</button>`
        : `<button class="primary" data-act="new">✦ Nouvelle décision</button>`;
    return `<div class="f-actions">
      ${primary}
      <button data-act="follow" data-sid="${d.sid}" title="Suivre l'événement avec la caméra">🎥</button>
      ${ph !== "ended" ? `<button data-act="cancel" data-sid="${d.sid}" title="Annuler la décision">Annuler</button>` : ""}
    </div>`;
  }
}
