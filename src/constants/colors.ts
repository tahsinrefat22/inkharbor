import { useColorScheme } from "react-native";

const light = {
  background: "#ffffff",
  /** Raised cards and menus. */
  surface: "#ffffff",
  /** Dims the screen behind a menu. */
  overlay: "rgba(0, 0, 0, 0.35)",
  text: "#111111",
  muted: "#666666",
  border: "#cccccc",
  primary: "#2563eb",
  onPrimary: "#ffffff",
  danger: "#dc2626",
  /** A filled star. */
  star: "#d97706",
  codeBackground: "#f3f4f6",
  codeText: "#1f2937",
};

const dark: typeof light = {
  background: "#111111",
  surface: "#1f1f23",
  overlay: "rgba(0, 0, 0, 0.6)",
  text: "#eeeeee",
  muted: "#999999",
  border: "#444444",
  primary: "#3b82f6",
  onPrimary: "#ffffff",
  danger: "#f87171",
  star: "#fbbf24",
  codeBackground: "#1e1e22",
  codeText: "#e5e7eb",
};

export type Colors = typeof light;

/** Pull-to-refresh spinner colours, so Android's spinner isn't a white disc in dark mode. */
export function refreshColors(colors: Colors) {
  return {
    colors: [colors.primary],
    progressBackgroundColor: colors.surface,
    tintColor: colors.muted,
  };
}

/** The app's colours for the phone's current light or dark mode. */
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
