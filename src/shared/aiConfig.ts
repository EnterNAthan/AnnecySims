import { z } from "zod";

export const AiConfigSchema = z.object({
  enabled: z.boolean(),
  agentLimit: z.number().int().min(0).max(100).default(50),
  batchSize: z.union([z.literal(1), z.literal(5)]).default(5),
  concurrency: z.number().int().min(1).max(100),
  intervalSeconds: z.number().min(1).max(600),
  requestsPerSecond: z.number().min(0.1).max(100),
  memoryLimit: z.number().int().min(4).max(48),
  maxTokens: z.number().int().min(256).max(16000),
  timeoutSeconds: z.number().int().min(5).max(90),
  temperature: z.number().min(0).max(2),
  reasoningEffort: z.enum(["none", "provider"]).default("none"),
  model: z.string().trim().min(1).max(200),
}).strict();
export type AiConfig = z.infer<typeof AiConfigSchema>;
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: true, agentLimit: 50, batchSize: 5, concurrency: 1, intervalSeconds: 60, requestsPerSecond: 0.2,
  memoryLimit: 16, maxTokens: 3000, timeoutSeconds: 60, temperature: 0.3, reasoningEffort: "none",
  model: "qwen38-27b-turbo-v2",
};
