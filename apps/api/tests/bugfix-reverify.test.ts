import { listUsersQuerySchema } from "@ca-firm/validation";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  hasTestDb,
  makeTestApp,
  registerOwner,
  resetDb,
  TEST_JWT_SECRET,
  type TestApp,
} from "./db-helpers.js";
import { call, FIRM, ME, SETTINGS } from "./support/firms.js";
import { nowSeconds, signJwt } from "./support/jwt.js";

/**
 * QA re-verification of P1-002 (array-typed JWT claims) and P1-003 (control characters), with extra
 * variants of QA's own. Everything here must answer a clean 4xx, never a 5xx.
 */

const codes = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const label = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
const errFields = (res: { json: () => { errors?: { field?: string }[] } }) =>
  (res.json().errors ?? []).map((e) => e.field);

/** C0 (U+0000-U+001F), DEL and C1 (U+007F-U+009F). */
const CONTROL = [...codes(0, 0x1f), ...codes(0x7f, 0x9f)];
/** Whitespace control characters that `trim()` strips at the ends of a value. */
const TRIMMED_AT_ENDS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d]);
/** Allowed inside a multi-line address. */
const ADDRESS_OK = new Set([0x09, 0x0a, 0x0d]);

describe.skipIf(!hasTestDb)("P1-002 re-verification: malformed JWT claims", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
  });

  async function victim() {
    const owner = await registerOwner(t, { firm_name: "Claims Firm" });
    const claims = { sub: owner.user.id, firm_id: owner.user.firm.id, role: "owner" };
    return { owner, claims, exp: nowSeconds() + 600 };
  }
  const withToken = (token: string) => `access_token=${token}`;
  const sign = (payload: Record<string, unknown>) => signJwt(payload, TEST_JWT_SECRET);

  const badIdValues = (uuid: string): [string, unknown][] => [
    ["array with the uuid", [uuid]],
    ["nested array", [[uuid]]],
    ["array with the uuid twice", [uuid, uuid]],
    ["empty array", []],
    ["object", { id: uuid }],
    ["object with toString", { toString: uuid }],
    ["number", 123],
    ["boolean", true],
    ["null", null],
    ["empty string", ""],
    ["uuid + newline", `${uuid}\n`],
    ["uuid + NUL", `${uuid}\u0000`],
    ["uuid with spaces", ` ${uuid} `],
    ["uuid without dashes", uuid.replace(/-/g, "")],
    ["uuid in braces", `{${uuid}}`],
  ];

  it.each(["sub", "firm_id"] as const)(
    "%s of the wrong type or shape = 401 on /auth/me, GET and PATCH /firms/current (never 500)",
    async (claim) => {
      const { owner, claims, exp } = await victim();
      const uuid = claims[claim];
      for (const [kind, value] of badIdValues(uuid)) {
        const cookie = withToken(sign({ ...claims, exp, [claim]: value }));
        for (const [method, url, body] of [
          ["GET", ME, undefined],
          ["GET", FIRM, undefined],
          ["GET", SETTINGS, undefined],
          ["PATCH", FIRM, { name: "Hijacked" }],
          ["PATCH", SETTINGS, { financial_year_start_month: 1 }],
        ] as const) {
          const res = await call(t, method, url, cookie, body);
          expect(res.statusCode, `${claim} ${kind} ${method} ${url}`).toBe(401);
          expect(res.json()).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
        }
      }
      // None of the rejected PATCHes changed anything.
      const row = await t.prisma.firm.findUniqueOrThrow({ where: { id: owner.user.firm.id } });
      expect(row.name).toBe("Claims Firm");
      expect(row.settings).toMatchObject({ financial_year_start_month: 4 });
    },
  );

  it("a missing sub or firm_id claim = 401", async () => {
    const { claims, exp } = await victim();
    for (const drop of ["sub", "firm_id"] as const) {
      const { [drop]: _removed, ...rest } = claims;
      const res = await call(t, "GET", FIRM, withToken(sign({ ...rest, exp })));
      expect(res.statusCode, `without ${drop}`).toBe(401);
    }
  });

  it("the role claim is ignored whatever its type: the DATABASE role decides", async () => {
    const { owner, claims, exp } = await victim();
    const roleClaims: unknown[] = [
      ["owner"],
      { role: "owner" },
      7,
      null,
      true,
      "superadmin",
      "OWNER",
      "",
      "x".repeat(5000),
    ];
    // An owner stays owner and is never confused by a strange claim.
    for (const role of roleClaims) {
      const res = await call(t, "GET", FIRM, withToken(sign({ ...claims, exp, role })));
      expect(res.statusCode, `owner with role claim ${JSON.stringify(role)?.slice(0, 20)}`).toBe(200);
    }
    // A viewer can never become an owner through the claim.
    const viewer = await t.prisma.user.create({
      data: {
        email: "viewer-claims@example.com",
        name: "Viewer",
        password_hash: "x",
        memberships: { create: { firm_id: owner.user.firm.id, role: "viewer" } },
      },
    });
    for (const role of ["owner", ["owner"], { role: "owner" }, 1]) {
      const cookie = withToken(
        sign({ sub: viewer.id, firm_id: owner.user.firm.id, role, exp }),
      );
      expect((await call(t, "GET", FIRM, cookie)).statusCode).toBe(200);
      const patch = await call(t, "PATCH", FIRM, cookie, { name: "Viewer coup" });
      expect(patch.statusCode, `viewer claiming ${JSON.stringify(role)}`).toBe(403);
      const settings = await call(t, "PATCH", SETTINGS, cookie, {
        onboarding_completed: true,
      });
      expect(settings.statusCode).toBe(403);
    }
    const row = await t.prisma.firm.findUniqueOrThrow({ where: { id: owner.user.firm.id } });
    expect(row.name).toBe("Claims Firm");
  });

  it("malformed time claims (exp, nbf) are 401, never 500", async () => {
    const { claims, exp } = await victim();
    for (const extra of [
      { exp: "9999999999" },
      { exp: [exp] },
      { exp: { a: 1 } },
      { exp: null },
      { exp, nbf: "0" },
      { exp, nbf: [0] },
      { exp: -1 },
    ]) {
      const res = await call(t, "GET", FIRM, withToken(sign({ ...claims, ...extra })));
      expect(res.statusCode, JSON.stringify(extra)).toBe(401);
    }
  });

  it("extra unknown claims do not matter", async () => {
    const { claims, exp } = await victim();
    const res = await call(
      t,
      "GET",
      FIRM,
      withToken(sign({ ...claims, exp, admin: true, firm_ids: ["a", "b"], is_superuser: 1 })),
    );
    expect(res.statusCode).toBe(200);
  });
});

