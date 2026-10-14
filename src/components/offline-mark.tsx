import Ionicons from "@expo/vector-icons/Ionicons";

import { useColors } from "@/constants/colors";

/** Shown on a document that's saved on the phone and opens without a connection. */
export function OfflineMark() {
  const colors = useColors();
  return (
    <Ionicons
      name="arrow-down-circle"
      size={16}
      color={colors.muted}
      accessibilityLabel="Available offline"
      accessible
    />
  );
}
