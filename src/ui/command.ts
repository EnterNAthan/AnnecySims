// Barre de commande en langage naturel : demande → interprétation (Claude) → confirmation → événement.
import { EVENT_SPECS, type EventProposal } from "../shared/catalog";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

export interface CommandContext {
  time(): string;
  weather(): string;
}

export function setupCommandBar(ctx: CommandContext, launch: (p: EventProposal) => void) {
  const form = $<HTMLFormElement>("#command-form");
  const input = $<HTMLInputElement>("#command-input");
  const button = form.querySelector("button")!;
  const card = $("#proposal");
  const show = (html: string, cls = "") => {
    card.className = cls;
    card.innerHTML = html;
  };
  const hide = () => (card.className = "hidden");

  const ask = async (text: string) => {
    if (!text.trim()) return;
    button.disabled = true;
    show("🪄 Claude interprète ta demande…", "thinking");
    try {
      const res = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, context: { time: ctx.time(), weather: ctx.weather() } }),
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

  let pending: EventProposal | null = null;
  const propose = (p: EventProposal) => {
    pending = p;
    const spec = EVENT_SPECS[p.kind];
    const dots = "●".repeat(p.intensity) + "○".repeat(3 - p.intensity);
    const when = p.startIn > 0 ? `dans ${p.startIn} min` : "maintenant";
    show(`
      <span class="source">${p.source === "claude" ? "✨ interprété par Claude" : "🔤 mots-clés"}</span>
      <h3>${spec.icon} ${p.title}</h3>
      <div>${p.description}</div>
      <div class="details">📍 ${p.location} · 🕐 ${when} · ⏳ ${p.durationMinutes} min · intensité ${dots}</div>
      ${p.note ? `<div class="note">${p.note}</div>` : ""}
      <div class="question">${p.question}</div>
      <div class="proposal-actions">
        <button data-act="yes">✅ Oui, lance-le</button>
        <button class="secondary" data-act="no">✖ Non</button>
      </div>`);
  };

  card.addEventListener("click", (e) => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === "yes" && pending) {
      launch(pending);
      show(`${EVENT_SPECS[pending.kind].icon} <b>C'est parti !</b> Regarde comment réagissent les habitants…`);
      pending = null;
      input.value = "";
      setTimeout(hide, 3500);
    } else if (act === "no") {
      pending = null;
      hide();
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    ask(input.value);
  });
  document.querySelectorAll<HTMLButtonElement>("#chips [data-say]").forEach((b) => {
    b.onclick = () => {
      input.value = b.dataset.say!;
      ask(input.value);
    };
  });
  // les touches tapées dans la barre ne doivent pas piloter la carte
  input.addEventListener("keydown", (e) => e.stopPropagation());
}
