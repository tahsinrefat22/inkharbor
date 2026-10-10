/** Calls an Outline API method as the signed-in user (see useAuth().request). */
export type Request = <T>(method: string, body?: object, headers?: Record<string, string>) => Promise<T>;

export interface Collection {
  id: string;
  name: string;
  /** Markdown, may be empty. */
  description: string | null;
  /** An emoji, the name of one of Outline's own icons, or an uploaded icon's id. */
  icon: string | null;
  color: string | null;
}

/** A document in a collection's tree, as returned by collections.documents. */
export interface DocumentNode {
  id: string;
  title: string;
  url: string;
  icon?: string;
  color?: string;
  children: DocumentNode[];
}

/** Outline caps list requests at 100 items per page. */
const PAGE_SIZE = 100;

/** All collections the user can read, in the order Outline shows them. */
export async function listCollections(request: Request): Promise<Collection[]> {
  const all: Collection[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request<Collection[]>("collections.list", { limit: PAGE_SIZE, offset });
    all.push(...page);
    if (page.length < PAGE_SIZE) {
      return all;
    }
  }
}

/** The full document tree of a collection, in one request. */
export function getDocumentTree(request: Request, collectionId: string): Promise<DocumentNode[]> {
  return request<DocumentNode[]>("collections.documents", { id: collectionId });
}

/**
 * Returns the icon if it's an emoji. Outline's named icons and uploaded icons
 * can't be drawn without its icon set, so callers show a fallback instead.
 */
export function emojiIcon(icon: string | null | undefined): string | null {
  return icon && /\p{Extended_Pictographic}/u.test(icon) ? icon : null;
}
