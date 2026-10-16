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

/** A comment as the server sends it; anchorText only comes when asked for. */
type ServerComment = Omit<OutlineComment, "anchorText"> & { anchorText?: string };

function toComment(comment: ServerComment): OutlineComment {
  return {
    id: comment.id,
    data: comment.data,
    parentCommentId: comment.parentCommentId ?? null,
    createdBy: toUser(comment.createdBy),
    createdAt: comment.createdAt,
    resolvedAt: comment.resolvedAt ?? null,
    resolvedBy: comment.resolvedBy ? toUser(comment.resolvedBy) : null,
    reactions: comment.reactions ?? [],
    anchorText: comment.anchorText || null,
  };
}

/** Every comment on a document, oldest first. Only the details the app shows are kept. */
export async function listComments(request: Request, documentId: string): Promise<OutlineComment[]> {
  const all: OutlineComment[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await request<ServerComment[]>("comments.list", {
      documentId,
      includeAnchorText: true,
      sort: "createdAt",
      direction: "ASC",
      limit: PAGE_SIZE,
      offset,
    });
    all.push(...page.map(toComment));
    if (page.length < PAGE_SIZE) {
      return all;
    }
  }
}

/**
 * Posts a comment on the whole document, or a reply when `parentCommentId`
 * is set. `text` is Markdown, which Outline turns into rich text.
 */
export async function createComment(
  request: Request,
  comment: { documentId: string; text: string; parentCommentId?: string },
): Promise<OutlineComment> {
  return toComment(await request<ServerComment>("comments.create", comment));
}

/** Resolves a thread; `id` is its first comment. Returns the updated comment. */
export async function resolveComment(request: Request, id: string): Promise<OutlineComment> {
  return toComment(await request<ServerComment>("comments.resolve", { id }));
}

/** Reopens a resolved thread. */
export async function unresolveComment(request: Request, id: string): Promise<OutlineComment> {
  return toComment(await request<ServerComment>("comments.unresolve", { id }));
}

/** Adds the user's reaction to a comment, or takes it away. */
export async function setReaction(request: Request, commentId: string, emoji: string, on: boolean): Promise<void> {
  await request(on ? "comments.add_reaction" : "comments.remove_reaction", { id: commentId, emoji });
}

/** Who reacted to a comment, newest first. */
export async function listReactions(
  request: Request,
  commentId: string,
): Promise<{ emoji: string; user: CommentUser }[]> {
  const reactions = await request<{ emoji: string; user: CommentUser }[]>("reactions.list", {
    commentId,
    limit: PAGE_SIZE,
  });
  return reactions.map(({ emoji, user }) => ({ emoji, user: toUser(user) }));
}

/**
 * The comment's reactions with the user's own reaction `emoji` added, or
 * taken away when `on` is false. Reactions nobody is left on are dropped.
 */
export function withReaction(reactions: Reaction[], emoji: string, userId: string, on: boolean): Reaction[] {
  const others = (reaction: Reaction) => reaction.userIds.filter((id) => id !== userId);
  if (!on) {
    return reactions
      .map((reaction) => (reaction.emoji === emoji ? { ...reaction, userIds: others(reaction) } : reaction))
      .filter((reaction) => reaction.userIds.length);
  }
  if (reactions.some((reaction) => reaction.emoji === emoji)) {
    return reactions.map((reaction) =>
      reaction.emoji === emoji ? { ...reaction, userIds: [...others(reaction), userId] } : reaction,
    );
  }
  return [...reactions, { emoji, userIds: [userId] }];
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
export function openComments(comments: OutlineComment[]): OutlineComment[] {
  const resolved = new Set(comments.filter((comment) => comment.resolvedAt).map((comment) => comment.id));
  return comments.filter(
    (comment) => !resolved.has(comment.id) && !(comment.parentCommentId && resolved.has(comment.parentCommentId)),
  );
}

/**
 * The newest comment's date, for remembering which comments were seen. The
 * server's dates are compared, so the phone's clock doesn't matter.
 */
export function latestCommentAt(comments: OutlineComment[]): string | null {
  return comments.reduce<string | null>(
    (latest, comment) => (!latest || comment.createdAt > latest ? comment.createdAt : latest),
    null,
  );
}
