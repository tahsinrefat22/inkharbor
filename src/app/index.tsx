import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";

import { getAuthInfo, OutlineApiError, type AuthInfo } from "@/lib/outline/api";
import { signIn, SignInError } from "@/lib/outline/oauth";
import {
  clearSession,
  getAccessToken,
  loadSession,
  saveSession,
  type Session,
} from "@/lib/session";

type State =
  | { kind: "loading" }
  | { kind: "signedOut"; error?: string }
  | { kind: "signedIn"; session: Session; info: AuthInfo };

function describeError(err: unknown): string {
  if (err instanceof SignInError || err instanceof OutlineApiError) {
    return err.message;
  }
  return "Something went wrong. Check the server address and your connection.";
}

export default function Index() {
  const dark = useColorScheme() === "dark";
  const colors = dark ? darkColors : lightColors;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState(false);

  async function showSignedIn(session: Session) {
    const fresh = await getAccessToken(session);
    const info = await getAuthInfo(fresh.server, fresh.accessToken);
    setState({ kind: "signedIn", session: fresh, info });
  }

  useEffect(() => {
    (async () => {
      const session = await loadSession();
      if (!session) {
        setState({ kind: "signedOut" });
        return;
      }
      try {
        await showSignedIn(session);
      } catch (err) {
        if (err instanceof OutlineApiError && err.isUnauthorized) {
          await clearSession();
          setState({ kind: "signedOut", error: "Your session ended. Please sign in again." });
          return;
        }
        setState({ kind: "signedOut", error: describeError(err) });
      }
    })();
  }, []);

  async function handleSignIn() {
    setBusy(true);
    try {
      const result = await signIn(server);
      if (!result) {
        return;
      }
      await saveSession(result);
      await showSignedIn(result);
    } catch (err) {
      setState({ kind: "signedOut", error: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await clearSession();
    setState({ kind: "signedOut" });
  }

  if (state.kind === "loading") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (state.kind === "signedIn") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>{state.info.team.name}</Text>
        <Text style={{ color: colors.muted }}>
          Signed in as {state.info.user.name} ({state.info.user.email})
        </Text>
        <Text style={[styles.server, { color: colors.muted }]}>{state.session.server}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleSignOut}
          style={[styles.button, { borderColor: colors.border }]}
        >
          <Text style={{ color: colors.text }}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Connect to Outline</Text>
      <Text style={{ color: colors.muted }}>The address of your Outline server.</Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        value={server}
        onChangeText={setServer}
        placeholder="https://docs.example.com"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!busy}
        onSubmitEditing={handleSignIn}
      />
      <Pressable
        accessibilityRole="button"
        onPress={handleSignIn}
        disabled={busy || !server.trim()}
        style={[
          styles.button,
          styles.primary,
          (busy || !server.trim()) && styles.disabled,
        ]}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Sign in</Text>}
      </Pressable>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
    </View>
  );
}

const lightColors = { background: "#ffffff", text: "#111111", muted: "#666666", border: "#cccccc" };
const darkColors = { background: "#111111", text: "#eeeeee", muted: "#999999", border: "#444444" };

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
  server: {
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  button: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  primary: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  primaryText: {
    color: "#ffffff",
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.5,
  },
  error: {
    color: "#dc2626",
  },
});
