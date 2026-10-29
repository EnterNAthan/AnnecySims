import type { Agent } from "./population";

/** Échantillon stable réparti dans la population, indépendant de la cadence des appels. */
export function selectAiPopulation(agents: Agent[], limit: number): Agent[] {
  const count = Math.min(agents.length, Math.max(0, Math.floor(limit)));
  return Array.from({ length: count }, (_, index) => agents[Math.floor(index * agents.length / count)]);
}

export interface AiPopulation {
  total: number;
  tracked: { id: number; name: string; profile: string }[];
}
