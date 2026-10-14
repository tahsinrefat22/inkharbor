import Ionicons from "@expo/vector-icons/Ionicons";
import { Alert, Pressable, StyleSheet } from "react-native";

import { useColors } from "@/constants/colors";
import { isNetworkError } from "@/lib/outline/api";
import type { DocumentSummary } from "@/lib/outline/documents";
import type { StarTarget } from "@/lib/outline/stars";
import { useStars } from "@/lib/stars";

interface StarButtonProps {
  /** Null while the document or collection isn't known yet. */
  target: StarTarget | null;
  /** A document's details, for the home screen's Starred list. */
  document?: DocumentSummary;
}

/** The header's star toggle for a document or collection. */
export function StarButton({ target, document }: StarButtonProps) {
  const colors = useColors();
  const stars = useStars();
  const starred = target ? stars.isStarred(target) : false;
  // Unstarring needs the star's id, so wait for the list.
  const disabled = !target || !stars.starred || stars.isPending(target);

  async function handlePress() {
    if (!target) {
      return;
    }
    try {
      await stars.toggle(target, document);
    } catch (err) {
      Alert.alert(
        starred ? "Couldn't remove the star" : "Couldn't star this",
        isNetworkError(err)
          ? "Can't reach the server. Try again when you're online."
          : err instanceof Error
            ? err.message
            : "Something went wrong. Try again.",
      );
    }
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={starred ? "Remove star" : "Star"}
      accessibilityState={{ selected: starred, disabled }}
      disabled={disabled}
      onPress={handlePress}
      hitSlop={8}
      style={({ pressed }) => [styles.button, (pressed || disabled) && { opacity: 0.5 }]}
    >
      <Ionicons
        name={starred ? "star" : "star-outline"}
        size={22}
        color={starred ? colors.star : colors.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
});
