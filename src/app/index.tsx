import * as LocalAuthentication from "expo-local-authentication";
import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { useColors, type Colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";

export default function Index() {
  const colors = useColors();
  const auth = useAuth();

  if (auth.status === "loading") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }
  if (auth.status === "setup") {
    return <Setup colors={colors} />;
  }
  if (auth.status === "locked") {
    return <Locked colors={colors} />;
  }
  return <Home colors={colors} />;
}

/** First run, or after a disconnect: pick a server and authorize once. */
function Setup({ colors }: { colors: Colors }) {
  const { lastServer, message, connect } = useAuth();
  const [server, setServer] = useState(lastServer);
  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    setBusy(true);
    await connect(server);
    setBusy(false);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Connect to Outline</Text>
      <Text style={{ color: colors.muted }}>
        {"Enter your Outline server's address. You'll confirm access once in the browser."}
      </Text>
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
        onSubmitEditing={handleConnect}
      />
      <Button title="Continue" variant="primary" onPress={handleConnect} disabled={!server.trim()} busy={busy} />
      {message ? <Text style={{ color: colors.danger }}>{message}</Text> : null}
    </View>
  );
}

/** Signed out: the app is locked and opens again with the phone's own lock. */
function Locked({ colors }: { colors: Colors }) {
  const { session, message, unlock } = useAuth();
  const [busy, setBusy] = useState(false);
  const [deviceSecured, setDeviceSecured] = useState(true);

  useEffect(() => {
    LocalAuthentication.getEnrolledLevelAsync().then((level) =>
      setDeviceSecured(level !== LocalAuthentication.SecurityLevel.NONE),
    );
  }, []);

  async function handleSignIn() {
    setBusy(true);
    await unlock();
    setBusy(false);
  }

  const account = session?.account;
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>
        {account?.userName ? `Welcome back, ${account.userName}` : "Welcome back"}
      </Text>
      {account?.teamName ? <Text style={{ color: colors.muted }}>{account.teamName}</Text> : null}
      <Button title="Sign in" variant="primary" onPress={handleSignIn} busy={busy} />
      {message ? <Text style={{ color: colors.danger }}>{message}</Text> : null}
      {!deviceSecured ? (
        <Text style={[styles.note, { color: colors.muted }]}>
          {"Your phone has no screen lock, so anyone holding it can sign in. Set a PIN, pattern or fingerprint in your phone's settings to protect Inkharbor."}
        </Text>
      ) : null}
    </View>
  );
}

/** Signed in. Reading features come next; for now, who and where. */
function Home({ colors }: { colors: Colors }) {
  const { session, offline, lock } = useAuth();
  const account = session?.account;
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>{account?.teamName || "Outline"}</Text>
      <Text style={{ color: colors.muted }}>
        Signed in as {account?.userName} ({account?.userEmail})
      </Text>
      {offline ? (
        <Text style={{ color: colors.muted }}>{"Can't reach the server right now. Showing saved details."}</Text>
      ) : null}
      <Button title="Sign out" onPress={lock} />
      <Link href="/settings" style={[styles.link, { color: colors.primary }]}>
        Settings
      </Link>
    </View>
  );
}

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
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  note: {
    fontSize: 13,
  },
  link: {
    textAlign: "center",
    padding: 8,
  },
});
