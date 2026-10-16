import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { Avatar } from "@/components/avatar";
import { BottomSheet } from "@/components/bottom-sheet";
import { EmojiPicker } from "@/components/emoji-picker";
import { ReactionEmoji } from "@/components/reader/document-body";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { addRecentEmoji } from "@/lib/emoji-preferences";
import { isNetworkError } from "@/lib/outline/api";
import { listReactions, type CommentUser, type OutlineComment } from "@/lib/outline/comments";

/** The reactions offered for one tap, like the web's quick reactions. */
const QUICK_REACTIONS = ["👍", "👎", "😄", "🎉", "❤️", "🚀", "👀"];

type Reacted = { emoji: string; user: CommentUser }[];

/**
 * A comment's reactions: a row of emoji to react with (yours are
 * highlighted; tapping one again takes it back), a button for every other
 * emoji, and who reacted with what. Needs ReaderProvider for the
 * workspace's own emoji.
 */
export function ReactionsSheet({
  comment,
  userId,
  onToggle,
  onClosed,
}: {
  comment: OutlineComment;
  userId: string | null;
  onToggle: (emoji: string) => void;
  onClosed: () => void;
}) {
  const colors = useColors();
  const { request, session } = useAuth();
  const { height: windowHeight } = useWindowDimensions();
  const [picking, setPicking] = useState(false);
  const [reacted, setReacted] = useState<Reacted | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    listReactions(request, comment.id)
      .then((list) => {
        if (current) {
          setReacted(list);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (current) {
          setError(
            isNetworkError(err) ? "Can't reach the server to see who reacted." : "Couldn't load who reacted.",
          );
        }
      });
    return () => {
      current = false;
    };
  }, [request, comment.id]);

  const mine = new Set(
    comment.reactions.filter((reaction) => userId && reaction.userIds.includes(userId)).map((r) => r.emoji),
  );
  // In the order the comment shows its reactions.
  const order = comment.reactions.map((reaction) => reaction.emoji);
  const people = [...(reacted ?? [])].sort((a, b) => order.indexOf(a.emoji) - order.indexOf(b.emoji));

  function pick(emoji: string) {
    if (!mine.has(emoji)) {
      addRecentEmoji(emoji);
    }
    onToggle(emoji);
  }

  return (
    <BottomSheet title={picking ? "Add a reaction" : "Reactions"} onClosed={onClosed}>
      {(close) =>
        picking ? (
          <EmojiPicker height={windowHeight * 0.6} selected={mine} onPick={(emoji) => close(() => pick(emoji))} />
        ) : (
        <>
          <View style={styles.quick}>
            {QUICK_REACTIONS.map((emoji) => {
              const selected = mine.has(emoji);
              return (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={selected ? `Remove your ${emoji}` : `React with ${emoji}`}
                  accessibilityState={{ selected }}
                  disabled={!userId}
                  onPress={() => close(() => pick(emoji))}
                  style={({ pressed }) => [
                    styles.quickButton,
                    selected && { backgroundColor: `${colors.primary}26`, borderColor: colors.primary },
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.quickEmoji}>{emoji}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More emoji"
              disabled={!userId}
              onPress={() => setPicking(true)}
              style={({ pressed }) => [
                styles.quickButton,
                { borderColor: colors.border },
                pressed && { opacity: 0.6 },
              ]}
            >
              <Ionicons name="add" size={22} color={colors.muted} />
            </Pressable>
          </View>
          {comment.reactions.length ? (
            <FlatList
              data={people}
              keyExtractor={(item) => `${item.emoji}:${item.user.id}`}
              ListHeaderComponent={
                <Text style={[styles.heading, { color: colors.muted }]}>Reacted</Text>
              }
              ListEmptyComponent={
                error ? (
                  <Text style={[styles.note, { color: colors.muted }]}>{error}</Text>
                ) : (
                  <ActivityIndicator style={styles.loading} color={colors.text} />
                )
              }
              renderItem={({ item }) => (
                <View style={styles.person}>
                  <Text style={styles.personEmoji}>
                    <ReactionEmoji emoji={item.emoji} />
                  </Text>
                  <Avatar
                    name={item.user.name}
                    avatarUrl={item.user.avatarUrl}
                    color={item.user.color}
                    size={28}
                    server={session?.server}
                    accessToken={session?.accessToken}
                  />
                  <Text style={[styles.personName, { color: colors.text }]} numberOfLines={1}>
                    {item.user.id === userId ? `${item.user.name} (you)` : item.user.name}
                  </Text>
                </View>
              )}
            />
          ) : (
            <Text style={[styles.note, { color: colors.muted }]}>No reactions yet.</Text>
          )}
        </>
        )
      }
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  quick: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  quickButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  quickEmoji: {
    fontSize: 22,
  },
  heading: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 4,
  },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  personEmoji: {
    fontSize: 20,
    width: 28,
    textAlign: "center",
  },
  personName: {
    flex: 1,
    fontSize: 15,
  },
  note: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  loading: {
    marginVertical: 16,
  },
});
