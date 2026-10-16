import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ViewToken,
} from "react-native";

import { ReactionEmoji } from "@/components/reader/document-body";
import { useColors } from "@/constants/colors";
import { useCachedLoader, type CacheAdapter } from "@/hooks/use-cached-loader";
import { readEntry, writeEntry } from "@/lib/cache";
import { useAuth } from "@/lib/auth";
import pickerData from "@/lib/emoji-picker.json";
import { saveSkinTone, useRecentEmoji, useSkinTone } from "@/lib/emoji-preferences";
import { listCustomEmojis, type CustomEmoji } from "@/lib/outline/emojis";

// The full emoji picker, like Outline's: every emoji by category, search,
// skin tones, recently used ones and the workspace's own emoji.

/** [character, search words, five skin-toned characters?], from scripts/generate-emoji-names.ts. */
type PickerEmoji = [string, string, string[]?];

const CATEGORIES = (pickerData as { categories: { id: string; emojis: PickerEmoji[] }[] }).categories;

const CATEGORY_INFO: Record<string, { icon: string; title: string }> = {
  recent: { icon: "🕘", title: "Recently used" },
  custom: { icon: "✨", title: "Custom" },
  people: { icon: "😀", title: "Smileys & People" },
  nature: { icon: "🐻", title: "Animals & Nature" },
  foods: { icon: "🍔", title: "Food & Drink" },
  activity: { icon: "⚽", title: "Activity" },
  places: { icon: "✈️", title: "Travel & Places" },
  objects: { icon: "💡", title: "Objects" },
  symbols: { icon: "🔣", title: "Symbols" },
  flags: { icon: "🏳️", title: "Flags" },
};

const TONE_HANDS = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];
const COLUMNS = 8;
const HEADER_HEIGHT = 32;
const SIDE_PADDING = 12;

/** One emoji to show: a character, or the id of a workspace emoji. */
interface Cell {
  value: string;
  /** What a screen reader says; it reads emoji characters by name itself. */
  label: string;
}

const toCell = (emoji: string): Cell => ({ value: emoji, label: emoji });

type Item =
  | { key: string; kind: "header"; title: string; section: number }
  | { key: string; kind: "row"; cells: Cell[]; section: number };

function toRows(cells: Cell[], section: number, key: string): Item[] {
  const rows: Item[] = [];
  for (let i = 0; i < cells.length; i += COLUMNS) {
    rows.push({ key: `${key}:${i}`, kind: "row", cells: cells.slice(i, i + COLUMNS), section });
  }
  return rows;
}

/** Where each item starts in the list. */
function itemOffsets(items: Item[], cellSize: number): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const item of items) {
    offsets.push(offset);
    offset += item.kind === "header" ? HEADER_HEIGHT : cellSize;
  }
  return offsets;
}

function withTone(emoji: PickerEmoji, tone: number): string {
  return tone && emoji[2] ? emoji[2][tone - 1] : emoji[0];
}

const customCache: CacheAdapter<CustomEmoji[]> = {
  read: () => readEntry<CustomEmoji[]>("custom-emojis"),
  write: (value) => writeEntry("custom-emojis", value),
};

/**
 * Picks an emoji. `selected` holds the ones already chosen (the user's
 * reactions), which are highlighted. Needs ReaderProvider for workspace emoji.
 */
