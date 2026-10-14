import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Animated, Easing, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { DocumentHeading } from "@/components/reader/document-body";
import { useColors } from "@/constants/colors";

/** Indent per heading level below the document's top level. */
const INDENT = 16;

/**
 * The header button for a document's table of contents. It opens a sheet
 * from the bottom listing the headings; tapping one closes the sheet and
 * calls `onSelect`. Renders nothing for a document without headings.
 */
export function ContentsButton({
  headings,
  onSelect,
}: {
  headings: DocumentHeading[];
  onSelect: (heading: DocumentHeading) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  // 0 = hidden below the screen, 1 = shown.
  const [progress] = useState(() => new Animated.Value(0));

  if (!headings.length) {
    return null;
  }
  // Levels are indented relative to the biggest heading used, so a document
  // that starts at H2 isn't indented from the start.
  const topLevel = Math.min(...headings.map((heading) => heading.level));
  const sheetHeight = windowHeight * 0.7;

  function animateIn() {
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  /** Plays the closing animation, then removes the sheet and runs `then`. */
  function close(then?: () => void) {
    Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setOpen(false);
      then?.();
    });
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Contents"
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.5 }]}
      >
        <Ionicons name="list" size={24} color={colors.text} />
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
              styles.sheet,
              {
                maxHeight: sheetHeight,
                paddingBottom: insets.bottom + 8,
                backgroundColor: colors.surface,
                borderColor: colors.border,
                transform: [
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] }) },
                ],
              },
            ]}
          >
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
              Contents
            </Text>
            <FlatList
              data={headings}
              keyExtractor={(heading) => String(heading.block)}
              renderItem={({ item }) => {
                const depth = item.level - topLevel;
                return (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => close(() => onSelect(item))}
                    style={({ pressed }) => [
                      styles.item,
                      { paddingLeft: 20 + depth * INDENT },
                      pressed && { backgroundColor: `${colors.border}66` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.itemText,
                        { color: depth === 0 ? colors.text : colors.muted },
                        depth === 0 && styles.itemTop,
                      ]}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                  </Pressable>
                );
              }}
            />
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
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
  item: {
    paddingRight: 20,
    paddingVertical: 12,
  },
  itemText: {
    fontSize: 15,
  },
  itemTop: {
    fontWeight: "600",
  },
});
