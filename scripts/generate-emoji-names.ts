// Writes src/lib/emoji-names.json: emoji shortcode -> character, the same
// names Outline stores in documents (see shared/editor/lib/emoji.ts in
// outline/outline). A small map instead of shipping all of @emoji-mart/data.
//
//   bun run emoji-names
//
// Runs under Bun, outside the app's TypeScript project (see tsconfig exclude).

import { writeFileSync } from "node:fs";

import data from "@emoji-mart/data";

interface EmojiMartData {
  emojis: Record<string, { id: string; skins: { native: string }[] }>;
}

// Outline's renames for gemoji compatibility.
const renames: Record<string, string> = { "+1": "thumbs_up", "-1": "thumbs_down" };
const snakeCase = (str: string) => str.replace(/(\w)-(\w)/g, "$1_$2");

const names: Record<string, string> = {};
for (const emoji of Object.values((data as EmojiMartData).emojis)) {
  const id = snakeCase(emoji.id);
  names[renames[id] ?? id] = emoji.skins[0].native;
}

writeFileSync(new URL("../src/lib/emoji-names.json", import.meta.url), JSON.stringify(names) + "\n");
console.log(`Wrote ${Object.keys(names).length} emoji names.`);
