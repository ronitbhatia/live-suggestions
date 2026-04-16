"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppSettings,
  ChatMessage,
  SuggestionBatch,
  SuggestionCard,
  TranscriptLine,
} from "@/lib/types";
import { defaultSettings } from "@/lib/defaults";
import { loadSettings, saveSettings } from "@/lib/settings-storage";
import { streamGroqChatToText } from "@/lib/sse";

function publicSettings(s: AppSettings): Omit<AppSettings, "groqApiKey"> {
  // Intentionally omit API key from JSON bodies; it is sent via headers only.
  const { groqApiKey: _key, ...rest } = s;
  void _key;
  return rest;
}

const TRANSCRIPT_CHUNK_MS = 30_000;

function kindLabel(kind: SuggestionCard["kind"]): string {
  switch (kind) {
    case "question_to_ask":
      return "Question";
    case "talking_point":
      return "Talking point";
    case "answer":
      return "Answer";
    case "fact_check":
      return "Fact check";
    case "clarify":
      return "Clarify";
    default:
      return "Suggestion";
  }
}

export function TwinMindApp() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [micStatus, setMicStatus] = useState<"idle" | "listening" | "error">("idle");

  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [batches, setBatches] = useState<SuggestionBatch[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<"transcribe" | "suggestions" | "chat" | null>(null);

  const [countdown, setCountdown] = useState(30);
  const countdownRef = useRef<number | null>(null);

  const [nextChunkDeadlineMs, setNextChunkDeadlineMs] = useState<number | null>(null);
  const [chunkUi, setChunkUi] = useState<{
    label: string;
    sec: number;
    pct: number;
  } | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const transcriptTextRef = useRef("");

  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Bootstrap from localStorage after mount (avoids SSR/localStorage mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time hydration
    setSettings(loadSettings());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveSettings(settings);
  }, [settings, hydrated]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [transcriptLines]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chatMessages]);

  useEffect(() => {
    transcriptTextRef.current = transcriptLines.map((l) => l.text).join("\n");
  }, [transcriptLines]);

  const scheduleNextChunkWindow = useCallback(() => {
    setNextChunkDeadlineMs(Date.now() + TRANSCRIPT_CHUNK_MS);
  }, []);

  useEffect(() => {
    if (!isRecording || nextChunkDeadlineMs == null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear UI when mic stops or before first deadline
      setChunkUi(null);
      return;
    }
    const deadline = nextChunkDeadlineMs;
    const tick = () => {
      const msLeft = Math.max(0, deadline - Date.now());
      const sec = Math.max(1, Math.ceil(msLeft / 1000));
      const pct = Math.min(
        100,
        Math.max(0, ((TRANSCRIPT_CHUNK_MS - msLeft) / TRANSCRIPT_CHUNK_MS) * 100),
      );
      setChunkUi({
        label: `Next transcript chunk in ~${sec}s`,
        sec,
        pct,
      });
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [isRecording, nextChunkDeadlineMs]);

  const stopCountdown = useCallback(() => {
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    stopCountdown();
    setCountdown(30);
    countdownRef.current = window.setInterval(() => {
      setCountdown((c) => (c <= 1 ? 30 : c - 1));
    }, 1000);
  }, [stopCountdown]);

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      if (!settings.groqApiKey.trim()) {
        setBanner("Add your Groq API key in Settings to transcribe audio.");
        return;
      }
      if (blob.size < 2048) return;

      setBusy("transcribe");
      try {
        const fd = new FormData();
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        fd.append("file", blob, `chunk.${ext}`);
        fd.append("model", settings.whisperModel);
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "x-groq-api-key": settings.groqApiKey },
          body: fd,
        });
        const data = (await res.json()) as { text?: string; error?: string };
        if (!res.ok) throw new Error(data.error || "Transcription failed");
        const text = (data.text || "").trim();
        if (text) {
          const line: TranscriptLine = {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            text,
          };
          setTranscriptLines((prev) => {
            const next = [...prev, line];
            transcriptTextRef.current = next.map((l) => l.text).join("\n");
            return next;
          });
        }
      } catch (e) {
        setBanner(e instanceof Error ? e.message : "Transcription error");
      } finally {
        setBusy(null);
      }
    },
    [settings.groqApiKey, settings.whisperModel],
  );

  const fetchSuggestions = useCallback(async () => {
    if (!settings.groqApiKey.trim()) {
      setBanner("Add your Groq API key in Settings to load suggestions.");
      return;
    }
    setBusy("suggestions");
    try {
      const res = await fetch("/api/suggestions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-groq-api-key": settings.groqApiKey,
        },
        body: JSON.stringify({
          transcript: transcriptTextRef.current,
          settings: publicSettings(settings),
        }),
      });
      const data = (await res.json()) as { batch?: SuggestionBatch; error?: string };
      if (!res.ok) throw new Error(data.error || "Suggestions failed");
      if (!data.batch) throw new Error("Missing batch");
      setBatches((prev) => [data.batch!, ...prev]);
      setBanner(null);
    } catch (e) {
      setBanner(e instanceof Error ? e.message : "Suggestions error");
    } finally {
      setBusy(null);
      startCountdown();
    }
  }, [settings, startCountdown]);

  const refreshAll = useCallback(async () => {
    if (isRecording && mediaRecorderRef.current?.state === "recording") {
      try {
        mediaRecorderRef.current.requestData();
      } catch {
        // ignore
      }
      return;
    }
    await fetchSuggestions();
  }, [fetchSuggestions, isRecording]);

  const attachRecorder = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const mimeCandidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));

    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    mediaRecorderRef.current = recorder;

    recorder.addEventListener("dataavailable", async (ev: BlobEvent) => {
      scheduleNextChunkWindow();
      if (!ev.data || ev.data.size === 0) {
        await fetchSuggestions();
        return;
      }
      await transcribeBlob(ev.data);
      await fetchSuggestions();
    });

    recorder.start(30_000);
    scheduleNextChunkWindow();
  }, [fetchSuggestions, scheduleNextChunkWindow, transcribeBlob]);

  const startMic = useCallback(async () => {
    if (mediaRecorderRef.current) return;
    setBanner(null);
    try {
      await attachRecorder();
      setIsRecording(true);
      setMicStatus("listening");
      startCountdown();
    } catch {
      setMicStatus("error");
      setBanner("Could not access the microphone. Check permissions.");
    }
  }, [attachRecorder, startCountdown]);

  const stopMic = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setNextChunkDeadlineMs(null);
    setIsRecording(false);
    setMicStatus("idle");
    stopCountdown();
  }, [stopCountdown]);

  useEffect(() => {
    return () => {
      stopMic();
      stopCountdown();
    };
  }, [stopMic, stopCountdown]);

  const appendAssistantMessage = useCallback((id: string, chunk: string) => {
    setChatMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
    );
  }, []);

  const runChatStream = useCallback(
    async (init: {
      mode: "detailed" | "freeform";
      userMessage: ChatMessage;
      body: Record<string, unknown>;
    }) => {
      if (!settings.groqApiKey.trim()) {
        setBanner("Add your Groq API key in Settings to use chat.");
        return;
      }

      setChatMessages((prev) => [...prev, init.userMessage]);
      const assistantId = crypto.randomUUID();
      const assistant: ChatMessage = {
        id: assistantId,
        createdAt: new Date().toISOString(),
        role: "assistant",
        content: "",
      };
      setChatMessages((prev) => [...prev, assistant]);
      setBusy("chat");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-groq-api-key": settings.groqApiKey,
          },
          body: JSON.stringify({
            ...init.body,
            transcript: transcriptTextRef.current,
            settings: publicSettings(settings),
          }),
        });

        if (!res.ok || !res.body) {
          const t = await res.text();
          throw new Error(t || "Chat request failed");
        }

        const reader = res.body.getReader();
        for await (const piece of streamGroqChatToText(reader)) {
          appendAssistantMessage(assistantId, piece);
        }
        setBanner(null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Chat error";
        setBanner(msg);
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content || `(Error) ${msg}` } : m,
          ),
        );
      } finally {
        setBusy(null);
      }
    },
    [appendAssistantMessage, settings],
  );

  const onSuggestionClick = useCallback(
    async (card: SuggestionCard, batchId: string) => {
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        role: "user",
        content: `[${kindLabel(card.kind)}] ${card.preview}`,
        sourceSuggestionId: `${batchId}:${card.kind}`,
      };

      await runChatStream({
        mode: "detailed",
        userMessage,
        body: {
          mode: "detailed",
          kind: card.kind,
          preview: card.preview,
          detailSeed: card.detailSeed,
        },
      });
    },
    [runChatStream],
  );

  const [draft, setDraft] = useState("");

  const sendDraft = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      role: "user",
      content: text,
    };
    await runChatStream({
      mode: "freeform",
      userMessage,
      body: { mode: "freeform", userText: text },
    });
  }, [draft, runChatStream]);

  const exportSession = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      transcript: transcriptLines,
      suggestionBatches: batches,
      chat: chatMessages,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `twinmind-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [batches, chatMessages, transcriptLines]);

  return (
    <div className="flex min-h-screen flex-col bg-[#0f1115] text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-wide text-zinc-200">
            TwinMind
          </span>
          <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] uppercase text-zinc-400">
            Live suggestions
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportSession}
            className="rounded-full border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:border-[#4a90e2] hover:text-white"
          >
            Export session
          </button>
          <Link
            href="/settings"
            className="rounded-full bg-[#4a90e2] px-3 py-1.5 text-xs font-medium text-black hover:brightness-110"
          >
            Settings
          </Link>
        </div>
      </header>

      {banner && (
        <div className="border-b border-amber-900/60 bg-amber-950/40 px-5 py-2 text-sm text-amber-100">
          {banner}
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 divide-y divide-zinc-800 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
        {/* Column 1 */}
        <section className="flex min-h-[420px] flex-col bg-[#14161c] lg:min-h-0">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-300">
              1. MIC &amp; TRANSCRIPT
            </h2>
            <span className="text-[11px] uppercase text-zinc-500">
              {micStatus === "listening" ? "Listening" : micStatus === "error" ? "Error" : "Idle"}
            </span>
          </div>
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => (isRecording ? stopMic() : startMic())}
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 ${
                  isRecording
                    ? "border-red-400 bg-red-500/20 text-red-100"
                    : "border-[#4a90e2] bg-[#4a90e2] text-black"
                }`}
                aria-label={isRecording ? "Stop microphone" : "Start microphone"}
              >
                <span className="text-lg">{isRecording ? "■" : "●"}</span>
              </button>
              <p className="text-sm leading-relaxed text-zinc-400">
                Click mic to start. Transcript appends every ~30s while recording.
              </p>
            </div>
            {isRecording && (
              <div className="rounded-lg border border-zinc-700 bg-[#0f1115] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4a90e2] opacity-55" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4a90e2]" />
                    </span>
                    <p className="truncate text-xs font-medium text-zinc-200">
                      {chunkUi?.label ?? "Starting chunk timer…"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-[#4a90e2]">
                    {chunkUi?.sec ?? 30}s
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-[#4a90e2] transition-[width] duration-200 ease-linear"
                    style={{ width: `${chunkUi?.pct ?? 0}%` }}
                  />
                </div>
                {busy === "transcribe" && (
                  <p className="mt-2 text-[11px] text-zinc-500">Sending latest audio to Whisper…</p>
                )}
              </div>
            )}
            <div className="rounded-lg border border-[#4a90e2]/50 bg-[#1a1d23] p-3 text-xs leading-relaxed text-sky-200/90">
              Chunks flush on a ~30s cadence and auto-scroll. Use{" "}
              <span className="font-semibold text-sky-100">Export session</span> in the header
              to download transcript, every suggestion batch, and chat with timestamps (JSON).
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col px-2 pb-4">
            <div className="mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-zinc-800 bg-[#0f1115] p-3">
              {transcriptLines.length === 0 ? (
                <p className="text-sm text-zinc-500">No transcript yet — start the mic.</p>
              ) : (
                <ul className="space-y-3 text-sm text-zinc-200">
                  {transcriptLines.map((line) => (
                    <li key={line.id} className="border-b border-zinc-800/80 pb-2 last:border-0">
                      <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                        {new Date(line.createdAt).toLocaleTimeString()}
                      </div>
                      <div className="whitespace-pre-wrap">{line.text}</div>
                    </li>
                  ))}
                </ul>
              )}
              <div ref={transcriptEndRef} />
            </div>
            {busy === "transcribe" && (
              <p className="px-3 pt-2 text-xs text-zinc-500">Transcribing latest chunk…</p>
            )}
          </div>
        </section>

        {/* Column 2 */}
        <section className="flex min-h-[420px] flex-col bg-[#14161c] lg:min-h-0">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-300">
              2. LIVE SUGGESTIONS
            </h2>
            <span className="text-[11px] uppercase text-zinc-500">
              {batches.length} batch{batches.length === 1 ? "" : "es"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <button
              type="button"
              onClick={refreshAll}
              disabled={busy === "suggestions" || busy === "transcribe"}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-600 px-3 py-1.5 text-xs text-zinc-100 hover:border-[#4a90e2] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-base">↻</span>
              Reload suggestions
            </button>
            <span className="text-xs text-zinc-500">
              {isRecording
                ? `auto-refresh ~30s (chunk cadence) · timer ${countdown}s`
                : "start mic for timed refreshes"}
            </span>
          </div>
          <div className="mx-4 rounded-lg border border-[#4a90e2]/50 bg-[#1a1d23] p-3 text-xs leading-relaxed text-sky-200/90">
            Each refresh yields exactly three cards, newest batch on top. Previews are meant to be
            useful even without a click; clicking streams a longer answer with full transcript
            context.
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            {batches.length === 0 ? (
              <p className="px-2 text-sm text-zinc-500">
                Suggestions appear here after the first successful refresh (mic chunk or manual
                reload).
              </p>
            ) : (
              <div className="space-y-6 px-2">
                {batches.map((batch, batchIndex) => {
                  const fade = Math.max(0.35, 1 - batchIndex * 0.12);
                  return (
                    <div
                      key={batch.id}
                      className="space-y-2"
                      style={{ opacity: fade }}
                    >
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
                        {new Date(batch.createdAt).toLocaleString()} · batch{" "}
                        {batches.length - batchIndex}
                      </div>
                      <div className="space-y-2">
                        {batch.suggestions.map((s) => (
                          <button
                            key={`${batch.id}-${s.preview}`}
                            type="button"
                            onClick={() => onSuggestionClick(s, batch.id)}
                            disabled={busy === "chat"}
                            className="w-full rounded-xl border border-zinc-700 bg-[#0f1115] p-3 text-left text-sm text-zinc-100 transition hover:border-[#4a90e2] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#4a90e2]">
                              {kindLabel(s.kind)}
                            </div>
                            <div className="leading-snug text-zinc-200">{s.preview}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Column 3 */}
        <section className="flex min-h-[480px] flex-col bg-[#14161c] lg:min-h-0">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-300">
              3. CHAT (DETAILED ANSWERS)
            </h2>
            <span className="text-[11px] uppercase text-zinc-500">Session-only</span>
          </div>
          <div className="mx-4 mt-3 rounded-lg border border-[#4a90e2]/50 bg-[#1a1d23] p-3 text-xs leading-relaxed text-sky-200/90">
            Tap a suggestion to add it here and stream a deeper answer. You can also type your own
            question; everything stays in memory until you reload.
          </div>
          <div
            ref={chatScrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {chatMessages.length === 0 ? (
              <p className="text-sm text-zinc-500">Click a suggestion or type a question below.</p>
            ) : (
              chatMessages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[95%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "ml-auto bg-[#1f2a3d] text-zinc-100"
                      : "mr-auto border border-zinc-800 bg-[#0f1115] text-zinc-200"
                  }`}
                >
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                    {m.role} · {new Date(m.createdAt).toLocaleTimeString()}
                  </div>
                  <div className="whitespace-pre-wrap">{m.content || "…"}</div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-zinc-800 p-3">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendDraft();
                  }
                }}
                placeholder="Ask anything…"
                className="flex-1 rounded-lg border border-zinc-700 bg-[#0f1115] px-3 py-2 text-sm text-zinc-100 outline-none ring-[#4a90e2] focus:ring-2"
              />
              <button
                type="button"
                onClick={() => void sendDraft()}
                disabled={busy === "chat" || !draft.trim()}
                className="rounded-lg bg-[#4a90e2] px-4 py-2 text-sm font-medium text-black hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
