import { headersFor, hostOf, serverHeadersReady } from "./server-access";

/** An error response from the Outline API. */
export class OutlineApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** True when something other than Outline answered, such as an access proxy. */
    public readonly notOutline = false,
  ) {
    super(message);
    this.name = "OutlineApiError";
  }

  /** True when the token is missing, invalid, revoked or expired. A proxy's 401 doesn't count. */
  get isUnauthorized(): boolean {
    return this.status === 401 && !this.notOutline;
  }

  /** True for server-side failures (5xx, including proxy error pages). */
  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * True when a request never got an answer: no internet, DNS failure, refused
 * connection. React Native's fetch throws a TypeError for these; Expo's fetch
 * (the global one in SDK 57) throws a FetchError whose message starts with
 * "fetch failed", and doesn't export the class.
 */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && err.message.startsWith("fetch failed"));
}

const PROXY_HELP =
  "An access proxy such as Cloudflare Access may be blocking the app. Inkharbor needs these paths without a browser login: /.well-known/oauth-authorization-server, /oauth/register, /oauth/token, /oauth/revoke and /api/. Or add the proxy's service token as extra headers, when adding the server or in Settings.";

/**
 * Reads an answer that should be Outline's JSON. Requests to Outline don't
 * follow redirects, so a redirect or a web page means something else answered:
 * usually an access proxy asking for a browser login, or the wrong address.
 */
export async function readOutlineJson(
  res: Response,
): Promise<{ json: Record<string, unknown> } | { problem: string }> {
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") ?? "";
    const target = /^https?:\/\//i.test(location) ? hostOf(location) : hostOf(res.url);
    return {
      problem: `The server sent the app on to ${target} (HTTP ${res.status}) instead of answering as Outline. ${PROXY_HELP}`,
    };
  }
  const text = await res.text().catch(() => "");
  try {
    const json: unknown = JSON.parse(text);
    if (json && typeof json === "object") {
      return { json: json as Record<string, unknown> };
    }
  } catch {
    // Not JSON: handled below.
  }
  if (res.status >= 500) {
    return { problem: `The server isn't answering right now (HTTP ${res.status}). Try again in a while.` };
  }
  return {
    problem: `${hostOf(res.url)} answered with a web page instead of Outline (HTTP ${res.status}). Check the address, and that the server runs Outline 1.11.0 or newer. If both are right: ${PROXY_HELP.charAt(0).toLowerCase()}${PROXY_HELP.slice(1)}`,
  };
}

/** Removes trailing slashes so URLs can be joined safely. */
export function normalizeServerUrl(server: string): string {
  return server.trim().replace(/\/+$/, "");
}

/**
 * Calls an Outline API method. Outline's API is RPC style: every method is a
 * POST to /api/<method> with a JSON body.
 */
/**
 * What the user may do with a model, e.g. `abilities.update` for a document.
 * An ability is true, or the ids of the memberships that grant it.
 */
export interface Policy {
  id: string;
  abilities: Record<string, boolean | string[]>;
}

/** Whether the policies let the user take `ability` on the model `id`. */
export function allows(policies: Policy[] | undefined, id: string, ability: string): boolean {
  const granted = policies?.find((policy) => policy.id === id)?.abilities[ability];
  return Array.isArray(granted) ? granted.length > 0 : granted === true;
}

/** A method's answer with the user's policies for the models in it. */
export interface ApiResponse<T> {
  data: T;
  policies?: Policy[];
}

export async function apiCall<T>(
  server: string,
  token: string,
  method: string,
  body: object = {},
  headers: Record<string, string> = {},
): Promise<ApiResponse<T>> {
  await serverHeadersReady;
  const url = `${normalizeServerUrl(server)}/api/${method}`;
  const res = await fetch(url, {
    method: "POST",
    // Outline's API never redirects; a redirect comes from something in front of it.
    redirect: "manual",
    headers: {
      ...headersFor(url),
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const answer = await readOutlineJson(res);
  if ("problem" in answer) {
    throw new OutlineApiError(res.status, answer.problem, true);
  }
  const { json } = answer;
  if (!res.ok) {
    throw new OutlineApiError(res.status, typeof json.message === "string" ? json.message : `HTTP ${res.status}`);
  }
  return { data: json.data as T, policies: json.policies as Policy[] | undefined };
}

export async function apiRequest<T>(
  server: string,
  token: string,
  method: string,
  body: object = {},
  headers: Record<string, string> = {},
): Promise<T> {
  return (await apiCall<T>(server, token, method, body, headers)).data;
}

export interface AuthInfo {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    color: string;
    role: string;
  };
  team: { id: string; name: string; url: string };
}

/** Returns the signed-in user and their workspace. */
export function getAuthInfo(server: string, token: string): Promise<AuthInfo> {
  return apiRequest<AuthInfo>(server, token, "auth.info");
}
