import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

// The emoji picker's skin tone and recently used emoji. Device preferences,
// like the theme, so they survive Disconnect.

const TONE_KEY = "emoji-skin-tone";
const RECENT_KEY = "emoji-recent";
const RECENT_LIMIT = 24;

function loadTone(): number {
  try {
    const value = Number(Storage.getItemSync(TONE_KEY));
    return Number.isInteger(value) && value >= 0 && value <= 5 ? value : 0;
  } catch {
    return 0;
  }
}

function loadRecent(): string[] {
  try {
    const value: unknown = JSON.parse(Storage.getItemSync(RECENT_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

let tone = loadTone();
let recent = loadRecent();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function save(key: string, value: string) {
  try {
    Storage.setItemSync(key, value);
  } catch {
    // Applied for this session even if it couldn't be saved.
  }
  listeners.forEach((listener) => listener());
}

/** 0 for the default yellow, 1–5 for light to dark. */
export function useSkinTone(): number {
  return useSyncExternalStore(subscribe, () => tone);
}

export function saveSkinTone(value: number): void {
  tone = value;
  save(TONE_KEY, String(value));
}

/** Emoji the user picked, newest first: characters, or ids of the workspace's own. */
export function useRecentEmoji(): string[] {
  return useSyncExternalStore(subscribe, () => recent);
}

export function addRecentEmoji(emoji: string): void {
  recent = [emoji, ...recent.filter((item) => item !== emoji)].slice(0, RECENT_LIMIT);
  save(RECENT_KEY, JSON.stringify(recent));
}
