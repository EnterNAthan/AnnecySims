import type { AiLog } from "../shared/intelligence";

const labels: Record<AiLog["kind"], string> = {
  request: "Appel", decision: "Décision", conversation: "Conversation", error: "Erreur", ignored: "Obsolète",
};

export function setupAiLog(onSelect: (id: number) => void) {
  const panel = document.createElement("aside");
  panel.className = "panel";
  panel.id = "ai-log";
  panel.innerHTML = `<details open><summary class="panel-title">Activité IA <span id="ai-active">0 appel en cours</span></summary>
    <div class="ai-log-tools"><label>Afficher <select aria-label="Filtrer les logs IA"><option value="all">Tout</option><option value="conversation">Conversations</option><option value="decision">Décisions</option><option value="error">Erreurs</option></select></label><button type="button" data-pause aria-pressed="false">Figer</button><button type="button" data-clear>Effacer</button></div>
    <p class="ai-log-hint">Clique sur un nom pour suivre la personne.</p><ol class="ai-log-list" aria-label="Journal des interactions IA"></ol><p class="ai-log-empty">En attente des premières décisions…</p></details>`;
  document.querySelector("#right")!.prepend(panel);
  const list = panel.querySelector<HTMLOListElement>("ol")!;
  const empty = panel.querySelector<HTMLElement>(".ai-log-empty")!;
  const active = panel.querySelector<HTMLElement>("#ai-active")!;
  const filter = panel.querySelector("select")!;
  const pause = panel.querySelector<HTMLButtonElement>("[data-pause]")!;
  let entries: AiLog[] = [];
  let frozen = false;
  function render() {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const scroll = list.scrollTop;
    list.replaceChildren();
    const shown = entries.filter((e) => filter.value === "all" || e.kind === filter.value);
    empty.hidden = shown.length > 0;
    for (const entry of shown) {
      const row = document.createElement("li");
      row.dataset.kind = entry.kind;
      const meta = document.createElement("div");
      const time = new Date(entry.timestamp).toLocaleTimeString("fr-FR");
      meta.className = "ai-log-meta";
      meta.textContent = `${time} · J${entry.day} ${String(Math.floor(entry.minute / 60)).padStart(2, "0")}:${String(Math.floor(entry.minute % 60)).padStart(2, "0")} · ${labels[entry.kind]}${entry.durationMs === undefined ? "" : ` · ${(entry.durationMs / 1000).toFixed(1)} s`}`;
      const name = document.createElement("button");
      name.type = "button";
      name.textContent = entry.name;
      name.onclick = () => onSelect(entry.agentId);
      const text = document.createElement("p");
      text.textContent = entry.text;
      row.append(meta, name, text);
      list.append(row);
    }
    list.scrollTop = atBottom ? list.scrollHeight : scroll;
  }
  filter.onchange = render;
  pause.onclick = () => {
    frozen = !frozen;
    pause.textContent = frozen ? "Reprendre" : "Figer";
    pause.setAttribute("aria-pressed", String(frozen));
    if (!frozen) render();
  };
  panel.querySelector<HTMLButtonElement>("[data-clear]")!.onclick = () => { entries = []; render(); };
  return (entry: AiLog) => {
    active.textContent = `${entry.active} appel${entry.active > 1 ? "s" : ""} en cours`;
    if (!entry.text) return;
    entries.push(entry);
    if (entries.length > 200) entries.shift();
    if (!frozen) render();
  };
}
