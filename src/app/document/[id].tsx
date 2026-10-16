import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ItemIcon } from "@/components/item-icon";
import { CommentsButton } from "@/components/reader/comments-button";
import { ContentsButton } from "@/components/reader/contents-button";
import { DocumentMenu } from "@/components/reader/document-menu";
import { DocumentList, documentHeadings, type DocumentListHandle } from "@/components/reader/document-body";
import { StarButton } from "@/components/star-button";
import { refreshColors, useColors } from "@/constants/colors";
import { OfflineNote } from "@/components/offline-note";
import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { useComments, useUnseenCommentCount } from "@/hooks/use-comments";
import { useReaderLinks } from "@/hooks/use-reader-links";
import { readDocument, writeDocument } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { useStars } from "@/lib/stars";
import { useTextScale } from "@/lib/text-size";
import { openComments } from "@/lib/outline/comments";
import { getDocument, toSummary, type OutlineDocument } from "@/lib/outline/documents";

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
  // `id` can be the urlId from a link; comments are kept by the real id.
  const comments = useComments(doc?.id ?? null);
  const hasOpenComments = useMemo(() => openComments(comments.data ?? []).length > 0, [comments.data]);
  const unseenComments = useUnseenCommentCount(doc?.id ?? null, comments.data);
  // Refreshing also catches stars changed elsewhere, e.g. on the web.
  const { reload: reloadStars } = useStars();
  const { reload: reloadComments } = comments;
  const reload = useCallback(async () => {
    await Promise.all([reloadContent(), reloadStars(), reloadComments()]);
  }, [reloadContent, reloadStars, reloadComments]);

  const listRef = useRef<DocumentListHandle>(null);
  const scale = useTextScale();
  const headings = useMemo(() => documentHeadings(doc?.data.content ?? []), [doc]);
  const { openLink, openDocument } = useReaderLinks();

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
              {doc ? (
                <CommentsButton
                  count={unseenComments}
                  filled={hasOpenComments}
                  onPress={() => router.push({ pathname: "/comments/[id]", params: { id: doc.id } })}
                />
              ) : null}
              <StarButton
                target={doc ? { documentId: doc.id } : null}
                document={doc ? toSummary(doc) : undefined}
              />
              <DocumentMenu webUrl={doc && session ? `${session.server}${doc.url}` : null} />
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
              <Text
                style={[styles.title, { color: colors.text, fontSize: 28 * scale }]}
                accessibilityRole="header"
              >
                {title || "Untitled"}
              </Text>
            </View>
            {updated ? (
              <Text style={[styles.meta, { color: colors.muted, fontSize: 13 * scale }]}>{updated}</Text>
            ) : null}
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
    fontWeight: "700",
  },
  meta: {
    marginBottom: 12,
  },
  loading: {
    marginTop: 32,
  },
});
