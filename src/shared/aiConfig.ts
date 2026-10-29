import { z } from "zod";

export const AiConfigSchema = z.object({
  enabled: z.boolean(),
  concurrency: z.number().int().min(1).max(100),
  intervalSeconds: z.number().min(1).max(600),
  requestsPerSecond: z.number().min(0.1).max(100),
  memoryLimit: z.number().int().min(4).max(48),
  maxTokens: z.number().int().min(256).max(16000),
  timeoutSeconds: z.number().int().min(5).max(90),
  temperature: z.number().min(0).max(2),
  model: z.string().trim().min(1).max(200),
}).strict();
export type AiConfig = z.infer<typeof AiConfigSchema>;
export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: true, concurrency: 4, intervalSeconds: 30, requestsPerSecond: 1,
  memoryLimit: 48, maxTokens: 4000, timeoutSeconds: 90, temperature: 0.7,
  model: "deepseek-ai/DeepSeek-V4.1-Flash",
};
