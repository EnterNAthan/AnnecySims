import type { RequestMetrics } from "./intelligence";

export interface ModelCall {
  id: number;
  at: number;
  agent: string;
  model: string;
  status: number;
  duration: number;
  result?: unknown;
  error?: string;
  metrics?: RequestMetrics;
}

export function createModelStats() {
  const calls: ModelCall[] = [];
  let sequence = 0, total = 0, failures = 0, errors502 = 0, duration = 0;
  const since = Date.now();
  let decisions = 0;
  return {
    record(call: Omit<ModelCall, "id">) {
      total++;
      duration += call.duration;
      if (call.status >= 400) failures++;
      if (call.status === 502) errors502++;
      if (call.status < 400 && call.result) {
        const batch = call.result as { decisions?: unknown[] };
        decisions += batch.decisions?.length ?? 1;
      }
      calls.unshift({ ...call, id: ++sequence });
      if (calls.length > 300) calls.pop();
    },
    snapshot(active: number, model: string) {
      return { since, model, active, total, failures, errors502, decisions, decisionsPerMinute: decisions / Math.max(1, (Date.now() - since) / 60000), successes: total - failures,
        averageMs: total ? Math.round(duration / total) : 0, calls };
    },
  };
}
