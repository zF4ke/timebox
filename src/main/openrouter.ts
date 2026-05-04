interface JsonCallOptions {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

export async function callOpenRouterJson<T>(options: JsonCallOptions): Promise<T> {
  try {
    return await requestJson<T>(options, "json_schema");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("response_format") && !message.toLowerCase().includes("schema")) {
      throw error;
    }

    return requestJson<T>(options, "json_object");
  }
}

async function requestJson<T>(
  options: JsonCallOptions,
  responseFormat: "json_schema" | "json_object"
): Promise<T> {
  const { OpenRouter } = await importOpenRouterSdk();
  const openRouter = new OpenRouter({
    apiKey: options.apiKey,
    httpReferer: "https://local.multi-agent-calendar-planner",
    appTitle: "Multi-Agent Student Calendar Planner"
  });

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
      responseFormat:
        responseFormat === "json_schema"
          ? {
              type: "json_schema",
              jsonSchema: {
                name: options.schemaName,
                strict: false,
                schema: options.schema
              }
            }
          : { type: "json_object" }
    }
  } as never);

  const content = result.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return parseJsonContent<T>(typeof content === "string" ? content : JSON.stringify(content));
}

async function importOpenRouterSdk(): Promise<typeof import("@openrouter/sdk")> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<typeof import("@openrouter/sdk")>;
  return dynamicImport("@openrouter/sdk");
}

function parseJsonContent<T>(content: string): T {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const jsonText = fenced?.[1] ?? trimmed;

  try {
    return JSON.parse(jsonText) as T;
  } catch {
    const firstBrace = jsonText.indexOf("{");
    const lastBrace = jsonText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(jsonText.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error("OpenRouter response was not valid JSON.");
  }
}
