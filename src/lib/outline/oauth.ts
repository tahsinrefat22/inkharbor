import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { normalizeServerUrl } from "./api";
import { createPkcePair, randomBase64Url } from "./pkce";

// OAuth 2.0 + PKCE login against Outline as a public client (no secret),
// following RFC 8252 for native apps:
//
// 1. Discover the server's endpoints.
// 2. Register the app with dynamic client registration, using the app's own
//    URL (inkharbor://oauth) as the redirect URI. Outline accepts custom
//    schemes from outline/outline#13945 onwards; older servers reject them,
//    so then fall back to an HTTPS relay page (EXPO_PUBLIC_OAUTH_RELAY_URL)
//    that forwards the code to the app.
// 3. Authorize in the system browser, then exchange the code with the PKCE
//    verifier.

/** The URL the browser hands the code back to: inkharbor://oauth in builds. */
export const appReturnUrl = Linking.createURL("oauth");

const relayUrl = process.env.EXPO_PUBLIC_OAUTH_RELAY_URL;

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface SignInResult extends Tokens {
  server: string;
  clientId: string;
  redirectUri: string;
  tokenEndpoint: string;
}

/** Builds a query string. React Native's URLSearchParams is incomplete. */
function toQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

/** Thrown for login problems that should be shown to the user as-is. */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

async function discover(server: string): Promise<Discovery> {
  const res = await fetch(`${server}/.well-known/oauth-authorization-server`);
  if (!res.ok) {
    throw new SignInError(
      `Couldn't reach an Outline server at ${server} (HTTP ${res.status}).`,
    );
  }
  return res.json();
}

/** Registers a public client for the redirect URI, or returns null if rejected. */
async function registerClient(
  discovery: Discovery,
  redirectUri: string,
): Promise<string | null> {
  if (!discovery.registration_endpoint) {
    throw new SignInError(
      "This server doesn't allow apps to register themselves. Ask an admin to enable it.",
    );
  }
  const res = await fetch(discovery.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Inkharbor",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });
  if (res.status === 400) {
    return null;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.client_id) {
    throw new SignInError(
      res.status === 429
        ? "Too many sign-in attempts. Please wait a while and try again."
        : `Couldn't register the app with the server (HTTP ${res.status}).`,
    );
  }
  return body.client_id;
}

async function postToken(
  tokenEndpoint: string,
  params: Record<string, string>,
): Promise<Tokens> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toQuery(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new SignInError(
      body.error_description ?? `Token request failed (HTTP ${res.status}).`,
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  };
}

/**
 * Signs in to an Outline server in the system browser.
 *
 * @returns the tokens and client details, or null if the user cancelled.
 */
export async function signIn(serverInput: string): Promise<SignInResult | null> {
  const server = normalizeServerUrl(serverInput);
  const discovery = await discover(server);

  let redirectUri = appReturnUrl;
  let clientId = await registerClient(discovery, redirectUri);
  if (!clientId && relayUrl) {
    redirectUri = relayUrl;
    clientId = await registerClient(discovery, redirectUri);
  }
  if (!clientId) {
    throw new SignInError(
      "This Outline server doesn't accept app sign-ins yet. It needs a newer Outline version, or a relay page (see the README).",
    );
  }

  const pkce = await createPkcePair();
  const state = randomBase64Url(16);
  const authUrl = `${discovery.authorization_endpoint}?${toQuery({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "read write",
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  })}`;

  // createTask: false keeps the browser in the app's task, so Android can't
  // resurface a stale tab from an earlier sign-in.
  const result = await WebBrowser.openAuthSessionAsync(authUrl, appReturnUrl, {
    createTask: false,
  });
  if (result.type !== "success") {
    return null;
  }

  const params = Linking.parse(result.url).queryParams ?? {};
  if (params.error) {
    throw new SignInError(`The server refused the sign-in: ${params.error}.`);
  }
  if (params.state !== state || typeof params.code !== "string") {
    throw new SignInError("The sign-in response didn't match. Please try again.");
  }

  const tokens = await postToken(discovery.token_endpoint, {
    grant_type: "authorization_code",
    code: params.code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: pkce.verifier,
  });
  return {
    ...tokens,
    server,
    clientId,
    redirectUri,
    tokenEndpoint: discovery.token_endpoint,
  };
}

/** Exchanges a refresh token for new tokens. Outline rotates refresh tokens. */
export function refreshTokens(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string,
): Promise<Tokens> {
  return postToken(tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
}
