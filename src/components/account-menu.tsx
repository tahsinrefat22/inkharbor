import { router } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";

/** The header avatar. Tapping it opens a card with the account and actions. */
export function AccountMenu() {
  const colors = useColors();
  const { session, lock } = useAuth();
  const [open, setOpen] = useState(false);
  if (!session) {
    return null;
  }
  const { account, server, accessToken } = session;
  const name = account.userName || "Account";

  function handleSettings() {
    setOpen(false);
    router.push("/settings");
  }

  async function handleSignOut() {
    setOpen(false);
    await lock();
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account"
        onPress={() => setOpen(true)}
        hitSlop={8}
      >
        <Avatar name={name} avatarUrl={account.avatarUrl} color={account.color} size={32} server={server} accessToken={accessToken} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.identity}>
              <Avatar name={name} avatarUrl={account.avatarUrl} color={account.color} size={56} server={server} accessToken={accessToken} />
              <View style={styles.identityText}>
                <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{name}</Text>
                {account.userEmail ? (
                  <Text style={{ color: colors.muted }} numberOfLines={1}>{account.userEmail}</Text>
                ) : null}
                {account.role ? (
                  <Text style={[styles.role, { color: colors.muted }]}>{account.role}</Text>
                ) : null}
              </View>
            </View>
            <View style={[styles.details, { borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.muted }]}>Workspace</Text>
              <Text style={{ color: colors.text }} numberOfLines={1}>{account.teamName || "Outline"}</Text>
              <Text style={[styles.label, { color: colors.muted }]}>Server</Text>
              <Text style={{ color: colors.text }} numberOfLines={1}>{server.replace(/^https?:\/\//, "")}</Text>
            </View>
            <MenuItem label="Settings" color={colors.text} onPress={handleSettings} />
            <MenuItem label="Sign out" color={colors.danger} onPress={handleSignOut} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function MenuItem({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.itemText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "flex-end",
    paddingTop: 56,
    paddingHorizontal: 12,
  },
  card: {
    width: 300,
    maxWidth: "100%",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 4,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 17,
    fontWeight: "600",
  },
  role: {
    fontSize: 12,
    textTransform: "capitalize",
  },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    marginBottom: 4,
    gap: 2,
  },
  label: {
    fontSize: 11,
    textTransform: "uppercase",
    marginTop: 4,
  },
  item: {
    paddingVertical: 12,
  },
  itemText: {
    fontSize: 16,
    fontWeight: "500",
  },
});
