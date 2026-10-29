import type { ResidentChat } from "../shared/chat";

export function setupResidentChat(send: (id: number, text?: string) => void) {
  const panel = document.createElement("aside");
  panel.id = "resident-chat";
  panel.className = "panel hidden";
  panel.setAttribute("aria-label", "Conversation avec un habitant");
  panel.innerHTML = `<header><strong></strong><button type="button" aria-label="Fermer la conversation">✕</button></header>
    <p class="muted small">Habitant fictif · échanges conservés pendant cette session.</p>
    <div class="resident-messages" role="log" aria-live="polite"></div>
    <p class="resident-chat-status small" role="status"></p>
    <form><label for="resident-message">Votre message</label><textarea id="resident-message" maxlength="1000" rows="2" placeholder="Raconte-moi ton histoire…" required></textarea><button type="submit">Envoyer</button></form>`;
  document.body.append(panel);
  const title = panel.querySelector("strong")!;
  const messages = panel.querySelector<HTMLElement>(".resident-messages")!;
  const status = panel.querySelector<HTMLElement>(".resident-chat-status")!;
  const form = panel.querySelector("form")!;
  const input = panel.querySelector("textarea")!;
  const submit = form.querySelector("button")!;
  let current = -1;
  let busy = false;
  panel.querySelector("header button")!.addEventListener("click", () => panel.classList.add("hidden"));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (current < 0 || busy || !input.value.trim()) return;
    busy = true; submit.disabled = true; input.disabled = true; status.textContent = "Réfléchit…";
    send(current, input.value.trim());
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  return {
    open(id: number, name: string) {
      current = id; busy = true; submit.disabled = true;
      title.textContent = `Discuter avec ${name}`;
      messages.replaceChildren(); input.value = ""; status.textContent = "Chargement…";
      panel.classList.remove("hidden"); send(id); input.focus();
    },
    update(state: ResidentChat) {
      if (state.id !== current) return;
      const completed = busy && !state.busy && !state.error;
      busy = state.busy; submit.disabled = busy; input.disabled = busy;
      title.textContent = `Discuter avec ${state.name}`;
      status.textContent = state.error ?? (busy ? "Réfléchit…" : "");
      messages.replaceChildren();
      if (!state.messages.length) messages.textContent = "Faites connaissance : demandez-lui de raconter son histoire.";
      for (const message of state.messages) {
        const row = document.createElement("p");
        row.className = `resident-message ${message.role}`;
        const label = document.createElement("b"); label.textContent = message.role === "user" ? "Vous" : state.name;
        const text = document.createElement("span"); text.textContent = message.content;
        row.append(label, text); messages.append(row);
      }
      if (completed) input.value = "";
      messages.scrollTop = messages.scrollHeight;
    },
  };
}
