import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { canCreateIn, getDocumentTree, type DocumentNode } from "@/lib/outline/collections";

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
  const { request, requestWithPolicies } = useAuth();
  const load = useCallback(() => getDocumentTree(request, id), [request, id]);
  const cache = useMemo<CacheAdapter<DocumentNode[]>>(
    () => ({
      read: () => readEntry<DocumentNode[]>(`tree:${id}`),
      write: (value) => writeEntry(`tree:${id}`, value),
    }),
    [id],
  );
  const {
    data,
    error,
    loading,
    refreshing,
    offlineSince,
    reload: reloadContent,
    refreshQuietly,
  } = useCachedLoader(load, cache);
  // Coming back, e.g. from a document renamed in the app, checks for changes.
  const shownBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (shownBefore.current) {
        void refreshQuietly();
      }
      shownBefore.current = true;
    }, [refreshQuietly]),
  );
  // Refreshing also catches stars changed elsewhere, e.g. on the web.
  const { reload: reloadStars } = useStars();
  const reload = useCallback(async () => {
    await Promise.all([reloadContent(), reloadStars()]);
  }, [reloadContent, reloadStars]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Offline, or until the server says so, there's no way to add a document.
  const [canCreate, setCanCreate] = useState(false);
  useEffect(() => {
    let current = true;
    canCreateIn(requestWithPolicies, id)
      .then((allowed) => current && setCanCreate(allowed))
      .catch(() => {
        // Stays hidden; it's offered again next time.
      });
    return () => {
      current = false;
    };
  }, [requestWithPolicies, id]);
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
          headerRight: () => (
            <View style={styles.headerActions}>
              {canCreate ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="New document"
                  hitSlop={8}
                  onPress={() =>
                    router.push({ pathname: "/new-document", params: { collectionId: id, placeName: name ?? "" } })
                  }
                  style={({ pressed }) => [styles.headerButton, pressed && { opacity: 0.5 }]}
                >
                  <Ionicons name="add" size={26} color={colors.text} />
                </Pressable>
              ) : null}
              <StarButton target={{ collectionId: id }} />
            </View>
          ),
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerButton: {
    padding: 2,
  },
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
