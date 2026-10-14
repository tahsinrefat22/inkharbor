import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ItemIcon } from "@/components/item-icon";
import { OfflineMark } from "@/components/offline-mark";
import { useColors } from "@/constants/colors";
import { snippetParts, type SearchResult } from "@/lib/outline/documents";

/** One search result: title, collection and a snippet with the matches in bold. */
export function SearchResultRow({
  result,
  collectionName,
  offline = false,
}: {
  result: SearchResult;
  collectionName?: string;
  /** Whether the document is saved on the phone. */
  offline?: boolean;
}) {
  const colors = useColors();
  const { document } = result;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: "/document/[id]", params: { id: document.id, title: document.title } })
      }
      style={({ pressed }) => [styles.result, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.titleRow}>
        {document.icon ? <ItemIcon icon={document.icon} color={document.color} label={document.title} /> : null}
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {document.title || "Untitled"}
        </Text>
        {offline ? <OfflineMark /> : null}
      </View>
      {collectionName ? (
        <Text style={[styles.collection, { color: colors.muted }]} numberOfLines={1}>
          {collectionName}
        </Text>
      ) : null}
      <Text style={[styles.snippet, { color: colors.muted }]} numberOfLines={3}>
        {snippetParts(result.context).map((part, i) => (
          <Text key={i} style={part.match ? [styles.match, { color: colors.text }] : undefined}>
            {part.text}
          </Text>
        ))}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  result: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  collection: {
    fontSize: 12,
  },
  snippet: {
    fontSize: 14,
    lineHeight: 20,
  },
  match: {
    fontWeight: "700",
  },
});
