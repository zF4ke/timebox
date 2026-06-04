export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "google/gemini-2.5-flash-lite-preview-09-2025": {
    inputPerMillionUsd: 0.10,
    outputPerMillionUsd: 0.40
  },
  "google/gemini-3.1-flash-lite-preview": {
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 1.50
  },
  "google/gemini-3.1-flash-lite": {
    inputPerMillionUsd: 0.25,
    outputPerMillionUsd: 1.50
  },
  "minimax/minimax-m2.7": {
    inputPerMillionUsd: 0.30,
    outputPerMillionUsd: 1.20
  },
  "deepseek/deepseek-v3.2": {
    inputPerMillionUsd: 0.26,
    outputPerMillionUsd: 0.38
  },
  "openai/gpt-5-nano": {
    inputPerMillionUsd: 0.05,
    outputPerMillionUsd: 0.40
  },
  "nvidia/nemotron-3-super-120b-a12b:free": {
    inputPerMillionUsd: 0,
    outputPerMillionUsd: 0
  }
};

export function isFreeModel(model: string): boolean {
  return model.includes(":free");
}

export function modelPricing(model: string): ModelPricing | null {
  return MODEL_PRICING[model] ?? null;
}

export function estimateModelCostUsd(model: string, promptTokens: number, completionTokens: number): number | null {
  const pricing = modelPricing(model);
  if (!pricing) {
    return null;
  }

  const input = (promptTokens / 1_000_000) * pricing.inputPerMillionUsd;
  const output = (completionTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return round6(input + output);
}

export function estimateTokensFromChars(chars: number): number {
  return Math.max(1, Math.ceil(chars / 4));
}

export function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
