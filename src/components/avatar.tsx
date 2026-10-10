import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

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
  if (avatarUrl) {
    // Photos uploaded to Outline are relative and need the bearer token;
    // photos from Google and similar are public URLs.
    const relative = avatarUrl.startsWith("/");
    const uri = relative && server ? `${server}${avatarUrl}` : avatarUrl;
    const headers: Record<string, string> | undefined =
      relative && accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
    return <Image source={{ uri, headers }} style={round} accessibilityLabel={name} />;
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
