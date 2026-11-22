import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMember,
  DEFAULT_PASSWORD,
  hasTestDb,
  makeTestApp,
  registerOwner,
  resetDb,
  type TestApp,
} from "./db-helpers.js";
import {
  call,
  cookieFor,
  FIRM,
  firmWithAllRoles,
  ME,
  ROLES,
  SETTINGS,
} from "./support/firms.js";

/**
 * P1 slice 2 QA gate (firm setup), adversarial layer on top of firms.test.ts: per-role matrix on all four
 * endpoints, validation boundaries, settings merge on odd stored rows, concurrency, tenant isolation.
 * Tests named "P1-00x" are reproductions of logged defects and fail until the owner fixes them.
 */

const errFields = (res: { json: () => { errors?: { field?: string }[] } }) =>
  (res.json().errors ?? []).map((e) => e.field);

const PROFILE_KEYS = ["address", "created_at", "email", "id", "name", "phone", "timezone"];
const SETTINGS_KEYS = ["financial_year_start_month", "onboarding_completed"];

describe.skipIf(!hasTestDb)("firms: per-role matrix on all four endpoints", () => {
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

  type Who = "anonymous" | "owner" | "manager" | "employee" | "viewer";
  const WHO: Who[] = ["anonymous", "owner", "manager", "employee", "viewer"];

  // method, url, valid payload, expected status per identity
  const MATRIX = [
    ["GET", FIRM, undefined, [401, 200, 200, 200, 200]],
    ["PATCH", FIRM, { name: "Matrix Renamed" }, [401, 200, 403, 403, 403]],
    ["GET", SETTINGS, undefined, [401, 200, 200, 200, 200]],
    ["PATCH", SETTINGS, { financial_year_start_month: 7 }, [401, 200, 403, 403, 403]],
  ] as const;

  it.each(MATRIX)(
    "%s %s answers the documented status for anonymous / owner / manager / employee / viewer",
    async (method, url, payload, expected) => {
      const f = await firmWithAllRoles(t);
      for (const [i, who] of WHO.entries()) {
        const cookie = who === "anonymous" ? undefined : f.cookies[who];
        const res = await call(t, method, url, cookie, payload);
        expect(res.statusCode, `${method} ${url} as ${who}`).toBe(expected[i]);
        const body = res.json();
        expect(Object.keys(body).sort()).toEqual(
          res.statusCode === 200
            ? ["data", "message", "success"]
            : ["code", "errors", "message", "success"],
        );
        if (res.statusCode === 401) expect(body.code).toBe("UNAUTHENTICATED");
        if (res.statusCode === 403) {
          expect(body).toMatchObject({
            success: false,
            message: "You do not have permission to perform this action",
            code: "FORBIDDEN",
            errors: [],
          });
        }
        // A forbidden or anonymous caller never causes a Set-Cookie either.
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
    },
  );

  it("401 beats 403 beats 400: an INVALID body gets 401 / 403 / 400 by caller, on both PATCH endpoints", async () => {
    const f = await firmWithAllRoles(t);
    const invalid = {
      [FIRM]: { name: "", email: "nope", timezone: "Mars/Olympus" },
      [SETTINGS]: { financial_year_start_month: 99, onboarding_completed: "x" },
    };
    for (const url of [FIRM, SETTINGS] as const) {
      const expected: Record<Who, number> = {
        anonymous: 401,
        owner: 400,
        manager: 403,
        employee: 403,
        viewer: 403,
      };
      for (const who of WHO) {
        const cookie = who === "anonymous" ? undefined : f.cookies[who];
        const res = await call(t, "PATCH", url, cookie, invalid[url]);
        expect(res.statusCode, `PATCH ${url} as ${who}`).toBe(expected[who]);
      }
      // Also when the body is empty / not an object at all.
      for (const who of ["manager", "viewer", "anonymous"] as const) {
        const cookie = who === "anonymous" ? undefined : f.cookies[who];
        const res = await t.app.inject({
          method: "PATCH",
          url,
          headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json" },
          payload: "[]",
        });
        expect(res.statusCode, `PATCH ${url} as ${who} with []`).toBe(
          who === "anonymous" ? 401 : 403,
        );
      }
    }
  });

  it("a deactivated manager / employee / viewer is 401 on all four endpoints, an active one still works", async () => {
    const f = await firmWithAllRoles(t);
    for (const role of ["manager", "employee", "viewer"] as const) {
      await t.prisma.firmMember.update({
        where: { firm_id_user_id: { firm_id: f.firmId, user_id: f.userIds[role] } },
        data: { is_active: false },
      });
    }
    for (const role of ["manager", "employee", "viewer"] as const) {
      for (const [method, url, payload] of MATRIX.map((m) => [m[0], m[1], m[2]] as const)) {
        const res = await call(t, method, url, f.cookies[role], payload);
        expect(res.statusCode, `${role} ${method} ${url}`).toBe(401);
      }
    }
    expect((await call(t, "GET", FIRM, f.cookies.owner)).statusCode).toBe(200);
  });

  it("a role change applies on the very next request, in both directions", async () => {
    const f = await firmWithAllRoles(t);
    const setRole = (role: "owner" | "viewer" | "manager") =>
      t.prisma.firmMember.update({
        where: { firm_id_user_id: { firm_id: f.firmId, user_id: f.userIds.manager } },
        data: { role },
      });
    expect((await call(t, "PATCH", FIRM, f.cookies.manager, { name: "N1" })).statusCode).toBe(403);
    await setRole("owner");
    expect((await call(t, "PATCH", FIRM, f.cookies.manager, { name: "N2" })).statusCode).toBe(200);
    await setRole("viewer");
    expect((await call(t, "PATCH", FIRM, f.cookies.manager, { name: "N3" })).statusCode).toBe(403);
    expect((await call(t, "GET", FIRM, f.cookies.manager)).json().data.name).toBe("N2");
  });

  it("no other HTTP method or path can write a firm (PUT / POST / DELETE / PATCH on other paths = 404)", async () => {
    const f = await firmWithAllRoles(t, "Immutable Paths");
    for (const [method, url] of [
      ["PUT", FIRM],
      ["POST", FIRM],
      ["DELETE", FIRM],
      ["PUT", SETTINGS],
      ["POST", SETTINGS],
      ["DELETE", SETTINGS],
      ["POST", "/api/v1/firms"],
      ["GET", "/api/v1/firms"],
      ["DELETE", `/api/v1/firms/${f.firmId}`],
      ["PATCH", `/api/v1/firms/${f.firmId}`],
      ["PATCH", `/api/v1/firms/${f.firmId}/settings`],
    ] as const) {
      const res = await call(t, method, url, f.cookies.owner, method === "GET" ? undefined : { name: "x" });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
      expect(res.json().code).toBe("NOT_FOUND");
    }
    expect(await t.prisma.firm.count()).toBe(1);
    expect((await t.prisma.firm.findUniqueOrThrow({ where: { id: f.firmId } })).name).toBe(
      "Immutable Paths",
    );
  });

  it("content types: non-JSON bodies never apply (415, or 400 for text/plain, which Fastify parses as a string) and nothing is applied", async () => {
    const f = await firmWithAllRoles(t);
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "application/xml"]) {
      const owner = await t.app.inject({
        method: "PATCH",
        url: FIRM,
        headers: { cookie: f.cookies.owner, "content-type": contentType },
        payload: "name=Hacked",
      });
      if (contentType === "text/plain") {
        expect(owner.statusCode, contentType).toBe(400);
        expect(owner.json().code).toBe("VALIDATION_ERROR");
      } else {
        expect(owner.statusCode, contentType).toBe(415);
        expect(owner.json().code).toBe("UNSUPPORTED_MEDIA_TYPE");
      }
    }
    expect((await t.prisma.firm.findUniqueOrThrow({ where: { id: f.firmId } })).name).toBe(
      "Role Matrix & Co",
    );
  });

  it("an oversized body is 413 in the standard envelope, not a crash, and changes nothing", async () => {
    const f = await firmWithAllRoles(t);
    const res = await t.app.inject({
      method: "PATCH",
      url: FIRM,
      headers: { cookie: f.cookies.owner, "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(2_000_000) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ success: false, code: "PAYLOAD_TOO_LARGE" });
    expect((await call(t, "GET", FIRM, f.cookies.owner)).json().data.name).toBe(
      "Role Matrix & Co",
    );
  });

  // P1-007: the route comment and docs promise "an anonymous or forbidden caller always gets 401/403 and never
  // a 400"; a malformed JSON body is rejected by the parser BEFORE authentication runs.
  it("P1-007: an unsupported content type from an anonymous caller is still 401, not 415", async () => {
    for (const contentType of ["application/x-www-form-urlencoded", "application/xml"]) {
      const anon = await t.app.inject({
        method: "PATCH",
        url: FIRM,
        headers: { "content-type": contentType },
        payload: "name=Hacked",
      });
      expect(anon.statusCode, `anonymous ${contentType}`).toBe(401);
    }
  });

  it("P1-007: malformed JSON from an anonymous or forbidden caller is still 401 / 403, not 400", async () => {
    const f = await firmWithAllRoles(t);
    for (const url of [FIRM, SETTINGS]) {
      const anon = await t.app.inject({
        method: "PATCH",
        url,
        headers: { "content-type": "application/json" },
        payload: "{bad json",
      });
      expect(anon.statusCode, `anonymous PATCH ${url}`).toBe(401);
      const viewer = await t.app.inject({
        method: "PATCH",
        url,
        headers: { cookie: f.cookies.viewer, "content-type": "application/json" },
        payload: "{bad json",
      });
      expect(viewer.statusCode, `viewer PATCH ${url}`).toBe(403);
    }
  });
});

describe.skipIf(!hasTestDb)("firms: validation boundaries (one shared firm)", () => {
  let t: TestApp;
  let cookie: string;
  beforeAll(async () => {
    t = await makeTestApp();
    await resetDb(t.prisma);
    cookie = (await registerOwner(t, { firm_name: "Boundary Firm" })).cookie;
  });
  afterAll(async () => {
    await t?.close();
  });

  const patch = (payload: unknown) => call(t, "PATCH", FIRM, cookie, payload);
  const raw = (body: string, url = FIRM) =>
    t.app.inject({
      method: "PATCH",
      url,
      headers: { cookie, "content-type": "application/json" },
      payload: body,
    });
  const profile = async () => (await call(t, "GET", FIRM, cookie)).json().data;

  describe("name", () => {
    it.each([
      ["200 characters", "a".repeat(200), "a".repeat(200)],
      ["200 accented characters", "é".repeat(200), "é".repeat(200)],
      ["200 after trimming surrounding spaces", `  ${"a".repeat(200)}  `, "a".repeat(200)],
      ["ideographic spaces trimmed", "　Sharma & Co　", "Sharma & Co"],
      ["markup is stored verbatim", "<b>Sharma</b> & Sons", "<b>Sharma</b> & Sons"],
      ["SQL-looking text is stored verbatim", "x'); DROP TABLE firms;--", "x'); DROP TABLE firms;--"],
      ["emoji and non-latin scripts", "事務所 🙂 مكتب", "事務所 🙂 مكتب"],
      ["single character", "A", "A"],
    ])("accepts %s", async (_label, name, expected) => {
      const res = await patch({ name });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.name).toBe(expected);
      expect((await profile()).name).toBe(expected);
      expect(await t.prisma.firm.count()).toBe(1); // the DROP TABLE text did nothing
    });

    it.each([
      ["201 characters", "a".repeat(201)],
      ["201 accented characters", "é".repeat(201)],
      ["empty", ""],
      ["spaces only", "    "],
      ["no-break spaces only", "  "],
      ["null", null],
      ["number", 42],
      ["boolean", true],
      ["array", ["a"]],
      ["object", { a: 1 }],
    ])("rejects %s", async (_label, name) => {
      const before = await profile();
      const res = await patch({ name });
      expect(res.statusCode).toBe(400);
      expect(errFields(res)).toContain("name");
      expect((await profile()).name).toBe(before.name);
    });

    it("never 500s on a very long or astral-plane name (only 200 or 400)", async () => {
      for (const name of ["😀".repeat(100), "😀".repeat(200), "😀".repeat(201), "😀".repeat(1000)]) {
        const res = await patch({ name });
        expect([200, 400], `${name.length} UTF-16 units`).toContain(res.statusCode);
        if (res.statusCode === 200) {
          expect([...res.json().data.name].length).toBeLessThanOrEqual(200);
        }
      }
    });
  });

  describe("address", () => {
    it("accepts exactly 500 characters and rejects 501", async () => {
      expect((await patch({ address: "a".repeat(500) })).statusCode).toBe(200);
      expect((await profile()).address).toHaveLength(500);
      const res = await patch({ address: "a".repeat(501) });
      expect(res.statusCode).toBe(400);
      expect(errFields(res)).toContain("address");
      expect((await profile()).address).toHaveLength(500);
    });

    it("length is measured after trimming; line breaks inside count as characters", async () => {
      expect((await patch({ address: `   ${"a".repeat(500)}   ` })).statusCode).toBe(200);
      const crlf = `x${"\r\n".repeat(249)}x`; // 500 characters
      expect(crlf).toHaveLength(500);
      const ok = await patch({ address: crlf });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().data.address).toBe(crlf);
      expect((await patch({ address: `x${"\r\n".repeat(250)}x` })).statusCode).toBe(400);
    });

    it.each([["number", 7], ["array", ["a"]], ["object", { a: 1 }], ["boolean", false]])(
      "rejects a %s",
      async (_label, address) => {
        const res = await patch({ address });
        expect(res.statusCode).toBe(400);
        expect(errFields(res)).toContain("address");
      },
    );
  });

  describe("phone", () => {
    it.each([
      ["10 digits", "9876543210"],
      ["15 digits", "123456789012345"],
      ["with country code", "+919876543210"],
      ["with spaces", "+91 98765 43210"],
      ["with dashes", "98765-43210"],
      ["mixed", "+91-98765 43210"],
      ["surrounding spaces are trimmed", "   9876543210   "],
      ["10 characters including punctuation", "+91-9876-54"],
    ])("accepts %s", async (_label, phone) => {
      const res = await patch({ phone });
      expect(res.statusCode, phone).toBe(200);
      expect(res.json().data.phone).toBe(phone.trim());
    });

    it.each([
      ["9 characters", "987654321"],
      ["16 characters", "1234567890123456"],
      ["letters", "98765abcde"],
      ["parentheses", "(022) 12345678"],
      ["dots", "98765.43210"],
      ["slash", "98765/43210"],
      ["Devanagari digits", "९८७६५४३२१०"],
      ["full-width digits", "９８７６５４３２１０"],
      ["extension", "9876543210 x12"],
      ["number type", 9876543210],
      ["array", ["9876543210"]],
      ["emoji", "98765432\u{1F600}"],
    ])("rejects %s", async (_label, phone) => {
      const res = await patch({ phone });
      expect(res.statusCode, String(phone)).toBe(400);
      expect(errFields(res)).toContain("phone");
    });

    // P1-006: the contract says "digits, +, -, space" but the regex uses \s, which also matches
    // newline, tab, vertical tab, form feed, NBSP and U+2028/2029.
    it("P1-006: line breaks, tabs and other whitespace inside a phone number are rejected", async () => {
      for (const phone of [
        "98765\n43210",
        "98765\r\n43210",
        "98765\t43210",
        "98765\u000b43210",
        "98765\u000c43210",
        "98765 43210",
        "98765 43210",
      ]) {
        const res = await patch({ phone });
        expect(res.statusCode, JSON.stringify(phone)).toBe(400);
      }
    });
  });

  describe("email", () => {
    it("normalises: trims and lowercases", async () => {
      const res = await patch({ email: "  Office+Tax@Example.COM \t" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.email).toBe("office+tax@example.com");
    });

    it("accepts a 254 character address and rejects 255", async () => {
      // 64 + 1 + 63 + 1 + 63 + 1 + 57 + 4 = 254 characters; one more character in the local part makes 255.
      const r254 = await patch({ email: `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com` });
      expect(r254.statusCode).toBe(200);
      const r255 = await patch({ email: `${"a".repeat(65)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com` });
      expect(r255.statusCode).toBe(400);
      expect(errFields(r255)).toContain("email");
    });

    it.each([
      ["no at sign", "plainaddress"],
      ["no domain dot", "a@b"],
      ["double at", "a@@b.com"],
      ["spaces inside", "a b@example.com"],
      ["display name", "Name <a@example.com>"],
      ["leading dot", ".a@example.com"],
      ["double dot domain", "a@example..com"],
      ["non-ascii local part", "tést@example.com"],
      ["comma list", "a@example.com,b@example.com"],
      ["newline injection", "a@example.com\nBcc: x@example.com"],
      ["number", 5],
      ["array", ["a@example.com"]],
    ])("rejects %s", async (_label, email) => {
      const res = await patch({ email });
      expect(res.statusCode, JSON.stringify(email)).toBe(400);
      expect(errFields(res)).toContain("email");
    });
  });

  describe("timezone", () => {
    it.each(["UTC", "Asia/Kolkata", "Asia/Calcutta", "America/New_York", "Europe/London", "Australia/Sydney", "Etc/GMT+5", "Pacific/Auckland"])(
      "accepts the IANA zone %s",
      async (timezone) => {
        const res = await patch({ timezone });
        expect(res.statusCode).toBe(200);
        expect(res.json().data.timezone).toBe(timezone);
      },
    );

    it.each([
      ["unknown zone", "Mars/Olympus"],
      ["empty", ""],
      ["spaces only", "   "],
      ["trailing space", "Asia/Kolkata "],
      ["leading space", " Asia/Kolkata"],
      ["trailing newline", "Asia/Kolkata\n"],
      ["path traversal", "../../etc/passwd"],
      ["NUL inside", "Asia/Kol\u0000kata"],
      ["very long", "A".repeat(10_000)],
      ["SQL-looking", "UTC'; DROP TABLE firms;--"],
      ["number", 5],
      ["null", null],
      ["array", ["UTC"]],
      ["object", { tz: "UTC" }],
    ])("rejects %s", async (_label, timezone) => {
      const before = (await profile()).timezone;
      const res = await patch({ timezone });
      expect(res.statusCode).toBe(400);
      expect(errFields(res)).toContain("timezone");
      expect((await profile()).timezone).toBe(before);
    });

    // P1-004: the contract says "IANA zone"; the validator uses Intl.DateTimeFormat, which also accepts fixed offsets.
    it("P1-004: fixed UTC offsets are not IANA zones and are rejected", async () => {
      for (const timezone of ["+05:30", "-08:00", "+0530", "+05"]) {
        const res = await patch({ timezone });
        expect(res.statusCode, timezone).toBe(400);
      }
    });
  });

  describe("clearing optional fields", () => {
    const SAMPLE = { address: "Somewhere 1", email: "a@example.com", phone: "9876543210" };

    it.each([
      ["empty string", ""],
      ["null", null],
    ])("%s clears address, email and phone (stored as null)", async (_label, value) => {
      await patch(SAMPLE);
      const res = await patch({ address: value, email: value, phone: value });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ address: null, email: null, phone: null });
      const row = await t.prisma.firm.findFirstOrThrow();
      expect([row.address, row.email, row.phone]).toEqual([null, null, null]);
    });

    it("clearing twice is idempotent, and clearing something already empty is fine", async () => {
      await patch({ address: "", email: "", phone: "" });
      const again = await patch({ address: "", email: "", phone: "" });
      expect(again.statusCode).toBe(200);
      expect(again.json().data).toMatchObject({ address: null, email: null, phone: null });
    });

    it("name and timezone can never be cleared", async () => {
      expect((await patch({ name: "" })).statusCode).toBe(400);
      expect((await patch({ timezone: "" })).statusCode).toBe(400);
      expect((await patch({ name: null })).statusCode).toBe(400);
      expect((await patch({ timezone: null })).statusCode).toBe(400);
    });

    // P1-005: docs: "address, email and phone are cleared by sending \"\" (or whitespace)". Address does; email and phone are 400.
    it("P1-005: a whitespace-only email or phone clears it, like a whitespace-only address", async () => {
      await patch(SAMPLE);
      expect((await patch({ address: "   " })).json().data.address).toBeNull();
      for (const key of ["email", "phone"] as const) {
        const res = await patch({ [key]: "   " });
        expect(res.statusCode, `${key} whitespace`).toBe(200);
        expect(res.json().data[key]).toBeNull();
      }
    });
  });

  describe("mass assignment and odd bodies", () => {
    it("ignores every non-whitelisted key next to a valid one", async () => {
      const before = await t.prisma.firm.findFirstOrThrow();
      const res = await patch({
        name: "Mass Assignment Co",
        id: "00000000-0000-0000-0000-000000000000",
        firm_id: "00000000-0000-0000-0000-000000000000",
        settings: { onboarding_completed: true, financial_year_start_month: 1 },
        created_at: "2001-01-01T00:00:00.000Z",
        updated_at: "2001-01-01T00:00:00.000Z",
        deleted_at: "2001-01-01T00:00:00.000Z",
        plan: "enterprise",
        is_active: false,
        owner_id: "x",
        members: [{ role: "owner" }],
        role: "owner",
        subscription: { status: "active" },
      });
      expect(res.statusCode).toBe(200);
      const after = await t.prisma.firm.findFirstOrThrow();
      expect(after.id).toBe(before.id);
      expect(after.created_at).toEqual(before.created_at);
      expect(after.name).toBe("Mass Assignment Co");
      expect(after.settings).toEqual(before.settings);
      expect(Object.keys(res.json().data).sort()).toEqual(PROFILE_KEYS);
    });

    it("settings PATCH ignores non-whitelisted keys too, and never stores them", async () => {
      const before = await t.prisma.firm.findFirstOrThrow();
      const res = await call(t, "PATCH", SETTINGS, cookie, {
        financial_year_start_month: 5,
        is_admin: true,
        id: "x",
        name: "Not a setting",
        nested: { a: 1 },
      });
      expect(res.statusCode).toBe(200);
      const after = await t.prisma.firm.findFirstOrThrow();
      expect(after.name).toBe(before.name);
      expect(after.settings).toEqual({
        ...(before.settings as object),
        financial_year_start_month: 5,
      });
      expect(JSON.stringify(after.settings)).not.toContain("is_admin");
    });

    it("prototype-pollution style keys never reach the stored data or crash", async () => {
      for (const body of [
        '{"__proto__":{"name":"polluted"},"name":"Proto 1"}',
        '{"constructor":{"prototype":{"name":"polluted"}},"name":"Proto 2"}',
        '{"name":"Proto 3","__proto__":null}',
      ]) {
        const res = await raw(body);
        expect(res.statusCode, body).toBeLessThan(500);
      }
      expect(({} as Record<string, unknown>)["name"]).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "name")).toBe(false);
      for (const body of ['{"__proto__":{"onboarding_completed":true},"financial_year_start_month":6}']) {
        expect((await raw(body, SETTINGS)).statusCode).toBeLessThan(500);
      }
      expect(({} as Record<string, unknown>)["onboarding_completed"]).toBeUndefined();
    });

    it("non-object bodies are 400 validation errors (never 500)", async () => {
      for (const body of ["null", "[]", '"text"', "123", "true", '[{"name":"x"}]', "{}"]) {
        for (const url of [FIRM, SETTINGS]) {
          const res = await raw(body, url);
          expect(res.statusCode, `${url} ${body}`).toBe(400);
          expect(res.json().code).toBe("VALIDATION_ERROR");
        }
      }
    });

    it("duplicate JSON keys: the last one wins and nothing breaks", async () => {
      const res = await raw('{"name":"First","name":"Second"}');
      expect(res.statusCode).toBe(200);
      expect(res.json().data.name).toBe("Second");
    });

    it("query strings on PATCH are ignored", async () => {
      const before = (await profile()).id;
      const res = await call(t, "PATCH", `${FIRM}?name=FromQuery&id=other&firm_id=other`, cookie, {
        phone: "9876543210",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(before);
      expect(res.json().data.name).not.toBe("FromQuery");
    });
  });

  describe("settings boundaries", () => {
    it.each([1, 2, 12])("accepts financial_year_start_month %s", async (month) => {
      const res = await call(t, "PATCH", SETTINGS, cookie, { financial_year_start_month: month });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.financial_year_start_month).toBe(month);
    });

    it("accepts JSON numbers that equal an integer (12.0, 4e0, 1.0e1)", async () => {
      for (const [body, month] of [
        ['{"financial_year_start_month":12.0}', 12],
        ['{"financial_year_start_month":4e0}', 4],
        ['{"financial_year_start_month":1.0e1}', 10],
      ] as const) {
        const res = await raw(body, SETTINGS);
        expect(res.statusCode, body).toBe(200);
        expect(res.json().data.financial_year_start_month).toBe(month);
      }
    });

    it.each([
      ["zero", "0"],
      ["thirteen", "13"],
      ["negative", "-1"],
      ["fraction", "1.5"],
      ["just under 12", "11.999999"],
      ["just over 1", "1.000001"],
      ["numeric string", '"4"'],
      ["empty string", '""'],
      ["null", "null"],
      ["boolean", "true"],
      ["array", "[4]"],
      ["object", "{}"],
      ["huge", "1e308"],
      ["infinite (overflows)", "1e999"],
      ["safe integer limit", "9007199254740993"],
    ])("rejects financial_year_start_month: %s", async (_label, value) => {
      const before = (await call(t, "GET", SETTINGS, cookie)).json().data;
      const res = await raw(`{"financial_year_start_month":${value}}`, SETTINGS);
      expect(res.statusCode).toBe(400);
      expect(errFields(res)).toContain("financial_year_start_month");
      expect((await call(t, "GET", SETTINGS, cookie)).json().data).toEqual(before);
    });

    it.each([["string true", '"true"'], ["one", "1"], ["null", "null"], ["array", "[true]"], ["object", "{}"], ["string false", '"false"']])(
      "rejects onboarding_completed: %s",
      async (_label, value) => {
        const res = await raw(`{"onboarding_completed":${value}}`, SETTINGS);
        expect(res.statusCode).toBe(400);
        expect(errFields(res)).toContain("onboarding_completed");
      },
    );

    it("responses contain exactly the two settings keys", async () => {
      const res = await call(t, "PATCH", SETTINGS, cookie, { financial_year_start_month: 4 });
      expect(Object.keys(res.json().data).sort()).toEqual(SETTINGS_KEYS);
      expect(Object.keys((await call(t, "GET", SETTINGS, cookie)).json().data).sort()).toEqual(
        SETTINGS_KEYS,
      );
    });
  });
});

