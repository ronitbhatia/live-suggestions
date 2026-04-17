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
const KIND_ROTATION: SuggestionCard["kind"][] = [
  "question_to_ask",
  "talking_point",
  "fact_check",
  "clarify",
  "answer",
];

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

function fallbackSuggestion(transcript: string, idx: number): SuggestionCard {
  const topic = transcript.split(/\s+/).slice(0, 12).join(" ").trim() || "the current discussion";
  const kind = KIND_ROTATION[idx % KIND_ROTATION.length];
  if (kind === "question_to_ask") {
    return {
      kind,
      preview: `Clarify priority and owner for ${topic}.`,
      detailSeed: `Draft 2 concise follow-up questions to clarify priority and ownership for: ${topic}.`,
    };
  }
  if (kind === "talking_point") {
    return {
      kind,
      preview: `Summarize one concrete next step tied to ${topic}.`,
      detailSeed: `Provide a short talking point with next step, owner, and timing for: ${topic}.`,
    };
  }
  if (kind === "fact_check") {
    return {
      kind,
      preview: `Verify assumptions or metrics mentioned around ${topic}.`,
      detailSeed: `List what should be validated and which source to check for: ${topic}.`,
    };
  }
  if (kind === "clarify") {
    return {
      kind,
      preview: `Define ambiguous terms or scope in ${topic}.`,
      detailSeed: `Explain likely ambiguities and propose exact clarifying language for: ${topic}.`,
    };
  }
  return {
    kind: "answer",
    preview: `Offer a concise answer draft based on what was said about ${topic}.`,
    detailSeed: `Draft a concise response grounded in transcript context for: ${topic}.`,
  };
}

function ensureExactlyThree(
  suggestions: SuggestionCard[],
  transcript: string,
): SuggestionCard[] {
  const deduped = suggestions.filter((s, i, arr) => {
    const key = `${s.kind}:${s.preview.toLowerCase()}`;
    return arr.findIndex((x) => `${x.kind}:${x.preview.toLowerCase()}` === key) === i;
  });

  if (deduped.length > 3) return deduped.slice(0, 3);
  if (deduped.length === 3) return deduped;

  const padded = [...deduped];
  for (let i = padded.length; i < 3; i += 1) {
    padded.push(fallbackSuggestion(transcript, i));
  }
  return padded;
}

async function generateSuggestions(args: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
}): Promise<SuggestionCard[]> {
  const jsonText = await groqChatCompletionJson({
    apiKey: args.apiKey,
    model: args.model,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    messages: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
  });
  const parsed = JSON.parse(jsonText) as unknown;
  return normalizeSuggestions(parsed);
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
    const temperature = settings.suggestionTemperature ?? 0.55;
    const maxTokens = settings.suggestionMaxTokens ?? 700;

    let suggestions: SuggestionCard[] = [];
    try {
      suggestions = await generateSuggestions({
        apiKey,
        model,
        system,
        user,
        temperature,
        maxTokens,
      });
    } catch {
      // Retry once with stronger determinism and explicit count requirement.
      const retrySystem =
        `${system}\n\nCRITICAL: Return exactly 3 suggestions. Never return fewer or more.`;
      const retryUser = `${user}\n\nReturn exactly 3 suggestions.`;
      try {
        suggestions = await generateSuggestions({
          apiKey,
          model,
          system: retrySystem,
          user: retryUser,
          temperature: Math.max(0, temperature - 0.2),
          maxTokens,
        });
      } catch {
        // Fall through to resilient fallback path below.
      }
    }

    suggestions = ensureExactlyThree(suggestions, transcript);

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
