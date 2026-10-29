import { loadEnv } from "vite";
import { decide } from "../server/intelligence";
const started = performance.now();
const result = await decide({ contexts: Array.from({ length: 5 }, (_, agentId) => ({ agentId, context: JSON.stringify({ person: { id: agentId, name: `Habitant ${agentId}`, age: 30 + agentId, now: "Au travail" }, nearby: [], destinations: [], instruction: "Poursuis ton travail, réponse concise." }) })) }, loadEnv("development", process.cwd(), ""));
console.log("Lot réel Arkane :", "decisions" in result ? result.decisions.length : 0, "décisions en", Math.round(performance.now() - started), "ms");
