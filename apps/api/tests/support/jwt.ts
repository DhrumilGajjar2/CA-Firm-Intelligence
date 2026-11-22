import { createHmac } from "node:crypto";

/**
 * Hand-rolled JWT builder for adversarial tests. It lets a test control every part of the token
 * (algorithm header, payload, secret, signature) which the app's own signer would not allow.
 */
const b64 = (v: unknown) =>
  Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

export function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
): string {
  const head = b64(header);
  const body = b64(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** Unsigned token with an arbitrary `alg` header and an empty signature segment. */
export function unsignedJwt(
  payload: Record<string, unknown>,
  alg: string,
  signature = "",
): string {
  return `${b64({ alg, typ: "JWT" })}.${b64(payload)}.${signature}`;
}

/** Replaces the payload of an existing token and keeps the ORIGINAL signature. */
export function withPayload(token: string, payload: Record<string, unknown>): string {
  const [head, , sig] = token.split(".");
  return `${head}.${b64(payload)}.${sig}`;
}

export function payloadOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
}

/** Flips the first character of the signature segment (a real change, not padding bits). */
export function tamperSignature(token: string): string {
  const [head, body, sig] = token.split(".");
  const first = sig![0] === "A" ? "B" : "A";
  return `${head}.${body}.${first}${sig!.slice(1)}`;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
