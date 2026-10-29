import { z } from "zod";

export const DecisionSchema = z.object({
  thought: z.string().min(1).max(300),
  action: z.enum(["continue", "visit", "talk"]),
  placeId: z.number().int().optional(),
  targetId: z.number().int().optional(),
  message: z.string().max(500).optional(),
});
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
