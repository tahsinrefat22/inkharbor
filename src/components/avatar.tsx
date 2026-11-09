import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { useServerSource } from "@/hooks/use-server-source";

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  color?: string;
  size: number;
  /** Needed for avatars stored on the Outline server itself. */
  server?: string;
  accessToken?: string;
}

/** The user's profile photo, or their initial on their Outline colour. */
export function Avatar({ name, avatarUrl, color, size, server, accessToken }: AvatarProps) {
  const round = { width: size, height: size, borderRadius: size / 2 };
  // Photos uploaded to Outline need the bearer token; photos from Google and
  // similar are public URLs and get no headers.
  const source = useServerSource(avatarUrl ?? "", server ?? "", accessToken ?? "");
  if (avatarUrl) {
    return <Image source={server ? source : { uri: avatarUrl }} style={round} accessibilityLabel={name} />;
  }
  return (
    <View style={[styles.fallback, round, { backgroundColor: color || "#6b7280" }]}>
      <Text style={[styles.initial, { fontSize: size * 0.45 }]}>
        {name.trim().charAt(0).toUpperCase() || "?"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  initial: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
