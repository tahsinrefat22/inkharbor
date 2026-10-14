import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ItemIcon } from "@/components/item-icon";
import { OfflineMark } from "@/components/offline-mark";
import { SearchResultRow } from "@/components/search-result-row";
import { TabPager } from "@/components/tab-pager";
import { refreshColors, useColors } from "@/constants/colors";
import { useDocumentSearch } from "@/hooks/use-document-search";
import { OfflineNote } from "@/components/offline-note";
import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { useRecentDocuments } from "@/hooks/use-recent-documents";
import { useSavedDocuments } from "@/hooks/use-saved-documents";
import { readEntry, writeEntry } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import { emojiIcon, listCollections, type Collection } from "@/lib/outline/collections";
import type { DocumentSummary } from "@/lib/outline/documents";
import { useStars } from "@/lib/stars";

const collectionsCache: CacheAdapter<Collection[]> = {
  read: () => readEntry<Collection[]>("collections"),
  write: (value) => writeEntry("collections", value),
};

type Tab = "collections" | "recent" | "starred";

const TABS: { key: Tab; title: string }[] = [
  { key: "collections", title: "Collections" },
  { key: "recent", title: "Recent" },
  { key: "starred", title: "Starred" },
];
/** The last tab the user picked; a device preference. */
const TAB_KEY = "home-tab";

type Item =
  | { kind: "document"; key: string; document: DocumentSummary }
  | { kind: "collection"; key: string; collection: Collection };

function loadTab(): Tab {
  try {
    const value = Storage.getItemSync(TAB_KEY);
    return TABS.some((tab) => tab.key === value) ? (value as Tab) : "collections";
  } catch {
    return "collections";
  }
}

const EMPTY: Record<Tab, string> = {
  collections: "You don't have access to any collections yet.",
  recent: "Documents you open, here or in Outline on the web, show up here.",
  starred: "Star a document or collection with the star at the top of its page to keep it here, and offline.",
};

function saveTab(tab: Tab): void {
  try {
    Storage.setItemSync(TAB_KEY, tab);
  } catch {
    // Kept for this session even if it couldn't be saved.
  }
}

/**
 * The signed-in home screen: a search box above three tabs, the user's
 * collections, recently viewed documents and stars. While something is
 * typed, search results replace the tabs in place; clearing the box brings
 * them back.
 */
