import type { TokenUsage } from "./types.js";

/**
 * Approximate USD price per 1M tokens for common models, as of the
 * project's last update. These are estimates for local debugging
 * convenience only — not accurate enough for billing. Prices change
 * often; treat this as "roughly how expensive was this run", not ground
 * truth. Unrecognized models simply get no cost estimate.
 */
interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPrice> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6 },
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gpt-5": { inputPer1M: 5, outputPer1M: 15 },
  "gpt-5-mini": { inputPer1M: 0.6, outputPer1M: 2.4 },
  "o3": { inputPer1M: 2, outputPer1M: 8 },
  "o4-mini": { inputPer1M: 1.1, outputPer1M: 4.4 },
  "claude-opus-4": { inputPer1M: 15, outputPer1M: 75 },
  "claude-sonnet-4": { inputPer1M: 3, outputPer1M: 15 },
  "claude-haiku-4": { inputPer1M: 0.8, outputPer1M: 4 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
  "gemini-2.0-pro": { inputPer1M: 1.25, outputPer1M: 5 },
};

/** Finds a pricing entry by loose match (handles versioned/prefixed model names). */
function findPricing(modelName: string): ModelPrice | undefined {
  const normalized = modelName.toLowerCase();
  if (PRICING[normalized]) return PRICING[normalized];
  const match = Object.keys(PRICING).find((key) => normalized.includes(key));
  return match ? PRICING[match] : undefined;
}

/**
 * Estimates USD cost for an LLM call given the model name and token counts.
 * Returns undefined if the model isn't in the known pricing table — callers
 * should treat that as "unknown cost", not zero.
 */
export function estimateCost(modelName: string, promptTokens?: number, completionTokens?: number): number | undefined {
  const price = findPricing(modelName);
  if (!price || promptTokens === undefined || completionTokens === undefined) return undefined;
  const cost = (promptTokens / 1_000_000) * price.inputPer1M + (completionTokens / 1_000_000) * price.outputPer1M;
  return Math.round(cost * 1_000_000) / 1_000_000; // round to 6 decimal places
}

/** Builds a TokenUsage object from raw counts, filling in cost when the model is recognized. */
export function buildUsage(modelName: string, promptTokens?: number, completionTokens?: number): TokenUsage | undefined {
  if (promptTokens === undefined && completionTokens === undefined) return undefined;
  const totalTokens = (promptTokens ?? 0) + (completionTokens ?? 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: totalTokens || undefined,
    costUsd: estimateCost(modelName, promptTokens, completionTokens),
  };
}