export function EmojiPicker({
  height,
  selected,
  onPick,
}: {
  height: number;
  selected: Set<string>;
  onPick: (emoji: string) => void;
}) {
  const colors = useColors();
  const { request } = useAuth();
  const { width } = useWindowDimensions();
  const cellSize = Math.floor((width - SIDE_PADDING * 2) / COLUMNS);
  const tone = useSkinTone();
  const recent = useRecentEmoji();
  const loadCustom = useCallback(() => listCustomEmojis(request), [request]);
  const customData = useCachedLoader(loadCustom, customCache).data;
  const custom = useMemo(() => customData ?? [], [customData]);
  const [query, setQuery] = useState("");
  const [choosingTone, setChoosingTone] = useState(false);
  const [section, setSection] = useState(0);
  const listRef = useRef<FlatList<Item>>(null);

  const customNames = useMemo(() => new Map(custom.map((emoji) => [emoji.id, emoji.name])), [custom]);

  // The sections, each with its title, icon and emoji, in the order shown.
  const sections = useMemo(() => {
    const all: { id: string; cells: Cell[] }[] = [];
    if (recent.length) {
      all.push({
        id: "recent",
        cells: recent.map((value) => ({ value, label: customNames.get(value) ?? value })),
      });
    }
    if (custom.length) {
      all.push({ id: "custom", cells: custom.map((emoji) => ({ value: emoji.id, label: emoji.name })) });
    }
    for (const category of CATEGORIES) {
      all.push({
        id: category.id,
        cells: category.emojis.map((emoji) => toCell(withTone(emoji, tone))),
      });
    }
    return all;
  }, [recent, custom, customNames, tone]);

  const items = useMemo<Item[]>(() => {
    const search = query.trim().toLowerCase();
    if (search) {
      const found: Cell[] = [
        ...custom
          .filter((emoji) => emoji.name.toLowerCase().includes(search))
          .map((emoji) => ({ value: emoji.id, label: emoji.name })),
        ...CATEGORIES.flatMap((category) =>
          category.emojis
            .filter((emoji) => emoji[1].includes(search))
            .map((emoji) => toCell(withTone(emoji, tone))),
        ),
      ];
      return toRows(found, 0, "search");
    }
    return sections.flatMap((s, index) => [
      { key: s.id, kind: "header" as const, title: CATEGORY_INFO[s.id]?.title ?? s.id, section: index },
      ...toRows(s.cells, index, s.id),
    ]);
  }, [query, sections, custom, tone]);

  // Every item has a fixed height, so the list can jump straight to a section.
  const offsets = useMemo(() => itemOffsets(items, cellSize), [items, cellSize]);

  function jumpTo(index: number) {
    const itemIndex = items.findIndex((item) => item.kind === "header" && item.section === index);
    if (itemIndex !== -1) {
      setSection(index);
      listRef.current?.scrollToOffset({ offset: offsets[itemIndex], animated: false });
    }
  }

  // The tab of the section at the top of the list is highlighted while scrolling.
  // Stable: FlatList doesn't accept a new one after it's mounted.
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    const first = viewableItems[0]?.item;
    if (first) {
      setSection(first.section);
    }
  }, []);

  return (
    <View style={{ height }}>
      <View style={styles.searchRow}>
        <View style={[styles.search, { borderColor: colors.border, backgroundColor: colors.background }]}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search emoji"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: colors.text }]}
          />
          {query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skin tone"
          accessibilityState={{ expanded: choosingTone }}
          onPress={() => setChoosingTone((value) => !value)}
          hitSlop={6}
          style={({ pressed }) => [styles.toneButton, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.barEmoji}>{TONE_HANDS[tone]}</Text>
        </Pressable>
      </View>

      {choosingTone ? (
        <View style={[styles.bar, { borderColor: colors.border }]} accessibilityRole="radiogroup">
          {TONE_HANDS.map((hand, index) => (
            <Pressable
              key={hand}
              accessibilityRole="radio"
              accessibilityLabel={index ? `Skin tone ${index}` : "Default skin tone"}
              accessibilityState={{ checked: index === tone }}
              onPress={() => {
                saveSkinTone(index);
                setChoosingTone(false);
              }}
              style={[styles.barItem, index === tone && { backgroundColor: `${colors.primary}26` }]}
            >
              <Text style={styles.barEmoji}>{hand}</Text>
            </Pressable>
          ))}
        </View>
      ) : query ? null : (
        <View style={[styles.bar, { borderColor: colors.border }]} accessibilityRole="tablist">
          {sections.map((s, index) => (
            <Pressable
              key={s.id}
              accessibilityRole="tab"
              accessibilityLabel={CATEGORY_INFO[s.id]?.title ?? s.id}
              accessibilityState={{ selected: index === section }}
              onPress={() => jumpTo(index)}
              style={[styles.barItem, index === section && { backgroundColor: `${colors.primary}26` }]}
            >
              <Text style={styles.barEmoji}>{CATEGORY_INFO[s.id]?.icon ?? "•"}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.grid}
        getItemLayout={(_data, index) => ({
          length: items[index].kind === "header" ? HEADER_HEIGHT : cellSize,
          offset: offsets[index],
          index,
        })}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ itemVisiblePercentThreshold: 1 }}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.muted }]}>
            {query ? "No emoji found." : "Loading…"}
          </Text>
        }
        renderItem={({ item }) =>
          item.kind === "header" ? (
            <Text style={[styles.header, { color: colors.muted }]} accessibilityRole="header">
              {item.title}
            </Text>
          ) : (
            <View style={styles.row}>
              {item.cells.map((cell) => {
                const chosen = selected.has(cell.value);
                return (
                  <Pressable
                    key={cell.value}
                    accessibilityRole="button"
                    accessibilityLabel={cell.label}
                    accessibilityState={{ selected: chosen }}
                    onPress={() => onPick(cell.value)}
                    style={({ pressed }) => [
                      styles.cell,
                      { width: cellSize, height: cellSize, borderRadius: cellSize / 2 },
                      chosen && { backgroundColor: `${colors.primary}26` },
                      pressed && { backgroundColor: `${colors.border}aa` },
                    ]}
                  >
                    <Text style={styles.cellEmoji}>
                      <ReactionEmoji emoji={cell.value} />
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: SIDE_PADDING,
    paddingBottom: 8,
  },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    paddingHorizontal: 12,
    height: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  toneButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  bar: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: SIDE_PADDING,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barItem: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 4,
    borderRadius: 8,
  },
  barEmoji: {
    fontSize: 20,
  },
  grid: {
    paddingHorizontal: SIDE_PADDING,
    paddingBottom: 8,
  },
  header: {
    height: HEADER_HEIGHT,
    fontSize: 13,
    fontWeight: "600",
    textAlignVertical: "center",
    paddingHorizontal: 4,
  },
  row: {
    flexDirection: "row",
  },
  cell: {
    alignItems: "center",
    justifyContent: "center",
  },
  cellEmoji: {
    fontSize: 26,
  },
  empty: {
    textAlign: "center",
    marginTop: 24,
  },
});
