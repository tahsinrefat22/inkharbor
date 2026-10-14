import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/constants/colors";
import { saveTextScale, TEXT_SIZES, useTextScale } from "@/lib/text-size";
import { saveThemePreference, useThemePreference, type ThemePreference } from "@/lib/theme";

// The theme and text size pickers, shown in both the account menu and a
// document's ⋮ menu. Both read the same shared settings, so a change in one
// menu shows in the other at once.

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemePicker() {
  const colors = useColors();
  const theme = useThemePreference();
  return (
    <View style={styles.picker}>
      <Text style={[styles.label, { color: colors.muted }]}>Theme</Text>
      <View style={[styles.segments, { borderColor: colors.border }]} accessibilityRole="radiogroup">
        {themeOptions.map((option) => {
          const selected = option.value === theme;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => saveThemePreference(option.value)}
              style={[styles.segment, selected && { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.segmentText, { color: selected ? colors.onPrimary : colors.text }]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Reader text size: five steps, each shown as an "A" of growing size. */
export function TextSizePicker() {
  const colors = useColors();
  const scale = useTextScale();
  return (
    <View style={styles.picker}>
      <Text style={[styles.label, { color: colors.muted }]}>Text size</Text>
      <View style={[styles.segments, { borderColor: colors.border }]} accessibilityRole="radiogroup">
        {TEXT_SIZES.map((size) => {
          const selected = size.scale === scale;
          return (
            <Pressable
              key={size.label}
              accessibilityRole="radio"
              accessibilityLabel={size.label}
              accessibilityState={{ checked: selected }}
              onPress={() => saveTextScale(size.scale)}
              style={[styles.segment, styles.sizeSegment, selected && { backgroundColor: colors.primary }]}
            >
              <Text
                style={[
                  styles.sizeLetter,
                  { color: selected ? colors.onPrimary : colors.text, fontSize: 14 * size.scale },
                ]}
              >
                A
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: {
    gap: 6,
    paddingTop: 4,
    paddingBottom: 6,
  },
  label: {
    fontSize: 11,
    textTransform: "uppercase",
    marginTop: 4,
  },
  segments: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 2,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: 6,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "500",
  },
  sizeSegment: {
    justifyContent: "flex-end",
    height: 34,
    paddingVertical: 6,
  },
  sizeLetter: {
    fontWeight: "600",
  },
});
