import type { AppSettings, SuggestionBatch, SuggestionCard } from "@/lib/types";
import { getGroqKeyFromRequest, groqChatCompletionJson } from "@/lib/groq-server";
import { truncateMiddle } from "@/lib/settings-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  transcript: string;
  settings: Partial<AppSettings>;
};

const KINDS = new Set([
  "question_to_ask",
  "talking_point",
  "answer",
  "fact_check",
  "clarify",
]);

function normalizeSuggestions(raw: unknown): SuggestionCard[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as { suggestions?: unknown };
  if (!Array.isArray(obj.suggestions)) return [];
  const out: SuggestionCard[] = [];
  for (const item of obj.suggestions) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const kind = s.kind;
    const preview = s.preview;
    const detailSeed = s.detailSeed;
    if (typeof kind !== "string" || !KINDS.has(kind)) continue;
    if (typeof preview !== "string" || typeof detailSeed !== "string") continue;
    out.push({
      kind: kind as SuggestionCard["kind"],
      preview: preview.trim(),
      detailSeed: detailSeed.trim(),
    });
  }
  return out;
}

export async function POST(request: Request) {
  const apiKey = getGroqKeyFromRequest(request);
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing Groq API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const settings = body.settings ?? {};
  const model = settings.llmModel || "openai/gpt-oss-120b";
  const maxChars = Math.max(2000, settings.liveSuggestionContextChars ?? 14_000);
  const transcript = truncateMiddle((body.transcript || "").trim(), maxChars);

  if (!transcript) {
    return new Response(JSON.stringify({ error: "Transcript is empty" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const system = settings.liveSuggestionSystemPrompt;
  const userTpl = settings.liveSuggestionUserTemplate;
  if (!system || !userTpl) {
    return new Response(JSON.stringify({ error: "Missing suggestion prompts in settings" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = userTpl.replaceAll("{{TRANSCRIPT}}", transcript);

  try {
    const jsonText = await groqChatCompletionJson({
      apiKey,
      model,
      temperature: settings.suggestionTemperature ?? 0.55,
      maxTokens: settings.suggestionMaxTokens ?? 700,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return new Response(JSON.stringify({ error: "Model returned non-JSON" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const suggestions = normalizeSuggestions(parsed);
    if (suggestions.length !== 3) {
      return new Response(
        JSON.stringify({
          error: `Expected exactly 3 suggestions, got ${suggestions.length}`,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    const batch: SuggestionBatch = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      suggestions,
    };

    return Response.json({ batch });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
