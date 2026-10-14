import { router } from "expo-router";
import { useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { Avatar } from "@/components/avatar";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { saveTextScale, TEXT_SIZES, useTextScale } from "@/lib/text-size";
import { loadThemePreference, saveThemePreference, type ThemePreference } from "@/lib/theme";

/** The header avatar. Tapping it opens a card with the account and actions. */
export function AccountMenu() {
  const colors = useColors();
  const { session, lock } = useAuth();
  const [open, setOpen] = useState(false);
  // 0 = hidden, 1 = shown. The card grows out of the avatar's corner while
  // the screen behind it dims, like a standard pop-up menu.
  const [progress] = useState(() => new Animated.Value(0));
  const avatarRef = useRef<View>(null);
  // Where the card goes: just below the avatar, right edges aligned.
  const [anchor, setAnchor] = useState({ top: 0, right: 12 });
  const { width: windowWidth } = useWindowDimensions();
  if (!session) {
    return null;
  }
  const { account, server, accessToken } = session;
  const name = account.userName || "Account";

  function openMenu() {
    // The modal covers the whole window (see statusBarTranslucent below), so
    // window coordinates line up with it.
    avatarRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ top: y + height + 8, right: Math.max(windowWidth - (x + width), 12) });
      setOpen(true);
    });
  }

  function animateIn() {
    Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  /** Plays the closing animation, then removes the menu and runs `then`. */
  function close(then?: () => void) {
    Animated.timing(progress, {
      toValue: 0,
      duration: 130,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setOpen(false);
      then?.();
    });
  }

  function handleSettings() {
    close(() => router.push("/settings"));
  }

  function handleSignOut() {
    close(() => lock());
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Account"
        ref={avatarRef}
        onPress={openMenu}
        hitSlop={8}
      >
        <Avatar name={name} avatarUrl={account.avatarUrl} color={account.color} size={32} server={server} accessToken={accessToken} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="none"
        onShow={animateIn}
        onRequestClose={() => close()}
      >
        <View style={styles.backdrop}>
          <Animated.View
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: progress }]}
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel="Close" />
          <Animated.View
            style={[
              styles.card,
              {
                top: anchor.top,
                right: anchor.right,
                maxWidth: windowWidth - 24,
                backgroundColor: colors.surface,
                borderColor: colors.border,
                opacity: progress,
                transform: [
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                ],
              },
            ]}
          >
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
            <MenuItem label="Settings" color={colors.text} onPress={handleSettings} />
            <MenuItem label="Sign out" color={colors.danger} onPress={handleSignOut} />
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const themeOptions: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function ThemePicker() {
  const colors = useColors();
  const [theme, setTheme] = useState(loadThemePreference);

  function choose(value: ThemePreference) {
    setTheme(value);
    saveThemePreference(value);
  }

  return (
    <View style={styles.theme}>
      <Text style={[styles.label, { color: colors.muted }]}>Theme</Text>
      <View style={[styles.segments, { borderColor: colors.border }]} accessibilityRole="radiogroup">
        {themeOptions.map((option) => {
          const selected = option.value === theme;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => choose(option.value)}
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
function TextSizePicker() {
  const colors = useColors();
  const scale = useTextScale();
  return (
    <View style={styles.theme}>
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
  },
  card: {
    position: "absolute",
    width: 300,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    transformOrigin: "top right",
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
  theme: {
    gap: 6,
    paddingTop: 4,
    paddingBottom: 6,
  },
  segments: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 2,
  },
  sizeSegment: {
    justifyContent: "flex-end",
    height: 34,
    paddingVertical: 6,
  },
  sizeLetter: {
    fontWeight: "600",
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
  item: {
    paddingVertical: 12,
  },
  itemText: {
    fontSize: 16,
    fontWeight: "500",
  },
});
