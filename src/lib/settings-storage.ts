import type { AppSettings } from "./types";
import { defaultSettings } from "./defaults";

const STORAGE_KEY = "twinmind.settings.v1";

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaultSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...defaultSettings(), ...parsed };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: AppSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function truncateMiddle(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.62);
  const tail = maxChars - head - 30;
  return `${text.slice(0, head)}\n\n[… middle truncated …]\n\n${text.slice(-tail)}`;
}
