import * as SecureStore from "expo-secure-store";

// Server addresses, and the extra headers a server can need, such as an access
// proxy's service token (Cloudflare Access: CF-Access-Client-Id and
// CF-Access-Client-Secret). The headers are kept in the keystore per server and
// are only ever sent to that server itself, never to a host it redirects to.

/** "scheme://host[:port]" of an http(s) URL, lowercased, or null for anything else. */
export function originOf(url: string): string | null {
  const match = /^(https?):\/\/([^/?#\s\\]+)/i.exec(url.trim());
  if (!match || match[2].includes("@")) {
    return null;
  }
  const scheme = match[1].toLowerCase();
  const host = match[2].toLowerCase().replace(scheme === "https" ? /:443$/ : /:80$/, "");
  return host ? `${scheme}://${host}` : null;
}

/** The host of a URL, for messages. */
export function hostOf(url: string): string {
  return originOf(url)?.replace(/^https?:\/\//, "") ?? url;
}

/** True when both URLs are on the same scheme, host and port. */
export function sameOrigin(a: string, b: string): boolean {
  const origin = originOf(a);
  return origin !== null && origin === originOf(b);
}

/**
 * Turns what the user typed into the server's address, e.g. "docs.example.com"
 * into "https://docs.example.com". Outline always runs at the root of its
 * address, so a path copied from the browser is dropped. Plain http is only
 * accepted in development builds, for servers on the local network.
 */
export function parseServerAddress(input: string): { server: string } | { error: string } {
  const trimmed = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const server = originOf(withScheme);
  if (!server) {
    return { error: "Enter your Outline server's web address, like https://docs.example.com." };
  }
  if (server.startsWith("http://") && !__DEV__) {
    return {
      error:
        "Inkharbor only connects to servers over HTTPS, so your sign-in and documents can't be read on the way. Enter the server's https:// address.",
    };
  }
  return { server };
}

/** Extra headers as name and value pairs, in the order the user entered them. */
export type HeaderList = [name: string, value: string][];

const HEADERS_KEY = "server_headers";

// Every server's extra headers, by origin. Loaded once at start, so image
// sources can look them up while rendering.
let saved: Record<string, HeaderList> = {};

/** Settles once the saved headers are loaded. Requests wait for it. */
export const serverHeadersReady: Promise<void> = SecureStore.getItemAsync(HEADERS_KEY)
  .then((raw) => {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") {
      saved = parsed as Record<string, HeaderList>;
    }
  })
  .catch(() => {});

/** The extra headers to send with a request to this URL: none unless it's on a server that has some. */
export function headersFor(url: string): Record<string, string> {
  const origin = originOf(url);
  return Object.fromEntries((origin && saved[origin]) || []);
}

/** The extra headers saved for a server. */
export function savedHeaders(server: string): HeaderList {
  const origin = originOf(server);
  return (origin && saved[origin]) || [];
}

/** Saves a server's extra headers; an empty list removes them. */
export async function setServerHeaders(server: string, headers: HeaderList): Promise<void> {
  const origin = originOf(server);
  if (!origin) {
    return;
  }
  await serverHeadersReady;
  const next = { ...saved };
  if (headers.length) {
    next[origin] = headers;
  } else {
    delete next[origin];
  }
  await SecureStore.setItemAsync(HEADERS_KEY, JSON.stringify(next));
  saved = next;
}

/** Removes the extra headers of every server not in the list, e.g. left from a sign-in that never finished. */
export async function pruneServerHeaders(servers: string[]): Promise<void> {
  await serverHeadersReady;
  const keep = new Set(servers.map(originOf));
  const unused = Object.keys(saved).filter((origin) => !keep.has(origin));
  for (const origin of unused) {
    await setServerHeaders(origin, []);
  }
}

// Headers the app sets itself, which an extra header mustn't replace.
const RESERVED = new Set(["authorization", "content-type", "content-length", "host"]);

/**
 * Checks headers the user entered, dropping rows left empty. Returns the
 * cleaned list, or what's wrong with it.
 */
export function checkHeaders(rows: HeaderList): { headers: HeaderList } | { error: string } {
  const headers: HeaderList = [];
  for (const [rawName, rawValue] of rows) {
    const name = rawName.trim();
    const value = rawValue.trim();
    if (!name && !value) {
      continue;
    }
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
      return { error: name ? `"${name}" can't be a header name.` : "Each header needs a name." };
    }
    if (RESERVED.has(name.toLowerCase())) {
      return { error: `Inkharbor sets ${name} itself, so it can't be an extra header.` };
    }
    if (!value || /[\r\n]/.test(value)) {
      return { error: `${name} needs a value on a single line.` };
    }
    headers.push([name, value]);
  }
  return { headers };
}
