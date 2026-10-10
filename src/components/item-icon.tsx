import { StyleSheet, Text, View } from "react-native";

import { emojiIcon } from "@/lib/outline/collections";

interface ItemIconProps {
  icon: string | null | undefined;
  color: string | null | undefined;
  /** Used for the fallback letter when the icon isn't an emoji. */
  label: string;
}

/** A collection or document icon: its emoji, or a coloured square with a letter. */
export function ItemIcon({ icon, color, label }: ItemIconProps) {
  const emoji = emojiIcon(icon);
  if (emoji) {
    return <Text style={styles.emoji}>{emoji}</Text>;
  }
  return (
    <View style={[styles.square, { backgroundColor: color || "#6b7280" }]}>
      <Text style={styles.letter}>{label.trim().charAt(0).toUpperCase() || "?"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emoji: {
    fontSize: 20,
    width: 28,
    textAlign: "center",
  },
  square: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  letter: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
