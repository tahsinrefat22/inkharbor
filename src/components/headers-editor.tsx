import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useColors } from "@/constants/colors";
import type { HeaderList } from "@/lib/outline/server-access";

/**
 * Rows of extra headers for a server, such as an access proxy's service token.
 * Values are hidden like passwords, since they usually are secrets.
 */
export function HeadersEditor({
  rows,
  onChange,
  editable = true,
}: {
  rows: HeaderList;
  onChange: (rows: HeaderList) => void;
  editable?: boolean;
}) {
  const colors = useColors();
  const inputStyle = [styles.input, { color: colors.text, borderColor: colors.border }];

  function set(index: number, part: 0 | 1, text: string) {
    onChange(rows.map((row, i) => (i === index ? (part === 0 ? [text, row[1]] : [row[0], text]) : row)));
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.hint, { color: colors.muted }]}>
        {
          "Sent with every request to this server, and only to it. For Cloudflare Access, add CF-Access-Client-Id and CF-Access-Client-Secret from a service token."
        }
      </Text>
      {rows.map(([name, value], index) => (
        <View key={index} style={styles.row}>
          <TextInput
            style={[inputStyle, styles.name]}
            value={name}
            onChangeText={(text) => set(index, 0, text)}
            placeholder="Name"
            placeholderTextColor={colors.muted}
            selectionColor={colors.primary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={editable}
            accessibilityLabel={`Header ${index + 1} name`}
          />
          <TextInput
            style={[inputStyle, styles.value]}
            value={value}
            onChangeText={(text) => set(index, 1, text)}
            placeholder="Value"
            placeholderTextColor={colors.muted}
            selectionColor={colors.primary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={editable}
            accessibilityLabel={`Header ${index + 1} value`}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove header ${index + 1}`}
            onPress={() => onChange(rows.filter((_, i) => i !== index))}
            disabled={!editable}
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Ionicons name="close" size={22} color={colors.muted} />
          </Pressable>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => onChange([...rows, ["", ""]])}
        disabled={!editable}
        style={({ pressed }) => [styles.add, pressed && styles.pressed]}
      >
        <Ionicons name="add" size={20} color={colors.primary} />
        <Text style={{ color: colors.primary }}>Add a header</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  hint: {
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
  },
  name: {
    flex: 1,
  },
  value: {
    flex: 1,
  },
  add: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
