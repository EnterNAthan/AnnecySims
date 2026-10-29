// Historique : tendances de la ville jour après jour, tous les événements (décisions et vie de la ville)
// avec leur rapport, et les bilans quotidiens.
import type { DayReport } from "../sim/protocol";
import type { DecisionsPanel } from "./decisions";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const fmt = (n: number) => Math.round(n).toLocaleString("fr-FR");
const hhmm = (m: number) => `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, "0")}`;
const dayName = (r: DayReport) => new Date(r.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

type Selection = { type: "decision"; sid: number } | { type: "city"; day: number; index: number } | { type: "day"; day: number } | null;

export class HistoryPanel {
  private days: DayReport[] = [];
  private tab: "events" | "days" = "events";
  private selection: Selection = null;
  private readonly el = $("#history");

  constructor(private readonly decisions: DecisionsPanel, private readonly dayHtml: (r: DayReport) => string) {
    decisions.onChange = () => this.refresh();
    $("#history-open").onclick = () => this.toggle(true);
    this.el.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-h]");
      if (!t) return;
      const a = t.dataset.h!;
      if (a === "close") this.toggle(false);
      else if (a === "tab-events" || a === "tab-days") {
        this.tab = a === "tab-events" ? "events" : "days";
        this.selection = null;
      } else if (a === "decision") this.selection = { type: "decision", sid: Number(t.dataset.sid) };
      else if (a === "city") this.selection = { type: "city", day: Number(t.dataset.day), index: Number(t.dataset.index) };
      else if (a === "day") this.selection = { type: "day", day: Number(t.dataset.day) };
      this.render();
    });
    this.el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.toggle(false);
    });
  }

  addDay(r: DayReport) {
    this.days.push(r);
    this.refresh();
  }

  private toggle(open: boolean) {
    this.el.classList.toggle("hidden", !open);
    if (open) this.render();
  }

  private refresh() {
    if (!this.el.classList.contains("hidden")) this.render();
  }

  private render() {
    const decisions = this.decisions.all();
    this.el.innerHTML = `
      <div class="h-head">
        <h2>📚 Historique de la ville</h2>
        <div class="seg">
          <button data-h="tab-events" class="${this.tab === "events" ? "active" : ""}">Événements (${decisions.length + this.cityEvents().length})</button>
          <button data-h="tab-days" class="${this.tab === "days" ? "active" : ""}">Journées (${this.days.length})</button>
        </div>
        <button data-h="close" class="h-close" title="Fermer (Échap)">✕</button>
      </div>
      ${this.trends()}
      <div class="h-body">
        <div class="h-list">${this.tab === "events" ? this.eventList() : this.dayList()}</div>
        <div class="h-detail">${this.detail()}</div>
      </div>`;
  }

  /** Événements de la ville (marchés, concerts, travaux…) relevés dans les bilans quotidiens. */
  private cityEvents() {
    return this.days.flatMap((r) => r.events.map((e, index) => ({ r, e, index })).filter((x) => !x.e.byPlayer));
  }

  /** Petits graphiques jour par jour, avec les décisions du joueur en repère. */
  private trends() {
    if (this.days.length < 2) return `<div class="muted small h-trends-empty">Les tendances apparaîtront après deux journées complètes.</div>`;
    const decisionDays = new Set(this.decisions.all().map((d) => d.day));
    const chart = (label: string, values: number[], format: (v: number) => string, good: 1 | -1) => {
      const w = 220, h = 44, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
      const x = (i: number) => (i / (values.length - 1)) * w, y = (v: number) => h - 4 - ((v - min) / span) * (h - 8);
      const path = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
      const marks = this.days.map((r, i) => (decisionDays.has(r.day) ? `<line x1="${x(i)}" x2="${x(i)}" y1="0" y2="${h}" class="mark"/>` : "")).join("");
      const last = values[values.length - 1], first = values[0];
      const trend = last === first ? "flat" : (last > first ? 1 : -1) * good > 0 ? "good" : "bad";
      return `<div class="trend"><small>${label}</small><b>${format(last)}</b><span class="${trend}">${last >= first ? "▲" : "▼"}</span>
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${marks}<path d="${path}" class="line"/></svg></div>`;
    };
    const d = this.days;
    return `<div class="h-trends">
      ${chart("Satisfaction", d.map((r) => r.satisfaction * 100), (v) => `${Math.round(v)} %`, 1)}
      ${chart("Congestion", d.map((r) => r.congestion * 100), (v) => `+${Math.round(v)} %`, -1)}
      ${chart("Chiffre d'affaires", d.map((r) => r.revenueTotal / 1000), (v) => `${fmt(v)} k€`, 1)}
      ${chart("CO₂ voitures", d.map((r) => r.co2Tonnes), (v) => `${v.toFixed(1)} t`, -1)}
      <div class="muted small">Traits verticaux : jours où une décision a été prise.</div>
    </div>`;
  }

  private eventList() {
    const decisions = this.decisions.all();
    const rows: string[] = [];
    if (decisions.length) rows.push(`<div class="sub">🏛️ Vos décisions</div>`);
    for (const d of decisions) {
      const b = d.bilan, i = d.impact;
      const fig = b ? `👥 ${fmt(b.attendees)}` : i ? `trajets ${i.now.tripMinutes >= i.before.tripMinutes ? "+" : ""}${Math.round((i.now.tripMinutes / Math.max(0.1, i.before.tripMinutes) - 1) * 100)} %` : "programmé";
      const sel = this.selection?.type === "decision" && this.selection.sid === d.sid;
      rows.push(`<button class="h-row ${sel ? "sel" : ""}" data-h="decision" data-sid="${d.sid}">
        <span class="h-icon">${d.event.traits?.icon ?? "📍"}</span>
        <span><b>${d.event.title}</b><small>jour ${d.day} · ${d.cancelled ? "annulé" : d.report ? d.report.verdict : i?.active ? "en cours" : i ? "terminé" : d.event.when}</small></span>
        <em>${fig}</em></button>`);
    }
    const city = this.cityEvents();
    if (city.length) rows.push(`<div class="sub">🏙️ Vie de la ville</div>`);
    for (const { r, e, index } of city.slice().reverse()) {
      const sel = this.selection?.type === "city" && this.selection.day === r.day && this.selection.index === index;
      rows.push(`<button class="h-row ${sel ? "sel" : ""}" data-h="city" data-day="${r.day}" data-index="${index}">
        <span class="h-icon">${e.icon}</span><span><b>${e.title}</b><small>jour ${r.day} · ${dayName(r)}</small></span><em>${e.visits ? `👥 ${fmt(e.visits)}` : ""}</em></button>`);
    }
    return rows.join("") || `<div class="muted small">Aucun événement pour l'instant.</div>`;
  }

  private dayList() {
    return this.days.slice().reverse().map((r) => {
      const sel = this.selection?.type === "day" && this.selection.day === r.day;
      return `<button class="h-row ${sel ? "sel" : ""}" data-h="day" data-day="${r.day}">
        <span class="h-icon">📅</span><span><b>Jour ${r.day}</b><small>${dayName(r)} · ${r.weather.kind}, ${r.weather.tempC} °C</small></span>
        <em>${Math.round(r.satisfaction * 100)} %</em></button>`;
    }).join("") || `<div class="muted small">Le premier bilan arrive à minuit.</div>`;
  }

  private detail() {
    const s = this.selection;
    if (!s) return `<div class="muted h-hint">Choisissez un événement ou une journée pour voir son rapport.</div>`;
    if (s.type === "decision") return this.decisions.detail(s.sid);
    const r = this.days.find((x) => x.day === s.day);
    if (!r) return "";
    if (s.type === "day") return `<div class="h-day">${this.dayHtml(r)}</div>`;
    const e = r.events[s.index];
    // ce que la journée a été, pour situer l'événement
    return `<div class="h-city">
      <h3>${e.icon} ${e.title}</h3>
      <div class="muted small">Jour ${r.day} · ${dayName(r)} · ${hhmm(e.start)} – ${hhmm(e.end)}</div>
      <div class="kpis">
        <div class="kpi"><small>Visiteurs</small><b>${fmt(e.visits)}</b></div>
        <div class="kpi"><small>Satisfaction du jour</small><b>${Math.round(r.satisfaction * 100)} %</b></div>
        <div class="kpi"><small>Congestion du jour</small><b>+${Math.round(r.congestion * 100)} %</b></div>
      </div>
      ${r.jams.length ? `<div class="sub">Bouchons ce jour-là</div><ul>${r.jams.map((j) => `<li>${j.name} (−${Math.round(j.slowdown * 100)} %)</li>`).join("")}</ul>` : ""}
      <div class="muted small">Événement de la vie courante : il n'a pas d'analyse détaillée. Les décisions du maire sont mesurées en continu (habitants concernés, voix des quartiers, bilan).</div>
    </div>`;
  }
}
