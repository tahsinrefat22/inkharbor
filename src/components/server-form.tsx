import { useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";

import { Button } from "@/components/button";
import { useColors } from "@/constants/colors";
import { useAuth, type ConnectResult } from "@/lib/auth";

/**
 * The server address field and Continue, which confirms access in the
 * browser. `message` is shown until the user tries again, e.g. why the
 * server asked to sign in again.
 */
export function ServerForm({
  initialServer = "",
  message,
  onConnected,
}: {
  initialServer?: string;
  message?: string | null;
  onConnected?: () => void;
}) {
  const colors = useColors();
  const { connect } = useAuth();
  const [server, setServer] = useState(initialServer);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ConnectResult | null>(null);

  async function handleConnect() {
    if (!server.trim() || busy) {
      return;
    }
    setBusy(true);
    const outcome = await connect(server);
    setBusy(false);
    setResult(outcome);
    if (outcome.connected) {
      onConnected?.();
    }
  }

  const error = result ? (result.connected ? null : result.error) : message;
  return (
    <>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        value={server}
        onChangeText={setServer}
        placeholder="https://docs.example.com"
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!busy}
        onSubmitEditing={handleConnect}
      />
      <Button title="Continue" variant="primary" onPress={handleConnect} disabled={!server.trim()} busy={busy} />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
});
