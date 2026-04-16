"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AppSettings } from "@/lib/types";
import { defaultSettings } from "@/lib/defaults";
import { loadSettings, saveSettings } from "@/lib/settings-storage";

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time hydration
    setSettings(loadSettings());
  }, []);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(false);
  };

  const onSave = () => {
    saveSettings(settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const onResetPrompts = () => {
    const fresh = defaultSettings();
    setSettings((s) => ({
      ...s,
      liveSuggestionSystemPrompt: fresh.liveSuggestionSystemPrompt,
      liveSuggestionUserTemplate: fresh.liveSuggestionUserTemplate,
      detailedAnswerSystemPrompt: fresh.detailedAnswerSystemPrompt,
      detailedAnswerUserTemplate: fresh.detailedAnswerUserTemplate,
      chatSystemPrompt: fresh.chatSystemPrompt,
      chatUserPrefixTemplate: fresh.chatUserPrefixTemplate,
    }));
    setSaved(false);
  };

  return (
    <div className="min-h-screen bg-[#0f1115] px-5 py-8 text-zinc-100">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">TwinMind settings</h1>
            <p className="text-sm text-zinc-400">
              Keys stay in your browser (localStorage). The app sends them to these API routes,
              which proxy requests to Groq without persisting your key.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-full border border-zinc-600 px-3 py-1.5 text-xs text-zinc-200 hover:border-[#4a90e2]"
          >
            Back to app
          </Link>
        </div>

        <section className="rounded-xl border border-zinc-800 bg-[#14161c] p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Groq</h2>
          <label className="mt-3 block text-xs uppercase tracking-wide text-zinc-500">
            API key
          </label>
          <input
            type="password"
            autoComplete="off"
            value={settings.groqApiKey}
            onChange={(e) => update("groqApiKey", e.target.value)}
            placeholder="gsk_…"
            className="mt-1 w-full rounded-lg border border-zinc-700 bg-[#0f1115] px-3 py-2 text-sm outline-none ring-[#4a90e2] focus:ring-2"
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-zinc-500">Whisper model</label>
              <input
                value={settings.whisperModel}
                onChange={(e) => update("whisperModel", e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-[#0f1115] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-zinc-500">LLM model</label>
              <input
                value={settings.llmModel}
                onChange={(e) => update("llmModel", e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-[#0f1115] px-3 py-2 text-sm"
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-[#14161c] p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Windows &amp; sampling</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              label="Live suggestion transcript window (chars)"
              value={settings.liveSuggestionContextChars}
              onChange={(n) => update("liveSuggestionContextChars", n)}
            />
            <Field
              label="Detailed answer transcript window (chars)"
              value={settings.detailedAnswerContextChars}
              onChange={(n) => update("detailedAnswerContextChars", n)}
            />
            <Field
              label="Chat transcript window (chars)"
              value={settings.chatContextChars}
              onChange={(n) => update("chatContextChars", n)}
            />
            <div />
            <Field
              label="Suggestion temperature"
              value={settings.suggestionTemperature}
              onChange={(n) => update("suggestionTemperature", n)}
              step={0.05}
            />
            <Field
              label="Chat temperature"
              value={settings.chatTemperature}
              onChange={(n) => update("chatTemperature", n)}
              step={0.05}
            />
            <Field
              label="Suggestion max tokens"
              value={settings.suggestionMaxTokens}
              onChange={(n) => update("suggestionMaxTokens", n)}
              step={1}
            />
            <Field
              label="Chat max tokens"
              value={settings.chatMaxTokens}
              onChange={(n) => update("chatMaxTokens", n)}
              step={1}
            />
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-[#14161c] p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">Prompts</h2>
            <button
              type="button"
              onClick={onResetPrompts}
              className="text-xs text-[#4a90e2] hover:underline"
            >
              Reset prompts to defaults
            </button>
          </div>
          <PromptArea
            label="Live suggestions — system"
            value={settings.liveSuggestionSystemPrompt}
            onChange={(v) => update("liveSuggestionSystemPrompt", v)}
          />
          <PromptArea
            label="Live suggestions — user template (use {{TRANSCRIPT}})"
            value={settings.liveSuggestionUserTemplate}
            onChange={(v) => update("liveSuggestionUserTemplate", v)}
          />
          <PromptArea
            label="Detailed answers (on card click) — system"
            value={settings.detailedAnswerSystemPrompt}
            onChange={(v) => update("detailedAnswerSystemPrompt", v)}
          />
          <PromptArea
            label="Detailed answers — user template ({{TRANSCRIPT}}, {{KIND}}, {{PREVIEW}}, {{DETAIL_SEED}})"
            value={settings.detailedAnswerUserTemplate}
            onChange={(v) => update("detailedAnswerUserTemplate", v)}
          />
          <PromptArea
            label="Freeform chat — system"
            value={settings.chatSystemPrompt}
            onChange={(v) => update("chatSystemPrompt", v)}
          />
          <PromptArea
            label="Freeform chat — user prefix (append the typed question after this; use {{TRANSCRIPT}})"
            value={settings.chatUserPrefixTemplate}
            onChange={(v) => update("chatUserPrefixTemplate", v)}
          />
        </section>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#4a90e2] px-4 py-2 text-sm font-medium text-black hover:brightness-110"
          >
            Save settings
          </button>
          {saved && <span className="text-sm text-emerald-400">Saved</span>}
        </div>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wide text-zinc-500">{props.label}</label>
      <input
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        step={props.step ?? 1}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-zinc-700 bg-[#0f1115] px-3 py-2 text-sm"
      />
    </div>
  );
}

function PromptArea(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mt-4 block text-xs text-zinc-400">
      <span className="font-semibold text-zinc-300">{props.label}</span>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={8}
        className="mt-2 w-full rounded-lg border border-zinc-700 bg-[#0f1115] px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-100 outline-none ring-[#4a90e2] focus:ring-2"
      />
    </label>
  );
}
