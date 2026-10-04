import * as Crypto from "expo-crypto";

/** Encodes base64 as base64url without padding (RFC 7636). */
function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Returns `byteCount` cryptographically random bytes as a base64url string. */
export function randomBase64Url(byteCount: number): string {
  let binary = "";
  Crypto.getRandomBytes(byteCount).forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return toBase64Url(btoa(binary));
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Creates a PKCE verifier and its S256 challenge. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomBase64Url(32);
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  return { verifier, challenge: toBase64Url(digest) };
}
