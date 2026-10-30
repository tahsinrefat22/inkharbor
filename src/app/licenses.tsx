import { Stack } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import { CODE_FONT } from "@/components/reader/document-body";
import { useColors } from "@/constants/colors";
import licenses from "@/lib/licenses.json";

// The licences of everything the app is built with, written by
// scripts/generate-licenses.ts (bun run licenses) from a release build.

interface Entry {
  title: string;
  license: string;
  components: string[];
  texts: number[];
}

const { entries, texts } = licenses as { entries: Entry[]; texts: string[] };

export default function Licenses() {
  const colors = useColors();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  function toggle(title: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(title)) {
        next.add(title);
      }
      return next;
    });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Open-source licences" }} />
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.title}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={[styles.intro, { color: colors.muted }]}>
            {
              "Inkharbor is open source under the MIT License. It's built with the software below, used under these licences. Tap one to read it."
            }
          </Text>
        }
        renderItem={({ item }) => {
          const expanded = open.has(item.title);
          const count = item.components.length;
          return (
            <View style={[styles.entry, { borderColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => toggle(item.title)}
                style={({ pressed }) => [styles.heading, pressed && styles.pressed]}
              >
                <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>
                  {item.license}
                  {count > 1 ? ` · ${count} parts` : ""}
                </Text>
              </Pressable>
              {expanded ? (
                <View style={styles.body}>
                  <Text style={[styles.components, { color: colors.muted }]}>{item.components.join("\n")}</Text>
                  {item.texts.map((id) => (
                    <Text
                      key={id}
                      selectable
                      style={[styles.text, { color: colors.codeText, backgroundColor: colors.codeBackground }]}
                    >
                      {texts[id]}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: 16,
    paddingBottom: 48,
  },
  intro: {
    fontSize: 14,
    marginBottom: 12,
  },
  entry: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  heading: {
    paddingVertical: 12,
    gap: 2,
  },
  pressed: {
    opacity: 0.6,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
  },
  meta: {
    fontSize: 13,
  },
  body: {
    gap: 10,
    paddingBottom: 16,
  },
  components: {
    fontSize: 13,
    lineHeight: 19,
  },
  text: {
    fontFamily: CODE_FONT,
    fontSize: 11,
    lineHeight: 16,
    padding: 10,
    borderRadius: 6,
  },
});
