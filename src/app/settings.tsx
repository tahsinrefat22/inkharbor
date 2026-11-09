import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { Button } from "@/components/button";
import { HeadersEditor } from "@/components/headers-editor";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { pendingEdits } from "@/lib/cache";
import { checkHeaders, savedHeaders, setServerHeaders, type HeaderList } from "@/lib/outline/server-access";

export default function Settings() {
  const colors = useColors();
  const { session, sessions, disconnect } = useAuth();
  const others = sessions.filter((other) => other.id !== session?.id);
  const [busy, setBusy] = useState(false);
  const [headers, setHeaders] = useState<HeaderList>(() => savedHeaders(session?.server ?? ""));
  const [headersNote, setHeadersNote] = useState<{ text: string; error: boolean } | null>(null);

  async function saveHeaders() {
    const checked = checkHeaders(headers);
    if ("error" in checked) {
      setHeadersNote({ text: checked.error, error: true });
      return;
    }
    await setServerHeaders(session?.server ?? "", checked.headers);
    setHeaders(checked.headers);
    setHeadersNote({ text: checked.headers.length ? "Saved." : "Removed.", error: false });
  }

  async function handleDisconnect() {
    // The open account's edits made offline, which disconnecting deletes.
    const waiting = await pendingEdits().then(
      (edits) => edits.length,
      () => 0,
    );
    const unsaved = waiting
      ? ` Your changes to ${waiting === 1 ? "1 document haven't" : `${waiting} documents haven't`} been saved to the server yet and will be deleted.`
      : "";
    Alert.alert(
      "Disconnect from this server?",
      (others.length
        ? "Inkharbor will lose access to your account on this server and remove its offline copy, then open your next server. To use this one again, add it and confirm access in the browser."
        : "Inkharbor will lose access to your account. To use it again, you'll need to confirm access in the browser.") + unsaved,
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
    <KeyboardAwareScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <Stack.Screen options={{ title: "Settings" }} />
      <Text style={[styles.label, { color: colors.muted }]}>Server</Text>
      <Text style={{ color: colors.text }}>{session?.server}</Text>
      <Text style={[styles.label, { color: colors.muted }]}>Account</Text>
      <Text style={{ color: colors.text }}>
        {session?.account.userName} ({session?.account.userEmail})
      </Text>
      <Text style={[styles.label, { color: colors.muted }]}>Extra headers</Text>
      <HeadersEditor
        rows={headers}
        onChange={(rows) => {
          setHeaders(rows);
          setHeadersNote(null);
        }}
      />
      <Button title="Save headers" onPress={saveHeaders} />
      {headersNote ? (
        <Text style={[styles.note, { color: headersNote.error ? colors.danger : colors.muted }]}>{headersNote.text}</Text>
      ) : null}
      <View style={styles.spacer} />
      <Button title="Disconnect" variant="danger" onPress={handleDisconnect} busy={busy} />
      <Text style={[styles.note, { color: colors.muted }]}>
        {"Use this to remove the app's access, for example before giving your phone to someone else. For everyday use, Sign out is enough."}
      </Text>
      <View style={styles.spacer} />
      <Button title="Open-source licences" onPress={() => router.push("/licenses")} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
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
