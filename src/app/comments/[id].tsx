import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams } from "expo-router";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/avatar";
import { CommentComposer } from "@/components/comment-composer";
import { OfflineNote } from "@/components/offline-note";
import { ReactionsSheet } from "@/components/reactions-sheet";
import { ReactionEmoji, ReaderBlocks, ReaderProvider } from "@/components/reader/document-body";
import { TabPager } from "@/components/tab-pager";
import { refreshColors, useColors, type Colors } from "@/constants/colors";
import { useComments, useMarkCommentsSeen } from "@/hooks/use-comments";
import { useKeyboardOverlap } from "@/hooks/use-keyboard-overlap";
import { useReaderLinks } from "@/hooks/use-reader-links";
import { useAuth } from "@/lib/auth";
import { readDocument } from "@/lib/cache";
import { isNetworkError } from "@/lib/outline/api";
import { commentOrder, toThreads, type CommentThread, type OutlineComment } from "@/lib/outline/comments";
import { useTextScale } from "@/lib/text-size";

const TABS = ["Open", "Resolved"];

/** What a comment can do, shared with every comment on the screen. */
interface CommentActions {
  userId: string | null;
  toggleReaction: (commentId: string, emoji: string) => void;
}

const CommentActionsContext = createContext<CommentActions>({ userId: null, toggleReaction: () => {} });

function describeActionError(err: unknown): string {
  if (isNetworkError(err)) {
    return "Can't reach the server. Try again when you're online.";
  }
  return err instanceof Error ? err.message : "Try again.";
}

/** "5 min ago" for recent comments, the date for older ones. */
function commentTime(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  if (minutes < 24 * 60) {
    return `${Math.round(minutes / 60)} h ago`;
  }
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
}

/**
 * A document's comment threads, open and resolved on two tabs like on the
 * web. Threads on a passage show the passage and follow the document's
 * order; comments on the whole document come after them. The box at the
 * bottom of the Open tab posts a comment, or a reply after tapping Reply.
 * Resolving a thread moves it to the Resolved tab, and reopening moves it back.
 */
export default function CommentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { session } = useAuth();
  const { openLink, openDocument } = useReaderLinks();
  const { data, error, loading, refreshing, offlineSince, reload, add, setResolved, toggleReaction, userId } =
    useComments(id);
  const actions = useMemo<CommentActions>(
    () => ({
      userId,
      toggleReaction: (commentId, emoji) => {
        toggleReaction(commentId, emoji).catch((err: unknown) =>
          Alert.alert("Reaction not saved", describeActionError(err)),
        );
      },
    }),
    [userId, toggleReaction],
  );
  // Everything shown here counts as seen, including comments arriving while it's open.
  useMarkCommentsSeen(id, data);
  const insets = useSafeAreaInsets();
  const { viewRef: keyboardViewRef, overlap: keyboardOverlap, open: keyboardOpen } = useKeyboardOverlap();
  const inputRef = useRef<TextInput>(null);
  const openListRef = useRef<FlatList<CommentThread>>(null);
  const [replyingTo, setReplyingTo] = useState<OutlineComment | null>(null);

  // The order of the commented passages, from the saved copy of the document
  // (it's saved whenever it's opened, which is how this screen is reached).
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    readDocument(id)
      .then((saved) => setOrder(commentOrder(saved?.value.data.content ?? [])))
      .catch(() => {});
  }, [id]);

  const threads = useMemo(() => toThreads(data ?? [], order), [data, order]);
  const open = useMemo(() => threads.filter((thread) => !thread.comment.resolvedAt), [threads]);
  // Most recently resolved first, as on the web.
  const resolved = useMemo(
    () =>
      threads
        .filter((thread) => thread.comment.resolvedAt)
        .sort((a, b) => (b.comment.resolvedAt ?? "").localeCompare(a.comment.resolvedAt ?? "")),
    [threads],
  );
  const [tab, setTab] = useState(0);

  function reply(comment: OutlineComment) {
    setReplyingTo(comment);
    inputRef.current?.focus();
  }

  async function send(text: string) {
    const parent = replyingTo;
    await add(text, parent?.id);
    setReplyingTo(null);
    if (!parent) {
      // New threads on the whole document come last.
      setTimeout(() => openListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  function renderPage(index: number) {
    const list = index === 0 ? open : resolved;
    return (
      <FlatList
        ref={index === 0 ? openListRef : undefined}
        data={list}
        keyExtractor={(thread) => thread.comment.id}
        renderItem={({ item }) => (
          <ThreadCard thread={item} onReply={index === 0 ? reply : undefined} onSetResolved={setResolved} />
        )}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} {...refreshColors(colors)} />}
        ListHeaderComponent={
          <>
            <OfflineNote savedAt={offlineSince} />
            {error ? <Text style={[styles.message, { color: colors.danger }]}>{error}</Text> : null}
          </>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loading} color={colors.text} />
          ) : error ? null : (
            <Text style={[styles.message, { color: colors.muted }]}>
              {index === 0 ? "No open comments on this document." : "No resolved comments."}
            </Text>
          )
        }
      />
    );
  }

  return (
    <View
      ref={keyboardViewRef}
      style={[styles.container, { backgroundColor: colors.background, paddingBottom: keyboardOverlap }]}
    >
      <Stack.Screen options={{ title: "Comments" }} />
      <ReaderProvider
        server={session?.server ?? ""}
        accessToken={session?.accessToken ?? ""}
        colors={colors}
        openLink={openLink}
        openDocument={openDocument}
      >
        <CommentActionsContext.Provider value={actions}>
          <View style={styles.pager}>
            <TabPager
              titles={TABS}
              initialIndex={tab}
              onChange={(index) => {
                setTab(index);
                setReplyingTo(null);
              }}
              renderPage={renderPage}
            />
          </View>
        </CommentActionsContext.Provider>
      </ReaderProvider>
      {tab === 0 ? (
        <CommentComposer
          ref={inputRef}
          replyingTo={replyingTo?.createdBy.name ?? null}
          onCancelReply={() => setReplyingTo(null)}
          onSend={send}
          bottomInset={keyboardOpen ? 0 : insets.bottom}
        />
      ) : null}
    </View>
  );
}

