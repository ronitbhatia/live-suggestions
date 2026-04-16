const GROQ_BASE = "https://api.groq.com/openai/v1";

export function getGroqKeyFromRequest(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const x = request.headers.get("x-groq-api-key");
  if (x) return x.trim();
  return null;
}

export async function groqChatCompletionJson(args: {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}): Promise<string> {
  const payloadBase = {
    model: args.model,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    messages: args.messages,
  };

  let res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...payloadBase,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    const retry = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payloadBase),
    });
    if (!retry.ok) {
      const retryText = await retry.text();
      throw new Error(retryText || errText || `Groq chat error ${retry.status}`);
    }
    res = retry;
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty completion from Groq");
  return content;
}

export async function groqChatCompletionStream(args: {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  messages: { role: "system" | "user" | "assistant"; content: string }[];
}): Promise<Response> {
  const upstream = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      temperature: args.temperature,
      max_tokens: args.maxTokens,
      messages: args.messages,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText || "Groq stream error", { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
