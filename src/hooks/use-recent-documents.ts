import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { useAuth } from "@/lib/auth";
import { readEntry, recentlyOpened, writeEntry, type OpenedDocument } from "@/lib/cache";
import { listViewedDocuments, type DocumentSummary, type ViewedDocument } from "@/lib/outline/documents";

/** How many recent documents are fetched and kept. */
const RECENT_LIMIT = 25;

const viewedCache: CacheAdapter<ViewedDocument[]> = {
  read: () => readEntry<ViewedDocument[]>("viewed"),
  write: (value) => writeEntry("viewed", value),
};

/**
 * Recently viewed documents, newest first: the views Outline recorded (on
 * the web or desktop app) together with documents opened in this app, which
 * Outline doesn't hear about. Works offline from the saved copies.
 */
export function useRecentDocuments() {
  const { request } = useAuth();
  const load = useCallback(() => listViewedDocuments(request, RECENT_LIMIT), [request]);
  const viewed = useCachedLoader(load, viewedCache);
  const [opened, setOpened] = useState<OpenedDocument[] | null>(null);

  const readOpened = useCallback(async () => {
    setOpened(await recentlyOpened(RECENT_LIMIT).catch(() => []));
  }, []);

  // Coming back from a document moves it to the top.
  useFocusEffect(
    useCallback(() => {
      readOpened();
    }, [readOpened]),
  );

  const documents = useMemo(() => {
    const latest = new Map<string, { document: DocumentSummary; at: number }>();
    const add = (document: DocumentSummary, at: number) => {
      const seen = latest.get(document.id);
      // The latest of the two times, and the details of the newer copy.
      latest.set(document.id, {
        document: seen && seen.document.updatedAt >= document.updatedAt ? seen.document : document,
        at: Math.max(seen?.at ?? 0, at),
      });
    };
    for (const document of viewed.data ?? []) {
      add(document, Date.parse(document.lastViewedAt));
    }
    for (const document of opened ?? []) {
      add(document, document.openedAt);
    }
    return [...latest.values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, RECENT_LIMIT)
      .map((entry) => entry.document);
  }, [viewed.data, opened]);

  const { reload: reloadViewed } = viewed;
  const reload = useCallback(async () => {
    await Promise.all([reloadViewed(), readOpened()]);
  }, [reloadViewed, readOpened]);

  return { documents, loading: viewed.loading || opened === null, reload };
}
