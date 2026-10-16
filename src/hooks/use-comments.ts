import { useCallback, useMemo } from "react";

import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { readEntry, writeEntry } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { listComments, type OutlineComment } from "@/lib/outline/comments";

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
  return useCachedLoader(load, cache, documentId !== null);
}
