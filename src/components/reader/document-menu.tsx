import Ionicons from "@expo/vector-icons/Ionicons";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, View } from "react-native";

import { MenuItem, PopupMenu } from "@/components/popup-menu";
import { TextSizePicker, ThemePicker } from "@/components/reading-pickers";
import { useColors } from "@/constants/colors";

/**
 * A document's ⋮ menu: reading settings (the same ones as the account
 * menu, kept in sync) and actions on the document.
 */
export function DocumentMenu({ webUrl }: { webUrl: string | null }) {
  const colors = useColors();
  return (
    <PopupMenu
      accessibilityLabel="More options"
      trigger={
        <View style={styles.trigger}>
          <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
        </View>
      }
    >
      {(close) => (
        <>
          <ThemePicker />
          <TextSizePicker />
          {webUrl ? (
            <MenuItem
              label="Open in browser"
              onPress={() => close(() => WebBrowser.openBrowserAsync(webUrl))}
            />
          ) : null}
        </>
      )}
    </PopupMenu>
  );
}

const styles = StyleSheet.create({
  trigger: {
    padding: 4,
  },
});
