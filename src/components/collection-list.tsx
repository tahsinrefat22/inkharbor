import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { ItemIcon } from "@/components/item-icon";
import { SearchResultRow } from "@/components/search-result-row";
import { useColors } from "@/constants/colors";
import { useDocumentSearch } from "@/hooks/use-document-search";
import { useLoader } from "@/hooks/use-loader";
import { useAuth } from "@/lib/auth";
import { listCollections } from "@/lib/outline/collections";

/**
 * The signed-in home screen: a search box above the user's collections. While
 * something is typed, search results replace the collections in place;
 * clearing the box brings the collections back.
 */
export function CollectionList() {
  const colors = useColors();
  const { request } = useAuth();
  const load = useCallback(() => listCollections(request), [request]);
  const { data, error, loading, refreshing, reload } = useLoader(load);
  const [query, setQuery] = useState("");
  const search = useDocumentSearch(query);
  const searching = query.trim() !== "";

  const collectionNames = useMemo(
    () => Object.fromEntries((data ?? []).map((collection) => [collection.id, collection.name])),
    [data],
  );

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
              collectionName={
                item.document.collectionId ? collectionNames[item.document.collectionId] : undefined
              }
            />
          )}
        />
      ) : loading ? (
        <ActivityIndicator style={styles.spinner} color={colors.text} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(collection) => collection.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
          ListHeaderComponent={
            error ? <Text style={[styles.message, { color: colors.danger }]}>{error}</Text> : null
          }
          ListEmptyComponent={
            error ? null : (
              <Text style={[styles.message, { color: colors.muted }]}>
                {"You don't have access to any collections yet."}
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: "/collection/[id]", params: { id: item.id, name: item.name } })
              }
              style={({ pressed }) => [
                styles.row,
                { borderColor: colors.border },
                pressed && { opacity: 0.6 },
              ]}
            >
              <ItemIcon icon={item.icon} color={item.color} label={item.name} />
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {item.name}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
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
  name: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  message: {
    textAlign: "center",
    padding: 16,
  },
});
