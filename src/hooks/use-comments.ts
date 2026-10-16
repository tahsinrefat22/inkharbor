import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { readEntry, writeEntry } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { withHardBreaks } from "@/lib/outline/markdown";
import {
  createComment,
  deleteComment,
  latestCommentAt,
  listComments,
  openComments,
  resolveComment,
  setReaction,
  unresolveComment,
  updateComment,
  withReaction,
  type OutlineComment,
} from "@/lib/outline/comments";

// Every screen showing a document's comments (the document's badge and the
// comments screen) hears about a new, changed or deleted one at once.
type Change = { comment: OutlineComment } | { deleted: string };
type Listener = (documentId: string, change: Change) => void;
const listeners = new Set<Listener>();

function announce(documentId: string, change: Change) {
  listeners.forEach((listener) => listener(documentId, change));
}

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

  const { data, mutate, refreshQuietly } = loader;
  const dataRef = useRef(data);
  // Counts changes made in the app, so a check of the server that started
  // before one of them can't undo it when it comes back; and the changes
  // still on their way, during which checking would find the old state.
  const changesRef = useRef(0);
  const sendingRef = useRef(0);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const listener: Listener = (id, change) => {
      if (id !== documentId) {
        return;
      }
      const current = dataRef.current ?? [];
      let next: OutlineComment[];
      if ("deleted" in change) {
        // A thread's replies go with it.
        next = current.filter(
          (existing) => existing.id !== change.deleted && existing.parentCommentId !== change.deleted,
        );
      } else {
        const { comment } = change;
        const index = current.findIndex((existing) => existing.id === comment.id);
        next = [...current];
        if (index === -1) {
          next.push(comment);
        } else {
          // Only comments.list sends the passage a thread is on; keep it.
          next[index] = { ...comment, anchorText: comment.anchorText ?? current[index].anchorText };
        }
      }
      // Set now, so a second change before the next render builds on this one.
      dataRef.current = next;
      changesRef.current++;
      mutate(next);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [documentId, mutate]);

  /** Runs a change on the server, holding off checks for others' changes meanwhile. */
  const sending = useCallback(async <T,>(change: () => Promise<T>): Promise<T> => {
    sendingRef.current++;
    try {
      return await change();
    } finally {
      sendingRef.current--;
    }
  }, []);

  /**
   * Posts a comment, or a reply to `parentCommentId`, and shows it. Throws
   * if it couldn't be posted, e.g. offline.
   */
  const add = useCallback(
    async (text: string, parentCommentId?: string) => {
      if (!documentId) {
        return;
      }
      const comment = await sending(() =>
        createComment(request, { documentId, text: withHardBreaks(text), parentCommentId }),
      );
      announce(documentId, { comment });
    },
    [request, documentId, sending],
  );

  /** Resolves a thread, or reopens it when `resolved` is false. Throws if it couldn't. */
  const setResolved = useCallback(
    async (threadId: string, resolved: boolean) => {
      if (!documentId) {
        return;
      }
      const comment = await sending(() =>
        (resolved ? resolveComment : unresolveComment)(request, threadId),
      );
      announce(documentId, { comment });
    },
    [request, documentId, sending],
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
        announce(documentId, { comment: { ...comment, reactions } });
      show(withReaction(comment.reactions, emoji, userId, on));
      try {
        await sending(() => setReaction(request, commentId, emoji, on));
      } catch (err) {
        const latest = dataRef.current?.find((existing) => existing.id === commentId) ?? comment;
        show(withReaction(latest.reactions, emoji, userId, !on));
        throw err;
      }
    },
    [request, documentId, userId, sending],
  );

  /** Checks the server for changes made elsewhere, e.g. on the web, without a spinner. */
  const poll = useCallback(async () => {
    if (sendingRef.current) {
      return;
    }
    const changes = changesRef.current;
    await refreshQuietly(() => changesRef.current === changes && !sendingRef.current);
  }, [refreshQuietly]);

  /** Replaces a comment's text (Markdown). Throws if it couldn't be saved. */
  const edit = useCallback(
    async (commentId: string, text: string) => {
      if (!documentId) {
        return;
      }
      const comment = await sending(() => updateComment(request, commentId, withHardBreaks(text)));
      announce(documentId, { comment });
    },
    [request, documentId, sending],
  );

  /** Deletes a comment, and its replies if it starts a thread. Throws if it couldn't. */
  const remove = useCallback(
    async (commentId: string) => {
      if (!documentId) {
        return;
      }
      await sending(() => deleteComment(request, commentId));
      announce(documentId, { deleted: commentId });
    },
    [request, documentId, sending],
  );

  return { ...loader, add, edit, remove, setResolved, toggleReaction, poll, userId };
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
