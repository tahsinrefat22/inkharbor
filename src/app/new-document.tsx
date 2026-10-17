import { router, Stack, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { Button } from "@/components/button";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { writeDocument } from "@/lib/cache";
import { isNetworkError } from "@/lib/outline/api";
import { createDocument, MAX_TITLE_LENGTH, type NewDocumentPlace } from "@/lib/outline/edits";

/**
 * A new document from a title and, optionally, Markdown text. It's
 * published at once in the collection or under the document it was started
 * from, then opened in place of this screen.
 */
export default function NewDocument() {
  const { collectionId, parentDocumentId, placeName } = useLocalSearchParams<{
    collectionId?: string;
    parentDocumentId?: string;
    placeName?: string;
  }>();
  const colors = useColors();
  const { requestWithPolicies } = useAuth();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<TextInput>(null);

  const place: NewDocumentPlace | null = parentDocumentId
    ? { parentDocumentId }
    : collectionId
      ? { collectionId }
      : null;
  const canCreate = place !== null && title.trim() !== "";

  async function create() {
    if (!place || !canCreate || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const document = await createDocument(requestWithPolicies, place, title.trim(), text);
      await writeDocument(document, { opened: true }).catch(() => {
        // Saving is best effort; the document opens from the server anyway.
      });
      router.replace({ pathname: "/document/[id]", params: { id: document.id, title: document.title } });
    } catch (err) {
      setError(
        isNetworkError(err)
          ? "Can't reach the server. Try again when you're online."
          : err instanceof Error
            ? err.message
            : "Couldn't create the document. Try again.",
      );
      setBusy(false);
    }
  }

  const inputStyle = [styles.input, { color: colors.text, borderColor: colors.border }];
  return (
    <KeyboardAwareScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
      <Stack.Screen options={{ title: "New document" }} />
      {placeName ? (
        <Text style={{ color: colors.muted }}>
          {parentDocumentId ? `Nested under ${placeName}` : `In ${placeName}`}
        </Text>
      ) : null}
      <TextInput
        style={[inputStyle, styles.title]}
        value={title}
        // Titles are one line, even when pasted text has breaks.
        onChangeText={(value) => setTitle(value.replace(/\s*\n\s*/g, " "))}
        accessibilityLabel="Title"
        placeholder="Title"
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        maxLength={MAX_TITLE_LENGTH}
        autoFocus
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => textRef.current?.focus()}
        editable={!busy}
      />
      <TextInput
        ref={textRef}
        style={[inputStyle, styles.text]}
        value={text}
        onChangeText={setText}
        accessibilityLabel="Text"
        placeholder="Text (optional)"
        placeholderTextColor={colors.muted}
        selectionColor={colors.primary}
        multiline
        textAlignVertical="top"
        editable={!busy}
      />
      <Text style={[styles.hint, { color: colors.muted }]}>
        {"Markdown works here: # Heading, **bold**, _italic_, - list, - [ ] checkbox, [link](https://…)."}
      </Text>
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Button title="Create" variant="primary" onPress={create} disabled={!canCreate} busy={busy} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  text: {
    minHeight: 200,
    lineHeight: 22,
  },
  hint: {
    fontSize: 13,
  },
});
