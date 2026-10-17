import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ItemIcon } from "@/components/item-icon";
import { CommentsButton } from "@/components/reader/comments-button";
import { ContentsButton } from "@/components/reader/contents-button";
import { DocumentMenu } from "@/components/reader/document-menu";
import { DocumentList, documentHeadings, type DocumentListHandle } from "@/components/reader/document-body";
import { TitleEditor } from "@/components/reader/title-editor";
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
import { isNetworkError } from "@/lib/outline/api";
import { getDocument, toSummary, type OutlineDocument } from "@/lib/outline/documents";
import { EditConflictError, renameDocument, setChecked } from "@/lib/outline/edits";

export default function DocumentScreen() {
  const { id, title: initialTitle } = useLocalSearchParams<{ id: string; title?: string }>();
  const colors = useColors();
  const { requestWithPolicies, session } = useAuth();
  const load = useCallback(() => getDocument(requestWithPolicies, id), [requestWithPolicies, id]);
  const cache = useMemo<CacheAdapter<OutlineDocument>>(
    () => ({
      read: () => readDocument(id),
      write: (value) => writeDocument(value, { opened: true }),
    }),
    [id],
  );
  const {
    data: doc,
    error,
    loading,
    refreshing,
    offlineSince,
    reload: reloadContent,
    mutate,
  } = useCachedLoader(load, cache);
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

  // Checkboxes being saved, by their place in the document, with the state
  // they're changing to. Saves run one after another, each on the document
  // as the one before left it, so quick taps don't trip over each other.
  const [pendingChecks, setPendingChecks] = useState<ReadonlyMap<number, boolean>>(new Map());
  const latestDoc = useRef(doc);
  useEffect(() => {
    latestDoc.current = doc;
  }, [doc]);
  const saves = useRef<Promise<void>>(Promise.resolve());
  const toggleCheckbox = useCallback(
    (index: number, checked: boolean) => {
      setPendingChecks((current) => new Map(current).set(index, checked));
      saves.current = saves.current.then(async () => {
        try {
          const current = latestDoc.current;
          if (current) {
            const saved = await setChecked(requestWithPolicies, current, index, checked);
            latestDoc.current = saved;
            await mutate(saved);
          }
        } catch (err) {
          if (err instanceof EditConflictError) {
            await reloadContent();
          }
          Alert.alert(
            "Checkbox not changed",
            isNetworkError(err)
              ? "Can't reach the server. Try again when you're online."
              : err instanceof Error
                ? err.message
                : "Try again.",
          );
        } finally {
          setPendingChecks((current) => {
            const rest = new Map(current);
            rest.delete(index);
            return rest;
          });
        }
      });
    },
    [mutate, requestWithPolicies, reloadContent],
  );
  const pendingCheckbox = useCallback((index: number) => pendingChecks.get(index), [pendingChecks]);

  const [renaming, setRenaming] = useState(false);
  const saveTitle = useCallback(
    async (newTitle: string) => {
      const current = latestDoc.current;
      if (!current) {
        return;
      }
      // Waits for checkbox saves, so they don't overwrite the new title.
      await saves.current;
      const saved = await renameDocument(requestWithPolicies, current.id, newTitle);
      latestDoc.current = saved;
      await mutate(saved);
      setRenaming(false);
      // Starred lists show the new title too.
      void reloadStars();
    },
    [mutate, requestWithPolicies, reloadStars],
  );

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
              <DocumentMenu
                webUrl={doc && session ? `${session.server}${doc.url}` : null}
                onRename={
                  doc?.canUpdate
                    ? () => {
                        listRef.current?.scrollToTop();
                        setRenaming(true);
                      }
                    : undefined
                }
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
        onToggleCheckbox={doc?.canUpdate ? toggleCheckbox : undefined}
        pendingCheckbox={pendingCheckbox}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} {...refreshColors(colors)} />}
        header={
          <View style={styles.header}>
            {renaming && doc ? (
              <TitleEditor
                title={doc.title}
                fontSize={28 * scale}
                onSave={saveTitle}
                onCancel={() => setRenaming(false)}
              />
            ) : (
              <View style={styles.titleRow}>
                {doc?.icon ? <ItemIcon icon={doc.icon} color={doc.color} label={title} /> : null}
                <Text
                  style={[styles.title, { color: colors.text, fontSize: 28 * scale }]}
                  accessibilityRole="header"
                >
                  {title || "Untitled"}
                </Text>
              </View>
            )}
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
