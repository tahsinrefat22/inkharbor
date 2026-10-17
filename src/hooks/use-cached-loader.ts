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
  /**
   * Checks the server again without the pull-to-refresh spinner, e.g. on a
   * timer. The answer is dropped if `isCurrent` is false by the time it
   * arrives, e.g. because the app changed the value itself meanwhile.
   */
  refreshQuietly: (isCurrent?: () => boolean) => Promise<void>;
  /** Shows and saves a value the app changed itself, such as a new star. */
  mutate: (value: T) => Promise<void>;
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
 * (useCallback / useMemo) or they will re-run every render. While `enabled`
 * is false (e.g. nobody is signed in) nothing loads and `data` is null.
 * A new `cache` (e.g. another account's) hides the old data at once, until
 * its own saved copy is read.
 */
export function useCachedLoader<T>(
  load: () => Promise<T>,
  cache: CacheAdapter<T>,
  enabled = true,
): CachedLoaderState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineSince, setOfflineSince] = useState<number | null>(null);
  // The cache whose saved copy `data` started from.
  const [dataCache, setDataCache] = useState<CacheAdapter<T> | null>(null);

  const fetchFresh = useCallback(
    async (saved: Cached<T> | null, isCurrent: () => boolean) => {
      try {
        const value = await load();
        if (!isCurrent()) {
          return;
        }
        // Usually the server sends back exactly what was saved. Keeping the
        // saved object then skips re-rendering, which for a long document is
        // a visible hitch right after it appears.
        if (!saved || JSON.stringify(value) !== JSON.stringify(saved.value)) {
          setData(value);
        }
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
    if (!enabled) {
      return;
    }
    let current = true;
    const isCurrent = () => current;
    (async () => {
      const saved = await cache.read().catch(() => null);
      if (!current) {
        return;
      }
      // Also replaces what an earlier session showed, e.g. after a reconnect.
      setData(saved?.value ?? null);
      setDataCache(cache);
      setLoading(!saved);
      await fetchFresh(saved, isCurrent);
      if (current) {
        setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [cache, fetchFresh, enabled]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    const saved = await cache.read().catch(() => null);
    await fetchFresh(saved, () => true);
    setRefreshing(false);
  }, [cache, fetchFresh]);

  const refreshQuietly = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!enabled) {
        return;
      }
      const saved = await cache.read().catch(() => null);
      await fetchFresh(saved, isCurrent);
    },
    [cache, fetchFresh, enabled],
  );

  const mutate = useCallback(
    async (value: T) => {
      setData(value);
      await cache.write(value).catch(() => {
        // Best effort, like saving a server copy.
      });
    },
    [cache],
  );

  if (!enabled || dataCache !== cache) {
    return {
      data: null,
      error: null,
      loading: true,
      refreshing: false,
      offlineSince: null,
      reload,
      refreshQuietly,
      mutate,
    };
  }
  return { data, error, loading, refreshing, offlineSince, reload, refreshQuietly, mutate };
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
