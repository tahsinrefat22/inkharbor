// Links shared to Inkharbor from other apps (Android's share sheet). The
// shared text can be a bare URL or a message with one in it, e.g. "Have a
// look: https://docs.example.com/doc/…".

/** The first web link in shared text, or null if there isn't one. */
export function firstLink(text: string): string | null {
  return text.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[).,;!?]+$/, "") ?? null;
}

/** Whether the link points at the same server as `server`, ignoring http vs https. */
export function isOnServer(link: string, server: string): boolean {
  try {
    return new URL(link).host.toLowerCase() === new URL(server).host.toLowerCase();
  } catch {
    return false;
  }
}

/** The host of a link, e.g. docs.example.com, or the link itself if it can't be read. */
export function hostOf(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}

/** Whether the link is a server's front page, e.g. https://docs.example.com or …/home. */
export function isFrontPage(link: string): boolean {
  try {
    return /^\/(home\/?)?$/.test(new URL(link).pathname || "/");
  } catch {
    return false;
  }
}

/** The path of a link, e.g. /doc/title-abc123, for documentIdFromLink. */
export function pathOf(link: string): string {
  try {
    const url = new URL(link);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return link;
  }
}

// A link shared while the app was locked or not connected waits here until
// the home screen opens after sign-in.
let pending: string | null = null;

export function setPendingLink(link: string): void {
  pending = link;
}

/** The waiting link, once; later calls return null. */
export function takePendingLink(): string | null {
  const link = pending;
  pending = null;
  return link;
}
