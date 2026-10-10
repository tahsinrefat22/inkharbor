import { useCallback, useEffect, useState } from "react";

interface LoaderState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True while a pull-to-refresh is running and data is already shown. */
  refreshing: boolean;
  reload: () => Promise<void>;
}

function describeLoadError(err: unknown): string {
  if (err instanceof TypeError) {
    return "Can't reach the server. Pull down to try again.";
  }
  return err instanceof Error ? err.message : "Couldn't load this. Pull down to try again.";
}

/**
 * Runs an async loader on mount and on reload(), tracking loading and error
 * state. Keep `load` stable (useCallback) or it will re-run every render.
 */
export function useLoader<T>(load: () => Promise<T>): LoaderState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let current = true;
    load()
      .then((result) => {
        if (current) {
          setData(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (current) {
          setError(describeLoadError(err));
        }
      })
      .finally(() => {
        if (current) {
          setLoading(false);
        }
      });
    return () => {
      current = false;
    };
  }, [load]);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await load());
      setError(null);
    } catch (err) {
      setError(describeLoadError(err));
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return { data, error, loading, refreshing, reload };
}
