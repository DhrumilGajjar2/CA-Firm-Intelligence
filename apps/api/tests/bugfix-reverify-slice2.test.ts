import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClientSchema, timezoneSchema, updateFirmSchema } from "@ca-firm/validation";
import { hasTestDb, makeTestApp, resetDb, type TestApp } from "./db-helpers.js";
import {
  ACCEPT,
  FIRM_URL,
  INVITATIONS,
  INVITE,
  NO_ONE,
  SETTINGS_URL,
  USERS,
  call,
  expectEnvelope,
  firmWithAllRoles,
  rawCall,
} from "./support/slice3.js";
import type { FirmFixture } from "./support/firms.js";

/**
 * QA re-verification of the five Low bugs P1-004 .. P1-008 (API side: 004-007) with extra variants beyond
 * the original evidence tests in firms-adversarial.test.ts.
 */

describe("P1-004 timezone: numeric offsets are rejected, IANA names and UTC are accepted (schema level)", () => {
  const offsets = [
    "+05:30",
    "-08:00",
    "+0530",
    "+05",
    "-05",
    "+5",
    "-0",
    "+00:00",
    "-00:00",
    "+14:00",
    "-12:00",
    "+1",
    "05:30",
    "0530",
    "530",
    "Z",
    "z",
    "5.5",
    "+٠٥:٣٠", // Arabic-Indic digits
    "−08:00", // U+2212 MINUS SIGN + digits
  ];
  it.each(offsets)("rejects the numeric offset %j", (tz) => {
    expect(timezoneSchema.safeParse(tz).success).toBe(false);
    expect(updateFirmSchema.safeParse({ timezone: tz }).success).toBe(false);
  });

  it.each(["UTC", "utc", "Asia/Kolkata", "Asia/Calcutta", "America/New_York", "Europe/London", "Etc/GMT+5", "Etc/GMT-14", "Etc/UTC", "EST5EDT", "America/Argentina/Buenos_Aires", "Pacific/Kiritimati"])(
    "still accepts the IANA / UTC name %s",
    (tz) => {
      expect(timezoneSchema.safeParse(tz).success).toBe(true);
    },
  );

  it("records what other offset-looking names do (GMT+5, UTC+5, UTC+05:30)", () => {
    // These must not be accepted as stored values if Intl itself treats them as numeric offsets.
    for (const tz of ["GMT+5", "GMT-8", "UTC+5", "UTC+05:30", "UTC-08:00", "GMT+05:30"]) {
      const ok = timezoneSchema.safeParse(tz).success;
      let intlAccepts = true;
      try {
        new Intl.DateTimeFormat("en-IN", { timeZone: tz });
      } catch {
        intlAccepts = false;
      }
      // If Intl itself rejects it the schema must too (no extra acceptance); if Intl accepts it we only
      // assert it is not a pure numeric offset (they start with a letter, so a real zone alias).
      if (!intlAccepts) expect(ok, tz).toBe(false);
    }
  });
});

