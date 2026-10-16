import { useCallback, useEffect, useMemo, useRef } from "react";

import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { readEntry, writeEntry } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { createComment, listComments, type OutlineComment } from "@/lib/outline/comments";

// Every screen showing a document's comments (the document's badge and the
// comments screen) hears about a new one at once.
type Listener = (documentId: string, comment: OutlineComment) => void;
const listeners = new Set<Listener>();

/**
 * A document's comments, saved on the device like the document itself so
 * they can be read offline. `documentId` is null until the document's id is
 * known; nothing loads until then.
 */
export function useComments(documentId: string | null) {
  const { request } = useAuth();
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
      const current = dataRef.current ?? [];
      if (id === documentId && !current.some((existing) => existing.id === comment.id)) {
        mutate([...current, comment]);
      }
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

  return { ...loader, add };
}
