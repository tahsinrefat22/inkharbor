import { router, Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ItemIcon } from "@/components/item-icon";
import { ContentsButton } from "@/components/reader/contents-button";
import { DocumentList, documentHeadings, type DocumentListHandle } from "@/components/reader/document-body";
import { StarButton } from "@/components/star-button";
import { refreshColors, useColors } from "@/constants/colors";
import { OfflineNote } from "@/components/offline-note";
import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { readDocument, writeDocument } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { useStars } from "@/lib/stars";
import {
  documentIdFromLink,
  getDocument,
  resolveAttachmentUrl,
  toSummary,
  type OutlineDocument,
} from "@/lib/outline/documents";

export default function DocumentScreen() {
  const { id, title: initialTitle } = useLocalSearchParams<{ id: string; title?: string }>();
  const colors = useColors();
  const { request, session } = useAuth();
  const load = useCallback(() => getDocument(request, id), [request, id]);
  const cache = useMemo<CacheAdapter<OutlineDocument>>(
    () => ({
      read: () => readDocument(id),
      write: (value) => writeDocument(value, { opened: true }),
    }),
    [id],
  );
  const { data: doc, error, loading, refreshing, offlineSince, reload: reloadContent } = useCachedLoader(load, cache);
  // Refreshing also catches stars changed elsewhere, e.g. on the web.
  const { reload: reloadStars } = useStars();
  const reload = useCallback(async () => {
    await Promise.all([reloadContent(), reloadStars()]);
  }, [reloadContent, reloadStars]);

  const listRef = useRef<DocumentListHandle>(null);
  const headings = useMemo(() => documentHeadings(doc?.data.content ?? []), [doc]);

  const openDocument = useCallback((documentId: string) => {
    router.push({ pathname: "/document/[id]", params: { id: documentId } });
  }, []);

  // Read at tap time, so the hourly token renewal doesn't give openLink a new
  // identity (which would redraw the whole document).
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const openLink = useCallback(
    async (href: string) => {
      const current = sessionRef.current;
      if (!current) {
        return;
      }
      const documentId = documentIdFromLink(href, current.server);
      if (documentId) {
        openDocument(documentId);
        return;
      }
      // Files on the Outline server need the token; open their signed URL instead.
      const url = await resolveAttachmentUrl(href, current.server, current.accessToken);
      await WebBrowser.openBrowserAsync(url);
    },
    [openDocument],
  );

  const title = doc?.title ?? initialTitle ?? "";
  const updated = doc
    ? `Updated ${new Date(doc.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}${doc.updatedBy ? ` by ${doc.updatedBy.name}` : ""}`
    : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: title || "Document",
          headerRight: () => (
            <View style={styles.headerActions}>
              <ContentsButton
                headings={headings}
                onSelect={(heading) => listRef.current?.scrollToBlock(heading.block)}
              />
              <StarButton
                target={doc ? { documentId: doc.id } : null}
                document={doc ? toSummary(doc) : undefined}
              />
            </View>
          ),
        }}
      />
      <DocumentList
        ref={listRef}
        blocks={doc && session ? (doc.data.content ?? []) : []}
        server={session?.server ?? ""}
        accessToken={session?.accessToken ?? ""}
        colors={colors}
        openLink={openLink}
        openDocument={openDocument}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} {...refreshColors(colors)} />}
        header={
          <View style={styles.header}>
            <View style={styles.titleRow}>
              {doc?.icon ? <ItemIcon icon={doc.icon} color={doc.color} label={title} /> : null}
              <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
                {title || "Untitled"}
              </Text>
            </View>
            {updated ? <Text style={[styles.meta, { color: colors.muted }]}>{updated}</Text> : null}
            <OfflineNote savedAt={offlineSince} />
            {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
          </View>
        }
        footer={loading ? <ActivityIndicator style={styles.loading} color={colors.text} /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
  },
  header: {
    gap: 6,
    marginBottom: 6,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    flex: 1,
    fontSize: 28,
    fontWeight: "700",
  },
  meta: {
    fontSize: 13,
    marginBottom: 12,
  },
  loading: {
    marginTop: 32,
  },
});
