import { StyleSheet, Text } from "react-native";

import { useColors } from "@/constants/colors";
import { savedAgo } from "@/hooks/use-cached-loader";

/** Shown while a screen displays its saved copy because the server is unreachable. */
export function OfflineNote({ savedAt }: { savedAt: number | null }) {
  const colors = useColors();
  if (savedAt === null) {
    return null;
  }
  return (
    <Text style={[styles.note, { color: colors.muted }]} accessibilityLiveRegion="polite">
      {`Offline · ${savedAgo(savedAt)}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 6,
  },
});
