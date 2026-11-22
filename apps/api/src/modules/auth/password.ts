import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing with Argon2id (@node-rs/argon2: ships prebuilt binaries for Windows, macOS and Linux,
 * so no compiler toolchain is needed). Parameters follow the OWASP minimum for Argon2id
 * (19 MiB memory, 2 iterations, 1 lane). The algorithm default of @node-rs/argon2 is Argon2id.
 * The salt is random and embedded in the encoded hash string.
 */
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed stored hash must never become a 500 or a bypass.
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Verify against a throwaway hash so that logging in as an unknown user costs about the same as a
 * wrong password for a known one (no user enumeration through timing).
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  await verifyPassword(await dummyHash, password);
  return false;
}
