import { loadEnv } from "vite";
import { decide } from "../server/intelligence";

const decision = await decide({ context: JSON.stringify({ person: { name: "Test", age: 30 }, nearby: [], destinations: [], instruction: "Poursuis ton activité." }) }, loadEnv("development", process.cwd(), ""));
console.log("Connexion Arkane validée, action :", decision.action);
