import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from "react-native";

import { useColors } from "@/constants/colors";

/** The tab bar's side margins, matching the search box above it. */
const BAR_MARGIN = 16;

interface TabPagerProps {
  titles: string[];
  /** The page shown first. */
  initialIndex: number;
  /** Called when a tap or a swipe has settled on a page. */
  onChange: (index: number) => void;
  renderPage: (index: number) => ReactNode;
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduce)
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => subscription.remove();
  }, []);
  return reduce;
}

/**
 * Tabs over pages that slide sideways, by tapping a tab or swiping. The tab
 * titles and underline follow the finger, driven by the scroll position on
 * the native thread. With reduce motion on, a tapped tab shows at once.
 */
export function TabPager({ titles, initialIndex, onChange, renderPage }: TabPagerProps) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const pagerRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(initialIndex);
  const [scrollX] = useState(() => new Animated.Value(initialIndex * width));
  const [height, setHeight] = useState(0);

  const tabWidth = (width - BAR_MARGIN * 2) / titles.length;
  const lastPage = (titles.length - 1) * width;

  function settle(next: number) {
    if (next !== index) {
      setIndex(next);
      onChange(next);
    }
  }

  function goTo(next: number) {
    pagerRef.current?.scrollTo({ x: next * width, animated: !reduceMotion });
    settle(next);
  }

  function handleMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    settle(Math.round(event.nativeEvent.contentOffset.x / width));
  }

  function handleLayout(event: LayoutChangeEvent) {
    setHeight(event.nativeEvent.layout.height);
    // Start on the chosen page (contentOffset isn't applied on every platform).
    pagerRef.current?.scrollTo({ x: index * width, animated: false });
  }

  return (
    <View style={styles.flex}>
      <View style={[styles.bar, { borderColor: colors.border }]} accessibilityRole="tablist">
        {titles.map((title, i) => {
          const at = i * width;
          // The selected colour fades in over the muted title as its page arrives.
          const selectedOpacity = scrollX.interpolate({
            inputRange: [at - width, at, at + width],
            outputRange: [0, 1, 0],
            extrapolate: "clamp",
          });
          return (
            <Pressable
              key={title}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === index }}
              onPress={() => goTo(i)}
              style={({ pressed }) => [styles.tab, pressed && { opacity: 0.6 }]}
            >
              <View>
                <Text style={[styles.title, { color: colors.muted }]}>{title}</Text>
                <Animated.Text
                  style={[styles.title, styles.overlay, { color: colors.primary, opacity: selectedOpacity }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  {title}
                </Animated.Text>
              </View>
            </Pressable>
          );
        })}
        <Animated.View
          style={[
            styles.underline,
            {
              width: tabWidth,
              backgroundColor: colors.primary,
              transform: [
                {
                  translateX: scrollX.interpolate({
                    inputRange: [0, Math.max(lastPage, 1)],
                    outputRange: [0, (titles.length - 1) * tabWidth],
                    extrapolate: "clamp",
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentOffset={{ x: index * width, y: 0 }}
        onLayout={handleLayout}
        onMomentumScrollEnd={handleMomentumEnd}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        style={styles.flex}
      >
        {titles.map((title, i) => (
          <View key={title} style={[{ width }, height ? { height } : styles.flex]}>
            {renderPage(i)}
          </View>
        ))}
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  bar: {
    flexDirection: "row",
    marginTop: 8,
    marginHorizontal: BAR_MARGIN,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
  },
  overlay: {
    ...StyleSheet.absoluteFill,
  },
  underline: {
    position: "absolute",
    left: 0,
    bottom: 0,
    height: 2,
    borderRadius: 1,
  },
});
