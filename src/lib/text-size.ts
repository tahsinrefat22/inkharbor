import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

// The reader's text size from the account menu. Like the theme it's a device
// preference, so it lives outside the offline cache and survives Disconnect.
// It applies on top of Android's own font size setting.

export const TEXT_SIZES = [
  { scale: 0.875, label: "Small" },
  { scale: 1, label: "Default" },
  { scale: 1.125, label: "Large" },
  { scale: 1.25, label: "Larger" },
  { scale: 1.5, label: "Largest" },
] as const;

const KEY = "reader-text-size";

function load(): number {
  try {
    const value = Number(Storage.getItemSync(KEY));
    return TEXT_SIZES.some((size) => size.scale === value) ? value : 1;
  } catch {
    return 1;
  }
}

let current = load();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The reader's text scale; 1 is the default size. Updates when it's changed. */
export function useTextScale(): number {
  return useSyncExternalStore(subscribe, () => current);
}

export function saveTextScale(scale: number): void {
  current = scale;
  try {
    Storage.setItemSync(KEY, String(scale));
  } catch {
    // Applied for this session even if it couldn't be saved.
  }
  for (const listener of listeners) {
    listener();
  }
}
