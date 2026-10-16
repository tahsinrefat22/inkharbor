import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text } from "react-native";

import { BottomSheet } from "@/components/bottom-sheet";
import type { DocumentHeading } from "@/components/reader/document-body";
import { useColors } from "@/constants/colors";

/** Indent per heading level below the document's top level. */
const INDENT = 16;

/**
 * The header button for a document's table of contents. It opens a sheet
 * from the bottom listing the headings; tapping one closes the sheet and
 * calls `onSelect`. Renders nothing for a document without headings.
 */
export function ContentsButton({
  headings,
  onSelect,
}: {
  headings: DocumentHeading[];
  onSelect: (heading: DocumentHeading) => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  if (!headings.length) {
    return null;
  }
  // Levels are indented relative to the biggest heading used, so a document
  // that starts at H2 isn't indented from the start.
  const topLevel = Math.min(...headings.map((heading) => heading.level));

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Contents"
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.5 }]}
      >
        <Ionicons name="list" size={24} color={colors.text} />
      </Pressable>
      {open ? (
        <BottomSheet title="Contents" onClosed={() => setOpen(false)}>
          {(close) => (
            <FlatList
              data={headings}
              keyExtractor={(heading) => String(heading.block)}
              renderItem={({ item }) => {
                const depth = item.level - topLevel;
                return (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => close(() => onSelect(item))}
                    style={({ pressed }) => [
                      styles.item,
                      { paddingLeft: 20 + depth * INDENT },
                      pressed && { backgroundColor: `${colors.border}66` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.itemText,
                        { color: depth === 0 ? colors.text : colors.muted },
                        depth === 0 && styles.itemTop,
                      ]}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                  </Pressable>
                );
              }}
            />
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
  item: {
    paddingRight: 20,
    paddingVertical: 12,
  },
  itemText: {
    fontSize: 15,
  },
  itemTop: {
    fontWeight: "600",
  },
});
