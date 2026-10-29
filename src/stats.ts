import "./stats.css";
import type { ModelCall } from "../server/modelStats";

interface Snapshot { since: number; model: string; active: number; total: number; failures: number; errors502: number; successes: number; averageMs: number; calls: ModelCall[] }
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const filter = get<HTMLSelectElement>("filter"), search = get<HTMLInputElement>("search");
let snapshot: Snapshot | undefined;
let frozen = false;
const expanded = new Set<number>();
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function render() {
  if (!snapshot) return;
  const s = snapshot;
  get("model").textContent = s.model;
  const metrics = [["Appels terminés", s.total], ["En cours", s.active], ["Réussite", `${s.total ? Math.round(s.successes / s.total * 100) : 0} %`], ["Erreurs", s.failures], ["HTTP 502", s.errors502], ["Durée moyenne", `${(s.averageMs / 1000).toFixed(1)} s`]];
  get("metrics").innerHTML = metrics.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  const calls = s.calls.filter((call) => {
    const result = call.result as { action?: string } | undefined;
    return (filter.value === "all" || filter.value === "errors" && call.status >= 400 || filter.value === "502" && call.status === 502 || filter.value === "talk" && result?.action === "talk") && JSON.stringify(call).toLocaleLowerCase().includes(search.value.toLocaleLowerCase());
  });
  get("summary").textContent = `${calls.length} entrées affichées sur les ${s.calls.length} dernières conservées · Compteurs depuis ${new Date(s.since).toLocaleString("fr-FR")} · Remis à zéro au redémarrage du serveur`;
  get("calls").innerHTML = calls.length ? calls.map((call) => {
    const result = call.result as { thought?: string; action?: string; message?: string; targetId?: number; placeId?: number; goal?: string; plan?: string[] } | undefined;
    return `<article class="${call.status >= 400 ? "error" : "success"}"><div class="call-head"><span class="status">HTTP ${call.status}</span><strong>${escape(call.agent)}</strong><time>${new Date(call.at).toLocaleTimeString("fr-FR")}</time><span>${(call.duration / 1000).toFixed(1)} s</span></div>${call.error ? `<pre class="error-message">${escape(call.error)}</pre>` : `<p>${escape(result?.thought)}</p><p class="action">Action : ${escape(result?.action)}${result?.placeId === undefined ? "" : ` · Lieu #${result.placeId}`}</p>${result?.message ? `<blockquote>À la personne #${result.targetId ?? "?"} : « ${escape(result.message)} »</blockquote>` : ""}`}<details data-id="${call.id}" ${expanded.has(call.id) ? "open" : ""}><summary>Réponse complète</summary><pre>${escape(JSON.stringify(call.result ?? { error: call.error }, null, 2))}</pre></details></article>`;
  }).join("") : `<p class="empty">${s.total ? "Aucun appel ne correspond aux filtres." : "Aucun appel enregistré. Ouvre la ville dans un autre onglet et lance la simulation."}</p>`;
  get("calls").querySelectorAll<HTMLDetailsElement>("details").forEach((detail) => {
    const call = calls.find((entry) => entry.id === Number(detail.dataset.id));
    const result = call?.result as { goal?: string; plan?: string[] } | undefined;
    if (result?.goal || result?.plan?.length) {
      const plan = document.createElement("p");
      plan.className = "action";
      plan.textContent = `Objectif : ${result.goal ?? "—"}\nPlan : ${result.plan?.join(" → ") ?? "—"}`;
      detail.before(plan);
    }
    detail.ontoggle = () => { const id = Number(detail.dataset.id); if (detail.open) expanded.add(id); else expanded.delete(id); };
  });
}
filter.onchange = render;
search.oninput = render;
get("freeze").onclick = () => {
  frozen = !frozen;
  get("freeze").textContent = frozen ? "Reprendre" : "Figer";
  get("freeze").setAttribute("aria-pressed", String(frozen));
  if (!frozen) render();
};
async function poll() {
  try {
    const response = await fetch("/api/model-stats", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    snapshot = await response.json();
    get("connection").textContent = frozen ? "Affichage figé" : "En direct · actualisation 2 s";
    if (!frozen) render();
  } catch {
    get("connection").textContent = "Serveur indisponible · lance npm.cmd run dev";
  } finally { window.setTimeout(poll, 2000); }
}
void poll();
