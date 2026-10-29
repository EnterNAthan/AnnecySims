// Barre de commande en langage naturel : demande → interprétation (Claude) → aperçu et confirmation → événement.
import { EVENT_SPECS, type EventProposal } from "../shared/catalog";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface CommandContext {
  time(): string;
  weather(): string;
  /** montre (ou efface) sur la carte les rues et le parcours concernés */
  preview(p: EventProposal | null): void;
}

/** Suggestions : gestion urbaine courante, et scénarios extrêmes derrière l'interrupteur. */
const SUGGESTIONS: [string, string, boolean][] = [
  ["🚧 Travaux av. de Genève", "Ferme l'avenue de Genève pour travaux pendant 2 semaines à partir de demain", false],
  ["📣 Manif Gare → Préfecture", "Une manifestation part de la gare à 14h et va jusqu'à la préfecture", false],
  ["🚆 Grève Léman Express", "Grève du Léman Express demain, plus aucun train vers Genève", false],
  ["🚶 Piétonniser rue Royale", "Piétonnise la rue Royale ce week-end", false],
  ["🏃 Course autour du lac", "Course à pied autour du lac dimanche matin à 9h", false],
  ["⛔ Fermer av. du Rhône", "Ferme l'avenue du Rhône toute la journée", false],
  ["⛈️ Orage violent", "Un orage violent éclate cet après-midi", false],
  ["☄️ Météorite", "Une énorme météorite s'écrase sur le Pâquier", true],
  ["🌊 Tsunami", "Un tsunami déferle sur le lac", true],
  ["🫨 Séisme", "Un tremblement de terre secoue Annecy", true],
  ["🛸 OVNI", "Un OVNI apparaît au-dessus du Pâquier", true],
];

const hm = (s: string) => s.replace(":", "h");

/** « demain dès 7h30, 10 h par jour, pendant 14 jours » */
export function describeWhen(p: EventProposal): string {
  const day = p.dayOffset === 0 ? "aujourd'hui" : p.dayOffset === 1 ? "demain" : `dans ${p.dayOffset} jours`;
  const start = p.startTime ? `${p.dayOffset === 0 ? "" : day + " "}à ${hm(p.startTime)}` : p.dayOffset === 0 ? "maintenant" : `${day}, dès minuit`;
  const dur = p.durationMinutes >= 1440 ? "toute la journée" : p.durationMinutes >= 60 ? `${Math.round(p.durationMinutes / 6) / 10} h${p.days > 1 ? " par jour" : ""}` : `${p.durationMinutes} min`;
  return `${start} · ${dur}${p.days > 1 ? ` · pendant ${p.days} jours` : ""}`;
}

export function setupCommandBar(ctx: CommandContext, launch: (p: EventProposal) => void) {
  const form = $<HTMLFormElement>("#command-form");
  const input = $<HTMLInputElement>("#command-input");
  const button = form.querySelector("button")!;
  const card = $("#proposal");
  const extreme = $<HTMLInputElement>("#extreme");
  const chips = $("#chips");
  const show = (html: string, cls = "") => {
    card.className = cls;
    card.innerHTML = html;
  };
  const hide = () => (card.className = "hidden");

  const renderChips = () => {
    chips.innerHTML = SUGGESTIONS.filter(([, , x]) => !x || extreme.checked)
      .map(([label, say, x]) => `<button type="button" class="${x ? "extreme" : ""}" data-say="${say}">${label}</button>`)
      .join("");
  };
  renderChips();
  extreme.onchange = () => {
    renderChips();
    document.body.classList.toggle("extreme-on", extreme.checked);
  };
  chips.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-say]");
    if (!b) return;
    input.value = b.dataset.say!;
    ask(input.value);
  });

  let pending: EventProposal | null = null;
  const cancel = () => {
    pending = null;
    ctx.preview(null);
    hide();
  };

  const ask = async (text: string) => {
    if (!text.trim()) return;
    button.disabled = true;
    ctx.preview(null);
    show(`<span class="spinner"></span> Claude analyse la demande et cherche les rues concernées…`, "thinking");
    try {
      const res = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, context: { time: ctx.time(), weather: ctx.weather() }, extreme: extreme.checked }),
      });
      const out: EventProposal | { error: string } = await res.json();
      if ("error" in out) {
        show(`<div>🤔 ${out.error}</div><div class="proposal-actions"><button class="secondary" data-act="no">OK</button></div>`);
      } else propose(out);
    } catch {
      show(`<div>⚠️ Le serveur ne répond pas.</div><div class="proposal-actions"><button class="secondary" data-act="no">OK</button></div>`);
    } finally {
      button.disabled = false;
    }
  };

  const propose = (p: EventProposal) => {
    pending = p;
    ctx.preview(p);
    const spec = EVENT_SPECS[p.kind];
    const dots = "●".repeat(p.intensity) + "○".repeat(3 - p.intensity);
    const where = p.streets.length ? p.streets.join(", ") : p.route.length ? p.route.join(" → ") : p.location;
    show(`
      <span class="source">${p.source === "claude" ? "✨ interprété par Claude" : "🔤 mots-clés (sans Claude)"}</span>
      <h3>${spec.icon} ${p.title}</h3>
      <div>${p.description}</div>
      <div class="details">
        <span>📍 ${where}</span>
        <span>🕐 ${describeWhen(p)}</span>
        <span>intensité ${dots}</span>
      </div>
      ${p.note ? `<div class="note">${p.note}</div>` : ""}
      <div class="question">${p.question}</div>
      <div class="proposal-actions">
        <button data-act="yes">✅ Confirmer</button>
        <button class="secondary" data-act="no">✖ Annuler</button>
        <span class="hint">${p.streets.length || p.route.length ? "Rues concernées en surbrillance sur la carte" : ""}</span>
      </div>`);
  };

  card.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === "yes" && pending) {
      launch(pending);
      show(`${EVENT_SPECS[pending.kind].icon} <b>Décision enregistrée.</b> Les habitants concernés vont s'organiser ; suis l'impact dans le panneau « Décisions ».`);
      pending = null;
      ctx.preview(null);
      input.value = "";
      setTimeout(hide, 4000);
    } else if (act === "no") cancel();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });
  // les touches tapées dans la barre ne doivent pas piloter la carte
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") cancel();
  });
}
