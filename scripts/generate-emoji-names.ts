// Writes two files from @emoji-mart/data, the emoji set Outline uses:
//
// - src/lib/emoji-names.json: emoji shortcode -> character, the same names
//   Outline stores in documents (see shared/editor/lib/emoji.ts in
//   outline/outline). A small map instead of shipping all of the data.
// - src/lib/emoji-picker.json: the emoji picker's categories, each emoji
//   with the words it's found by and its skin tones.
//
//   bun run emoji-names
//
// Runs under Bun, outside the app's TypeScript project (see tsconfig exclude).

import { writeFileSync } from "node:fs";

import data from "@emoji-mart/data";

interface EmojiMartData {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<string, { id: string; name: string; keywords: string[]; skins: { native: string }[] }>;
}

const { categories, emojis } = data as EmojiMartData;

// Outline's renames for gemoji compatibility.
const renames: Record<string, string> = { "+1": "thumbs_up", "-1": "thumbs_down" };
const snakeCase = (str: string) => str.replace(/(\w)-(\w)/g, "$1_$2");

const names: Record<string, string> = {};
for (const emoji of Object.values(emojis)) {
  const id = snakeCase(emoji.id);
  names[renames[id] ?? id] = emoji.skins[0].native;
}
writeFileSync(new URL("../src/lib/emoji-names.json", import.meta.url), JSON.stringify(names) + "\n");
console.log(`Wrote ${Object.keys(names).length} emoji names.`);

// Each emoji is [character, search words] or, with skin tones,
// [character, search words, [the five toned characters, light to dark]].
type PickerEmoji = [string, string] | [string, string, string[]];

const picker = categories.map((category) => ({
  id: category.id,
  emojis: category.emojis.map((id): PickerEmoji => {
    const emoji = emojis[id];
    const words = [...new Set([emoji.name, snakeCase(id), ...emoji.keywords].map((w) => w.toLowerCase()))];
    const [plain, ...toned] = emoji.skins.map((skin) => skin.native);
    return toned.length === 5 ? [plain, words.join(" "), toned] : [plain, words.join(" ")];
  }),
}));
writeFileSync(new URL("../src/lib/emoji-picker.json", import.meta.url), JSON.stringify({ categories: picker }) + "\n");
console.log(`Wrote ${picker.reduce((sum, category) => sum + category.emojis.length, 0)} picker emoji.`);
