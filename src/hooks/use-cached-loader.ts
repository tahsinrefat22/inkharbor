import { useCallback, useEffect, useState } from "react";

import type { Cached } from "@/lib/cache";
import { isNetworkError, OutlineApiError } from "@/lib/outline/api";

export interface CacheAdapter<T> {
  read: () => Promise<Cached<T> | null>;
  write: (value: T) => Promise<void>;
}

interface CachedLoaderState<T> {
  data: T | null;
  error: string | null;
  /** True until either a saved copy or the server's answer is shown. */
  loading: boolean;
  refreshing: boolean;
  /** Set while showing a saved copy because the server couldn't be reached. */
  offlineSince: number | null;
  reload: () => Promise<void>;
}

/** No internet, or the server is down: a saved copy is the best we can show. */
function isUnreachable(err: unknown): boolean {
  return isNetworkError(err) || (err instanceof OutlineApiError && err.isServerError);
}

function describeLoadError(err: unknown): string {
  if (isUnreachable(err)) {
    return "Can't reach the server. Pull down to try again.";
  }
  return err instanceof Error ? err.message : "Couldn't load this. Pull down to try again.";
}

/**
 * Shows the saved copy at once, then loads from the server and saves the
 * result. If the server can't be reached, the saved copy stays on screen and
 * `offlineSince` says when it was saved. Keep `load` and `cache` stable
 * (useCallback / useMemo) or they will re-run every render.
 */
export function useCachedLoader<T>(load: () => Promise<T>, cache: CacheAdapter<T>): CachedLoaderState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);

  const fetchFresh = useCallback(
    async (saved: Cached<T> | null, isCurrent: () => boolean) => {
      try {
        const value = await load();
        if (!isCurrent()) {
          return;
        }
        setData(value);
        setError(null);
        setOfflineSince(null);
        await cache.write(value).catch(() => {
          // Saving is best effort; the screen already shows fresh data.
        });
      } catch (err) {
        if (!isCurrent()) {
          return;
        }
        if (saved && isUnreachable(err)) {
          setOfflineSince(saved.savedAt);
          setError(null);
        } else {
          setError(describeLoadError(err));
        }
      }
    },
    [load, cache],
  );

  useEffect(() => {
    let current = true;
    const isCurrent = () => current;
    (async () => {
      const saved = await cache.read().catch(() => null);
      if (!current) {
        return;
      }
      if (saved) {
        setData(saved.value);
        setLoading(false);
      }
      await fetchFresh(saved, isCurrent);
      if (current) {
        setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [cache, fetchFresh]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    const saved = await cache.read().catch(() => null);
    await fetchFresh(saved, () => true);
    setRefreshing(false);
  }, [cache, fetchFresh]);

  return { data, error, loading, refreshing, offlineSince, reload };
}

/** "saved 5 min ago" style text for offline notes. */
export function savedAgo(savedAt: number): string {
  const minutes = Math.round((Date.now() - savedAt) / 60_000);
  if (minutes < 1) {
    return "saved just now";
  }
  if (minutes < 60) {
    return `saved ${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `saved ${hours} h ago`;
  }
  return `saved ${new Date(savedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
