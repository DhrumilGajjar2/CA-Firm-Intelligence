import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "../src/generated/prisma/client.js";
import { createMember, hasTestDb, makeTestApp, registerOwner, resetDb, type TestApp } from "./db-helpers.js";
import { USERS, call, cookieFor, expectEnvelope } from "./support/slice3.js";

const FAKE_HASH = "$argon2id$v=19$m=19456,t=2,p=1$ZmFrZQ$ZmFrZWZha2VmYWtlZmFrZQ";

interface Row {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
}

/**
 * GET /users: pagination, search, filters and ordering against a deliberately awkward data set
 * (wildcards, quotes, backslashes, unicode) plus 130 bulk members.
 */
describe.skipIf(!hasTestDb)("GET /users: pagination, search, filters, order", () => {
  let t: TestApp;
  let owner: string;
  let manager: string;
  let firmId: string;
  let otherOwner: string;
  const named: Record<string, string> = {};
  const bulkIds: string[] = [];

  const list = (qs = "", cookie = owner) => call(t, "GET", `${USERS}${qs ? `?${qs}` : ""}`, cookie);
  const names = (res: { json(): { data: Row[] } }) => res.json().data.map((u) => u.name);

  async function addUser(name: string, email: string, role: UserRole = "employee", is_active = true, created_at?: Date) {
    const id = randomUUID();
    await t.prisma.user.create({
      data: {
        id,
        name,
        email,
        password_hash: FAKE_HASH,
        ...(created_at ? { created_at } : {}),
        memberships: { create: { firm_id: firmId, role, is_active } },
      },
    });
    named[name] = id;
    return id;
  }

  beforeAll(async () => {
    t = await makeTestApp();
    await resetDb(t.prisma);
    const o = await registerOwner(t, { name: "Olivia Owner", email: "olivia.owner@example.com", firm_name: "List Firm" });
    owner = o.cookie;
    firmId = o.user.firm.id;
    const m = await createMember(t.prisma, { firm_id: firmId, role: "manager", name: "Manny Manager", email: "manny.manager@example.com" });
    manager = cookieFor(t, m.id, firmId, "manager");
    named["Manny Manager"] = m.id;
    // another firm whose rows must never show up
    const other = await registerOwner(t, { name: "Percent 50% Elsewhere", email: "percent.elsewhere@other-firm.example", firm_name: "Other Firm" });
    otherOwner = other.cookie;

    await addUser("Plain Alice", "alice@example.com");
    await addUser("Plain Bob", "bob@example.com", "viewer");
    await addUser("50% Discount", "discount@example.com");
    await addUser("Under_score", "under_score@example.com", "viewer", false);
    await addUser("Back\\slash", "backslash@example.com");
    await addUser("O'Brien", "obrien@example.com", "manager");
    await addUser('Quote "Q" Name', "quote@example.com");
    await addUser("Zoë Müller", "zoe@example.com", "employee", false);
    await addUser("日本語 太郎", "taro@example.com");
    await addUser("Emoji 🙂 Person", "emoji@example.com", "viewer");
    await addUser("Dot.*Star", "dotstar@example.com");
    await addUser("Br[a-z]cket", "bracket@example.com");
    await addUser("Paren(thesis", "paren@example.com");
    await addUser("Pipe|Caret^Dollar$", "pipe@example.com");
    await addUser("Semi;colon--Drop", "semi@example.com");
    // ties: same name, same created_at -> ordered by user id; same name, different created_at -> by created_at
    const sameInstant = new Date("2026-03-01T10:00:00.000Z");
    for (let i = 0; i < 5; i++) await addUser("Tie Name", `tie${i}@example.com`, "employee", true, sameInstant);
    await addUser("Tie Name", "tie.early@example.com", "employee", true, new Date("2026-01-01T10:00:00.000Z"));
    await addUser("Tie Name", "tie.late@example.com", "employee", true, new Date("2026-12-01T10:00:00.000Z"));
    // bulk: 130 members "Bulk 000" .. "Bulk 129"
    const users = Array.from({ length: 130 }, (_, i) => ({
      id: randomUUID(),
      name: `Bulk ${String(i).padStart(3, "0")}`,
      email: `bulk${i}@bulk.example`,
      password_hash: FAKE_HASH,
    }));
    await t.prisma.user.createMany({ data: users });
    await t.prisma.firmMember.createMany({
      data: users.map((u, i) => ({
        firm_id: firmId,
        user_id: u.id,
        role: (["employee", "viewer", "manager"] as const)[i % 3]!,
        is_active: i % 5 !== 0,
      })),
    });
    bulkIds.push(...users.map((u) => u.id));
  }, 120_000);
  afterAll(async () => {
    await t?.close();
  });

  const TOTAL = 2 /* owner + manager */ + 15 /* named */ + 7 /* ties */ + 130;

  it("fixture sanity", async () => {
    const res = await list("limit=1");
    expect(res.json().meta.total).toBe(TOTAL);
    expect(await t.prisma.firmMember.count({ where: { firm_id: firmId } })).toBe(TOTAL);
  });

  describe("pagination", () => {
    it.each([
      ["page=0", 400],
      ["page=-1", 400],
      ["page=1.5", 400],
      ["page=abc", 400],
      ["page=", 400],
      ["page=NaN", 400],
      ["page=Infinity", 400],
      ["page=-Infinity", 400],
      ["page=1&page=2", 400],
      ["page[]=1", 200], // unknown key (page[]) is ignored: default page
      ["limit=0", 400],
      ["limit=-1", 400],
      ["limit=101", 400],
      ["limit=1000000", 400],
      ["limit=abc", 400],
      ["limit=", 400],
      ["limit=1.5", 400],
      ["limit=1&limit=2", 400],
      ["limit=1", 200],
      ["limit=100", 200],
      ["page=1&limit=100", 200],
      ["page=2&limit=100", 200],
      ["page=3&limit=100", 200],
      ["page=1e2", 200],
      ["page=0x10", 200],
      ["page=%201", 200],
      ["page=2&limit=100&unknown=x&sort=email&order=desc", 200],
    ])("%s -> %i", async (qs, status) => {
      const res = await list(qs);
      expect(res.statusCode).toBe(status);
      if (status === 400) {
        expectEnvelope(res, 400, "VALIDATION_ERROR");
        expect(res.json().errors.length).toBeGreaterThan(0);
        expect(res.body).not.toMatch(/prisma|postgres|SELECT/i);
      } else {
        expect(res.json().success).toBe(true);
        expect(res.json().meta.total).toBe(TOTAL);
      }
    });

    it("huge page numbers never cause a 5xx (empty data, exact total, or a clean 400)", async () => {
      for (const page of ["99999", "2147483647", "2147483648", "9007199254740991", "9007199254740992", "99999999999999999999", "1e21"]) {
        for (const limit of ["1", "100"]) {
          const res = await list(`page=${page}&limit=${limit}`);
          expect(res.statusCode, `page=${page} limit=${limit}: ${res.body.slice(0, 120)}`).toBeLessThan(500);
          if (res.statusCode === 200) {
            expect(res.json().data).toEqual([]);
            expect(res.json().meta.total).toBe(TOTAL);
          } else {
            expectEnvelope(res, 400, "VALIDATION_ERROR");
          }
        }
      }
    });

    it("limit and page are echoed back as numbers; last page is partial; the page after it is empty", async () => {
      const res = await list("page=2&limit=100");
      expect(res.json().meta).toEqual({ page: 2, limit: 100, total: TOTAL });
      expect(res.json().data).toHaveLength(TOTAL - 100);
      const empty = await list(`page=${Math.ceil(TOTAL / 100) + 1}&limit=100`);
      expect(empty.json().data).toEqual([]);
      expect(empty.json().meta.total).toBe(TOTAL);
      const defaults = await list();
      expect(defaults.json().meta).toEqual({ page: 1, limit: 20, total: TOTAL });
      expect(defaults.json().data).toHaveLength(20);
      const one = await list("limit=1");
      expect(one.json().data).toHaveLength(1);
    });

    it("walking every page (sizes 1, 7, 20, 100) returns each member exactly once, in the same order as one big page", async () => {
      const big = (await list("limit=100")).json().data.map((u: Row) => u.id) as string[];
      const rest = (await list("page=2&limit=100")).json().data.map((u: Row) => u.id) as string[];
      const reference = [...big, ...rest];
      expect(reference).toHaveLength(TOTAL);
      expect(new Set(reference).size).toBe(TOTAL);
      for (const size of [7, 20]) {
        const walked: string[] = [];
        for (let page = 1; page <= Math.ceil(TOTAL / size); page++) {
          for (const u of (await list(`page=${page}&limit=${size}`)).json().data) walked.push(u.id);
        }
        expect(walked, `size ${size}`).toEqual(reference);
      }
    });

    it("the same request twice gives the identical body (stable order, nothing time-dependent)", async () => {
      const a = await list("limit=50&page=2");
      const b = await list("limit=50&page=2");
      expect(a.body).toBe(b.body);
    });
  });

  describe("sort order", () => {
    it("name ascending, ties by created_at ascending, then by user id; unknown sort parameters are ignored", async () => {
      const baseline = (await list("limit=100&search=Tie%20Name")).json().data as Row[];
      expect(baseline).toHaveLength(7);
      const created = await t.prisma.user.findMany({ where: { id: { in: baseline.map((r) => r.id) } } });
      const byId = new Map(created.map((u) => [u.id, u]));
      const expected = [...baseline].sort((x, y) => {
        const cx = byId.get(x.id)!.created_at.getTime();
        const cy = byId.get(y.id)!.created_at.getTime();
        if (cx !== cy) return cx - cy;
        return x.id < y.id ? -1 : 1;
      });
      expect(baseline.map((r) => r.id)).toEqual(expected.map((r) => r.id));
      expect(baseline[0]!.email).toBe("tie.early@example.com");
      expect(baseline[6]!.email).toBe("tie.late@example.com");
      const middle = baseline.slice(1, 6).map((r) => r.id);
      expect(middle).toEqual([...middle].sort());
      const withSort = (await list("limit=100&search=Tie%20Name&sort=email&order=desc&sort_by=created_at")).json().data as Row[];
      expect(withSort.map((r) => r.id)).toEqual(baseline.map((r) => r.id));
    });

    it("Bulk members appear in name order across page boundaries", async () => {
      const res = await list("search=Bulk&limit=100");
      expect(names(res)).toEqual(Array.from({ length: 100 }, (_, i) => `Bulk ${String(i).padStart(3, "0")}`));
      const page2 = await list("search=Bulk&limit=100&page=2");
      expect(names(page2)).toEqual(Array.from({ length: 30 }, (_, i) => `Bulk ${String(i + 100).padStart(3, "0")}`));
    });
  });

  describe("search", () => {
    const only = async (term: string, expected: string[]) => {
      const res = await list(`search=${encodeURIComponent(term)}&limit=100`);
      expect(res.statusCode, term).toBe(200);
      expect(names(res).sort(), `search ${JSON.stringify(term)}`).toEqual([...expected].sort());
      expect(res.json().meta.total).toBe(expected.length);
    };

    it("% _ and backslash are literal characters, never wildcards", async () => {
      await only("%", ["50% Discount"]);
      await only("0%", ["50% Discount"]);
      await only("_", ["Under_score"]);
      await only("r_s", ["Under_score"]);
      await only("\\", ["Back\\slash"]);
      await only("k\\s", ["Back\\slash"]);
      // wildcard look-alikes that WOULD match if %/_ were wildcards
      await only("_lice", []);
      await only("Pl_in", []);
      await only("A%ice", []);
      await only("%lice", []);
      await only("%%", []);
      await only("\\%", []);
      await only("\\_", []);
      await only("Plain\\%Alice", []);
      await only("5_%", []);
    });

    it("quotes, regex and SQL metacharacters are inert literals", async () => {
      await only("'", ["O'Brien"]);
      await only("O'B", ["O'Brien"]);
      await only('"Q"', ['Quote "Q" Name']);
      await only(".*", ["Dot.*Star"]);
      await only("[a-z]", ["Br[a-z]cket"]);
      await only("(", ["Paren(thesis"]);
      await only("|", ["Pipe|Caret^Dollar$"]);
      await only("^", ["Pipe|Caret^Dollar$"]);
      await only("$", ["Pipe|Caret^Dollar$"]);
      await only(";", ["Semi;colon--Drop"]);
      await only("--", ["Semi;colon--Drop"]);
      await only("'; DROP TABLE users;--", []);
      await only("' OR '1'='1", []);
      await only("%' OR 1=1 --", []);
      await only("\\'", []);
      await only(`'"`, []);
      expect(await t.prisma.user.count()).toBeGreaterThan(100); // nothing dropped
    });

    it("case-insensitive, trimmed, matches name or email; internal spacing matters", async () => {
      await only("plain alice", ["Plain Alice"]);
      await only("PLAIN ALICE", ["Plain Alice"]);
      await only("  alice  ", ["Plain Alice"]);
      await only("alice@example", ["Plain Alice"]);
      await only("ALICE@EXAMPLE.COM", ["Plain Alice"]);
      await only("Plain  Alice", []);
      await only("Alice Plain", []);
      await only("plain", ["Plain Alice", "Plain Bob"]);
    });

    it("unicode: CJK, emoji, accented text are found; no 5xx for any scripts or combining marks", async () => {
      await only("日本", ["日本語 太郎"]);
      await only("太郎", ["日本語 太郎"]);
      await only("🙂", ["Emoji 🙂 Person"]);
      await only("Zoë", ["Zoë Müller"]);
      await only("Müller", ["Zoë Müller"]);
      for (const term of ["ß", "İ", "ı", "é", "Ё", "مرحبا", "नमस्ते", "​", "﻿", "🙂", "ä", "ǅ"]) {
        const res = await list(`search=${encodeURIComponent(term)}&limit=100`);
        expect(res.statusCode, JSON.stringify(term)).toBeLessThan(500);
      }
    });

    it("empty and whitespace-only search means no filter; 100 characters ok, 101 is 400; control characters are 400", async () => {
      for (const qs of ["search=", "search=%20%20%20", "search=%09"]) {
        const res = await list(`${qs}&limit=1`);
        expect(res.statusCode, qs).toBe(200); // trimmed first: a tab-only term is empty, not a control-character error
        if (res.statusCode === 200) expect(res.json().meta.total).toBe(TOTAL);
      }
      expect((await list(`search=${"a".repeat(100)}`)).statusCode).toBe(200);
      const long = await list(`search=${"a".repeat(101)}`);
      expectEnvelope(long, 400, "VALIDATION_ERROR");
      expect(long.json().errors[0].field).toBe("search");
      expect((await list(`search=${"a".repeat(100_000)}`)).statusCode).toBeLessThan(500);
      for (const cc of ["%00", "%01", "%08", "%0A", "%0D", "%1F", "%7F", "%C2%80", "%C2%9F"]) {
        const res = await list(`search=a${cc}b`);
        expect(res.statusCode, cc).toBe(400);
        expect(res.json().errors[0].field).toBe("search");
      }
      expect((await list("search=%ff%fe")).statusCode).toBeLessThan(500);
      expect((await list("search=a&search=b")).statusCode).toBe(400);
    });

    it("never matches another firm's rows, whatever the term", async () => {
      for (const term of ["Elsewhere", "other-firm", "percent.elsewhere", "50%", "Percent"]) {
        const res = await list(`search=${encodeURIComponent(term)}&limit=100`);
        expect(res.body).not.toContain("percent.elsewhere@other-firm.example");
        expect(res.body).not.toContain("Elsewhere");
      }
      const theirs = await list("search=Elsewhere", otherOwner);
      expect(theirs.json().meta.total).toBe(1);
      expect((await list("search=Plain", otherOwner)).json().meta.total).toBe(0);
    });
  });

  describe("role and status filters", () => {
    const dbCount = (where: object) => t.prisma.firmMember.count({ where: { firm_id: firmId, ...where } });

    it.each(["owner", "manager", "employee", "viewer"] as const)("role=%s: exact total, every row has the role, matches the database", async (role) => {
      const res = await list(`role=${role}&limit=100`);
      expect(res.json().meta.total).toBe(await dbCount({ role }));
      const all = [...res.json().data, ...(await list(`role=${role}&limit=100&page=2`)).json().data] as Row[];
      expect(all.every((u) => u.role === role)).toBe(true);
      expect(all).toHaveLength(res.json().meta.total);
    });

    it.each([
      ["active", true],
      ["inactive", false],
    ] as const)("status=%s", async (status, active) => {
      const res = await list(`status=${status}&limit=100`);
      expect(res.json().meta.total).toBe(await dbCount({ is_active: active }));
      expect((res.json().data as Row[]).every((u) => u.is_active === active)).toBe(true);
    });

    it("combinations equal the database counts: role x status x search", async () => {
      for (const role of ["owner", "manager", "employee", "viewer"] as const) {
        for (const [status, active] of [["active", true], ["inactive", false]] as const) {
          const res = await list(`role=${role}&status=${status}&limit=1`);
          expect(res.json().meta.total, `${role}/${status}`).toBe(await dbCount({ role, is_active: active }));
        }
      }
      const combo = await list("role=viewer&status=inactive&search=score");
      expect(names(combo)).toEqual(["Under_score"]);
      const none = await list("role=owner&status=inactive");
      expect(none.json().data).toEqual([]);
      expect(none.json().meta.total).toBe(0);
      const mixed = await list("role=employee&status=active&search=bulk&limit=100");
      expect(mixed.json().meta.total).toBe(await t.prisma.firmMember.count({ where: { firm_id: firmId, role: "employee", is_active: true, user: { name: { startsWith: "Bulk" } } } }));
    });

    it.each(["role=Owner", "role=OWNER", "role=admin", "role=", "role=owner&role=manager", "role=%00", "status=Active", "status=deleted", "status=", "status=true", "status=1"])("invalid filter %s is a 400", async (qs) => {
      const res = await list(qs);
      expect(res.statusCode).toBe(400);
      expectEnvelope(res, 400, "VALIDATION_ERROR");
    });
  });

  describe("shape and exposure", () => {
    it("every row has exactly the FirmUser keys; no password, hash, token, firm id or membership data", async () => {
      const res = await list("limit=100");
      for (const u of res.json().data) {
        expect(Object.keys(u).sort()).toEqual(["created_at", "email", "id", "is_active", "last_login_at", "name", "role"]);
      }
      expect(res.body).not.toMatch(/password|hash|argon|token|firm_id|memberships/i);
      expect(res.body).not.toContain(firmId);
    });

    it("owner and manager receive the same list; email and name are returned as stored", async () => {
      const a = await list("limit=100");
      const b = await list("limit=100", manager);
      expect(b.statusCode).toBe(200);
      expect(b.body).toBe(a.body);
      const row = ((await list("search=O%27Brien")).json().data as Row[]).find((u) => u.name === "O'Brien")!;
      expect(row.email).toBe("obrien@example.com");
      expect(row.role).toBe("manager");
    });

    it("a deactivated manager cannot read the list; a deactivated user stays visible to the owner as inactive", async () => {
      await t.prisma.firmMember.updateMany({ where: { user_id: named["Manny Manager"]! }, data: { is_active: false } });
      expect((await list("", manager)).statusCode).toBe(401);
      const row = (await list("search=Manny")).json().data[0] as Row;
      expect(row.is_active).toBe(false);
      await t.prisma.firmMember.updateMany({ where: { user_id: named["Manny Manager"]! }, data: { is_active: true } });
      expect((await list("", manager)).statusCode).toBe(200);
    });
  });
});
