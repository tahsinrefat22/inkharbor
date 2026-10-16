import type { Request } from "./collections";

/** An emoji the workspace uploaded. Reactions and documents refer to it by id. */
export interface CustomEmoji {
  id: string;
  name: string;
}

const PAGE_SIZE = 100;

/** All of the workspace's own emoji, newest first. */
export async function listCustomEmojis(request: Request): Promise<CustomEmoji[]> {
  const all: CustomEmoji[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request<CustomEmoji[]>("emojis.list", { limit: PAGE_SIZE, offset });
    all.push(...page.map(({ id, name }) => ({ id, name })));
    if (page.length < PAGE_SIZE) {
      return all;
    }
  }
}
