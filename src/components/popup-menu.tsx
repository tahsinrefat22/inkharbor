import { useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { useColors } from "@/constants/colors";

/** Closes the menu with its animation, then runs `then` (e.g. navigation). */
export type CloseMenu = (then?: () => void) => void;

/**
 * A header button that opens a card just below it, right edges aligned.
 * The card grows out of the button's corner while the screen behind it
 * dims, like a standard pop-up menu. Tapping outside or Android back closes
 * it.
 */
export function PopupMenu({
  accessibilityLabel,
  trigger,
  children,
}: {
  accessibilityLabel: string;
  /** What the header shows, e.g. the avatar or a ⋮ icon. */
  trigger: ReactNode;
  children: (close: CloseMenu) => ReactNode;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  // 0 = hidden, 1 = shown.
  const [progress] = useState(() => new Animated.Value(0));
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState({ top: 0, right: 12 });
  const { width: windowWidth } = useWindowDimensions();

  function openMenu() {
    // The modal covers the whole window (see statusBarTranslucent below), so
    // window coordinates line up with it.
    triggerRef.current?.measureInWindow((x, y, width, height) => {
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

  const close: CloseMenu = (then) => {
    Animated.timing(progress, {
      toValue: 0,
      duration: 130,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setOpen(false);
      then?.();
    });
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        ref={triggerRef}
        onPress={openMenu}
        hitSlop={8}
      >
        {trigger}
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
            {children(close)}
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

/** A plain text action in a pop-up menu. */
export function MenuItem({ label, color, onPress }: { label: string; color?: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.itemText, { color: color ?? colors.text }]}>{label}</Text>
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
  item: {
    paddingVertical: 12,
  },
  itemText: {
    fontSize: 16,
    fontWeight: "500",
  },
});
