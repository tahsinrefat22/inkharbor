import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";

import { useColors } from "@/constants/colors";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  busy?: boolean;
}

export function Button({ title, onPress, variant = "secondary", disabled, busy }: ButtonProps) {
  const colors = useColors();
  const filled = variant === "primary";
  const tint = variant === "danger" ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        filled
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { borderColor: variant === "danger" ? colors.danger : colors.border },
        (disabled || pressed) && styles.dimmed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={filled ? colors.onPrimary : tint} />
      ) : (
        <Text style={[styles.label, { color: filled ? colors.onPrimary : tint }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
  },
  label: {
    fontWeight: "600",
  },
  dimmed: {
    opacity: 0.5,
  },
});
