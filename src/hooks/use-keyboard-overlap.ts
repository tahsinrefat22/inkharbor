import { useEffect, useRef, useState } from "react";
import { Keyboard, StatusBar, type View } from "react-native";

/**
 * How much of a view the keyboard covers, and whether it's open. Give the
 * view this much bottom padding to keep its content above the keyboard.
 *
 * The app draws edge to edge, so whether Android shrinks the screen for the
 * keyboard varies; measuring the view's position on screen against the
 * keyboard's top gives the right answer either way (0 when it was shrunk).
 * The padding doesn't move the view's own frame, so measuring stays stable.
 *
 * On Android the keyboard's top comes in screen coordinates, while
 * measureInWindow counts from below the status bar, so the status bar's
 * height is added back before comparing the two.
 */
export function useKeyboardOverlap() {
  const viewRef = useRef<View>(null);
  const [overlap, setOverlap] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      setOpen(true);
      viewRef.current?.measureInWindow((_x, y, _width, height) => {
        const bottom = y + height + (StatusBar.currentHeight ?? 0);
        setOverlap(Math.max(0, bottom - event.endCoordinates.screenY));
      });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      setOpen(false);
      setOverlap(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return { viewRef, overlap, open };
}
