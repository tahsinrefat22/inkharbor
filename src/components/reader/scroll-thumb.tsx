import { useEffect, useState } from "react";
import {
  Animated,
  PanResponder,
  StyleSheet,
  View,
  type FlatList,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import type { Colors } from "@/constants/colors";

const THUMB_HEIGHT = 44;
/** Space kept between the thumb and the top and bottom of the list. */
const INSET = 4;
const HIDE_AFTER_MS = 1500;

interface Sizes {
  viewport: number;
  content: number;
}

/** How far the thumb can move, and how far the list can scroll. */
function metrics({ viewport, content }: Sizes) {
  return {
    travel: Math.max(viewport - 2 * INSET - THUMB_HEIGHT, 0),
    scrollable: Math.max(content - viewport, 0),
  };
}

/**
 * A draggable scroll thumb, like Android's fast scroller: it fades in while
 * the list scrolls, and dragging it jumps anywhere in the list. Spread
 * `listProps` (including its ref) on an Animated.FlatList and render `thumb`
 * beside it.
 */
export function useScrollThumb<T>(colors: Colors) {
  const [scrollY] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => new Animated.Value(0));
  const [sizes, setSizes] = useState<Sizes>({ viewport: 0, content: 0 });
  // `shown` stops the invisible thumb from catching taps at the screen edge.
  const [shown, setShown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [handlers] = useState(() => {
    // What the gesture and scroll handlers need between events. Plain values,
    // not state: they change on every scroll frame.
    const live = {
      list: null as FlatList<T> | null,
      sizes: { viewport: 0, content: 0 },
      offset: 0,
      startTop: 0,
      shown: false,
      dragging: false,
      hideTimer: undefined as ReturnType<typeof setTimeout> | undefined,
    };

    function hide() {
      live.shown = false;
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(({ finished }) => {
        if (finished && !live.shown) {
          setShown(false);
        }
      });
    }

    function show() {
      const s = live;
      if (!s.shown) {
        s.shown = true;
        setShown(true);
        Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
      }
      clearTimeout(s.hideTimer);
      if (!s.dragging) {
        s.hideTimer = setTimeout(hide, HIDE_AFTER_MS);
      }
    }

    function setSize(next: Partial<Sizes>) {
      const sizes = { ...live.sizes, ...next };
      live.sizes = sizes;
      setSizes(sizes);
    }

    function endDrag() {
      live.dragging = false;
      setDragging(false);
      show();
    }

    const pan = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Keep the drag even when the finger wanders over the list.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const s = live;
        const { travel, scrollable } = metrics(s.sizes);
        s.dragging = true;
        s.startTop = scrollable > 0 ? (s.offset / scrollable) * travel : 0;
        setDragging(true);
        show();
      },
      onPanResponderMove: (_event, gesture) => {
        const s = live;
        const { travel, scrollable } = metrics(s.sizes);
        if (travel <= 0) {
          return;
        }
        const top = Math.min(Math.max(s.startTop + gesture.dy, 0), travel);
        live.list?.scrollToOffset({ offset: (top / travel) * scrollable, animated: false });
      },
      onPanResponderRelease: endDrag,
      onPanResponderTerminate: endDrag,
    });

    const onScroll = Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
      useNativeDriver: true,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        live.offset = event.nativeEvent.contentOffset.y;
        show();
      },
    });

    return {
      pan,
      dispose: () => clearTimeout(live.hideTimer),
      listProps: {
        ref: (list: FlatList<T> | null) => {
          live.list = list;
        },
        onScroll,
        scrollEventThrottle: 16,
        showsVerticalScrollIndicator: false,
        onLayout: (event: LayoutChangeEvent) => setSize({ viewport: event.nativeEvent.layout.height }),
        onContentSizeChange: (_width: number, height: number) => setSize({ content: height }),
      },
    };
  });

  useEffect(() => handlers.dispose, [handlers]);

  const { travel, scrollable } = metrics(sizes);
  // The scroll position drives the thumb on the native side, so it keeps up
  // with fast flings without waiting for JavaScript.
  const translateY = scrollY.interpolate({
    inputRange: [0, Math.max(scrollable, 1)],
    outputRange: [0, travel],
    extrapolate: "clamp",
  });

  const thumb = (
    <Animated.View
      {...handlers.pan.panHandlers}
      pointerEvents={shown ? "auto" : "none"}
      accessible={false}
      style={[styles.touchArea, { opacity, transform: [{ translateY }] }]}
    >
      <View
        style={[
          styles.thumb,
          dragging ? { backgroundColor: colors.primary, width: 8 } : { backgroundColor: colors.muted },
        ]}
      />
    </Animated.View>
  );

  return { listProps: handlers.listProps, thumb };
}

const styles = StyleSheet.create({
  touchArea: {
    position: "absolute",
    top: INSET,
    right: 0,
    // Wider than it looks, so it's easy to grab.
    width: 36,
    height: THUMB_HEIGHT,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingRight: 3,
  },
  thumb: {
    width: 6,
    height: THUMB_HEIGHT,
    borderRadius: 4,
  },
});
