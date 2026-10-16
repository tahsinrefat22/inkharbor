import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { readEntry, writeEntry } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import {
  createComment,
  latestCommentAt,
  listComments,
  openComments,
  resolveComment,
  setReaction,
  unresolveComment,
  withReaction,
  type OutlineComment,
} from "@/lib/outline/comments";

// Every screen showing a document's comments (the document's badge and the
// comments screen) hears about a new or changed one at once.
type Listener = (documentId: string, comment: OutlineComment) => void;
const listeners = new Set<Listener>();

/**
 * A document's comments, saved on the device like the document itself so
 * they can be read offline. `documentId` is null until the document's id is
 * known; nothing loads until then.
 */
export function useComments(documentId: string | null) {
  const { request, session } = useAuth();
  const userId = session?.account.userId ?? null;
  const load = useCallback(() => listComments(request, documentId ?? ""), [request, documentId]);
  const cache = useMemo<CacheAdapter<OutlineComment[]>>(
    () => ({
      read: () => readEntry<OutlineComment[]>(`comments:${documentId}`),
      write: (value) => writeEntry(`comments:${documentId}`, value),
    }),
    [documentId],
  );
  const loader = useCachedLoader(load, cache, documentId !== null);

  const { data, mutate } = loader;
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const listener: Listener = (id, comment) => {
      if (id !== documentId) {
        return;
      }
      const current = dataRef.current ?? [];
      const index = current.findIndex((existing) => existing.id === comment.id);
      const next = [...current];
      if (index === -1) {
        next.push(comment);
      } else {
        // Only comments.list sends the passage a thread is on; keep it.
        next[index] = { ...comment, anchorText: comment.anchorText ?? current[index].anchorText };
      }
      // Set now, so a second change before the next render builds on this one.
      dataRef.current = next;
      mutate(next);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [documentId, mutate]);

  /**
   * Posts a comment, or a reply to `parentCommentId`, and shows it. Throws
   * if it couldn't be posted, e.g. offline.
   */
  const add = useCallback(
    async (text: string, parentCommentId?: string) => {
      if (!documentId) {
        return;
      }
      const comment = await createComment(request, { documentId, text, parentCommentId });
      listeners.forEach((listener) => listener(documentId, comment));
    },
    [request, documentId],
  );

  /** Resolves a thread, or reopens it when `resolved` is false. Throws if it couldn't. */
  const setResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      if (!documentId) {
        return;
      }
      const comment = await (resolved ? resolveComment : unresolveComment)(request, threadId);
      listeners.forEach((listener) => listener(documentId, comment));
    },
    [request, documentId],
  );

  /**
   * Adds the user's reaction to a comment, or takes it away if they already
   * reacted with that emoji. It shows at once and goes back if the server
   * can't be reached, in which case this throws.
   */
  const toggleReaction = useCallback(
    async (commentId: string, emoji: string) => {
      const comment = dataRef.current?.find((existing) => existing.id === commentId);
      if (!documentId || !userId || !comment) {
        return;
      }
      const on = !comment.reactions.some((reaction) => reaction.emoji === emoji && reaction.userIds.includes(userId));
      const show = (reactions: OutlineComment["reactions"]) =>
        listeners.forEach((listener) => listener(documentId, { ...comment, reactions }));
      show(withReaction(comment.reactions, emoji, userId, on));
      try {
        await setReaction(request, commentId, emoji, on);
      } catch (err) {
        const latest = dataRef.current?.find((existing) => existing.id === commentId) ?? comment;
        show(withReaction(latest.reactions, emoji, userId, !on));
        throw err;
      }
    },
    [request, documentId, userId],
  );

  return { ...loader, add, setResolved, toggleReaction, userId };
}

const seenKey = (documentId: string) => `comments-seen:${documentId}`;

/**
 * Remembers that the comments up to the newest in `comments` were seen, so
 * the document's badge stops counting them. Called by the comments screen.
 */
export function useMarkCommentsSeen(documentId: string, comments: OutlineComment[] | null) {
  useEffect(() => {
    const latest = comments ? latestCommentAt(comments) : null;
    if (latest) {
      writeEntry(seenKey(documentId), latest).catch(() => {});
    }
  }, [documentId, comments]);
}

/**
 * How many open comments are newer than the ones seen on the comments
 * screen, re-checked whenever the screen showing the badge comes back into
 * view. All count until the comments are opened for the first time.
 */
export function useUnseenCommentCount(documentId: string | null, comments: OutlineComment[] | null): number {
  const [seenAt, setSeenAt] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!documentId) {
        return;
      }
      readEntry<string>(seenKey(documentId))
        .then((saved) => setSeenAt(saved?.value ?? null))
        .catch(() => {});
    }, [documentId]),
  );
  return useMemo(
    () => openComments(comments ?? []).filter((comment) => !seenAt || comment.createdAt > seenAt).length,
    [comments, seenAt],
  );
}
