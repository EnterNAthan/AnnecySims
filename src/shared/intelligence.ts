import { z } from "zod";

export const DecisionSchema = z.object({
  thought: z.string().min(1).max(1000),
  goal: z.string().max(300).optional(),
  plan: z.array(z.string().max(200)).max(8).optional(),
  durationMinutes: z.number().int().min(5).max(120).optional(),
  action: z.enum(["continue", "visit", "talk"]),
  placeId: z.number().int().optional(),
  targetId: z.number().int().optional(),
  message: z.string().max(1500).optional(),
});
export const AI_CONCURRENCY = 4;
export const AI_INTERVAL_MS = 30000;
export const AI_MIN_DISPATCH_MS = 1000;
export type Decision = z.infer<typeof DecisionSchema>;

export interface AiLog {
  kind: "request" | "decision" | "conversation" | "error" | "ignored";
  agentId: number;
  name: string;
  day: number;
  minute: number;
  timestamp: number;
  text: string;
  active: number;
  durationMs?: number;
}
