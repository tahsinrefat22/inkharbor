import { Stack } from "expo-router";

import { AuthProvider } from "@/lib/auth";

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ title: "Inkharbor" }} />
    </AuthProvider>
  );
}
