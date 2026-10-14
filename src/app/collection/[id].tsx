import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ItemIcon } from "@/components/item-icon";
import { refreshColors, useColors } from "@/constants/colors";
import { OfflineMark } from "@/components/offline-mark";
import { OfflineNote } from "@/components/offline-note";
import { StarButton } from "@/components/star-button";
import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { useSavedDocuments } from "@/hooks/use-saved-documents";
import { readEntry, writeEntry } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { useStars } from "@/lib/stars";
import { getDocumentTree, type DocumentNode } from "@/lib/outline/collections";

interface Row {
  node: DocumentNode;
  depth: number;
}

/** The tree as a flat list of the rows that are currently visible. */
function visibleRows(nodes: DocumentNode[], expanded: Set<string>, depth = 0): Row[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(expanded.has(node.id) ? visibleRows(node.children, expanded, depth + 1) : []),
  ]);
}

export default function CollectionScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const colors = useColors();
  const { request } = useAuth();
  const load = useCallback(() => getDocumentTree(request, id), [request, id]);
  const cache = useMemo<CacheAdapter<DocumentNode[]>>(
    () => ({
      read: () => readEntry<DocumentNode[]>(`tree:${id}`),
      write: (value) => writeEntry(`tree:${id}`, value),
    }),
    [id],
  );
  const { data, error, loading, refreshing, offlineSince, reload: reloadContent } = useCachedLoader(load, cache);
  // Refreshing also catches stars changed elsewhere, e.g. on the web.
  const { reload: reloadStars } = useStars();
  const reload = useCallback(async () => {
    await Promise.all([reloadContent(), reloadStars()]);
  }, [reloadContent, reloadStars]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const saved = useSavedDocuments();

  const rows = useMemo(() => visibleRows(data ?? [], expanded), [data, expanded]);

  function toggle(nodeId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: name ?? "Collection",
          headerRight: () => <StarButton target={{ collectionId: id }} />,
        }}
      />
      {loading ? (
        <ActivityIndicator style={styles.loading} color={colors.text} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.node.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} {...refreshColors(colors)} />}
          ListHeaderComponent={
            <>
              <OfflineNote savedAt={offlineSince} />
              {error ? <Text style={[styles.message, { color: colors.danger }]}>{error}</Text> : null}
            </>
          }
          ListEmptyComponent={
            error ? null : (
              <Text style={[styles.message, { color: colors.muted }]}>No documents yet.</Text>
            )
          }
          renderItem={({ item: { node, depth } }) => {
            const hasChildren = node.children.length > 0;
            const isOpen = expanded.has(node.id);
            return (
              <View style={[styles.row, { paddingLeft: 8 + depth * 20, borderColor: colors.border }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isOpen ? `Collapse ${node.title}` : `Expand ${node.title}`}
                  disabled={!hasChildren}
                  onPress={() => toggle(node.id)}
                  hitSlop={8}
                  style={styles.chevron}
                >
                  <Text style={{ color: colors.muted }}>{hasChildren ? (isOpen ? "▾" : "▸") : ""}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({ pathname: "/document/[id]", params: { id: node.id, title: node.title } })
                  }
                  style={({ pressed }) => [styles.title, pressed && { opacity: 0.6 }]}
                >
                  {node.icon ? <ItemIcon icon={node.icon} color={node.color} label={node.title} /> : null}
                  <Text style={[styles.titleText, { color: colors.text }]} numberOfLines={2}>
                    {node.title || "Untitled"}
                  </Text>
                  {saved.has(node.id) ? <OfflineMark /> : null}
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    marginTop: 48,
  },
  list: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chevron: {
    width: 28,
    paddingVertical: 14,
    alignItems: "center",
  },
  title: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
  },
  titleText: {
    flex: 1,
    fontSize: 16,
  },
  message: {
    textAlign: "center",
    padding: 16,
  },
});
