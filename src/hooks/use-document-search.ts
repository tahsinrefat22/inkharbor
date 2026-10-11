import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth";
import { isNetworkError } from "@/lib/outline/api";
import { searchDocuments, type SearchResult } from "@/lib/outline/documents";

const PAGE_SIZE = 25;
/** Wait this long after the last keystroke before searching. */
const DEBOUNCE_MS = 350;

interface DocumentSearch {
  results: SearchResult[];
  /** The query the current results belong to; empty before the first search. */
  searchedFor: string;
  loading: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
}

/** Full-text search across the workspace, debounced, with paging. */
export function useDocumentSearch(query: string): DocumentSearch {
  const { request } = useAuth();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchedFor, setSearchedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Each search gets a number so a slow, older response can't replace newer results.
  const searchId = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    const id = ++searchId.current;
    if (!trimmed) {
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const page = await searchDocuments(request, trimmed, 0, PAGE_SIZE);
        if (id === searchId.current) {
          setResults(page);
          setHasMore(page.length === PAGE_SIZE);
          setSearchedFor(trimmed);
          setError(null);
        }
      } catch (err) {
        if (id === searchId.current) {
          setError(isNetworkError(err) ? "Can't reach the server." : "Search failed. Try again.");
        }
      } finally {
        if (id === searchId.current) {
          setLoading(false);
        }
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, request]);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore || !searchedFor) {
      return;
    }
    const id = searchId.current;
    setLoading(true);
    try {
      const page = await searchDocuments(request, searchedFor, results.length, PAGE_SIZE);
      if (id === searchId.current) {
        setResults((current) => [...current, ...page]);
        setHasMore(page.length === PAGE_SIZE);
      }
    } catch {
      // Scrolling to the end again retries.
    } finally {
      if (id === searchId.current) {
        setLoading(false);
      }
    }
  }, [loading, hasMore, searchedFor, results.length, request]);

  return { results, searchedFor, loading, error, loadMore };
}
