import { describe, expect, it } from "vitest";
import { loginUrlWithNext, safeNextPath } from "@/lib/safe-redirect";

/**
 * QA re-verification of P1-001 (open redirect through dot-segment normalisation) with variants of
 * QA's own. Contract: the result is ALWAYS either the fallback or a path with exactly one leading
 * slash that cannot be read as another origin once handed to router.replace().
 */
const FALLBACK = "/dashboard";
const HOST = "http://app.invalid";

function assertSafe(input: string, out: string) {
  expect(out.startsWith("/"), `${JSON.stringify(input)} -> ${out}`).toBe(true);
  expect(out.startsWith("//"), `${JSON.stringify(input)} -> ${out}`).toBe(false);
  expect(out.includes("\\"), `${JSON.stringify(input)} -> ${out}`).toBe(false);
  expect(out, `${JSON.stringify(input)} -> ${out}`).not.toMatch(/[\u0000-\u001f\u007f]/);
  expect(new URL(out, HOST).origin, `${JSON.stringify(input)} -> ${out}`).toBe(HOST);
}

describe("P1-001: dot-segment and encoding variants never produce a protocol-relative URL", () => {
  it.each([
    "/..//evil.example",
    "/.//evil.example",
    "/a/../..//evil.example",
    "/a/..//evil.example",
    "/a/b/../..//evil.example",
    "/./..//evil.example",
    "/../..//evil.example",
    "/../../../..//evil.example",
    "/%2e/%2e//evil.example",
    "/%2E/%2E//evil.example",
    "/%2e%2e//evil.example",
    "/%2E%2E//evil.example",
    "/%2e%2E//evil.example",
    "/%2E%2e//evil.example",
    "/.%2e//evil.example",
    "/%2e.//evil.example",
    "/.%2E//evil.example",
    "/%2e%2e/%2e%2e//evil.example",
    "/a/%2e%2e//evil.example",
    "/a/%2e%2e/%2e%2e//evil.example",
    "/..///evil.example",
    "/.///evil.example",
    "/..////evil.example",
    "/a/..///evil.example/x",
    "/..//evil.example?x=1",
    "/..//evil.example#frag",
    "/..//evil.example/../x",
    "/clients/..//evil.example/dashboard",
    "/a/./..//evil.example",
    "/a/././..//evil.example",
    "/%2e//evil.example",
    "/.%2e/.//evil.example",
  ])("%s", (value) => {
    const out = safeNextPath(value);
    assertSafe(value, out);
    expect(out).not.toContain("evil.example");
  });

  it.each([
    "/..;/",
    "/..;//evil.example",
    "/a/..;/..//evil.example",
    "/%2e%2e;//evil.example",
    "/a/%2e%2e%2f/evil.example", // encoded slash stays data
    "/...//evil.example",
    "/....//evil.example",
    "/.../evil.example",
    "/..%00//evil.example",
    "/..%0d%0a//evil.example",
    "/..%09//evil.example",
    "/%2e%2e%5c%5cevil.example",
    "/%2e%2e/%5cevil.example",
    "/%5c%5cevil.example",
    "/%2f%2fevil.example",
    "/%2F/evil.example",
    "/%252e%252e//evil.example",
    "/..%252f/evil.example",
    "/@evil.example",
    "/:@evil.example",
    "/a@evil.example//",
    "/?//evil.example",
    "/#//evil.example",
    "/x?next=//evil.example",
    "/x#next=//evil.example",
  ])("odd but same-origin path %s stays on this origin", (value) => {
    assertSafe(value, safeNextPath(value));
  });

  it.each([
    "/dashboard\t",
    "/dashboard\n",
    "/dashboard\r",
    "/dashboard \u0000",
    "\t/dashboard",
    "\n//evil.example",
    "/\t/evil.example",
    "/.\t./evil.example",
    "/.\t.//evil.example",
    "/..\n//evil.example",
    "/..\r\n//evil.example",
    "/\u0001/evil.example",
    "/\u001f/evil.example",
    "/\u007f/evil.example",
    "/..\u007f//evil.example",
  ])("control characters are rejected outright: %j", (value) => {
    expect(safeNextPath(value)).toBe(FALLBACK);
  });

  it.each([
    "/\\evil.example",
    "/\\\\evil.example",
    "/..\\evil.example",
    "/..\\/evil.example",
    "/.\\.\\//evil.example",
    "\\/evil.example",
  ])("backslash forms are rejected outright: %j", (value) => {
    expect(safeNextPath(value)).toBe(FALLBACK);
  });

  it.each([
    "//evil.example",
    "///evil.example",
    "////evil.example",
    "/ /evil.example",
    "/ /evil.example",
    "/ /evil.example",
    "/　/evil.example",
    "/​/evil.example",
    "/／/evil.example",
    "/∕/evil.example",
    "/﹨/evil.example",
    "／／evil.example",
    "⁄⁄evil.example",
  ])("lookalike slashes and unicode whitespace never leave the origin: %j", (value) => {
    const out = safeNextPath(value);
    if (out !== FALLBACK) assertSafe(value, out);
    else expect(out).toBe(FALLBACK);
  });

  it("a path that normalises to the root is a plain same-origin '/'", () => {
    for (const value of ["/..", "/../..", "/a/..", "/%2e%2e", "/./", "/a/../"]) {
      const out = safeNextPath(value);
      assertSafe(value, out);
      expect(out).toBe("/");
    }
  });

  it("known-good targets are preserved exactly (no over-blocking)", () => {
    expect(safeNextPath("/clients")).toBe("/clients");
    expect(safeNextPath("/clients/abc?page=2&q=x#top")).toBe("/clients/abc?page=2&q=x#top");
    expect(safeNextPath("/a/../clients")).toBe("/clients");
    expect(safeNextPath("/a//b")).toBe("/a//b");
    expect(safeNextPath("/settings")).toBe("/settings");
    expect(safeNextPath("/onboarding")).toBe("/onboarding");
  });

  it("auth pages are still never a destination, also after normalisation", () => {
    for (const value of [
      "/login",
      "/a/../login",
      "/%2e%2e/login",
      "/login/",
      "/login?x=1",
      "/reset-password?token=t",
      "/accept-invitation?token=t",
      "/./register",
    ]) {
      expect(safeNextPath(value), value).toBe(FALLBACK);
    }
  });

  it("loginUrlWithNext applies the same rules to every variant", () => {
    for (const value of ["/..//evil.example", "/%2e/%2e//evil.example", "/a/../..//x"]) {
      expect(loginUrlWithNext(value), value).toBe("/login");
    }
  });

  it("property check: 6000 pseudo-random dot/slash/encoding combinations are always safe", () => {
    // Small deterministic LCG so a failure is reproducible.
    let seed = 20261121;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % n;
    };
    const tokens = [
      "/",
      "/",
      "/",
      ".",
      "..",
      "%2e",
      "%2E",
      "%2e%2e",
      ".%2e",
      "%2e.",
      ";",
      "a",
      "evil.example",
      "\\",
      "%5c",
      "%2f",
      "%252e",
      "\t",
      "%09",
      "@",
      ":",
      "?",
      "#",
      " ",
      " ",
    ];
    for (let i = 0; i < 6000; i++) {
      const parts = ["/"];
      for (let j = 0, n = 1 + rnd(9); j < n; j++) parts.push(tokens[rnd(tokens.length)]!);
      const input = parts.join("");
      const out = safeNextPath(input);
      if (out !== FALLBACK) assertSafe(input, out);
    }
  });
});
