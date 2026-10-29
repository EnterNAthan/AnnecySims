// Panneau « Décisions » : pour chaque décision du joueur, la réaction des groupes d'habitants
// (Claude, porte-parole par profil × quartier), l'impact mesuré et la note d'analyse.
import { EVENT_SPECS } from "../shared/catalog";
import type { Analysis, CohortResponse, CohortStat, EventSummary, Kpis } from "../shared/advisors";
import type { EventBilan, Impact } from "../sim/protocol";

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

interface Decision {
  sid: number;
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
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export class DecisionsPanel {
  private decisions = new Map<number, Decision>();
  private readonly el = $("#decisions");

  constructor(
    private readonly send: {
      cohortPlan(sid: number, responses: CohortResponse[]): void;
      cancel(sid: number): void;
      goTo(sid: number): void;
      follow(sid: number): void;
    },
  ) {
    this.el.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!t) return;
      const sid = Number(t.dataset.sid);
      if (t.dataset.act === "cancel") {
        this.send.cancel(sid);
        this.decisions.delete(sid);
        this.render();
      } else if (t.dataset.act === "goto") this.send.goTo(sid);
      else if (t.dataset.act === "follow") this.send.follow(sid);
    });
  }

  /** Nouvelle décision : on demande à Claude comment chaque groupe concerné va s'organiser. */
  request(sid: number, event: EventSummary, cohorts: CohortStat[]) {
    const d: Decision = { sid, event, cohorts, responses: null, source: null, ready: Promise.resolve(), impact: null, analysis: null, analysing: false, bilan: null, report: null, reporting: false };
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
    this.render();
  }

  impact(i: Impact) {
    const d = this.decisions.get(i.sid);
    if (!d) return;
    d.impact = i;
    this.render();
  }

  /** Événement terminé : chiffres du bilan, puis note de Claude pour la prochaine édition. */
  async bilan(sid: number, event: EventSummary, bilan: EventBilan) {
    const d = this.decisions.get(sid);
    if (!d) return;
    d.bilan = bilan;
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

  private render() {
    const list = [...this.decisions.values()].reverse().slice(0, 4);
    this.el.classList.toggle("hidden", !list.length);
    this.el.innerHTML = `<div class="panel-title">🏛️ Décisions</div>` + list.map((d) => this.card(d)).join("");
  }

  private card(d: Decision): string {
    const spec = EVENT_SPECS[d.event.kind];
    const icon = d.event.traits?.icon ?? spec.icon;
    const i = d.impact;
    const status = !i ? `<div class="muted small">⏳ Programmé ${d.event.when}. L'impact s'affichera après le début.</div>` : "";
    return `
      <details class="decision" open>
        <summary>
          <span class="d-icon">${icon}</span>
          <span class="d-title"><b>${d.event.title}</b><small>${i ? (i.active ? "🔴 en cours" : "✔ terminé") : d.event.when}</small></span>
          <button data-act="follow" data-sid="${d.sid}" title="Suivre l'événement avec la caméra">🎥</button>
          <button data-act="goto" data-sid="${d.sid}" title="Voir sur la carte">📍</button>
          <button data-act="cancel" data-sid="${d.sid}" title="Annuler la décision">✕</button>
        </summary>
        ${status}
        ${this.params(d)}
        ${this.bilanBlock(d)}
        ${i && i.timeline.length > 1 ? this.attendance(i) : ""}
        ${i ? this.impactTable(i) : ""}
        ${this.voices(d)}
        ${this.analysisBlock(d)}
      </details>`;
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

  /** Courbe de fréquentation depuis le début (toutes les 10 min). */
  private attendance(i: Impact) {
    const pts = i.timeline, max = Math.max(1, ...pts), w = 300, h = 46;
    const path = pts.map((v, k) => `${k ? "L" : "M"}${((k / Math.max(1, pts.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
    return `<div class="sub">👥 Fréquentation <span class="badge">${fmt(pts[pts.length - 1])} présents · pic ${fmt(max)}</span></div>
      <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${path} L${w},${h} L0,${h} Z" class="area"/><path d="${path}" class="line"/></svg>`;
  }

  private bilanBlock(d: Decision) {
    const b = d.bilan;
    if (!b) return "";
    const r = d.report;
    const shops = b.zoneRevenue - b.zoneRevenueBefore;
    const cell = (label: string, value: string) => `<div class="kpi"><small>${label}</small><b>${value}</b></div>`;
    return `<div class="bilan">
      <div class="sub">📊 Bilan de l'événement ${r ? `<span class="badge verdict ${r.verdict === "réussite" ? "good" : r.verdict === "mitigé" ? "flat" : "bad"}">${r.verdict}</span>` : ""}</div>
      <div class="kpis">
        ${cell("Participants", fmt(b.attendees))}
        ${cell("Dont extérieurs", fmt(b.outsiders))}
        ${cell("Pic de foule", fmt(b.peak))}
        ${cell("Billetterie", `${fmt(b.ticketRevenue / 1000)} k€`)}
        ${cell("Dépenses sur place", `${fmt(b.onsiteSpend / 1000)} k€`)}
        ${cell("Commerces voisins", `${shops >= 0 ? "+" : ""}${fmt(shops / 1000)} k€`)}
        ${cell("Km en voiture (visiteurs)", fmt(b.visitorCarKm))}
        ${cell("CO₂", `${b.co2Tonnes} t`)}
        ${cell("Plaintes riverains", fmt(b.complaints))}
      </div>
      ${d.reporting ? `<div class="muted small"><span class="spinner"></span> Claude rédige le bilan…</div>` : ""}
      ${r ? `<b>${r.headline}</b><p>${r.summary}</p>
        ${r.positives.length ? `<div class="small">👍 ${r.positives.join(" · ")}</div>` : ""}
        ${r.negatives.length ? `<div class="small">👎 ${r.negatives.join(" · ")}</div>` : ""}
        <div class="reco">💡 Prochaine édition : ${r.recommendation}</div>` : ""}
    </div>`;
  }

  private impactTable(i: Impact) {
    const b = i.before, n = i.now;
    // sens : +1 = une hausse est une bonne nouvelle, -1 = mauvaise, 0 = neutre
    const row = (label: string, before: string, now: string, delta: number, sense: number, unit = "%") => {
      const cls = Math.abs(delta) < 0.03 || !sense ? "flat" : delta * sense > 0 ? "good" : "bad";
      const d = unit === "%" ? `${delta > 0 ? "+" : ""}${Math.round(delta * 100)} %` : `${delta > 0 ? "+" : ""}${Math.round(delta * 100)} pts`;
      return `<tr><td>${label}</td><td>${before}</td><td>→</td><td><b>${now}</b></td><td class="${cls}">${Math.abs(delta) < 0.005 ? "=" : d}</td></tr>`;
    };
    const rel = (a: number, c: number) => (a > 0 ? c / a - 1 : 0);
    return `
      <table class="impact">
        ${row("Trajet moyen", `${b.tripMinutes} min`, `${n.tripMinutes} min`, rel(b.tripMinutes, n.tripMinutes), -1)}
        ${row("Retard voiture", pct(b.congestion), pct(n.congestion), n.congestion - b.congestion, -1, "pts")}
        ${row("Part voiture", pct(b.carShare), pct(n.carShare), n.carShare - b.carShare, 0, "pts")}
        ${row("Part vélo", pct(b.bikeShare), pct(n.bikeShare), n.bikeShare - b.bikeShare, 0, "pts")}
        ${row("Présents (zone)", fmt(b.zonePeople), fmt(n.zonePeople), rel(b.zonePeople, n.zonePeople), 0)}
        ${row("CA zone / h", `${fmt(b.zoneRevenue)} €`, `${fmt(n.zoneRevenue)} €`, rel(b.zoneRevenue, n.zoneRevenue), 1)}
      </table>
      <div class="muted small">Habitants concernés, dernière heure, comparé à ${i.reference}.</div>
      ${i.participants || i.rerouted ? `<div class="chips-row">${i.participants ? `<span>👥 ${fmt(i.participants)} ${i.kind === "manifestation" ? "manifestants" : i.kind === "marathon" ? "coureurs et spectateurs" : "personnes sur place"}</span>` : ""}${i.rerouted ? `<span>↪️ ${fmt(i.rerouted)} automobilistes déviés</span>` : ""}</div>` : ""}`;
  }

  private voices(d: Decision) {
    if (!d.cohorts.length) return "";
    if (!d.responses) return `<div class="voices"><div class="sub">🗣️ Voix des quartiers</div><div class="muted small"><span class="spinner"></span> Claude consulte ${d.cohorts.length} groupes d'habitants…</div></div>`;
    const byId = new Map(d.cohorts.map((c) => [c.id, c]));
    const shown = d.responses
      .map((r) => ({ r, c: byId.get(r.id)! }))
      .filter((x) => x.c && x.r.quote)
      .sort((a, b) => b.c.people * (0.2 + b.c.affectedShare) * (1 + Math.abs(b.r.mood)) - a.c.people * (0.2 + a.c.affectedShare) * (1 + Math.abs(a.r.mood)))
      .slice(0, 4);
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
    return `<div class="voices"><div class="sub">🗣️ Voix des quartiers <span class="badge">${d.source === "claude" ? "✨ Claude" : "règles"}</span></div>
      ${shown.map(({ r, c }) => `<div class="voice"><span class="m">${mood(r.mood)}</span><div><b>${c.label}</b> <small>${fmt(c.people)} pers. · ${pct(c.affectedShare)} concernés</small><br><em>« ${r.quote} »</em>${what(r) ? `<div class="acts">${what(r)}</div>` : ""}</div></div>`).join("")}
    </div>`;
  }

  private analysisBlock(d: Decision) {
    if (d.analysing) return `<div class="analysis muted small"><span class="spinner"></span> Claude rédige la note d'impact…</div>`;
    const a = d.analysis;
    if (!a) return "";
    return `<div class="analysis">
      <div class="sub">📝 Note d'impact <span class="badge">${a.source === "claude" ? "✨ Claude" : "règles"}</span></div>
      <b>${a.headline}</b>
      <p>${a.summary}</p>
      ${a.winners.length ? `<div class="small">👍 ${a.winners.join(", ")}</div>` : ""}
      ${a.losers.length ? `<div class="small">👎 ${a.losers.join(", ")}</div>` : ""}
      <div class="reco">💡 ${a.recommendation}</div>
    </div>`;
  }
}
