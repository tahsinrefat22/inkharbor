import * as LocalAuthentication from "expo-local-authentication";
import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/button";
import { HomeList } from "@/components/home-list";
import { ServerForm } from "@/components/server-form";
import { useColors, type Colors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { hostOf, takePendingLink } from "@/lib/shared-link";

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

/** First run, after a disconnect, or when a server asks to sign in again. */
function Setup({ colors }: { colors: Colors }) {
  const { lastServer, message, sessions, cancelSetup } = useAuth();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>Connect to Outline</Text>
      <Text style={{ color: colors.muted }}>
        {"Enter your Outline server's address. You'll confirm access once in the browser."}
      </Text>
      <ServerForm initialServer={lastServer} message={message} />
      {sessions.length ? (
        <Button
          title={`Back to ${sessions[0].account.teamName || hostOf(sessions[0].server)}`}
          onPress={cancelSetup}
        />
      ) : null}
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

/** Signed in: search, starred and recent documents, and the collections. */
function Home({ colors }: { colors: Colors }) {
  const { session } = useAuth();

  // A link shared to the app while it was locked or not connected.
  useEffect(() => {
    const link = takePendingLink();
    if (link) {
      router.push({ pathname: "/shared", params: { url: link } });
    }
  }, []);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: session?.account.teamName || "Inkharbor",
          headerRight: () => <AccountMenu />,
        }}
      />
      {/* Starts afresh for another account, with its own lists and search. */}
      <HomeList key={session?.id} />
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
  note: {
    fontSize: 13,
  },
  flex: {
    flex: 1,
  },
});
