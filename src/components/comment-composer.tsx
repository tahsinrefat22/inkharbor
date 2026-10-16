import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type Ref } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/constants/colors";
import { isNetworkError } from "@/lib/outline/api";

function describeSendError(err: unknown): string {
  if (isNetworkError(err)) {
    return "Can't reach the server. Your comment is still in the box; send it again when you're online.";
  }
  return err instanceof Error ? err.message : "Couldn't post the comment. Try again.";
}

/**
 * The box for writing a comment, or a reply while `replyingTo` is set.
 * `onSend` posts the text (Markdown); the box is cleared once it's posted
 * and keeps the text if posting fails.
 */
export function CommentComposer({
  replyingTo,
  onCancelReply,
  onSend,
  bottomInset,
  ref,
}: {
  /** The name of the person whose thread is being replied to. */
  replyingTo: string | null;
  onCancelReply: () => void;
  onSend: (text: string) => Promise<void>;
  /** Space below the box, e.g. for the navigation bar. */
  bottomInset: number;
  ref?: Ref<TextInput>;
}) {
  const colors = useColors();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const canSend = text.trim().length > 0 && !sending;

  async function send() {
    if (!canSend) {
      return;
    }
    setSending(true);
    try {
      await onSend(text.trim());
      setText("");
    } catch (err) {
      Alert.alert("Comment not posted", describeSendError(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <View
      style={[
        styles.composer,
        { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: bottomInset + 8 },
      ]}
    >
      {replyingTo ? (
        <View style={styles.replying}>
          <Text style={[styles.replyingText, { color: colors.muted }]} numberOfLines={1}>
            {`Replying to ${replyingTo}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            onPress={onCancelReply}
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
          onChangeText={setText}
          placeholder={replyingTo ? "Reply…" : "Add a comment…"}
          placeholderTextColor={colors.muted}
          multiline
          editable={!sending}
          style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={replyingTo ? "Send reply" : "Send comment"}
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
            <Ionicons name="send" size={18} color={canSend ? colors.onPrimary : colors.muted} />
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
    gap: 6,
  },
  replying: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  replyingText: {
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
