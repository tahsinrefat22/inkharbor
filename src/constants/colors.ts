import { useColorScheme } from "react-native";

const light = {
  background: "#ffffff",
  text: "#111111",
  muted: "#666666",
  border: "#cccccc",
  primary: "#2563eb",
  onPrimary: "#ffffff",
  danger: "#dc2626",
  codeBackground: "#f3f4f6",
  codeText: "#1f2937",
};

const dark: typeof light = {
  background: "#111111",
  text: "#eeeeee",
  muted: "#999999",
  border: "#444444",
  primary: "#3b82f6",
  onPrimary: "#ffffff",
  danger: "#f87171",
  codeBackground: "#1e1e22",
  codeText: "#e5e7eb",
};

export type Colors = typeof light;

/** The app's colours for the phone's current light or dark mode. */
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
