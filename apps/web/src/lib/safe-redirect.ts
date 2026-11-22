export const DEFAULT_AFTER_LOGIN_PATH = "/dashboard";

/** Pages that must never be a post-login destination (would loop or be pointless). */
const AUTH_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/accept-invitation",
];

/**
 * Returns `next` only when it is a same-origin relative path; otherwise `fallback`.
 * Guards against open redirects ("//evil.com", "/\evil.com", "https://evil.com",
 * "javascript:..."): the value must start with a single "/" and still resolve to the
 * same origin when parsed against a base URL.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_AFTER_LOGIN_PATH,
): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  // Backslashes and control characters are normalised by browsers into other forms.
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/.test(next)) return fallback;

  const base = "http://relative.invalid";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  // Dot-segment normalisation (also for "%2e%2e") can turn "/..//evil.example" into
  // "//evil.example", a protocol-relative URL that router.replace() treats as external.
  // The returned value is built from the PARSED result, so check it, not the raw input.
  if (!url.pathname.startsWith("/") || url.pathname.startsWith("//")) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;
  const isAuthPath = AUTH_PATH_PREFIXES.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
  );
  return isAuthPath ? fallback : path;
}

/** Builds `/login?next=<encoded path>` for the unauthenticated redirect. */
export function loginUrlWithNext(intendedPath: string): string {
  const safe = safeNextPath(intendedPath, "");
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}
