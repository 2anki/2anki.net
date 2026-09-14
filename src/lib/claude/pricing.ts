export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ClaudeUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

const SONNET_PRICING: ModelPricing = {
  inputPerMillion: 3,
  outputPerMillion: 15,
};

const MODEL_PRICES: Record<string, ModelPricing> = {
  'claude-sonnet-4-5': SONNET_PRICING,
  'claude-sonnet-5': SONNET_PRICING,
  'claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },
};

const CACHE_READ_DISCOUNT = 0.1;
const CACHE_WRITE_PREMIUM = 1.25;

export function resolveModelPricing(
  model: string | undefined | null
): ModelPricing {
  if (model == null) return SONNET_PRICING;
  const match = Object.keys(MODEL_PRICES)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => model.startsWith(prefix));
  return match != null ? MODEL_PRICES[match] : SONNET_PRICING;
}

export function computeUsageCostUsd(
  model: string | undefined | null,
  usage: ClaudeUsage | undefined | null
): number {
  if (usage == null) return 0;
  const pricing = resolveModelPricing(model);
  const input = (usage.input_tokens ?? 0) / 1_000_000;
  const output = (usage.output_tokens ?? 0) / 1_000_000;
  const cacheWrite = (usage.cache_creation_input_tokens ?? 0) / 1_000_000;
  const cacheRead = (usage.cache_read_input_tokens ?? 0) / 1_000_000;
  const cost =
    input * pricing.inputPerMillion +
    output * pricing.outputPerMillion +
    cacheRead * pricing.inputPerMillion * CACHE_READ_DISCOUNT +
    cacheWrite * pricing.inputPerMillion * CACHE_WRITE_PREMIUM;
  return Math.round(cost * 10_000) / 10_000;
}