function ThreadCard({
  thread,
  onReply,
  onSetResolved,
}: {
  thread: CommentThread;
  /** Not set on resolved threads, which can't be replied to here. */
  onReply?: (comment: OutlineComment) => void;
  onSetResolved: (threadId: string, resolved: boolean) => Promise<void>;
}) {
  const colors = useColors();
  const scale = useTextScale();
  const { comment, replies } = thread;
  const [resolving, setResolving] = useState(false);
  const resolved = comment.resolvedAt !== null;

  function confirmToggleResolved() {
    Alert.alert(
      resolved ? "Reopen this thread?" : "Resolve this thread?",
      resolved
        ? "It moves back to the Open tab."
        : "It moves to the Resolved tab, where you can reopen it later.",
      [
        { text: "Cancel", style: "cancel" },
        { text: resolved ? "Reopen" : "Resolve", onPress: toggleResolved },
      ],
    );
  }

  async function toggleResolved() {
    setResolving(true);
    try {
      await onSetResolved(comment.id, !resolved);
    } catch (err) {
      Alert.alert(resolved ? "Thread not reopened" : "Thread not resolved", describeActionError(err));
      setResolving(false);
    }
    // On success the card moves to the other tab, so there's nothing to reset.
  }
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {comment.anchorText ? (
        <View style={[styles.anchor, { borderColor: colors.star }]}>
          <Text style={{ color: colors.muted, fontSize: 14 * scale, lineHeight: 20 * scale }} numberOfLines={3}>
            {comment.anchorText}
          </Text>
        </View>
      ) : null}
      <CommentView comment={comment} />
      {replies.map((reply) => (
        <View key={reply.id} style={[styles.reply, { borderColor: colors.border }]}>
          <CommentView comment={reply} />
        </View>
      ))}
      {comment.resolvedAt ? (
        <Text style={[styles.resolved, { color: colors.muted, fontSize: 13 * scale }]}>
          {`Resolved${comment.resolvedBy ? ` by ${comment.resolvedBy.name}` : ""} · ${commentTime(comment.resolvedAt)}`}
        </Text>
      ) : null}
      <View style={styles.actions}>
        {onReply ? (
          <ThreadAction
            icon="arrow-undo-outline"
            label="Reply"
            accessibilityLabel={`Reply to ${comment.createdBy.name}`}
            onPress={() => onReply(comment)}
          />
        ) : null}
        <ThreadAction
          icon={resolved ? "refresh-outline" : "checkmark-circle-outline"}
          label={resolved ? "Reopen" : "Resolve"}
          accessibilityLabel={resolved ? "Reopen thread" : "Resolve thread"}
          onPress={confirmToggleResolved}
          busy={resolving}
        />
      </View>
    </View>
  );
}

