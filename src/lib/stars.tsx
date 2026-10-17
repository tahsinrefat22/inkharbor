import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { useAuth } from "@/lib/auth";
import { readEntry, writeEntry } from "@/lib/cache";
import type { DocumentSummary } from "@/lib/outline/documents";
import {
  createStar,
  deleteStar,
  isStarFor,
  listStars,
  saveStarredDocuments,
  type Starred,
  type StarTarget,
} from "@/lib/outline/stars";

interface StarsContextValue {
  /** Null until loaded, or when nobody is signed in. */
  starred: Starred | null;
  loading: boolean;
  offlineSince: number | null;
  reload: () => Promise<void>;
  /** Whether the target is starred, including a change that's still being sent. */
  isStarred: (target: StarTarget) => boolean;
  /** True while a star or unstar for the target is being sent. */
  isPending: (target: StarTarget) => boolean;
  /**
   * Stars or unstars. A document needs its details for the home screen's
   * list. Throws if the server can't be reached or says no.
   */
  toggle: (target: StarTarget, document?: DocumentSummary) => Promise<void>;
}

const StarsContext = createContext<StarsContextValue | null>(null);

function keyOf(target: StarTarget): string {
  return "documentId" in target ? `document:${target.documentId}` : `collection:${target.collectionId}`;
}

/**
 * The user's stars, shared by the home screen and the star buttons. Every
 * time the list is saved, the starred documents are saved for offline
 * reading too.
 */
export function StarsProvider({ children }: { children: ReactNode }) {
  const { status, request, requestWithPolicies, session } = useAuth();
  // Each account has its own stars; another account loads its own.
  const accountId = session?.id;

  // One offline sync at a time, so two quick changes don't download the
  // same document twice.
  const syncRef = useRef<Promise<void>>(Promise.resolve());
  const cache = useMemo<CacheAdapter<Starred>>(
    () => ({
      read: () => readEntry<Starred>("stars"),
      write: async (value) => {
        await writeEntry("stars", value);
        syncRef.current = syncRef.current
          .then(() => saveStarredDocuments(requestWithPolicies, value))
          .catch(() => {
            // Offline or the server is busy; it runs again next time.
          });
      },
    }),
    // accountId: a new cache for another account, so its stars load afresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requestWithPolicies, accountId],
  );
  const load = useCallback(() => listStars(request), [request]);
  const { data, loading, offlineSince, reload, mutate } = useCachedLoader(load, cache, status === "ready");
  // The newest list, including changes not yet rendered, so two quick
  // changes in a row don't undo each other.
  const latestRef = useRef(data);
  useEffect(() => {
    latestRef.current = data;
  }, [data]);

  // What the user just asked for, shown until the server has answered.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [pendingFor, setPendingFor] = useState(accountId);
  if (pendingFor !== accountId) {
    setPendingFor(accountId);
    setPending(new Map());
  }

  const isStarred = useCallback(
    (target: StarTarget) =>
      pending.get(keyOf(target)) ?? data?.stars.some((star) => isStarFor(star, target)) ?? false,
    [pending, data],
  );
  const isPending = useCallback((target: StarTarget) => pending.has(keyOf(target)), [pending]);

  const toggle = useCallback(
    async (target: StarTarget, document?: DocumentSummary) => {
      if (!data) {
        throw new Error("Stars haven't loaded yet.");
      }
      const key = keyOf(target);
      const existing = data.stars.find((star) => isStarFor(star, target));
      setPending((current) => new Map(current).set(key, !existing));
      try {
        let next: Starred;
        if (existing) {
          await deleteStar(request, existing.id);
          const latest = latestRef.current ?? data;
          next = {
            stars: latest.stars.filter((star) => star.id !== existing.id),
            documents: latest.documents,
          };
        } else {
          const star = await createStar(request, target);
          const latest = latestRef.current ?? data;
          next = {
            stars: [star, ...latest.stars.filter((s) => s.id !== star.id)],
            documents:
              document && !latest.documents.some((d) => d.id === document.id)
                ? [document, ...latest.documents]
                : latest.documents,
          };
        }
        latestRef.current = next;
        await mutate(next);
      } finally {
        setPending((current) => {
          const rest = new Map(current);
          rest.delete(key);
          return rest;
        });
      }
    },
    [data, request, mutate],
  );

  const value = useMemo(
    () => ({ starred: data, loading, offlineSince, reload, isStarred, isPending, toggle }),
    [data, loading, offlineSince, reload, isStarred, isPending, toggle],
  );
  return <StarsContext.Provider value={value}>{children}</StarsContext.Provider>;
}

export function useStars(): StarsContextValue {
  const value = useContext(StarsContext);
  if (!value) {
    throw new Error("useStars must be used inside StarsProvider");
  }
  return value;
}
