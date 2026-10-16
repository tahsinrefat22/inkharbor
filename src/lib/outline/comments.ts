import type { Request } from "./collections";
import type { PMNode } from "./documents";

export interface CommentUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  color: string;
}

/** A reaction and who left it. `emoji` is the emoji itself, or the id of one the workspace uploaded. */
export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface OutlineComment {
  id: string;
  /** The comment's text as ProseMirror JSON, like a small document. */
  data: PMNode;
  /** Set on replies: the comment that started the thread. */
  parentCommentId: string | null;
  createdBy: CommentUser;
  /** ISO date. */
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: CommentUser | null;
  reactions: Reaction[];
  /** The document text the thread was left on, if it was left on a passage. */
  anchorText: string | null;
}

/** A comment with its replies, oldest first. Only the first comment can be resolved. */
export interface CommentThread {
  comment: OutlineComment;
  replies: OutlineComment[];
}

const PAGE_SIZE = 100;

function toUser(user: CommentUser): CommentUser {
  const { id, name, avatarUrl, color } = user;
  return { id, name, avatarUrl: avatarUrl ?? null, color };
}

/** Every comment on a document, oldest first. Only the details the app shows are kept. */
export async function listComments(request: Request, documentId: string): Promise<OutlineComment[]> {
  const all: OutlineComment[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request<(OutlineComment & { anchorText?: string })[]>("comments.list", {
      documentId,
      includeAnchorText: true,
      sort: "createdAt",
      direction: "ASC",
      limit: PAGE_SIZE,
      offset,
    });
    all.push(
      ...page.map((comment) => ({
        id: comment.id,
        data: comment.data,
        parentCommentId: comment.parentCommentId ?? null,
        createdBy: toUser(comment.createdBy),
        createdAt: comment.createdAt,
        resolvedAt: comment.resolvedAt ?? null,
        resolvedBy: comment.resolvedBy ? toUser(comment.resolvedBy) : null,
        reactions: comment.reactions ?? [],
        anchorText: comment.anchorText || null,
      })),
    );
    if (page.length < PAGE_SIZE) {
      return all;
    }
  }
}

/**
 * The ids of the comments anchored in a document, in the order their
 * passages appear. Outline marks commented text with a "comment" mark.
 */
export function commentOrder(blocks: PMNode[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const visit = (node: PMNode) => {
    for (const mark of node.marks ?? []) {
      const id = mark.attrs?.id;
      if (mark.type === "comment" && typeof id === "string" && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    node.content?.forEach(visit);
  };
  blocks.forEach(visit);
  return ids;
}

/**
 * Groups comments into threads. Threads on a passage come first, in the
 * order the passages appear in the document (`order`, from commentOrder),
 * then the rest, oldest first.
 */
export function toThreads(comments: OutlineComment[], order: string[]): CommentThread[] {
  const threads = new Map<string, CommentThread>();
  for (const comment of comments) {
    if (!comment.parentCommentId) {
      threads.set(comment.id, { comment, replies: [] });
    }
  }
  for (const comment of comments) {
    if (comment.parentCommentId) {
      threads.get(comment.parentCommentId)?.replies.push(comment);
    }
  }
  const position = new Map(order.map((id, index) => [id, index]));
  return [...threads.values()].sort((a, b) => {
    const pa = position.get(a.comment.id) ?? Infinity;
    const pb = position.get(b.comment.id) ?? Infinity;
    if (pa !== pb) {
      return pa - pb;
    }
    return a.comment.createdAt.localeCompare(b.comment.createdAt);
  });
}

/** Comments in unresolved threads, replies included, as Outline counts them. */
export function openCommentCount(comments: OutlineComment[]): number {
  const resolved = new Set(comments.filter((comment) => comment.resolvedAt).map((comment) => comment.id));
  return comments.filter(
    (comment) => !resolved.has(comment.id) && !(comment.parentCommentId && resolved.has(comment.parentCommentId)),
  ).length;
}
