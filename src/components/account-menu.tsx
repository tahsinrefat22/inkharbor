import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { MenuItem, PopupMenu } from "@/components/popup-menu";
import { TextSizePicker, ThemePicker } from "@/components/reading-pickers";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";

/** The header avatar. Tapping it opens a card with the account and actions. */
export function AccountMenu() {
  const colors = useColors();
  const { session, lock } = useAuth();
  if (!session) {
    return null;
  }
  const { account, server, accessToken } = session;
  const name = account.userName || "Account";

  return (
    <PopupMenu
      accessibilityLabel="Account"
      trigger={
        <Avatar
          name={name}
          avatarUrl={account.avatarUrl}
          color={account.color}
          size={32}
          server={server}
          accessToken={accessToken}
        />
      }
    >
      {(close) => (
        <>
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
          <ThemePicker />
          <TextSizePicker />
          <MenuItem label="Settings" onPress={() => close(() => router.push("/settings"))} />
          <MenuItem label="Sign out" color={colors.danger} onPress={() => close(() => lock())} />
        </>
      )}
    </PopupMenu>
  );
}

const styles = StyleSheet.create({
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
});
