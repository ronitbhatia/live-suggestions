export type SuggestionKind =
  | "question_to_ask"
  | "talking_point"
  | "answer"
  | "fact_check"
  | "clarify";

export type SuggestionCard = {
  kind: SuggestionKind;
  preview: string;
  /** Sent to the detailed-answer flow as the user's ask */
  detailSeed: string;
};

export type SuggestionBatch = {
  id: string;
  createdAt: string;
  suggestions: SuggestionCard[];
};

export type TranscriptLine = {
  id: string;
  createdAt: string;
  text: string;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  createdAt: string;
  role: ChatRole;
  content: string;
  /** Present when message came from a suggestion tap */
  sourceSuggestionId?: string;
};

export type AppSettings = {
  groqApiKey: string;
  whisperModel: string;
  llmModel: string;
  liveSuggestionContextChars: number;
  detailedAnswerContextChars: number;
  chatContextChars: number;
  suggestionTemperature: number;
  chatTemperature: number;
  suggestionMaxTokens: number;
  chatMaxTokens: number;
  liveSuggestionSystemPrompt: string;
  liveSuggestionUserTemplate: string;
  detailedAnswerSystemPrompt: string;
  detailedAnswerUserTemplate: string;
  chatSystemPrompt: string;
  chatUserPrefixTemplate: string;
};
