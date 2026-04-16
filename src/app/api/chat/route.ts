import type { AppSettings } from "@/lib/types";
import { getGroqKeyFromRequest, groqChatCompletionStream } from "@/lib/groq-server";
import { truncateMiddle } from "@/lib/settings-storage";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMode = "detailed" | "freeform";

type Body = {
  mode: ChatMode;
  transcript: string;
  /** freeform user text */
  userText?: string;
  /** suggestion-driven */
  kind?: string;
  preview?: string;
  detailSeed?: string;
  settings: Partial<AppSettings>;
};

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

  const maxChars =
    body.mode === "detailed"
      ? Math.max(4000, settings.detailedAnswerContextChars ?? 60_000)
      : Math.max(4000, settings.chatContextChars ?? 60_000);

  const transcript = truncateMiddle((body.transcript || "").trim(), maxChars);

  if (body.mode === "detailed") {
    const system = settings.detailedAnswerSystemPrompt;
    const userTpl = settings.detailedAnswerUserTemplate;
    if (!system || !userTpl) {
      return new Response(JSON.stringify({ error: "Missing detailed-answer prompts" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const user = userTpl
      .replaceAll("{{TRANSCRIPT}}", transcript || "(empty)")
      .replaceAll("{{KIND}}", String(body.kind ?? ""))
      .replaceAll("{{PREVIEW}}", String(body.preview ?? ""))
      .replaceAll("{{DETAIL_SEED}}", String(body.detailSeed ?? ""));

    return groqChatCompletionStream({
      apiKey,
      model,
      temperature: settings.chatTemperature ?? 0.45,
      maxTokens: settings.chatMaxTokens ?? 1800,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
  }

  const system = settings.chatSystemPrompt;
  const prefixTpl = settings.chatUserPrefixTemplate;
  if (!system || !prefixTpl) {
    return new Response(JSON.stringify({ error: "Missing chat prompts" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userQuestion = (body.userText || "").trim();
  if (!userQuestion) {
    return new Response(JSON.stringify({ error: "Empty question" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user =
    prefixTpl.replaceAll("{{TRANSCRIPT}}", transcript || "(empty)") + userQuestion;

  return groqChatCompletionStream({
    apiKey,
    model,
    temperature: settings.chatTemperature ?? 0.45,
    maxTokens: settings.chatMaxTokens ?? 1800,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
}
