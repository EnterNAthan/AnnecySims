// Barre de commande en langage naturel : demande → interprétation (Claude) → aperçu et confirmation → événement.
import { EVENT_SPECS, NATURES, PROPS, PROP_LABEL, type EventProposal, type Prop } from "../shared/catalog";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface CommandContext {
  time(): string;
  weather(): string;
  /** montre (ou efface) sur la carte les rues et le parcours concernés */
  preview(p: EventProposal | null): void;
  /** interprétation immédiate par mots-clés, pour montrer la zone pendant que Claude réfléchit */
  local(text: string, extreme: boolean): EventProposal | null;
}

/** Suggestions : effet immédiat (rien à attendre en démonstration), scénarios extrêmes derrière l'interrupteur. */
const SUGGESTIONS: [string, string, boolean][] = [
  ["🎸 Festival au Pâquier", "Un festival de musique commence maintenant au Pâquier, 15 000 personnes attendues", false],
  ["🚧 Travaux av. de Genève", "Ferme l'avenue de Genève pour travaux dès maintenant, pendant 2 semaines", false],
  ["📣 Manif Gare → Préfecture", "Une manifestation part maintenant de la gare et va jusqu'à la préfecture", false],
  ["🚶 Piétonniser rue Royale", "Piétonnise la rue Royale dès maintenant, toute la journée", false],
  ["🏃 Course autour du lac", "Une course à pied autour du lac commence maintenant", false],
  ["🚆 Grève Léman Express", "Grève du Léman Express aujourd'hui, plus aucun train vers Genève", false],
  ["⛈️ Orage violent", "Un orage violent éclate maintenant sur Annecy", false],
  ["☄️ Météorite", "Une énorme météorite s'écrase sur le Pâquier", true],
  ["🌊 Tsunami", "Un tsunami déferle sur le lac", true],
  ["🫨 Séisme", "Un tremblement de terre secoue Annecy", true],
  ["🛸 OVNI", "Un OVNI apparaît au-dessus du Pâquier", true],
];