describe.skipIf(!hasTestDb)("P1-003 re-verification: control characters over HTTP", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
  });

  const valid = {
    name: "Asha Rao",
    email: "asha@example.com",
    password: "Sample-pass-1",
    firm_name: "Demo CA",
  };
  const register = (payload: Record<string, unknown>) =>
    call(t, "POST", "/api/v1/auth/register", undefined, payload);

  it("register: every C0, DEL and C1 control character inside name or firm_name = 400 with a field error", async () => {
    for (const field of ["name", "firm_name"] as const) {
      for (const cp of CONTROL) {
        const ch = String.fromCodePoint(cp);
        const res = await register({ ...valid, [field]: `ab${ch}cd` });
        expect(res.statusCode, `${field} ${label(cp)}`).toBe(400);
        expect(res.json().code, `${field} ${label(cp)}`).toBe("VALIDATION_ERROR");
        expect(errFields(res), `${field} ${label(cp)}`).toContain(field);
      }
    }
    expect(await t.prisma.user.count()).toBe(0);
    expect(await t.prisma.firm.count()).toBe(0);
  }, 60_000);

  it("register: control characters at the start or end are rejected too, unless trim() removes them", async () => {
    for (const cp of CONTROL) {
      const ch = String.fromCodePoint(cp);
      for (const [i, name] of [`${ch}Asha`, `Asha${ch}`, ch].entries()) {
        const res = await register({ ...valid, email: `u${cp}-${i}@example.com`, name });
        if (TRIMMED_AT_ENDS.has(cp) && name !== ch) {
          // Leading/trailing whitespace is trimmed: stored without the control character.
          expect(res.statusCode, `${label(cp)} ${JSON.stringify(name)}`).toBe(201);
          expect(res.json().data.name).toBe("Asha");
        } else {
          expect(res.statusCode, `${label(cp)} ${JSON.stringify(name)}`).toBe(400);
        }
      }
    }
    // Nothing stored contains a control character.
    const users = await t.prisma.user.findMany({ select: { name: true } });
    for (const u of users) expect(u.name).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
  }, 120_000);

  it("PATCH /firms/current name: all control characters = 400, firm unchanged", async () => {
    const owner = await registerOwner(t, { firm_name: "Untouched" });
    for (const cp of CONTROL) {
      const res = await call(t, "PATCH", FIRM, owner.cookie, {
        name: `a${String.fromCodePoint(cp)}b`,
      });
      expect(res.statusCode, label(cp)).toBe(400);
      expect(errFields(res), label(cp)).toContain("name");
    }
    const row = await t.prisma.firm.findFirstOrThrow();
    expect(row.name).toBe("Untouched");
  }, 60_000);

  it("PATCH /firms/current address: tab, LF and CR are allowed, every other control character = 400", async () => {
    const owner = await registerOwner(t);
    for (const cp of CONTROL) {
      const address = `line1${String.fromCodePoint(cp)}line2`;
      const res = await call(t, "PATCH", FIRM, owner.cookie, { address });
      if (ADDRESS_OK.has(cp)) {
        expect(res.statusCode, label(cp)).toBe(200);
        expect(res.json().data.address, label(cp)).toBe(address);
      } else {
        expect(res.statusCode, label(cp)).toBe(400);
        expect(errFields(res), label(cp)).toContain("address");
      }
    }
  }, 60_000);

  it("other firm text fields with control characters (email, phone, timezone) = 400, never 500", async () => {
    const owner = await registerOwner(t);
    for (const payload of [
      { email: "a\u0000@example.com" },
      { email: "a@exam\u0000ple.com" },
      { phone: "98765\u000043210" },
      { phone: "98765\u000743210" },
      { timezone: "Asia/Kol\u0000kata" },
      { timezone: "UTC\u000b" },
    ]) {
      const res = await call(t, "PATCH", FIRM, owner.cookie, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("exotic but legal Unicode never causes a 500 and is stored without corruption", async () => {
    const owner = await registerOwner(t);
    const samples = [
      "line sep",
      "para sep",
      "bom﻿inside",
      "zero​width‍",
      "rtl ‮evil‬",
      "nbsp inside",
      "noncharacter￾",
      "privateuse",
      "astral \u{1F600} \u{10FFFF}",
      "combining é",
      "lone high \ud800 surrogate",
      "lone low \udc00 surrogate",
      "reversed \udc00\ud800 pair",
      "trailing lone \ud83d",
    ];
    for (const sample of samples) {
      for (const [url, field] of [
        [FIRM, "name"],
        [FIRM, "address"],
      ] as const) {
        const res = await call(t, "PATCH", url, owner.cookie, { [field]: sample });
        expect(res.statusCode, `${field} ${JSON.stringify(sample)}`).toBeLessThan(500);
        if (res.statusCode === 200) {
          const stored = (await t.prisma.firm.findUniqueOrThrow({ where: { id: owner.user.firm.id } }))[field];
          // What the API returned is exactly what the database holds, and it has no NUL.
          expect(stored, `${field} ${JSON.stringify(sample)}`).toBe(res.json().data[field]);
          expect(stored).not.toContain("\u0000");
        }
      }
      const reg = await register({
        ...valid,
        email: `u${Math.abs(hash(sample))}@example.com`,
        name: sample,
        firm_name: sample,
      });
      expect(reg.statusCode, `register ${JSON.stringify(sample)}`).toBeLessThan(500);
    }
  }, 60_000);

  it("NUL and control characters in the other auth text inputs never cause a 500", async () => {
    const owner = await registerOwner(t, { email: "known@example.com" });
    const cases: [string, string, Record<string, unknown>][] = [
      ["POST", "/api/v1/auth/login", { email: "known\u0000@example.com", password: "x" }],
      ["POST", "/api/v1/auth/login", { email: "known@example.com", password: "p\u0000w" }],
      ["POST", "/api/v1/auth/login", { email: "known@example.com", password: "\u0000" }],
      ["POST", "/api/v1/auth/forgot-password", { email: "known\u0000@example.com" }],
      ["POST", "/api/v1/auth/forgot-password", { email: "kn\u0007own@example.com" }],
      ["POST", "/api/v1/auth/reset-password", { token: "ab\u0000cd", password: "Sample-pass-2" }],
      ["POST", "/api/v1/auth/reset-password", { token: "abcd", password: "Sample\u0000pass-2" }],
      ["POST", "/api/v1/auth/register", { ...valid, email: "a\u0000b@example.com" }],
      ["POST", "/api/v1/auth/register", { ...valid, password: "Sample\u0000pass-1" }],
    ];
    for (const [method, url, payload] of cases) {
      const res = await call(t, method as "POST", url, undefined, payload);
      expect(res.statusCode, `${url} ${JSON.stringify(payload).slice(0, 60)}`).toBeLessThan(500);
    }
    // The existing account is untouched and still works.
    const ok = await call(t, "GET", ME, owner.cookie);
    expect(ok.statusCode).toBe(200);
  }, 60_000);
});

describe("P1-003 re-verification: shared schemas (the users search endpoint does not exist yet)", () => {
  it("search rejects every control character and accepts ordinary and exotic text", () => {
    for (const cp of CONTROL) {
      const ok = listUsersQuerySchema.safeParse({ search: `a${String.fromCodePoint(cp)}b` });
      expect(ok.success, label(cp)).toBe(false);
    }
    for (const search of ["Asha", "O'Brien", "a%b_c", "name x", "é", "\u{1F600}"]) {
      expect(listUsersQuerySchema.safeParse({ search }).success, search).toBe(true);
    }
  });
});

/** Tiny deterministic string hash so every sample gets its own e-mail address. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
