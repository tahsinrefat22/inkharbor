import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput } from "react-native";

import { Button } from "@/components/button";
import { HeadersEditor } from "@/components/headers-editor";
import { useColors } from "@/constants/colors";
import { useAuth, type ConnectResult } from "@/lib/auth";
import { checkHeaders, parseServerAddress, savedHeaders, type HeaderList } from "@/lib/outline/server-access";

/**
 * The server address field and Continue, which confirms access in the
 * browser. `message` is shown until the user tries again, e.g. why the
 * server asked to sign in again. Extra headers, for servers behind an access
 * proxy, are behind a link so they don't get in everyone else's way.
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
  // Null while the extra headers are hidden: then the saved ones stay as they are.
  const [headers, setHeaders] = useState<HeaderList | null>(null);

  function showHeaders() {
    const address = parseServerAddress(server);
    const saved = "server" in address ? savedHeaders(address.server) : [];
    setHeaders(saved.length ? saved : [["", ""]]);
  }

  async function handleConnect() {
    if (!server.trim() || busy) {
      return;
    }
    let extra: HeaderList | undefined;
    if (headers) {
      const checked = checkHeaders(headers);
      if ("error" in checked) {
        setResult({ connected: false, error: checked.error });
        return;
      }
      extra = checked.headers;
    }
    setBusy(true);
    const outcome = await connect(server, extra);
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
      {headers ? (
        <HeadersEditor rows={headers} onChange={setHeaders} editable={!busy} />
      ) : (
        <Pressable accessibilityRole="button" onPress={showHeaders} style={({ pressed }) => pressed && styles.pressed}>
          <Text style={{ color: colors.primary }}>Behind an access proxy? Add headers</Text>
        </Pressable>
      )}
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
  pressed: {
    opacity: 0.6,
  },
});
