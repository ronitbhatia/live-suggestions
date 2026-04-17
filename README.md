# TwinMind — Live Suggestions (assignment build)

Live app: https://live-suggestions-phi.vercel.app/

Always-on meeting copilot UI: **mic + rolling transcript** (left), **three live suggestions per refresh** (middle), **streamed detailed chat** (right). Session-only: nothing is persisted server-side; reloading clears state. Your **Groq API key** and prompt edits live in **localStorage** via the Settings screen.

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **Tailwind CSS v4**
- **Groq** (OpenAI-compatible HTTP):
  - **ASR:** `whisper-large-v3` via `POST /v1/audio/transcriptions`
  - **LLM:** `openai/gpt-oss-120b` for JSON suggestions + streamed chat completions
- **Browser APIs:** `MediaRecorder` with a **30s `timeslice`** so transcript chunks align with the assignment cadence; manual **Reload suggestions** issues `requestData()` while recording to flush partial audio before the next timed chunk.

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, go to **Settings**, paste a Groq API key, save, return to the app, start the mic.

```bash
npm run build && npm start
```

## Deploy (example: Vercel)

1. Push this repo to GitHub.
2. Import the repo in Vercel (framework: Next.js, defaults are fine).
3. No server env vars are required for the Groq key (users paste their own key in the browser).

## Prompt strategy (what we optimized for)

### Live suggestions (JSON, exactly three cards)

- **Context:** recent transcript only, truncated by **character window** (default **14k chars**, middle-snipped for very long sessions) so the model focuses on what just happened.
- **Temperature:** **0.55** — enough variety to avoid repetitive “three questions,” still grounded.
- **Shape:** each card has `kind`, `preview`, and `detailSeed`. The **preview** must read like a mini deliverable for someone glancing mid-meeting; **`detailSeed`** is an internal brief for the expansion pass (names, topics, what to verify).
- **Mixing:** system prompt pushes a **blend** of question / talking point / answer / fact-check / clarify unless the conversation clearly wants a different mix.
- **JSON reliability:** server asks for `response_format: json_object` when supported, then **falls back** automatically if Groq rejects JSON mode for the model.

### Detailed answers (on card click)

- **Context:** much larger transcript window (default **60k chars**) so follow-ups can reference earlier meeting content.
- **Prompt:** separates **card kind**, **preview shown to user**, and **detail seed** so the model knows what was promised on the card vs what to expand.

### Freeform chat

- Same large transcript window by default.
- User prefix template injects transcript, then the typed question is appended verbatim.

### Latency choices

- Suggestions stay **non-streaming JSON** (small payload, easier validation of “exactly three”).
- Chat uses **SSE streaming** from Groq through the Next route for **time-to-first-token** responsiveness.
- Whisper runs **once per audio chunk**; suggestions run immediately after a successful append so the middle column tracks the newest words.

## API routes (all Groq calls are server-side)

| Route | Role |
| --- | --- |
| `POST /api/transcribe` | multipart audio → Whisper |
| `POST /api/suggestions` | transcript + settings → three-card JSON batch |
| `POST /api/chat` | streamed completion for detailed or freeform chat |

Clients authenticate each call with `x-groq-api-key` (or `Authorization: Bearer`).

## Export format

**Export session** downloads JSON:

```json
{
  "exportedAt": "ISO-8601",
  "transcript": [{ "id", "createdAt", "text" }],
  "suggestionBatches": [{ "id", "createdAt", "suggestions": [...] }],
  "chat": [{ "id", "createdAt", "role", "content", "sourceSuggestionId?" }]
}
```

## Tradeoffs / known limits

- **Manual reload while recording** relies on `MediaRecorder.requestData()` firing `dataavailable`; if the browser delivers an empty blob, you still get a suggestion refresh but **no** new transcript line.
- **Prompt changes mid-recording** only apply after restarting the mic (the recorder closure holds the latest handlers in normal use, but restarting avoids surprises).
- **Minimum audio size:** tiny blobs (<2KB) are skipped to avoid spamming Whisper with empty clicks.
- **Empty transcript:** `/api/suggestions` returns `400` — start the mic or wait for the first chunk before expecting cards.

## Product note

We cannot download or authenticate to the commercial TwinMind app from this environment; the UX and prompt structure here are built directly from the provided prototype + assignment spec.
