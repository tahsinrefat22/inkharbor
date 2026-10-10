/** An error response from the Outline API. */
export class OutlineApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OutlineApiError";
  }

  /** True when the token is missing, invalid, revoked or expired. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Removes trailing slashes so URLs can be joined safely. */
export function normalizeServerUrl(server: string): string {
  return server.trim().replace(/\/+$/, "");
}

/**
 * Calls an Outline API method. Outline's API is RPC style: every method is a
 * POST to /api/<method> with a JSON body.
 */
export async function apiRequest<T>(
  server: string,
  token: string,
  method: string,
  body: object = {},
): Promise<T> {
  const res = await fetch(`${normalizeServerUrl(server)}/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new OutlineApiError(res.status, json.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
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
