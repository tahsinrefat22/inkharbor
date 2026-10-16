import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/constants/colors";

/** The header button for a document's comments, with the number of open ones. */
export function CommentsButton({ count, onPress }: { count: number; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Comments, ${count} open` : "Comments"}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.5 }]}
    >
      <Ionicons name="chatbubble-outline" size={22} color={colors.text} />
      {count ? (
        <View style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
          <Text style={[styles.badgeText, { color: colors.onPrimary }]}>{count > 99 ? "99+" : count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Room on the right for the badge: drawn outside the button, it gets cut off.
  button: {
    padding: 4,
    paddingRight: 10,
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 12,
  },
});