function ThreadAction({
  icon,
  label,
  accessibilityLabel,
  onPress,
  busy = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const colors = useColors();
  const scale = useTextScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.action, (pressed || busy) && { opacity: 0.5 }]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name={icon} size={16 * scale} color={colors.primary} />
      )}
      <Text style={{ color: colors.primary, fontSize: 14 * scale, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}

function CommentView({ comment }: { comment: OutlineComment }) {
  const colors = useColors();
  const scale = useTextScale();
  const { session } = useAuth();
  const { userId, toggleReaction } = useContext(CommentActionsContext);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { createdBy } = comment;
  return (
    <View style={styles.comment}>
      <Avatar
        name={createdBy.name}
        avatarUrl={createdBy.avatarUrl}
        color={createdBy.color}
        size={28}
        server={session?.server}
        accessToken={session?.accessToken}
      />
      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <Text style={[styles.metaText, { fontSize: 14 * scale }]} numberOfLines={1}>
            <Text style={[styles.author, { color: colors.text }]}>{createdBy.name}</Text>
            <Text style={{ color: colors.muted }}>{`  ${commentTime(comment.createdAt)}`}</Text>
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="React"
            onPress={() => setSheetOpen(true)}
            hitSlop={10}
            style={({ pressed }) => pressed && { opacity: 0.5 }}
          >
            <Ionicons name="happy-outline" size={18 * scale} color={colors.muted} />
          </Pressable>
        </View>
        <ReaderBlocks nodes={comment.data.content ?? []} />
        <Reactions
          comment={comment}
          colors={colors}
          userId={userId}
          onToggle={(emoji) => toggleReaction(comment.id, emoji)}
          onShowAll={() => setSheetOpen(true)}
        />
      </View>
      {sheetOpen ? (
        <ReactionsSheet
          comment={comment}
          userId={userId}
          onToggle={(emoji) => toggleReaction(comment.id, emoji)}
          onClosed={() => setSheetOpen(false)}
        />
      ) : null}
    </View>
  );
}

/**
 * A comment's reactions as chips. Tapping one adds or takes back the
 * user's own; holding one shows who reacted.
 */
function Reactions({
  comment,
  colors,
  userId,
  onToggle,
  onShowAll,
}: {
  comment: OutlineComment;
  colors: Colors;
  userId: string | null;
  onToggle: (emoji: string) => void;
  onShowAll: () => void;
}) {
  const scale = useTextScale();
  const reactions = comment.reactions.filter((reaction) => reaction.userIds.length);
  if (!reactions.length) {
    return null;
  }
  return (
    <View style={styles.reactions}>
      {reactions.map((reaction) => {
        const mine = userId !== null && reaction.userIds.includes(userId);
        const count = reaction.userIds.length;
        return (
          <Pressable
            key={reaction.emoji}
            accessibilityRole="button"
            accessibilityLabel={`${reaction.emoji}, ${count}${mine ? ", including you" : ""}`}
            accessibilityHint={mine ? "Takes back your reaction. Hold to see who reacted." : "Adds your reaction. Hold to see who reacted."}
            accessibilityState={{ selected: mine }}
            disabled={!userId}
            onPress={() => onToggle(reaction.emoji)}
            onLongPress={onShowAll}
            style={({ pressed }) => [
              styles.reaction,
              { borderColor: mine ? colors.primary : colors.border },
              mine && { backgroundColor: `${colors.primary}26` },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={{ fontSize: 14 * scale }}>
              <ReactionEmoji emoji={reaction.emoji} />
            </Text>
            <Text style={{ color: mine ? colors.primary : colors.muted, fontSize: 13 * scale }}>{count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pager: {
    flex: 1,
  },
  list: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
  },
  message: {
    textAlign: "center",
    marginTop: 32,
  },
  loading: {
    marginTop: 32,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  anchor: {
    borderLeftWidth: 3,
    paddingLeft: 10,
  },
  comment: {
    flexDirection: "row",
    gap: 10,
  },
  commentBody: {
    flex: 1,
    gap: 4,
  },
  commentMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metaText: {
    flex: 1,
  },
  author: {
    fontWeight: "600",
  },
  reply: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
  },
  resolved: {
    fontStyle: "italic",
  },
  actions: {
    flexDirection: "row",
    gap: 24,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  reactions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  reaction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
});
