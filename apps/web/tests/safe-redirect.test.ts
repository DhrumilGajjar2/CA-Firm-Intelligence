import { describe, expect, it } from "vitest";
import { loginUrlWithNext, safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath (open-redirect guard)", () => {
  it("accepts same-origin relative paths, keeping query and hash", () => {
    expect(safeNextPath("/clients")).toBe("/clients");
    expect(safeNextPath("/engagements?status=open#top")).toBe(
      "/engagements?status=open#top",
    );
  });

  it("falls back to the dashboard when missing", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
  });

  it.each([
    "https://evil.example",
    "http://evil.example/dashboard",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "dashboard",
    "/ok\nnext",
    "/ok\r\n//evil",
    " /dashboard",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("does not bounce back into auth pages", () => {
    expect(safeNextPath("/login")).toBe("/dashboard");
    expect(safeNextPath("/register?x=1")).toBe("/dashboard");
    expect(safeNextPath("/reset-password?token=abc")).toBe("/dashboard");
  });

  it("supports a custom fallback", () => {
    expect(safeNextPath("//evil.example", "/home")).toBe("/home");
  });
});

describe("loginUrlWithNext", () => {
  it("preserves the intended path, encoded", () => {
    expect(loginUrlWithNext("/clients?page=2")).toBe(
      `/login?next=${encodeURIComponent("/clients?page=2")}`,
    );
  });

  it("omits next for unsafe or auth paths", () => {
    expect(loginUrlWithNext("//evil.example")).toBe("/login");
    expect(loginUrlWithNext("/login")).toBe("/login");
  });
});

describe("safeNextPath: additional open-redirect vectors", () => {
  it.each([
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\u0000/evil.example",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "JaVaScRiPt:alert(1)",
    "  //evil.example",
    "\\/evil.example",
    "/\\/evil.example",
    "ftp://evil.example",
    "mailto:a@evil.example",
    "http:evil.example",
    "https:\\\\evil.example",
    "//evil.example/%2e%2e/",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("treats percent-encoded slashes and @ as plain same-origin path text", () => {
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
    expect(safeNextPath("/@evil.example")).toBe("/@evil.example");
    expect(safeNextPath("/clients/../engagements")).toBe("/engagements");
  });

  it("falls back for non-string input", () => {
    expect(safeNextPath(123 as unknown as string)).toBe("/dashboard");
    expect(safeNextPath({} as unknown as string)).toBe("/dashboard");
  });

  // P1-001: dot-segment normalisation turns "/..//evil.example" into the protocol-relative URL
  // "//evil.example", which router.replace() treats as an EXTERNAL navigation.
  it.each([
    "/..//evil.example",
    "/.//evil.example",
    "/a/..//evil.example",
    "/%2e%2e//evil.example",
    "/%2E%2E//evil.example",
    "/./..//evil.example",
  ])("P1-001: %j must never resolve to a protocol-relative or absolute URL", (value) => {
    const result = safeNextPath(value);
    expect(result.startsWith("//")).toBe(false);
    expect(result.startsWith("/")).toBe(true);
    expect(result).not.toMatch(/^\/[\/]/);
    expect(result).not.toContain("evil");
  });

  it("every returned value is a single-slash, same-origin path (property check over a vector list)", () => {
    const vectors = [
      "/",
      "/dashboard",
      "/clients?x=//evil.example",
      "/clients#//evil.example",
      "/a//b",
      "/%2F/",
      "//",
      "///",
      "/\\",
      "https://evil.example",
    ];
    for (const v of vectors) {
      const out = safeNextPath(v);
      expect(out.startsWith("/"), v).toBe(true);
      expect(out.startsWith("//"), v).toBe(false);
      expect(new URL(out, "http://app.invalid").origin, v).toBe("http://app.invalid");
    }
  });
});

describe("loginUrlWithNext: additional cases", () => {
  it("never produces a next that points off-site", () => {
    for (const v of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      expect(loginUrlWithNext(v)).toBe("/login");
    }
  });

  it("keeps query and hash of the intended page, encoded", () => {
    const url = loginUrlWithNext("/engagements?status=open&q=a b#top");
    const next = new URL(url, "http://app.invalid").searchParams.get("next");
    expect(next).toBe("/engagements?status=open&q=a%20b#top");
  });
});
