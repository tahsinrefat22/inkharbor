import { JetBrainsMono_400Regular, useFonts } from "@expo-google-fonts/jetbrains-mono";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useMemo, useState } from "react";
import { Appearance, StyleSheet, useColorScheme, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { OpeningAnimation } from "@/components/opening-animation";
import { useColors } from "@/constants/colors";
import { AuthProvider } from "@/lib/auth";
import { StarsProvider } from "@/lib/stars";
import { applyThemePreference, loadThemePreference } from "@/lib/theme";

// A screen opened from outside the app (a shared link, the sign-in
// redirect) gets the home screen below it, so Back goes home.
export const unstable_settings = {
  anchor: "index",
};

SplashScreen.preventAutoHideAsync();
// The phone's own setting, which the native splash screen follows; read
// before the app's chosen theme overrides it.
const SYSTEM_SCHEME = Appearance.getColorScheme() === "dark" ? "dark" : "light";
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

  // The opening animation hides the native splash once its first frame is up.
  const [intro, setIntro] = useState(true);
  const endIntro = useCallback(() => setIntro(false), []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  // The app draws edge to edge, behind both system bars; keyboard heights
  // from KeyboardProvider then line up with the screen's own layout.
  return (
    <KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>
      <ThemeProvider value={theme}>
        <AuthProvider>
          <StarsProvider>
            <StatusBar style={dark ? "light" : "dark"} />
            <View style={styles.root}>
              <Stack
                screenOptions={{
                  title: "Inkharbor",
                  headerStyle: { backgroundColor: colors.background },
                  headerTintColor: colors.text,
                  headerShadowVisible: false,
                  contentStyle: { backgroundColor: colors.background },
                }}
              />
              {intro ? <OpeningAnimation scheme={SYSTEM_SCHEME} onDone={endIntro} /> : null}
            </View>
          </StarsProvider>
        </AuthProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
