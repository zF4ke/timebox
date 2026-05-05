import { saveRawResponse } from "./debug";

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
  console.log(
    `[openrouter] -> ${options.schemaName} (json_schema) · prompt=${options.system.length + options.user.length} chars · maxTokens=${options.maxCompletionTokens ?? 2500}`
  );
  const { OpenRouter } = await importOpenRouterSdk();
  const openRouter = new OpenRouter({
    apiKey: options.apiKey,
    httpReferer: "https://local.multi-agent-calendar-planner",
    appTitle: "Multi-Agent Student Calendar Planner"
  });

  const fetchSignal = buildCombinedSignal(options.signal, options.timeoutMs ?? 75_000);

  const result = await openRouter.chat.send({
    httpReferer: "https://local.multi-agent-calendar-planner",
    appTitle: "Multi-Agent Student Calendar Planner",
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
