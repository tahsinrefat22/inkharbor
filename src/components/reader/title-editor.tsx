import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import { Button } from "@/components/button";
import { useColors } from "@/constants/colors";
import { isNetworkError } from "@/lib/outline/api";
import { MAX_TITLE_LENGTH } from "@/lib/outline/edits";

/**
 * The document title as a text field, shown in place of the title while
 * renaming. Save is offered once the title has changed and isn't blank.
 */
export function TitleEditor({
  title,
  fontSize,
  onSave,
  onCancel,
}: {
  title: string;
  fontSize: number;
  /** Saves the new title; a rejection is shown under the field. */
  onSave: (title: string) => Promise<void>;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = draft.trim();
  const canSave = trimmed !== "" && trimmed !== title.trim();

  async function save() {
    if (!canSave || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Can't reach the server. Try again when you're online."
          : err instanceof Error
            ? err.message
            : "Couldn't rename this document. Try again.",
      );
      setBusy(false);
    }
  }

  return (
    <View style={styles.editor}>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.primary, fontSize }]}
        value={draft}
        // Titles are one line, even when pasted text has breaks.
        onChangeText={(text) => setDraft(text.replace(/\s*\n\s*/g, " "))}
        accessibilityLabel="Title"
        placeholder="Untitled"
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        maxLength={MAX_TITLE_LENGTH}
        autoFocus
        multiline
        submitBehavior="blurAndSubmit"
        returnKeyType="done"
        editable={!busy}
        onSubmitEditing={save}
      />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <View style={styles.buttons}>
        <View style={styles.button}>
          <Button title="Cancel" onPress={onCancel} disabled={busy} />
        </View>
        <View style={styles.button}>
          <Button title="Save" variant="primary" onPress={save} disabled={!canSave} busy={busy} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    gap: 10,
  },
  input: {
    fontWeight: "700",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
  },
  button: {
    flex: 1,
  },
});
