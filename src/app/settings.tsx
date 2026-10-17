import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/button";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";

export default function Settings() {
  const colors = useColors();
  const { session, sessions, disconnect } = useAuth();
  const others = sessions.filter((other) => other.id !== session?.id);
  const [busy, setBusy] = useState(false);

  function handleDisconnect() {
    Alert.alert(
      "Disconnect from this server?",
      others.length
        ? "Inkharbor will lose access to your account on this server and remove its offline copy, then open your next server. To use this one again, add it and confirm access in the browser."
        : "Inkharbor will lose access to your account. To use it again, you'll need to confirm access in the browser.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            await disconnect();
            router.dismissTo("/");
          },
        },
      ],
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Settings" }} />
      <Text style={[styles.label, { color: colors.muted }]}>Server</Text>
      <Text style={{ color: colors.text }}>{session?.server}</Text>
      <Text style={[styles.label, { color: colors.muted }]}>Account</Text>
      <Text style={{ color: colors.text }}>
        {session?.account.userName} ({session?.account.userEmail})
      </Text>
      <View style={styles.spacer} />
      <Button title="Disconnect" variant="danger" onPress={handleDisconnect} busy={busy} />
      <Text style={[styles.note, { color: colors.muted }]}>
        {"Use this to remove the app's access, for example before giving your phone to someone else. For everyday use, Sign out is enough."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 8,
  },
  label: {
    fontSize: 12,
    textTransform: "uppercase",
    marginTop: 8,
  },
  spacer: {
    height: 24,
  },
  note: {
    fontSize: 13,
  },
});
