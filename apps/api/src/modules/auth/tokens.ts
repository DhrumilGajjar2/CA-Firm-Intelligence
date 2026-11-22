import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url. Only the SHA-256 hash is ever stored. */
export function generateToken(): { token: string; token_hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, token_hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
