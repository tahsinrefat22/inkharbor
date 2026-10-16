import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { AppState } from "react-native";

/**
 * Runs `poll` every `intervalMs` while the screen is on top and the app is in
 * the foreground, and once more as soon as the app comes back to the
 * foreground. A check still on its way is never doubled up. Keep `poll`
 * stable (useCallback).
 */
export function usePollWhileVisible(poll: () => Promise<void>, intervalMs: number) {
  useFocusEffect(
    useCallback(() => {
      let running = false;
      const tick = async () => {
        if (running || AppState.currentState !== "active") {
          return;
        }
        running = true;
        try {
          await poll();
        } catch {
          // The next tick tries again; the screen shows what it already has.
        } finally {
          running = false;
        }
      };
      const timer = setInterval(tick, intervalMs);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          tick();
        }
      });
      return () => {
        clearInterval(timer);
        subscription.remove();
      };
    }, [poll, intervalMs]),
  );
}
