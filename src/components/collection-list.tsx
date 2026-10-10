import { router } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";

import { ItemIcon } from "@/components/item-icon";
import { useColors } from "@/constants/colors";
import { useLoader } from "@/hooks/use-loader";
import { useAuth } from "@/lib/auth";
import { listCollections } from "@/lib/outline/collections";

/** The signed-in home screen: every collection the user can read. */
export function CollectionList() {
  const colors = useColors();
  const { request } = useAuth();
  const load = useCallback(() => listCollections(request), [request]);
  const { data, error, loading, refreshing, reload } = useLoader(load);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={data ?? []}
      keyExtractor={(collection) => collection.id}
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
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
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
