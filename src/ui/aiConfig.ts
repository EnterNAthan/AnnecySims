import { AiConfigSchema, DEFAULT_AI_CONFIG, type AiConfig } from "../shared/aiConfig";

export function setupAiConfig() {
  const form = document.querySelector<HTMLFormElement>("#config-form")!;
  const fields = document.querySelector<HTMLElement>("#config-fields")!;
  const status = document.querySelector<HTMLElement>("#config-status")!;
  const rows: [keyof AiConfig, string, string, string, number?, number?, number?][] = [
    ["enabled", "Intelligence active", "checkbox", "Suspend ou reprend les nouvelles décisions."],
    ["agentLimit", "Habitants suivis par IA", "number", "Seules ces personnes appellent le modèle. Le reste de la population conserve ses comportements automatiques.", 0, 100, 1],
    ["batchSize", "Personnes par appel", "number", "1 pour comparer, 5 pour tester les décisions groupées. Une mémoire distincte par personne.", 1, 5, 4],
    ["concurrency", "Appels simultanés", "number", "Maximum de requêtes en cours par ville et sur le serveur.", 1, 100, 1],
    ["intervalSeconds", "Intervalle par personne (s)", "number", "Délai minimum entre deux décisions d’un habitant.", 1, 600, 1],
    ["requestsPerSecond", "Départs maximum / seconde", "number", "Lisse les appels de chaque ville selon sa population.", 0.1, 100, 0.1],
    ["memoryLimit", "Souvenirs par personne", "number", "Nombre de souvenirs récents envoyés au modèle. Réduire retire les plus anciens.", 4, 48, 1],
    ["maxTokens", "Budget de génération", "number", "Limite de tokens de la réponse, raisonnement du modèle compris.", 256, 16000, 1],
    ["timeoutSeconds", "Délai maximal (s)", "number", "Temps maximal d’attente d’une réponse Arkane.", 5, 90, 1],
    ["temperature", "Température", "number", "Variation des réponses : faible pour la stabilité, élevée pour la diversité.", 0, 2, 0.1],
    ["reasoningEffort", "Raisonnement", "text", "none : désactivé, recommandé pour Qwen. provider : laisser le fournisseur choisir. Valeurs acceptées : none ou provider."],
    ["model", "Identifiant du modèle", "text", "Identifiant exact disponible chez Arkane. La clé et l’URL restent côté serveur."],
  ];
  for (const [key, label, type, help, min, max, step] of rows) {
    const tr = document.createElement("tr");
    const title = document.createElement("th");
    title.scope = "row";
    const caption = document.createElement("label");
    caption.htmlFor = `config-${key}`;
    caption.textContent = label;
    title.append(caption);
    const control = document.createElement("td");
    const input = document.createElement("input");
    input.id = `config-${key}`;
    input.name = key;
    input.type = type;
    input.required = type !== "checkbox";
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    if (step !== undefined) input.step = String(step);
    if (type === "text") input.maxLength = 200;
    control.append(input);
    const description = document.createElement("td");
    description.id = `config-help-${key}`;
    description.textContent = help;
    input.setAttribute("aria-describedby", description.id);
    tr.append(title, control, description);
    fields.append(tr);
  }
  function fill(config: AiConfig) {
    for (const [key] of rows) {
      const input = form.elements.namedItem(key) as HTMLInputElement;
      if (input.type === "checkbox") input.checked = Boolean(config[key]);
      else input.value = String(config[key]);
    }
  }
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  submit.disabled = true;
  void fetch("/api/ai-config", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("Configuration inaccessible");
    fill(AiConfigSchema.parse(await response.json()));
    submit.disabled = false;
    status.textContent = "Configuration active chargée.";
  }).catch(() => { status.textContent = "Impossible de charger la configuration. Recharge la page avec le serveur lancé."; });
  document.querySelector<HTMLButtonElement>("#config-reset")!.onclick = () => {
    fill(DEFAULT_AI_CONFIG);
    status.textContent = "Valeurs prudentes préparées. Clique sur Appliquer pour les activer.";
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const draft: Record<string, unknown> = {};
    for (const [key] of rows) {
      const input = form.elements.namedItem(key) as HTMLInputElement;
      draft[key] = input.type === "checkbox" ? input.checked : input.type === "number" ? input.valueAsNumber : input.value;
    }
    const parsed = AiConfigSchema.safeParse(draft);
    if (!parsed.success) { status.textContent = parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" · "); return; }
    submit.disabled = true;
    status.textContent = "Application…";
    try {
      const response = await fetch("/api/ai-config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      if (!response.ok) throw new Error("Le serveur a refusé la configuration");
      fill(AiConfigSchema.parse(await response.json()));
      status.textContent = "Configuration appliquée. Synchronisation des villes sous deux secondes.";
    } catch (error) { status.textContent = error instanceof Error ? error.message : "Échec de l’application"; }
    finally { submit.disabled = false; }
  };
}
