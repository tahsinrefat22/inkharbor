import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/constants/colors";

/** The document reader. Rendering the document itself is the next step. */
export default function DocumentScreen() {
  const { title } = useLocalSearchParams<{ id: string; title?: string }>();
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: title || "Document" }} />
      <Text style={[styles.title, { color: colors.text }]}>{title || "Untitled"}</Text>
      <Text style={{ color: colors.muted }}>The document reader comes in the next step.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
});
