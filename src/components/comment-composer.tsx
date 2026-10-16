import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type Ref } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/constants/colors";
import { isNetworkError } from "@/lib/outline/api";

function describeSendError(err: unknown, editing: boolean): string {
  if (isNetworkError(err)) {
    return editing
      ? "Can't reach the server. Your changes are still in the box; save them again when you're online."
      : "Can't reach the server. Your comment is still in the box; send it again when you're online.";
  }
  return err instanceof Error ? err.message : "Try again.";
}

/**
 * The box for writing a comment (Markdown). `context` says what it's doing
 * besides a new comment, e.g. "Replying to Sam", with a button to stop.
 * `onSend` posts or saves; the text stays if that fails. The screen keeps
 * it above the keyboard and the navigation bar.
 */
export function CommentComposer({
  text,
  onChangeText,
  context,
  onCancel,
  editing,
  onSend,
  ref,
}: {
  text: string;
  onChangeText: (text: string) => void;
  context: string | null;
  onCancel: () => void;
  /** Editing an existing comment: the button saves instead of sending. */
  editing: boolean;
  onSend: () => Promise<void>;
  ref?: Ref<TextInput>;
}) {
  const colors = useColors();
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length > 0 && !sending;

  async function send() {
    if (!canSend) {
      return;
    }
    setSending(true);
    try {
      await onSend();
    } catch (err) {
      Alert.alert(editing ? "Comment not saved" : "Comment not posted", describeSendError(err, editing));
    } finally {
      setSending(false);
    }
  }

  return (
    <View
      style={[
        styles.composer,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {context ? (
        <View style={styles.context}>
          <Ionicons name={editing ? "create-outline" : "arrow-undo-outline"} size={14} color={colors.muted} />
          <Text style={[styles.contextText, { color: colors.muted }]} numberOfLines={1}>
            {context}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editing ? "Stop editing" : "Cancel reply"}
            onPress={onCancel}
            hitSlop={8}
          >
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput
          ref={ref}
          value={text}
          onChangeText={onChangeText}
          placeholder={context && !editing ? "Reply…" : "Add a comment…"}
          placeholderTextColor={colors.muted}
          multiline
          editable={!sending}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={editing ? "Save changes" : context ? "Send reply" : "Send comment"}
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={send}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: canSend ? colors.primary : colors.border },
            pressed && { opacity: 0.7 },
          ]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.onPrimary} />
          ) : (
            <Ionicons
              name={editing ? "checkmark" : "send"}
              size={editing ? 22 : 18}
              color={canSend ? colors.onPrimary : colors.muted}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  context: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  contextText: {
    flex: 1,
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
