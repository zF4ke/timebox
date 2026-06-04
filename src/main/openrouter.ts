import crypto from "node:crypto";
import { saveRawResponse } from "./debug";
import type { LlmCallTrace } from "../shared/types";
import { estimateModelCostUsd, estimateTokensFromChars } from "./modelCosts";

interface JsonCallOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
  maxCompletionTokens?: number;
  timeoutMs?: number;
  onTrace?: (trace: LlmCallTrace) => void;
}

export async function callOpenRouterJson<T>(options: JsonCallOptions): Promise<T> {
  try {
    return await requestJson<T>(options);
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error("Planner run cancelled.");
    }
    throw new Error(formatProviderError(error, options));
  }
}

function buildCombinedSignal(cancelSignal?: AbortSignal, timeoutMs?: number): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (cancelSignal) signals.push(cancelSignal);
  if (timeoutMs && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  if (signals.length === 0) return undefined;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

async function requestJson<T>(options: JsonCallOptions): Promise<T> {
  const start = Date.now();
  const startedAt = new Date(start).toISOString();
  const promptChars = options.system.length + options.user.length;
  console.log(
    `[openrouter] -> ${options.schemaName} (json_schema) · prompt=${promptChars} chars · maxTokens=${options.maxCompletionTokens ?? 2500}`
  );
  const { OpenRouter } = await importOpenRouterSdk();
  const openRouter = new OpenRouter({
    apiKey: options.apiKey,
    httpReferer: "https://local.timebox",
    appTitle: "Timebox"
  });

  const fetchSignal = buildCombinedSignal(options.signal, options.timeoutMs ?? 75_000);

  const result = await openRouter.chat.send({
    httpReferer: "https://local.timebox",
    appTitle: "Timebox",
    chatRequest: {
      model: options.model,
      stream: false,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user }
      ],
      temperature: 0.2,
      maxCompletionTokens: options.maxCompletionTokens ?? 2500,
      responseFormat: {
        type: "json_schema",
        jsonSchema: {
          name: options.schemaName,
          strict: true,
          schema: options.schema
        }
      }
    }
  } as never, {
    fetchOptions: { signal: fetchSignal }
  });

  const choice = result.choices?.[0] as
    | {
        message?: { content?: unknown };
        finishReason?: string;
        finish_reason?: string;
      }
    | undefined;
  const content = choice?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  const raw = typeof content === "string" ? content : JSON.stringify(content);
  emitTrace(options, result, raw, start, startedAt, promptChars);
  const finishReason = choice?.finishReason ?? choice?.finish_reason;
  if (finishReason === "length" || finishReason === "max_tokens") {
    const filePath = saveRawResponse(options.schemaName, raw);
    throw new Error(
      `OpenRouter truncated ${options.schemaName} before valid JSON completed (finish_reason=${finishReason}, ${raw.length} chars). Raw response saved to ${filePath}.`
    );
  }

  try {
    const parsed = parseJsonContent<T>(raw);
    console.log(`[openrouter] <- ${options.schemaName} (${Date.now() - start}ms) · ${raw.length} chars`);
    return parsed;
  } catch (parseError) {
    const filePath = saveRawResponse(options.schemaName, raw);
    const snippetStart = raw.slice(0, 400);
    const snippetEnd = raw.slice(-400);
    console.error(`[openrouter] JSON parse failed for ${options.schemaName}`);
    console.error(`[openrouter] content length: ${raw.length}`);
    console.error(`[openrouter] raw response saved: ${filePath}`);
    console.error(`[openrouter] snippet start: ${snippetStart}`);
    console.error(`[openrouter] snippet end: ${snippetEnd}`);
    throw new Error(`${errorMessage(parseError)}. Raw response saved to ${filePath}.`);
  }
}

function emitTrace(
  options: JsonCallOptions,
  result: unknown,
  raw: string,
  start: number,
  startedAt: string,
  promptChars: number
): void {
  if (!options.onTrace) {
    return;
  }

  const usage = (result as {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  }).usage;

  const completionChars = raw.length;
  const promptTokens = numberOrNull(usage?.prompt_tokens ?? usage?.promptTokens) ?? estimateTokensFromChars(promptChars);
  const completionTokens =
    numberOrNull(usage?.completion_tokens ?? usage?.completionTokens) ?? estimateTokensFromChars(completionChars);
  const totalTokens = numberOrNull(usage?.total_tokens ?? usage?.totalTokens) ?? promptTokens + completionTokens;
  const completedAtMs = Date.now();

  options.onTrace({
    id: cryptoRandomId(),
    schemaName: options.schemaName,
    model: options.model,
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - start,
    promptChars,
    completionChars,
    maxCompletionTokens: options.maxCompletionTokens ?? 2500,
    promptTokens,
    completionTokens,
    totalTokens,
    usageSource: usage ? "provider" : "estimated",
    estimatedCostUsd: estimateModelCostUsd(options.model, promptTokens, completionTokens)
  });
}

function cryptoRandomId(): string {
  return crypto.randomUUID();
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function importOpenRouterSdk(): Promise<typeof import("@openrouter/sdk")> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<typeof import("@openrouter/sdk")>;
  return dynamicImport("@openrouter/sdk");
}

function parseJsonContent<T>(content: string): T {
  return JSON.parse(content) as T;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAbortError(error: unknown): boolean {
  const msg = errorMessage(error).toLowerCase();
  return msg.includes("aborted") || msg.includes("aborterror") || msg.includes("cancelled") || msg.includes("canceled");
}

function getProviderError(error: unknown): { message?: string; code?: number | string } | null {
  const candidate = (error as { rawValue?: { error?: { message?: string; code?: number | string } } } | null)?.rawValue?.error;
  return candidate ?? null;
}

function formatProviderError(error: unknown, options: JsonCallOptions): string {
  const provider = getProviderError(error);
  if (provider) {
    return `OpenRouter provider error (${provider.code ?? "?"}) on ${options.model}: ${provider.message ?? "unknown"}.`;
  }
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status) {
    return `OpenRouter HTTP ${status} on ${options.model}: ${errorMessage(error)}`;
  }
  return errorMessage(error);
}