/** Ce que Claude fait pendant l'interprétation, affiché au fil des secondes. */
const THINKING: [number, string][] = [
  [0, "Lecture de la demande"],
  [2.5, "Repérage du lieu et des rues concernées"],
  [6, "Estimation de la fréquentation et des effets"],
  [10, "Préparation de la scène 3D"],
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

  // les suggestions sont interprétées en arrière-plan : un clic en démonstration répond aussitôt
  const warm = () =>
    fetch("/api/warm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: SUGGESTIONS.filter(([, , x]) => x === extreme.checked).map(([, say]) => say), context: { time: ctx.time(), weather: ctx.weather() }, extreme: extreme.checked }),
    }).catch(() => {});
  setTimeout(warm, 1500);

  const renderChips = () => {
    chips.innerHTML = SUGGESTIONS.filter(([, , x]) => !x || extreme.checked)
      .map(([label, say, x]) => `<button type="button" class="${x ? "extreme" : ""}" data-say="${say}">${label}</button>`)
      .join("");
  };
  renderChips();
  extreme.onchange = () => {
    renderChips();
    document.body.classList.toggle("extreme-on", extreme.checked);
    if (extreme.checked) warm();
  };
  chips.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-say]");
    if (!b) return;
    input.value = b.dataset.say!;
    ask(input.value);
  });

  let pending: EventProposal | null = null;
  /** numéro de la demande en cours : une réponse arrivée après une nouvelle demande est ignorée */
  let asked = 0;
  const cancel = () => {
    asked++;
    pending = null;
    ctx.preview(null);
    hide();
  };

  const ask = async (text: string) => {
    if (!text.trim()) return;
    const id = ++asked;
    button.disabled = true;
    // la zone devinée par mots-clés s'affiche tout de suite sur la carte
    const guess = ctx.local(text, extreme.checked);
    ctx.preview(guess);
    const t0 = performance.now();
    const thinking = () => {
      const t = (performance.now() - t0) / 1000;
      const current = THINKING.filter(([at]) => at <= t).length - 1;
      show(`<div class="t-head"><span class="spinner"></span><b>Claude prépare l'événement</b><span class="t-time">${Math.floor(t)} s</span></div>
        <div class="t-quote">« ${text} »</div>
        <ol class="t-steps">${THINKING.map(([, label], k) => `<li class="${k < current ? "done" : k === current ? "active" : ""}">${label}</li>`).join("")}</ol>`, "thinking");
    };
    const timer = setInterval(() => id === asked && thinking(), 500);
    // une réponse en cache arrive en quelques ms : pas d'écran d'attente qui clignote
    const flash = setTimeout(thinking, 120);
    try {
      const res = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, context: { time: ctx.time(), weather: ctx.weather() }, extreme: extreme.checked }),
      });
      const out: EventProposal | { error: string } = await res.json();
      if (id !== asked) return;
      if ("error" in out) {
        ctx.preview(null);
        show(`<div>🤔 ${out.error}</div><div class="proposal-actions"><button class="secondary" data-act="no">OK</button></div>`);
      } else propose(out);
    } catch {
      if (id === asked) show(`<div>⚠️ Le serveur ne répond pas.</div><div class="proposal-actions"><button class="secondary" data-act="no">OK</button></div>`);
    } finally {
      clearInterval(timer);
      clearTimeout(flash);
      button.disabled = false;
    }
  };

  const propose = (p: EventProposal) => {
    pending = p;
    ctx.preview(p);
    const spec = EVENT_SPECS[p.kind];
    const icon = p.icon || spec.icon;
    const where = p.streets.length ? p.streets.slice(0, 3).join(", ") + (p.streets.length > 3 ? "…" : "") : p.route.length ? p.route.join(" → ") : p.location;
    const num = (name: string, label: string, value: number, step = 1, min = 0) =>
      `<label>${label}<input type="number" data-param="${name}" value="${value}" step="${step}" min="${min}" /></label>`;
    const facts = [
      `📍 ${where}`,
      `🕐 ${describeWhen(p)}`,
      p.attendance ? `👥 ${p.attendance.toLocaleString("fr-FR")} / jour` : "",
      p.attendance ? (p.ticketPrice ? `🎟️ ${p.ticketPrice} €` : "🎟️ gratuit") : "",
      p.closesRoads ? "⛔ rues fermées" : "",
      p.shuttles ? "🚌 navettes" : "",
      p.danger ? "⚠️ dangereux" : "",
    ].filter(Boolean);
    show(`
      <div class="p-head">
        <span class="p-icon">${icon}</span>
        <div><h3>${p.title}</h3><div class="kind-line">${p.label || spec.label}${p.nature ? ` · ${p.nature}` : ""}</div></div>
        <span class="source">${p.cached ? "⚡ instantané" : p.source === "claude" ? "✨ Claude" : "🔤 mots-clés"}</span>
      </div>
      <div class="p-desc">${p.description}</div>
      <div class="p-facts">${facts.map((f) => `<span>${f}</span>`).join("")}</div>
      ${p.note ? `<div class="note">${p.note}</div>` : ""}
      <details class="params">
        <summary>⚙️ Ajuster les paramètres</summary>
        <div class="param-grid">
          ${num("attendance", "Fréquentation / jour", p.attendance, 100)}
          ${num("ticketPrice", "Billet (€)", p.ticketPrice, 1)}
          ${num("dayOffset", "Dans (jours)", p.dayOffset)}
          ${num("days", "Nombre de jours", p.days, 1, 1)}
          <label>Début<input type="time" data-param="startTime" value="${p.startTime}" /></label>
          ${num("durationMinutes", "Durée (min)", p.durationMinutes, 15, 10)}
          <label>Public<select data-param="audience">${["tous", "jeunes", "familles", "seniors"].map((a) => `<option ${a === p.audience ? "selected" : ""}>${a}</option>`).join("")}</select></label>
          <label>Nature<select data-param="nature"><option value=""></option>${NATURES.map((n) => `<option ${n === p.nature ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <label class="check"><input type="checkbox" data-param="shuttles" ${p.shuttles ? "checked" : ""} /> 🚌 Navettes</label>
          <label class="check"><input type="checkbox" data-param="closesRoads" ${p.closesRoads ? "checked" : ""} /> ⛔ Rues fermées</label>
          <label class="check"><input type="checkbox" data-param="danger" ${p.danger ? "checked" : ""} /> ⚠️ Dangereux</label>
        </div>
        <div class="props">${PROPS.map((x) => `<label><input type="checkbox" data-prop="${x}" ${p.setup.includes(x) ? "checked" : ""} />${PROP_LABEL[x]}</label>`).join("")}</div>
      </details>
      <div class="proposal-actions">
        <button data-act="yes">▶ Lancer</button>
        <button class="secondary" data-act="no">Annuler</button>
      </div>
      ${p.streets.length || p.route.length ? `<div class="hint">Zone concernée en surbrillance sur la carte · Entrée pour lancer</div>` : `<div class="hint">Entrée pour lancer</div>`}`, "ready");
    // Entrée lance directement la simulation
    card.querySelector<HTMLButtonElement>("[data-act=yes]")!.focus();
  };

  // les champs de la carte ne doivent pas piloter la caméra
  card.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") cancel();
  });
  card.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === "yes" && pending) {
      // les paramètres retouchés à la main l'emportent sur l'interprétation
      const p = pending as unknown as Record<string, unknown>;
      card.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-param]").forEach((el) => {
        const k = el.dataset.param!;
        if (el instanceof HTMLInputElement && el.type === "checkbox") p[k] = el.checked;
        else if (el instanceof HTMLInputElement && el.type === "number") p[k] = Math.max(0, Number(el.value) || 0);
        else p[k] = el.value;
      });
      pending.setup = [...card.querySelectorAll<HTMLInputElement>("[data-prop]:checked")].map((el) => el.dataset.prop as Prop);
      pending.days = Math.max(1, pending.days);
      launch(pending);
      // le compte rendu prend le relais
      pending = null;
      ctx.preview(null);
      input.value = "";
      input.blur();
      hide();
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
  return { focus: () => input.focus() };
}
