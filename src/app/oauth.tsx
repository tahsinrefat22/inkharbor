import { router, Stack } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

// Sign-in returns to inkharbor://oauth?code=…. expo-web-browser hands that URL
// to the sign-in flow, but Expo Router also receives it and opens this route.
// Go straight back to the screen that started the sign-in, which is still
// waiting for the result; without this route the user sees "Unmatched Route".
export default function OAuthReturn() {
  useEffect(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