describe.skipIf(!hasTestDb)("firms: stored settings in odd shapes (old rows) and secrecy", () => {
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

  const setRaw = (firmId: string, json: string) =>
    t.prisma.$executeRaw`UPDATE firms SET settings = ${json}::jsonb WHERE id = ${firmId}::uuid`;
  const stored = async (firmId: string) =>
    (await t.prisma.firm.findUniqueOrThrow({ where: { id: firmId } })).settings;

  const ODD_ROWS: [string, string][] = [
    ["empty object", "{}"],
    ["JSON null", "null"],
    ["a string", '"settings"'],
    ["a number", "42"],
    ["an array", "[1,2,3]"],
    ["a boolean", "true"],
    ["wrong types", '{"financial_year_start_month":"7","onboarding_completed":"true"}'],
    ["out-of-range month", '{"financial_year_start_month":13,"onboarding_completed":false}'],
    ["zero month", '{"financial_year_start_month":0}'],
    ["fractional month", '{"financial_year_start_month":4.5}'],
    ["null values", '{"financial_year_start_month":null,"onboarding_completed":null}'],
  ];

  it.each(ODD_ROWS)(
    "stored settings that are %s: GET gives defaults, PATCH works and keeps the row an object",
    async (_label, json) => {
      const f = await firmWithAllRoles(t);
      await setRaw(f.firmId, json);

      const get = await call(t, "GET", SETTINGS, f.cookies.viewer);
      expect(get.statusCode).toBe(200);
      expect(get.json().data).toEqual({
        financial_year_start_month: 4,
        onboarding_completed: false,
      });
      // The firm profile and /auth/me are unaffected by a broken settings row.
      expect((await call(t, "GET", FIRM, f.cookies.employee)).statusCode).toBe(200);
      expect((await call(t, "GET", ME, f.cookies.manager)).json().data.firm).toMatchObject({
        onboarding_completed: false,
      });

      const patch = await call(t, "PATCH", SETTINGS, f.cookies.owner, {
        financial_year_start_month: 6,
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json().data).toEqual({ financial_year_start_month: 6, onboarding_completed: false });
      expect(await stored(f.firmId)).toMatchObject({ financial_year_start_month: 6 });

      const done = await call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: true });
      expect(done.json().data).toEqual({ financial_year_start_month: 6, onboarding_completed: true });
    },
  );

  it("a PATCH of one key keeps another key's stored (even invalid) value and every unknown key", async () => {
    const f = await firmWithAllRoles(t);
    await setRaw(
      f.firmId,
      '{"financial_year_start_month":13,"legacy":"keep","deep":{"a":[1,2,{"b":null}]},"flag":false}',
    );
    const res = await call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: true });
    expect(res.json().data).toEqual({ financial_year_start_month: 4, onboarding_completed: true });
    expect(await stored(f.firmId)).toEqual({
      financial_year_start_month: 13,
      legacy: "keep",
      deep: { a: [1, 2, { b: null }] },
      flag: false,
      onboarding_completed: true,
    });
  });

  it("true-only rule: once true it stays true through every other PATCH, and false never changes the row", async () => {
    const f = await firmWithAllRoles(t);
    expect((await call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: true })).statusCode).toBe(200);
    const snapshot = await stored(f.firmId);
    for (const body of [
      { onboarding_completed: false },
      { onboarding_completed: false, financial_year_start_month: 9 },
    ]) {
      const res = await call(t, "PATCH", SETTINGS, f.cookies.owner, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().errors).toEqual([{ field: "onboarding_completed", message: expect.any(String) }]);
      expect(await stored(f.firmId)).toEqual(snapshot);
    }
    for (const body of [{ financial_year_start_month: 11 }, { financial_year_start_month: 4 }]) {
      expect((await call(t, "PATCH", SETTINGS, f.cookies.owner, body)).json().data.onboarding_completed).toBe(true);
    }
    // Profile edits never touch the flag.
    await call(t, "PATCH", FIRM, f.cookies.owner, { name: "Renamed After Onboarding" });
    expect((await call(t, "GET", SETTINGS, f.cookies.viewer)).json().data.onboarding_completed).toBe(true);
    // Nobody but the owner can set or clear it.
    for (const role of ["manager", "employee", "viewer"] as const) {
      expect((await call(t, "PATCH", SETTINGS, f.cookies[role], { onboarding_completed: false })).statusCode).toBe(403);
    }
  });

  it("a new firm starts not-onboarded for every role and the flag is firm-wide", async () => {
    const f = await firmWithAllRoles(t);
    for (const role of ROLES) {
      expect((await call(t, "GET", ME, f.cookies[role])).json().data.firm.onboarding_completed, role).toBe(false);
    }
    await call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: true });
    for (const role of ROLES) {
      expect((await call(t, "GET", ME, f.cookies[role])).json().data.firm.onboarding_completed, role).toBe(true);
    }
  });

  it("responses never expose settings internals, other columns or secrets", async () => {
    const f = await firmWithAllRoles(t);
    await setRaw(
      f.firmId,
      '{"financial_year_start_month":4,"stripe_secret":"sk_live_s3cr3t","api_token":"tok_s3cr3t","password":"p4ssw0rd-s3cr3t"}',
    );
    await t.prisma.firm.update({ where: { id: f.firmId }, data: { name: "Secrecy Firm" } });
    const texts: string[] = [];
    for (const role of ROLES) {
      for (const [method, url, body] of [
        ["GET", FIRM, undefined],
        ["GET", SETTINGS, undefined],
        ["GET", ME, undefined],
      ] as const) {
        const res = await call(t, method, url, f.cookies[role], body);
        expect(res.statusCode).toBe(200);
        texts.push(res.body);
        expect(res.headers["set-cookie"]).toBeUndefined();
      }
    }
    texts.push((await call(t, "PATCH", FIRM, f.cookies.owner, { phone: "9876543210" })).body);
    texts.push((await call(t, "PATCH", SETTINGS, f.cookies.owner, { financial_year_start_month: 5 })).body);
    for (const text of texts) {
      for (const needle of ["s3cr3t", "sk_live", "stripe", "password", "$argon2", "password_hash", '"settings"', "updated_at", "token_hash", "owner@"]) {
        expect(text, needle).not.toContain(needle);
      }
    }
    // The unknown keys really are still in the database: they are hidden, not deleted.
    expect(JSON.stringify(await stored(f.firmId))).toContain("s3cr3t");
  });

  it("the same PATCH sent twice returns the same state (idempotent) and /auth/me agrees", async () => {
    const f = await firmWithAllRoles(t);
    const body = { name: "Idem Firm", phone: "9876543210" };
    const first = (await call(t, "PATCH", FIRM, f.cookies.owner, body)).json().data;
    const second = (await call(t, "PATCH", FIRM, f.cookies.owner, body)).json().data;
    expect(second).toEqual(first);
    const me = (await call(t, "GET", ME, f.cookies.viewer)).json().data.firm;
    expect(me).toMatchObject({ id: f.firmId, name: "Idem Firm", timezone: first.timezone });
  });

  it("two firms registered back to back with the same name stay fully independent", async () => {
    const a = await registerOwner(t, { firm_name: "Twin Firm" });
    const b = await registerOwner(t, { firm_name: "Twin Firm" });
    expect(a.user.firm.id).not.toBe(b.user.firm.id);
    await call(t, "PATCH", FIRM, a.cookie, { address: "A only", phone: "9000000001" });
    await call(t, "PATCH", SETTINGS, a.cookie, { financial_year_start_month: 1, onboarding_completed: true });
    const bProfile = (await call(t, "GET", FIRM, b.cookie)).json().data;
    expect(bProfile).toMatchObject({ id: b.user.firm.id, name: "Twin Firm", address: null, phone: null });
    expect((await call(t, "GET", SETTINGS, b.cookie)).json().data).toEqual({
      financial_year_start_month: 4,
      onboarding_completed: false,
    });
    expect((await call(t, "GET", ME, b.cookie)).json().data.firm.onboarding_completed).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("firms: concurrency", () => {
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

  it("simultaneous PATCHes of different profile fields all persist", async () => {
    const f = await firmWithAllRoles(t);
    const results = await Promise.all([
      call(t, "PATCH", FIRM, f.cookies.owner, { name: "Parallel Name" }),
      call(t, "PATCH", FIRM, f.cookies.owner, { address: "Parallel Address" }),
      call(t, "PATCH", FIRM, f.cookies.owner, { email: "parallel@example.com" }),
      call(t, "PATCH", FIRM, f.cookies.owner, { phone: "9876543210" }),
      call(t, "PATCH", FIRM, f.cookies.owner, { timezone: "Asia/Dubai" }),
      call(t, "PATCH", SETTINGS, f.cookies.owner, { financial_year_start_month: 10 }),
      call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: true }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200, 200]);
    const row = await t.prisma.firm.findUniqueOrThrow({ where: { id: f.firmId } });
    expect(row).toMatchObject({
      name: "Parallel Name",
      address: "Parallel Address",
      email: "parallel@example.com",
      phone: "9876543210",
      timezone: "Asia/Dubai",
    });
    expect(row.settings).toMatchObject({ financial_year_start_month: 10, onboarding_completed: true });
  });

  it("12 simultaneous PATCHes of the same field end in exactly one of the sent values", async () => {
    const f = await firmWithAllRoles(t);
    const names = Array.from({ length: 12 }, (_, i) => `Contender ${i}`);
    const results = await Promise.all(
      names.map((name) => call(t, "PATCH", FIRM, f.cookies.owner, { name })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const final = (await call(t, "GET", FIRM, f.cookies.viewer)).json().data.name;
    expect(names).toContain(final);
    for (const r of results) expect(names).toContain(r.json().data.name);
  });

  it("16 simultaneous settings PATCHes keep every unknown key and end in a consistent state", async () => {
    const f = await firmWithAllRoles(t);
    await t.prisma.firm.update({
      where: { id: f.firmId },
      data: { settings: { financial_year_start_month: 4, onboarding_completed: false, legacy: "keep", deep: { a: 1 } } },
    });
    const months = [1, 2, 3, 5, 6, 7, 8, 9];
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        i % 2 === 0
          ? call(t, "PATCH", SETTINGS, f.cookies.owner, { financial_year_start_month: months[i / 2]! })
          : call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: true }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const row = await t.prisma.firm.findUniqueOrThrow({ where: { id: f.firmId } });
    const settings = row.settings as Record<string, unknown>;
    expect(settings["legacy"]).toBe("keep");
    expect(settings["deep"]).toEqual({ a: 1 });
    expect(settings["onboarding_completed"]).toBe(true);
    expect(months).toContain(settings["financial_year_start_month"]);
    const get = (await call(t, "GET", SETTINGS, f.cookies.employee)).json().data;
    expect(get).toEqual({
      financial_year_start_month: settings["financial_year_start_month"],
      onboarding_completed: true,
    });
  });

  it("a rejected (false) request racing a valid one never un-completes onboarding", async () => {
    const f = await firmWithAllRoles(t);
    const results = await Promise.all([
      call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: true }),
      call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: false }),
      call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: false, financial_year_start_month: 2 }),
      call(t, "PATCH", SETTINGS, f.cookies.owner, { onboarding_completed: true }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 400, 400, 200]);
    const row = await t.prisma.firm.findUniqueOrThrow({ where: { id: f.firmId } });
    expect(row.settings).toMatchObject({ onboarding_completed: true, financial_year_start_month: 4 });
  });

  it("owners of six firms patching at the same moment each change only their own firm", async () => {
    const owners = [];
    for (let i = 0; i < 6; i++) owners.push(await registerOwner(t, { firm_name: `Parallel Firm ${i}` }));
    const results = await Promise.all(
      owners.flatMap((o, i) => [
        call(t, "PATCH", FIRM, o.cookie, { address: `Address ${i}`, phone: `90000000${i}0` }),
        call(t, "PATCH", SETTINGS, o.cookie, { financial_year_start_month: i + 1 }),
        call(t, "PATCH", SETTINGS, o.cookie, { onboarding_completed: i % 2 === 0 ? true : undefined } as object),
      ]),
    );
    // The third request of odd firms has no recognised field: 400, everything else 200.
    for (const [idx, r] of results.entries()) {
      const firmIndex = Math.floor(idx / 3);
      const kind = idx % 3;
      const expected = kind === 2 && firmIndex % 2 === 1 ? 400 : 200;
      expect(r.statusCode, `firm ${firmIndex} request ${kind}`).toBe(expected);
    }
    for (const [i, o] of owners.entries()) {
      const row = await t.prisma.firm.findUniqueOrThrow({ where: { id: o.user.firm.id } });
      expect(row.name).toBe(`Parallel Firm ${i}`);
      expect(row.address).toBe(`Address ${i}`);
      expect(row.phone).toBe(`90000000${i}0`);
      expect(row.settings).toMatchObject({
        financial_year_start_month: i + 1,
        onboarding_completed: i % 2 === 0,
      });
    }
  }, 60_000);

  it("patching while the same firm is read concurrently never returns a half-written profile", async () => {
    const f = await firmWithAllRoles(t);
    await call(t, "PATCH", FIRM, f.cookies.owner, { name: "State 0", address: "Address 0" });
    const writes = Array.from({ length: 10 }, (_, i) =>
      call(t, "PATCH", FIRM, f.cookies.owner, { name: `State ${i + 1}`, address: `Address ${i + 1}` }),
    );
    const reads = Array.from({ length: 20 }, () => call(t, "GET", FIRM, f.cookies.viewer));
    const all = await Promise.all([...writes, ...reads]);
    for (const res of all) {
      expect(res.statusCode).toBe(200);
      const { name, address } = res.json().data;
      // Each request touches name and address in one UPDATE, so the pair always matches.
      expect(address).toBe(`Address ${name.replace("State ", "")}`);
    }
  });
});