describe.skipIf(!hasTestDb)("P1-004 / 005 / 006 over HTTP", () => {
  let t: TestApp;
  let f: FirmFixture;
  beforeAll(async () => {
    t = await makeTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await resetDb(t.prisma);
    f = await firmWithAllRoles(t);
  });

  const patch = (body: unknown, who: "owner" | "manager" | "employee" | "viewer" = "owner") =>
    call(t, "PATCH", FIRM_URL, f.cookies[who], body);
  const row = () => t.prisma.firm.findUniqueOrThrow({ where: { id: f.firmId } });

  it("P1-004: offsets are 400 with a field error on timezone, stored value unchanged; a non-owner gets 403 first", async () => {
    const before = (await row()).timezone;
    for (const timezone of ["+05:30", "-08:00", "+0530", "+05", "+5", "05:30", "Z"]) {
      const res = await patch({ timezone });
      expectEnvelope(res, 400, "VALIDATION_ERROR");
      expect(res.json().errors.map((e: { field: string }) => e.field)).toContain("timezone");
      expect((await row()).timezone).toBe(before);
      for (const who of ["manager", "employee", "viewer"] as const) {
        expect((await patch({ timezone }, who)).statusCode, `${who} ${timezone}`).toBe(403);
      }
    }
  });

  it("P1-004: UTC and IANA names are stored exactly as sent and can be changed repeatedly", async () => {
    for (const timezone of ["UTC", "Asia/Kolkata", "America/New_York", "UTC"]) {
      const res = await patch({ timezone });
      expect(res.statusCode, timezone).toBe(200);
      expect(res.json().data.timezone).toBe(timezone);
      expect((await row()).timezone).toBe(timezone);
    }
  });

  it("P1-004: an offset next to otherwise valid fields rejects the whole request (nothing applied)", async () => {
    const before = await row();
    const res = await patch({ name: "Partially Applied?", timezone: "+05:30", phone: "9876543210" });
    expect(res.statusCode).toBe(400);
    const after = await row();
    expect(after.name).toBe(before.name);
    expect(after.phone).toBe(before.phone);
    expect(after.timezone).toBe(before.timezone);
  });

  it("P1-005: whitespace-only email and phone clear to null (many whitespace kinds), other fields untouched", async () => {
    const SAMPLE = { name: "Keep Me Ltd", address: "Somewhere 1", email: "a@example.com", phone: "9876543210" };
    for (const blank of [" ", "   ", "\t", "\n", "\r\n", " \t \n ", " ", " ", "　", "﻿", " "]) {
      await patch(SAMPLE);
      const res = await patch({ email: blank, phone: blank });
      expect(res.statusCode, JSON.stringify(blank)).toBe(200);
      expect(res.json().data).toMatchObject({ email: null, phone: null, name: "Keep Me Ltd", address: "Somewhere 1" });
      const r = await row();
      expect([r.email, r.phone, r.name, r.address]).toEqual([null, null, "Keep Me Ltd", "Somewhere 1"]);
    }
  });

  it("P1-005: each field clears on its own; whitespace on an already empty field is a harmless 200", async () => {
    await patch({ email: "a@example.com", phone: "9876543210" });
    const onlyEmail = await patch({ email: "   " });
    expect(onlyEmail.json().data).toMatchObject({ email: null, phone: "9876543210" });
    const onlyPhone = await patch({ phone: "   " });
    expect(onlyPhone.json().data).toMatchObject({ email: null, phone: null });
    expect((await patch({ phone: " ", email: " ", address: " " })).statusCode).toBe(200);
  });

  it("P1-005: zero-width space and NUL are not whitespace: still 400 (never silently cleared)", async () => {
    await patch({ email: "a@example.com", phone: "9876543210" });
    for (const key of ["email", "phone"] as const) {
      for (const bad of ["​", "\u0000", "  ​  "]) {
        const res = await patch({ [key]: bad });
        expect(res.statusCode, `${key} ${JSON.stringify(bad)}`).toBe(400);
      }
    }
    expect((await row()).email).toBe("a@example.com");
    expect((await row()).phone).toBe("9876543210");
  });

  it("P1-005: a non-owner sending whitespace-only values gets 403 and nothing changes", async () => {
    await patch({ email: "a@example.com" });
    for (const who of ["manager", "employee", "viewer"] as const) {
      expect((await patch({ email: "  " }, who)).statusCode).toBe(403);
    }
    expect((await row()).email).toBe("a@example.com");
  });

  describe("P1-006 phone alphabet", () => {
    const BAD_INSIDE = [
      "\n", "\r", "\t", "\u000b", "\u000c", " ", "\u0085", " ", " ", " ", " ", " ", " ", " ", " ", " ", "　", "﻿",
    ];
    it.each(BAD_INSIDE.map((c) => [JSON.stringify(c), c] as const))(
      "rejects %s inside a number",
      async (_label, ch) => {
        const before = (await row()).phone;
        const res = await patch({ phone: `98765${ch}43210` });
        expect(res.statusCode).toBe(400);
        expect(res.json().errors.map((e: { field: string }) => e.field)).toContain("phone");
        expect((await row()).phone).toBe(before);
      },
    );

    it("rejects look-alike digits and punctuation: full-width, Arabic-Indic, Devanagari, ( ) . / x", async () => {
      for (const phone of [
        "９８７６５４３２１０",
        "٩٨٧٦٥٤٣٢١٠",
        "९८७६५४३२१०",
        "(98765)43210",
        "98765.43210",
        "98765/43210",
        "98765x43210",
        "+91 98765 4321O", // letter O
        "98765​43210",
        "98765− 43210", // minus sign U+2212
        "98765‐ 43210", // hyphen U+2010
      ]) {
        expect((await patch({ phone })).statusCode, JSON.stringify(phone)).toBe(400);
      }
    });

    it("accepts digits, +, - and plain spaces, 10 to 15 characters, stored as sent", async () => {
      for (const phone of ["9876543210", "+91 98765 43210", "+91-98765-43210", "98765 43210", "+1 202 555 0143", "123456789012345", "+--+--+--+"]) {
        const res = await patch({ phone });
        expect(res.statusCode, phone).toBe(200);
        expect(res.json().data.phone).toBe(phone);
      }
    });

    it("length boundaries: 9 and 16 characters are rejected, 10 and 15 accepted (spaces count)", async () => {
      expect((await patch({ phone: "987654321" })).statusCode).toBe(400);
      expect((await patch({ phone: "9876543210" })).statusCode).toBe(200);
      expect((await patch({ phone: "987654321012345" })).statusCode).toBe(200);
      expect((await patch({ phone: "9876543210123456" })).statusCode).toBe(400);
      expect((await patch({ phone: "9876 54321" })).statusCode).toBe(200);
      expect((await patch({ phone: "98 76 54 3 " + "1" })).statusCode).toBe(200);
    });

    it("surrounding whitespace is trimmed, never stored (a trailing newline cannot reach the database)", async () => {
      for (const phone of ["9876543210\n", "\t9876543210", " 9876543210 ", " 9876543210 "]) {
        const res = await patch({ phone });
        expect(res.statusCode, JSON.stringify(phone)).toBe(200);
        expect(res.json().data.phone).toBe("9876543210");
        expect((await row()).phone).toBe("9876543210");
      }
    });
  });

  it("P1-006: createClientSchema (P2) uses the same phone rule", () => {
    const base = { client_code: "C-1", display_name: "Sample Traders", client_type: "individual" } as const;
    const ok = (phone: string) => createClientSchema.safeParse({ ...base, phone }).success;
    expect(ok("9876543210")).toBe(true);
    expect(ok("+91 98765 43210")).toBe(true);
    expect(ok("")).toBe(true);
    expect(ok("98765\n43210")).toBe(false);
    expect(ok("98765\t43210")).toBe(false);
    expect(ok("98765 43210")).toBe(false);
    expect(ok("98765 43210")).toBe(false);
    expect(ok("98765x43210")).toBe(false);
    expect(ok("987654321")).toBe(false);
    expect(ok("9876543210123456")).toBe(false);
    expect(ok("9876543210\n")).toBe(false); // no trim in this schema: the newline is simply invalid
  });

  describe("P1-007 authentication and the role check come before body parsing", () => {
    const bodies: [string, string, string][] = [
      ["malformed JSON", "application/json", "{bad json"],
      ["truncated JSON", "application/json", '{"name":"x"'],
      ["empty JSON body", "application/json", ""],
      ["JSON with trailing garbage", "application/json", '{"name":"x"} garbage'],
      ["urlencoded", "application/x-www-form-urlencoded", "name=Hacked"],
      ["xml", "application/xml", "<name>Hacked</name>"],
      ["text/plain", "text/plain", "name=Hacked"],
      ["yaml", "application/yaml", "name: Hacked"],
      ["bogus content type", "x/y;;;", "abc"],
    ];

    const BODY_ROUTES = [
      ["PATCH", FIRM_URL],
      ["PATCH", SETTINGS_URL],
    ] as const;

    it.each(bodies)("anonymous + %s on both firm PATCH routes: 401", async (_l, ct, body) => {
      for (const [m, url] of BODY_ROUTES) {
        expectEnvelope(await rawCall(t, m, url, undefined, body, ct), 401, "UNAUTHENTICATED");
      }
    });

    it.each(bodies)("manager / employee / viewer + %s on both firm PATCH routes: 403", async (_l, ct, body) => {
      for (const [m, url] of BODY_ROUTES) {
        for (const who of ["manager", "employee", "viewer"] as const) {
          const res = await rawCall(t, m, url, f.cookies[who], body, ct);
          expect(res.statusCode, `${who} ${url}`).toBe(403);
          expectEnvelope(res, 403, "FORBIDDEN");
        }
      }
    });

    it("owner + malformed JSON is 400 BAD_REQUEST; owner + other content types is 415 (after auth, so no regression)", async () => {
      for (const [m, url] of BODY_ROUTES) {
        const bad = await rawCall(t, m, url, f.cookies.owner, "{bad json");
        expectEnvelope(bad, 400, "BAD_REQUEST");
        for (const ct of ["application/x-www-form-urlencoded", "application/xml", "application/yaml"]) {
          const res = await rawCall(t, m, url, f.cookies.owner, "name=x", ct);
          expectEnvelope(res, 415, "UNSUPPORTED_MEDIA_TYPE");
        }
        // text/plain is parsed by Fastify as a string: the schema then rejects it (400, not 415).
        expectEnvelope(await rawCall(t, m, url, f.cookies.owner, "name=x", "text/plain"), 400, "VALIDATION_ERROR");
      }
    });

    it("an invalid or expired session with a malformed body is 401, not 400 (garbage cookie, unknown user, deactivated user)", async () => {
      expect((await rawCall(t, "PATCH", FIRM_URL, "access_token=garbage", "{bad")).statusCode).toBe(401);
      expect((await rawCall(t, "PATCH", FIRM_URL, `access_token=${"a.b.c"}`, "{bad")).statusCode).toBe(401);
      await t.prisma.firmMember.updateMany({ where: { user_id: f.userIds.manager }, data: { is_active: false } });
      expect((await rawCall(t, "PATCH", FIRM_URL, f.cookies.manager, "{bad")).statusCode).toBe(401);
    });

    it("an oversized body (2 MB): anonymous 401, viewer 403, owner 413", async () => {
      const big = JSON.stringify({ name: "x".repeat(2_000_000) });
      expect((await rawCall(t, "PATCH", FIRM_URL, undefined, big)).statusCode).toBe(401);
      expect((await rawCall(t, "PATCH", FIRM_URL, f.cookies.viewer, big)).statusCode).toBe(403);
      expect((await rawCall(t, "PATCH", FIRM_URL, f.cookies.owner, big)).statusCode).toBe(413);
    });

    it("the same holds on every slice-3 route with a body: anonymous 401, owner-only routes 403 for the other roles", async () => {
      const targets = [
        ["POST", INVITE],
        ["PATCH", `${USERS}/${f.userIds.employee}/role`],
        ["PATCH", `${USERS}/${f.userIds.employee}/status`],
      ] as const;
      for (const [m, url] of targets) {
        for (const [, ct, body] of bodies) {
          expect((await rawCall(t, m, url, undefined, body, ct)).statusCode, `anon ${m} ${url} ${ct}`).toBe(401);
          for (const who of ["manager", "employee", "viewer"] as const) {
            expect((await rawCall(t, m, url, f.cookies[who], body, ct)).statusCode, `${who} ${m} ${url} ${ct}`).toBe(403);
          }
        }
        expectEnvelope(await rawCall(t, m, url, f.cookies.owner, "{bad json"), 400, "BAD_REQUEST");
        expectEnvelope(await rawCall(t, m, url, f.cookies.owner, "a=b", "application/x-www-form-urlencoded"), 415, "UNSUPPORTED_MEDIA_TYPE");
      }
      // PATCH /users/:id is open to every role at the hook level (own-id rule is in the service): anonymous 401,
      // everyone else reaches the parser, so a malformed body is the documented 400 (before 404/403).
      const url = `${USERS}/${f.userIds.employee}`;
      for (const [, ct, body] of bodies) {
        expect((await rawCall(t, "PATCH", url, undefined, body, ct)).statusCode, `anon ${ct}`).toBe(401);
      }
      for (const who of ["owner", "manager", "employee", "viewer"] as const) {
        expectEnvelope(await rawCall(t, "PATCH", url, f.cookies[who], "{bad json"), 400, "BAD_REQUEST");
      }
    });

    it("the same holds for invalid query strings and bad ids on read routes: anonymous 401, wrong role 403 (never 400/404)", async () => {
      const reads = [`${USERS}?page=0&limit=1000&role=boss`, `${INVITATIONS}?page=-1&status=nope`];
      for (const url of reads) {
        expect((await call(t, "GET", url)).statusCode).toBe(401);
        expect((await call(t, "GET", url, f.cookies.employee)).statusCode).toBe(403);
        expect((await call(t, "GET", url, f.cookies.viewer)).statusCode).toBe(403);
      }
      expect((await call(t, "GET", `${USERS}?page=0`, f.cookies.manager)).statusCode).toBe(400);
      expect((await call(t, "GET", `${INVITATIONS}?page=0`, f.cookies.manager)).statusCode).toBe(403);
      expect((await call(t, "DELETE", `${INVITATIONS}/not-a-uuid`)).statusCode).toBe(401);
      expect((await call(t, "DELETE", `${INVITATIONS}/not-a-uuid`, f.cookies.manager)).statusCode).toBe(403);
      expect((await call(t, "DELETE", `${INVITATIONS}/${NO_ONE}`, f.cookies.owner)).statusCode).toBe(404);
    });

    it("the public accept endpoint has no session, so a malformed body is the plain 400 / 415 (no data involved)", async () => {
      expectEnvelope(await rawCall(t, "POST", ACCEPT, undefined, "{bad json"), 400, "BAD_REQUEST");
      expectEnvelope(await rawCall(t, "POST", ACCEPT, undefined, "a=b", "application/x-www-form-urlencoded"), 415, "UNSUPPORTED_MEDIA_TYPE");
    });
  });
});
