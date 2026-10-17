import { router, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { ServerForm } from "@/components/server-form";
import { useColors } from "@/constants/colors";

/** Adds another server from the account menu; it opens once access is confirmed. */
export default function AddServer() {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Add a server" }} />
      <Text style={{ color: colors.muted }}>
        {"Enter the address of another Outline server. You'll confirm access once in the browser, and you can switch between servers from the account menu."}
      </Text>
      {/* A new account replaces the screens of the old one; signing in to
          the open account again only needs this screen closed. */}
      <ServerForm onConnected={() => router.canGoBack() && router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 12,
  },
});
