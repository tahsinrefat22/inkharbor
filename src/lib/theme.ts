import Storage from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";
import { Appearance } from "react-native";

// The light / dark / system choice from the account menu. It's a device
// preference, so it lives outside the offline cache and survives Disconnect.

export type ThemePreference = "system" | "light" | "dark";

const KEY = "theme";

export function loadThemePreference(): ThemePreference {
  try {
    const value = Storage.getItemSync(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** Overrides the phone's setting for this app; useColorScheme() follows it. */
export function applyThemePreference(preference: ThemePreference): void {
  Appearance.setColorScheme(preference === "system" ? "unspecified" : preference);
}

let current: ThemePreference | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The chosen theme, shared by every picker so they always agree. */
export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, () => (current ??= loadThemePreference()));
}

export function saveThemePreference(preference: ThemePreference): void {
  current = preference;
  applyThemePreference(preference);
  try {
    Storage.setItemSync(KEY, preference);
  } catch {
    // Applied for this session even if it couldn't be saved.
  }
  for (const listener of listeners) {
    listener();
  }
}
