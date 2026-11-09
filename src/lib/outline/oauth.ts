import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

import { normalizeServerUrl, OutlineApiError, readOutlineJson } from "./api";
import { createPkcePair, randomBase64Url } from "./pkce";
import { headersFor, hostOf, originOf, parseServerAddress, sameOrigin, serverHeadersReady } from "./server-access";

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
//
// Registrations are remembered per server: Outline allows only five per hour,
// and against older servers each attempt would otherwise cost two.
//
// Every request here goes to the server the user entered and nowhere else:
// redirects aren't followed, so a code, verifier or refresh token can't be
// sent on to another host, and the discovered endpoints must be on that server.

/** The URL the browser hands the code back to: inkharbor://oauth in builds. */
export const appReturnUrl = Linking.createURL("oauth");

const relayUrl = process.env.EXPO_PUBLIC_OAUTH_RELAY_URL;

const CLIENTS_KEY = "oauth_clients";

interface RegisteredClient {
  clientId: string;
  redirectUri: string;
}

async function loadClients(): Promise<Record<string, RegisteredClient>> {
  const raw = await SecureStore.getItemAsync(CLIENTS_KEY);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function saveClient(server: string, client: RegisteredClient): Promise<void> {
  const clients = await loadClients();
  clients[server] = client;
  await SecureStore.setItemAsync(CLIENTS_KEY, JSON.stringify(clients));
}

/** Forgets a server's registration, e.g. after an admin deleted the app. */
export async function forgetClient(server: string): Promise<void> {
  const clients = await loadClients();
  delete clients[normalizeServerUrl(server)];
  await SecureStore.setItemAsync(CLIENTS_KEY, JSON.stringify(clients));
}

/**
 * Returns this app's client for the server, registering it the first time:
 * with the app's own URL if the server accepts it, otherwise the relay.
 */
async function getClient(server: string, discovery: Discovery): Promise<RegisteredClient> {
  const known = (await loadClients())[server];
  // A relay registration is only reusable while a relay is still configured.
  if (known && (known.redirectUri === appReturnUrl || known.redirectUri === relayUrl)) {
    return known;
  }

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
  const client = { clientId, redirectUri };
  await saveClient(server, client);
  return client;
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
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

/** A request to one of the server's OAuth endpoints, with its extra headers and without following redirects. */
async function oauthFetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  await serverHeadersReady;
  return fetch(url, { ...init, redirect: "manual", headers: { ...headersFor(url), ...init.headers } });
}

async function discover(server: string): Promise<Discovery> {
  const res = await oauthFetch(`${server}/.well-known/oauth-authorization-server`);
  const answer = await readOutlineJson(res);
  if ("problem" in answer) {
    throw new SignInError(answer.problem);
  }
  if (!res.ok) {
    throw new SignInError(
      `Couldn't reach an Outline server at ${server} (HTTP ${res.status}).`,
    );
  }
  return checkDiscovery(server, answer.json);
}

/**
 * Checks the server's OAuth details (RFC 8414): it must name itself as the
 * address the user entered, and every endpoint must be on that address. Else a
 * server could send the browser to another server's login and have the code
 * for it posted back to itself.
 */
function checkDiscovery(server: string, json: Record<string, unknown>): Discovery {
  const issuer = typeof json.issuer === "string" ? json.issuer.replace(/\/+$/, "") : "";
  if (!issuer) {
    throw new SignInError(`${hostOf(server)} doesn't look like an Outline server. Check the address.`);
  }
  // An issuer is a bare origin; a path or another host isn't the server entered.
  const issuerOrigin = originOf(issuer);
  if (issuerOrigin !== server || issuer.length !== issuerOrigin.length) {
    throw new SignInError(
      issuerOrigin && issuer.length === issuerOrigin.length
        ? `This server's address is ${issuer}. Enter that address instead.`
        : `The server describes itself as ${issuer}, which isn't the address you entered. Ask an admin to check its URL setting.`,
    );
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
    const endpoint = json[key];
    const required = key === "authorization_endpoint" || key === "token_endpoint";
    if (endpoint === undefined && !required) {
      continue;
    }
    if (typeof endpoint !== "string" || !sameOrigin(endpoint, server)) {
      throw new SignInError(
        `The server's sign-in settings point to ${typeof endpoint === "string" ? hostOf(endpoint) : "nowhere"} instead of ${hostOf(server)}, so Inkharbor stopped. Ask an admin to check the server's URL setting.`,
      );
    }
  }
  return json as unknown as Discovery;
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
  const res = await oauthFetch(discovery.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Inkharbor",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
    }),
  });
  const answer = await readOutlineJson(res);
  if ("problem" in answer) {
    throw new SignInError(answer.problem);
  }
  if (res.status === 400) {
    return null;
  }
  const body = answer.json;
  if (!res.ok || typeof body.client_id !== "string") {
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
  const res = await oauthFetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toQuery(params),
  });
  // Only a real refusal from Outline means the authorization is gone. Server
  // errors and proxy pages are temporary: report them as such, so a brief
  // outage or a proxy asking for a login never signs the user out or wipes
  // their saved copies.
  const answer = await readOutlineJson(res);
  if ("problem" in answer) {
    throw new OutlineApiError(res.status, answer.problem, true);
  }
  const body = answer.json;
  if (res.status === 400 || res.status === 401) {
    throw new SignInError(
      typeof body.error_description === "string" ? body.error_description : "The server refused the authorization.",
    );
  }
  if (!res.ok || typeof body.access_token !== "string" || typeof body.refresh_token !== "string") {
    throw new OutlineApiError(res.status, `Token request failed (HTTP ${res.status}).`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (typeof body.expires_in === "number" ? body.expires_in : 3600) * 1000,
  };
}

/**
 * Signs in to an Outline server in the system browser.
 *
 * @returns the tokens and client details, or null if the user cancelled.
 */
export async function signIn(serverInput: string): Promise<SignInResult | null> {
  const address = parseServerAddress(serverInput);
  if ("error" in address) {
    throw new SignInError(address.error);
  }
  const { server } = address;
  const discovery = await discover(server);

  const { clientId, redirectUri } = await getClient(server, discovery);

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

/**
 * Revokes the app's authorization on the server (RFC 7009). Revoking the
 * refresh token deletes the whole grant, access token included. Best effort:
 * if it fails, the grant still expires on the server after 30 days unused.
 */
export async function revokeTokens(server: string, refreshToken: string): Promise<void> {
  try {
    await oauthFetch(`${normalizeServerUrl(server)}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: toQuery({ token: refreshToken, token_type_hint: "refresh_token" }),
    });
  } catch {
    // Offline or unreachable: disconnecting locally still proceeds.
  }
}