export function HomeList() {
  const colors = useColors();
  const { request } = useAuth();
  const load = useCallback(() => listCollections(request), [request]);
  const collections = useCachedLoader(load, collectionsCache);
  const stars = useStars();
  const recent = useRecentDocuments();
  const saved = useSavedDocuments();
  const [query, setQuery] = useState("");
  const search = useDocumentSearch(query);
  const searching = query.trim() !== "";
  // The pager starts here again when a search is cleared.
  const [tab, setTab] = useState(loadTab);
  const [refreshing, setRefreshing] = useState(false);

  // Android back while searching goes back to the lists instead of leaving
  // the app. Only while this screen is in front, so back from an opened
  // result still returns to the results.
  useFocusEffect(
    useCallback(() => {
      if (!query) {
        return;
      }
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        Keyboard.dismiss();
        setQuery("");
        return true;
      });
      return () => subscription.remove();
    }, [query]),
  );

  const collectionNames = useMemo(
    () => Object.fromEntries((collections.data ?? []).map((collection) => [collection.id, collection.name])),
    [collections.data],
  );

  const lists = useMemo((): Record<Tab, Item[]> => {
    const byId = new Map((collections.data ?? []).map((collection) => [collection.id, collection]));
    const starredDocuments = new Map((stars.starred?.documents ?? []).map((document) => [document.id, document]));
    return {
      collections: (collections.data ?? []).map((collection) => ({ kind: "collection", key: collection.id, collection })),
      recent: recent.documents.map((document) => ({ kind: "document", key: document.id, document })),
      // In the user's sidebar order. Stars on things the user can't read any
      // more come without details and are left out.
      starred: (stars.starred?.stars ?? []).flatMap((star): Item[] => {
        const document = star.documentId ? starredDocuments.get(star.documentId) : undefined;
        if (document) {
          return [{ kind: "document", key: star.id, document }];
        }
        const collection = star.collectionId ? byId.get(star.collectionId) : undefined;
        return collection ? [{ kind: "collection", key: star.id, collection }] : [];
      }),
    };
  }, [collections.data, stars.starred, recent.documents]);

  const { reload: reloadCollections } = collections;
  const { reload: reloadStars } = stars;
  const { reload: reloadRecent } = recent;
  const reload = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reloadCollections(), reloadStars(), reloadRecent()]);
    setRefreshing(false);
  }, [reloadCollections, reloadStars, reloadRecent]);

  const loading: Record<Tab, boolean> = {
    collections: collections.loading,
    recent: recent.loading,
    starred: stars.loading,
  };

  function renderPage(index: number) {
    const page = TABS[index].key;
    if (loading[page]) {
      return <ActivityIndicator style={styles.spinner} color={colors.text} />;
    }
    return (
      <FlatList
        data={lists[page]}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} {...refreshColors(colors)} />}
        ListHeaderComponent={
          <>
            <OfflineNote savedAt={collections.offlineSince} />
            {collections.error ? (
              <Text style={[styles.message, { color: colors.danger }]}>{collections.error}</Text>
            ) : null}
          </>
        }
        ListEmptyComponent={
          page === "collections" && collections.error ? null : (
            <Text style={[styles.message, { color: colors.muted }]}>{EMPTY[page]}</Text>
          )
        }
        renderItem={({ item }) => (
          <HomeRow
            item={item}
            offline={item.kind === "document" && saved.has(item.document.id)}
            collectionName={
              item.kind === "document" && item.document.collectionId
                ? collectionNames[item.document.collectionId]
                : undefined
            }
          />
        )}
      />
    );
  }

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={[styles.searchBox, { borderColor: colors.border }]}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search all documents"
          placeholderTextColor={colors.muted}
          selectionColor={colors.primary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search all documents"
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery("")}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <FlatList
          data={search.searchedFor ? search.results : []}
          keyExtractor={(result) => result.document.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          onEndReached={search.loadMore}
          onEndReachedThreshold={0.5}
          ListHeaderComponent={
            search.error ? (
              <Text style={[styles.message, { color: colors.danger }]}>{search.error}</Text>
            ) : null
          }
          ListEmptyComponent={
            search.loading || !search.searchedFor ? null : (
              <Text style={[styles.message, { color: colors.muted }]}>
                {`No documents match “${search.searchedFor}”.`}
              </Text>
            )
          }
          ListFooterComponent={
            search.loading ? <ActivityIndicator style={styles.spinner} color={colors.text} /> : null
          }
          renderItem={({ item }) => (
            <SearchResultRow
              result={item}
              offline={saved.has(item.document.id)}
              collectionName={
                item.document.collectionId ? collectionNames[item.document.collectionId] : undefined
              }
            />
          )}
        />
      ) : (
        <TabPager
          titles={TABS.map(({ title }) => title)}
          initialIndex={TABS.findIndex(({ key }) => key === tab)}
          onChange={(index) => {
            setTab(TABS[index].key);
            saveTab(TABS[index].key);
          }}
          renderPage={renderPage}
        />
      )}
    </View>
  );
}

/** A document or collection on the home screen. */
function HomeRow({ item, collectionName, offline }: { item: Item; collectionName?: string; offline: boolean }) {
  const colors = useColors();
  const { title, icon, color } =
    item.kind === "document"
      ? { title: item.document.title || "Untitled", icon: item.document.icon, color: item.document.color }
      : { title: item.collection.name, icon: item.collection.icon, color: item.collection.color };

  function open() {
    if (item.kind === "document") {
      router.push({ pathname: "/document/[id]", params: { id: item.document.id, title: item.document.title } });
    } else {
      router.push({ pathname: "/collection/[id]", params: { id: item.collection.id, name: item.collection.name } });
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [styles.row, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
    >
      {item.kind === "document" && !emojiIcon(icon) ? (
        <View style={styles.documentIcon}>
          <Ionicons name="document-text-outline" size={20} color={colors.muted} />
        </View>
      ) : (
        <ItemIcon icon={icon} color={color} label={title} />
      )}
      <View style={styles.rowText}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {collectionName ? (
          <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={1}>
            {collectionName}
          </Text>
        ) : null}
      </View>
      {offline ? <OfflineMark /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  spinner: {
    marginVertical: 24,
  },
  list: {
    padding: 16,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 10,
  },
  documentIcon: {
    width: 28,
    alignItems: "center",
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    fontWeight: "500",
  },
  subtitle: {
    fontSize: 12,
  },
  message: {
    textAlign: "center",
    padding: 16,
  },
});
