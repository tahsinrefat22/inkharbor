import { Image } from "expo-image";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from "react-native";

// The logo's opening animation, from the design's timing table
// (assets/logo-source): the drop falls into the basin, the basin draws
// itself left to right, the water line widens, then the logo grows a little
// and fades out with the background to reveal the app (940 ms in all).
//
// Frame 0 is the native splash image (app.json: the drop alone, 80 units up,
// imageWidth 220), so the handoff from the splash screen doesn't jump.

/** expo-splash-screen's imageWidth: the logo canvas size on screen, in dp. */
const SIZE = 220;
/** The design is drawn on a 1024-unit canvas. */
const UNIT = SIZE / 1024;
/** Where the basin starts and ends, round caps included (units). */
const BASIN_LEFT = 222 * UNIT;
const BASIN_RIGHT = 802 * UNIT;
/** Start anyway if the drop image hasn't reported loading by then. */
const LOAD_TIMEOUT_MS = 500;

const palettes = {
  light: { background: "#ffffff", drop: "#2563eb", ink: "#111111" },
  dark: { background: "#111111", drop: "#3b82f6", ink: "#ffffff" },
};

function track(value: Animated.Value, delay: number, duration: number, easing: (t: number) => number) {
  return Animated.timing(value, { toValue: 1, delay, duration, easing, useNativeDriver: true });
}

/**
 * Plays over the app on a cold start, then calls `onDone`. `scheme` is the
 * phone's own light/dark setting, which the native splash screen used; the
 * app's chosen theme shows through as the animation fades out.
 */
export function OpeningAnimation({ scheme, onDone }: { scheme: "light" | "dark"; onDone: () => void }) {
  const palette = palettes[scheme];
  const [v] = useState(() => ({
    drop: new Animated.Value(0),
    basin: new Animated.Value(0),
    waterWidth: new Animated.Value(0),
    waterOpacity: new Animated.Value(0),
    logoScale: new Animated.Value(0),
    logoOpacity: new Animated.Value(0),
    background: new Animated.Value(0),
  }));
  const [dropLoaded, setDropLoaded] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = dropLoaded || timedOut;
  useEffect(() => {
    if (!ready) {
      return;
    }
    let cancelled = false;
    (async () => {
      const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
      // Our first frame is on screen, so the native splash can go.
      await SplashScreen.hideAsync().catch(() => {});
      if (cancelled) {
        return;
      }
      if (reduceMotion) {
        onDone();
        return;
      }
      Animated.parallel([
        track(v.drop, 0, 300, Easing.bezier(0.45, 0, 0.25, 1)),
        track(v.basin, 140, 400, Easing.bezier(0.22, 1, 0.36, 1)),
        track(v.waterWidth, 280, 300, Easing.bezier(0.22, 1, 0.36, 1)),
        track(v.waterOpacity, 280, 140, Easing.bezier(0, 0, 0.2, 1)),
        track(v.logoScale, 700, 240, Easing.bezier(0.4, 0, 0.2, 1)),
        track(v.logoOpacity, 700, 240, Easing.bezier(0.4, 0, 1, 1)),
        track(v.background, 700, 240, Easing.bezier(0.4, 0, 0.2, 1)),
      ]).start(({ finished }) => {
        if (finished && !cancelled) {
          onDone();
        }
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, v, onDone]);

  // The basin is revealed by a window whose right edge sweeps from the
  // basin's left end to its right end; the image inside counter-moves so it
  // stays put.
  const sweep = v.basin.interpolate({ inputRange: [0, 1], outputRange: [BASIN_LEFT - BASIN_RIGHT, 0] });
  const counterSweep = v.basin.interpolate({ inputRange: [0, 1], outputRange: [BASIN_RIGHT - BASIN_LEFT, 0] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: palette.background,
            opacity: v.background.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          },
        ]}
      />
      <View style={styles.center}>
        <Animated.View
          style={[
            styles.canvas,
            {
              opacity: v.logoOpacity.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              transform: [{ scale: v.logoScale.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
            },
          ]}
        >
          <Animated.View style={[styles.basinWindow, { transform: [{ translateX: sweep }] }]}>
            <Animated.View style={[styles.canvas, { transform: [{ translateX: counterSweep }] }]}>
              <Image source={require("@/assets/images/logo/basin.png")} style={styles.canvas} tintColor={palette.ink} />
            </Animated.View>
          </Animated.View>
          <Animated.View
            style={[
              styles.layer,
              {
                opacity: v.waterOpacity,
                transform: [{ scaleX: v.waterWidth.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }) }],
              },
            ]}
          >
            <Image source={require("@/assets/images/logo/water.png")} style={styles.canvas} tintColor={palette.ink} />
          </Animated.View>
          <Animated.View
            style={[
              styles.layer,
              { transform: [{ translateY: v.drop.interpolate({ inputRange: [0, 1], outputRange: [-80 * UNIT, 0] }) }] },
            ]}
          >
            <Image
              source={require("@/assets/images/logo/drop.png")}
              style={styles.canvas}
              tintColor={palette.drop}
              onLoad={() => setDropLoaded(true)}
            />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  canvas: {
    width: SIZE,
    height: SIZE,
  },
  layer: {
    ...StyleSheet.absoluteFill,
  },
  basinWindow: {
    position: "absolute",
    top: 0,
    left: 0,
    width: BASIN_RIGHT,
    height: SIZE,
    overflow: "hidden",
  },
});
