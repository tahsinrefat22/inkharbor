import { useState, type ReactNode } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/constants/colors";

/** Closes the sheet with its animation, then runs `then` (e.g. a jump). */
export type CloseSheet = (then?: () => void) => void;

/**
 * A sheet that slides up from the bottom over a dimmed screen. It shows
 * while mounted: render it when it should open, and stop rendering it in
 * `onClosed`, which runs once the closing animation has finished. Tapping
 * outside or Android back closes it.
 */
export function BottomSheet({
  title,
  onClosed,
  children,
}: {
  title: string;
  onClosed: () => void;
  children: (close: CloseSheet) => ReactNode;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // 0 = hidden below the screen, 1 = shown.
  const [progress] = useState(() => new Animated.Value(0));
  const sheetHeight = windowHeight * 0.7;

  function animateIn() {
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  const close: CloseSheet = (then) => {
    Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      onClosed();
      then?.();
    });
  };

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="none"
      onShow={animateIn}
      onRequestClose={() => close()}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: progress }]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: sheetHeight,
              paddingBottom: insets.bottom + 8,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] }) }],
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {title}
          </Text>
          {children(close)}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
});