describe.skipIf(!hasTestDb)("firms: tenant isolation (critical scenario #1)", () => {
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

  async function twoFirms() {
    const a = await firmWithAllRoles(t, "Isolation Firm A");
    const b = await firmWithAllRoles(t, "Isolation Firm B");
    await call(t, "PATCH", FIRM, b.cookies.owner, {
      address: "B Street 9",
      email: "b-office@example.com",
      phone: "9000000002",
      timezone: "Asia/Tokyo",
    });
    await call(t, "PATCH", SETTINGS, b.cookies.owner, { financial_year_start_month: 1, onboarding_completed: true });
    const bRow = () => t.prisma.firm.findUniqueOrThrow({ where: { id: b.firmId } });
    return { a, b, bBefore: await bRow(), bRow };
  }

  const B_MARKERS = (b: { firmId: string }) => [
    "Isolation Firm B",
    b.firmId,
    "B Street 9",
    "b-office@example.com",
    "9000000002",
    "Asia/Tokyo",
  ];

  it("EVERY role of firm A, on EVERY endpoint, sees only firm A and can never change firm B", async () => {
    const { a, b, bBefore, bRow } = await twoFirms();
    for (const role of ROLES) {
      for (const url of [FIRM, SETTINGS, ME]) {
        const res = await call(t, "GET", url, a.cookies[role]);
        expect(res.statusCode, `${role} ${url}`).toBe(200);
        for (const marker of B_MARKERS(b)) {
          expect(res.body, `${role} GET ${url} must not contain ${marker}`).not.toContain(marker);
        }
      }
      // Every write attempt names B in every place a client can: body, query and headers.
      for (const url of [FIRM, SETTINGS]) {
        const res = await call(
          t,
          "PATCH",
          `${url}?firm_id=${b.firmId}&id=${b.firmId}`,
          a.cookies[role],
          { id: b.firmId, firm_id: b.firmId, name: `${role} coup`, financial_year_start_month: 12, onboarding_completed: true },
          { "x-firm-id": b.firmId, "x-tenant-id": b.firmId, "firm-id": b.firmId, "x-forwarded-host": "firm-b.example" },
        );
        expect(res.statusCode, `${role} PATCH ${url}`).toBe(role === "owner" ? 200 : 403);
        expect(await bRow(), `after ${role} PATCH ${url}`).toEqual(bBefore);
      }
    }
    // A's owner's writes landed on A only.
    const aRow = await t.prisma.firm.findUniqueOrThrow({ where: { id: a.firmId } });
    expect(aRow.name).toBe("owner coup");
    expect(aRow.settings).toMatchObject({ financial_year_start_month: 12, onboarding_completed: true });
    expect(await bRow()).toEqual(bBefore);
  });

  it("firm B's roles are equally walled off from A (symmetry) and A's /auth/me and login never show B", async () => {
    const { a, b } = await twoFirms();
    for (const role of ROLES) {
      const profile = (await call(t, "GET", FIRM, b.cookies[role])).json().data;
      expect(profile).toMatchObject({ id: b.firmId, name: "Isolation Firm B", timezone: "Asia/Tokyo" });
      expect(JSON.stringify(profile)).not.toContain(a.firmId);
      const me = (await call(t, "GET", ME, b.cookies[role])).json().data;
      expect(me.firm.id).toBe(b.firmId);
    }
    const login = await t.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: a.owner.email, password: DEFAULT_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.firm).toMatchObject({ id: a.firmId, name: "Isolation Firm A", onboarding_completed: false });
    expect(login.body).not.toContain(b.firmId);
  });

  it("forged cross-firm tokens are 401 on all four endpoints for every role mix", async () => {
    const { a, b, bBefore, bRow } = await twoFirms();
    for (const role of ROLES) {
      // A's user with B's firm id, and B's user with A's firm id, claiming any role.
      const forged = [
        cookieFor(t, a.userIds[role], b.firmId, "owner"),
        cookieFor(t, b.userIds[role], a.firmId, "owner"),
      ];
      for (const cookie of forged) {
        for (const [method, url, body] of [
          ["GET", FIRM, undefined],
          ["PATCH", FIRM, { name: "Forged" }],
          ["GET", SETTINGS, undefined],
          ["PATCH", SETTINGS, { financial_year_start_month: 2 }],
          ["GET", ME, undefined],
        ] as const) {
          const res = await call(t, method, url, cookie, body);
          expect(res.statusCode, `${role} ${method} ${url}`).toBe(401);
          expect(res.body).not.toContain("Isolation Firm");
        }
      }
    }
    expect(await bRow()).toEqual(bBefore);
    expect((await t.prisma.firm.findUniqueOrThrow({ where: { id: a.firmId } })).name).toBe("Isolation Firm A");
  });

  it("a person who is in two firms gets exactly the firm and the DATABASE role of the session's firm", async () => {
    const a = await firmWithAllRoles(t, "Isolation Firm A");
    const b = await registerOwner(t, { firm_name: "Isolation Firm B" });
    const bId = b.user.firm.id;
    // A's viewer is also the OWNER of B (one user, two memberships: possible at DB level).
    const person = a.userIds.viewer;
    await t.prisma.firmMember.create({ data: { firm_id: bId, user_id: person, role: "owner" } });

    const inA = cookieFor(t, person, a.firmId, "owner"); // token even claims owner
    const inB = cookieFor(t, person, bId, "viewer"); // token claims viewer, DB says owner
    expect((await call(t, "GET", FIRM, inA)).json().data.id).toBe(a.firmId);
    expect((await call(t, "GET", FIRM, inB)).json().data.id).toBe(bId);

    // In A they are a viewer: no write, A untouched.
    expect((await call(t, "PATCH", FIRM, inA, { name: "Viewer write" })).statusCode).toBe(403);
    expect((await t.prisma.firm.findUniqueOrThrow({ where: { id: a.firmId } })).name).toBe("Isolation Firm A");
    // In B they are the owner: the write lands in B and never in A.
    expect((await call(t, "PATCH", FIRM, inB, { name: "Owner write in B" })).statusCode).toBe(200);
    expect((await t.prisma.firm.findUniqueOrThrow({ where: { id: bId } })).name).toBe("Owner write in B");
    expect((await t.prisma.firm.findUniqueOrThrow({ where: { id: a.firmId } })).name).toBe("Isolation Firm A");

    // Deactivating the membership in B ends B access only.
    await t.prisma.firmMember.update({
      where: { firm_id_user_id: { firm_id: bId, user_id: person } },
      data: { is_active: false },
    });
    expect((await call(t, "GET", FIRM, inB)).statusCode).toBe(401);
    expect((await call(t, "GET", FIRM, inA)).statusCode).toBe(200);
  });

  it("deactivating or demoting a member of one firm has no effect on another firm's sessions", async () => {
    const { a, b } = await twoFirms();
    await t.prisma.firmMember.updateMany({ where: { firm_id: a.firmId }, data: { is_active: false } });
    for (const role of ROLES) {
      expect((await call(t, "GET", FIRM, a.cookies[role])).statusCode).toBe(401);
      expect((await call(t, "GET", FIRM, b.cookies[role])).statusCode).toBe(200);
    }
    expect((await call(t, "PATCH", FIRM, b.cookies.owner, { name: "B still works" })).statusCode).toBe(200);
  });

  it("path tricks cannot select another firm: nothing but /firms/current exists", async () => {
    const { a, b, bBefore, bRow } = await twoFirms();
    for (const url of [
      `/api/v1/firms/${b.firmId}`,
      `/api/v1/firms/${b.firmId}/settings`,
      `/api/v1/firms/current/${b.firmId}`,
      `/api/v1/firms/current/../${b.firmId}`,
      `/api/v1/firms/current/%2e%2e/${b.firmId}`,
      `/api/v1/firms/${b.firmId}/current`,
      `/api/v1/firms/current/settings/${b.firmId}`,
      `/api/v1/firms/current;firm_id=${b.firmId}`,
      `/api/v1/firms/current%3Ffirm_id=${b.firmId}`,
      `/api/v1/firms/current#${b.firmId}`,
      `/api/v1/firms/current/`,
      `/api/v1//firms/current`,
    ]) {
      for (const method of ["GET", "PATCH"] as const) {
        const res = await call(t, method, url, a.cookies.owner, method === "PATCH" ? { name: "x" } : undefined);
        expect(res.statusCode, `${method} ${url}`).toBeLessThan(500);
        if (res.statusCode === 200) {
          // If a path variant is accepted at all it must resolve to the caller's own firm.
          expect(res.json().data.id ?? a.firmId, `${method} ${url}`).toBe(a.firmId);
        }
        expect(res.body).not.toContain("Isolation Firm B");
      }
    }
    expect(await bRow()).toEqual(bBefore);
  });

  it("a firm id in the cookie header, Authorization header or a second cookie cannot widen access", async () => {
    const { a, b, bBefore, bRow } = await twoFirms();
    const bToken = b.cookies.owner.replace("access_token=", "");
    // Valid A cookie plus B's token in the Authorization header: one identity is used, never a merge.
    const res = await t.app.inject({
      method: "GET",
      url: FIRM,
      headers: { cookie: a.cookies.owner, authorization: `Bearer ${bToken}` },
    });
    expect([a.firmId, b.firmId]).toContain(res.json().data.id);
    // Two access_token cookies: still exactly one firm, never both, and no 500.
    const dup = await t.app.inject({
      method: "PATCH",
      url: FIRM,
      headers: { cookie: `${a.cookies.owner}; ${b.cookies.owner}` },
      payload: { name: "Dup cookie" },
    });
    expect(dup.statusCode).toBeLessThan(500);
    const aName = (await t.prisma.firm.findUniqueOrThrow({ where: { id: a.firmId } })).name;
    const bName = (await bRow()).name;
    // At most one of the two firms was renamed, and only because a valid owner session for it was presented.
    expect([aName === "Dup cookie", bName === "Dup cookie"].filter(Boolean).length).toBeLessThanOrEqual(1);
    if (bName === "Dup cookie") expect(bBefore.name).not.toBe("Dup cookie"); // B's own owner cookie was in the request
  });

  it("members created in one firm cannot log in to or act in another (email is global, membership is per firm)", async () => {
    const { a, b, bBefore, bRow } = await twoFirms();
    const m = await createMember(t.prisma, { firm_id: a.firmId, role: "manager", email: "only-in-a@example.com" });
    const login = await t.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "only-in-a@example.com", password: DEFAULT_PASSWORD },
    });
    expect(login.json().data.firm.id).toBe(a.firmId);
    // A token naming B for this member is rejected: no membership there.
    expect((await call(t, "GET", FIRM, cookieFor(t, m.id, b.firmId, "manager"))).statusCode).toBe(401);
    expect(await bRow()).toEqual(bBefore);
  });
});
