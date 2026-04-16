import { getGroqKeyFromRequest } from "@/lib/groq-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const apiKey = getGroqKeyFromRequest(request);
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing Groq API key" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const form = await request.formData();
  const file = form.get("file");
  const model = (form.get("model") as string) || "whisper-large-v3";

  if (!(file instanceof Blob) || file.size === 0) {
    return new Response(JSON.stringify({ error: "Missing audio file" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const outForm = new FormData();
  outForm.append("file", file, "chunk.webm");
  outForm.append("model", model);
  outForm.append("response_format", "json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: outForm,
  });

  if (!res.ok) {
    const errText = await res.text();
    return new Response(JSON.stringify({ error: errText || "Transcription failed" }), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = (await res.json()) as { text?: string };
  return Response.json({ text: data.text ?? "" });
}
