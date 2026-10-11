import { JetBrainsMono_400Regular, useFonts } from "@expo-google-fonts/jetbrains-mono";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { useColorScheme } from "react-native";

import { useColors } from "@/constants/colors";
import { AuthProvider } from "@/lib/auth";
import { applyThemePreference, loadThemePreference } from "@/lib/theme";

SplashScreen.preventAutoHideAsync();
// Before the first render, so a chosen theme doesn't flash the other one.
applyThemePreference(loadThemePreference());

export default function RootLayout() {
  // The code font ships with the app; see CODE_FONT in the reader.
  const [fontsLoaded, fontError] = useFonts({ JetBrainsMono_400Regular });
  const colors = useColors();
  const dark = useColorScheme() === "dark";
  // Navigation's own colours (screen transitions, header ripples) from ours,
  // so nothing flashes white in dark mode.
  const theme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.background,
        text: colors.text,
        border: colors.border,
      },
    };
  }, [dark, colors]);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider value={theme}>
      <AuthProvider>
        <StatusBar style={dark ? "light" : "dark"} />
        <Stack
          screenOptions={{
            title: "Inkharbor",
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </AuthProvider>
    </ThemeProvider>
  );
}
