import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "../src/generated/prisma/client.js";
import { createMember, hasTestDb, makeTestApp, resetDb, type TestApp } from "./db-helpers.js";
import type { FirmFixture } from "./support/firms.js";
import {
  ACCEPT,
  INVITATIONS,
  INVITE,
  ME,
  NO_ONE,
  PREVIEW,
  USERS,
  call,
  cookieFor,
  expectEnvelope,
  firmWithAllRoles,
  inviteVia,
  tokenOf,
} from "./support/slice3.js";

/**
 * Critical scenario #1 for every firm-scoped P1 endpoint (users and invitations), with THREE firms.
 * Fixture built once; every attempt that must fail is followed by a byte-for-byte comparison of the other
 * firms' rows.
 */
const ROLES: UserRole[] = ["owner", "manager", "employee", "viewer"];
const NAMES = ["A", "B", "C"] as const;
type FirmName = (typeof NAMES)[number];

interface FirmWorld {
  f: FirmFixture;
  name: FirmName;
  /** all user ids of the firm (4 roles + marker user + accepted invitee) */
  userIds: string[];
  markerEmail: string;
  markerName: string;
  invitations: { pending: string; revoked: string; expired: string; accepted: string };
  pendingToken: string;
  sharedToken: string;
  emails: string[];
  invitationEmails: string[];
}

describe.skipIf(!hasTestDb)("tenant isolation: users and invitations (three firms)", () => {
  let t: TestApp;
  const W = {} as Record<FirmName, FirmWorld>;

  async function firmSnapshot(w: FirmWorld): Promise<string> {
    const firmId = w.f.firmId;
    const members = await t.prisma.firmMember.findMany({ where: { firm_id: firmId }, orderBy: { id: "asc" } });
    const users = await t.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.user_id) } },
      orderBy: { id: "asc" },
    });
    const invitations = await t.prisma.invitation.findMany({ where: { firm_id: firmId }, orderBy: { id: "asc" } });
    const firm = await t.prisma.firm.findUniqueOrThrow({ where: { id: firmId } });
    return JSON.stringify({ members, users, invitations, firm });
  }
  const snapshotsOf = async (names: FirmName[]) => Object.fromEntries(await Promise.all(names.map(async (n) => [n, await firmSnapshot(W[n])])));
  const others = (n: FirmName) => NAMES.filter((x) => x !== n);

  beforeAll(async () => {
    t = await makeTestApp();
    await resetDb(t.prisma);
    for (const name of NAMES) {
      const f = await firmWithAllRoles(t, `Firm ${name} Associates`);
      const marker = await createMember(t.prisma, {
        firm_id: f.firmId,
        role: "employee",
        name: `${name}-Marker Person`,
        email: `${name.toLowerCase()}.marker@${name.toLowerCase()}-firm.example`,
      });
      // invitations: pending (with a colliding email shared by all three firms), accepted, revoked, expired
      const pending = await inviteVia(t, f.cookies.owner, `${name.toLowerCase()}.pending@example.com`, "manager");
      const shared = await inviteVia(t, f.cookies.owner, "shared.person@example.com", name === "A" ? "manager" : name === "B" ? "viewer" : "employee");
      const toRevoke = await inviteVia(t, f.cookies.owner, `${name.toLowerCase()}.revoked@example.com`);
      expect((await call(t, "DELETE", `${INVITATIONS}/${toRevoke.id}`, f.cookies.owner)).statusCode).toBe(200);
      const toExpire = await inviteVia(t, f.cookies.owner, `${name.toLowerCase()}.expired@example.com`);
      await t.prisma.invitation.update({ where: { id: toExpire.id }, data: { expires_at: new Date(Date.now() - 60_000) } });
      const toAccept = await inviteVia(t, f.cookies.owner, `${name.toLowerCase()}.joined@example.com`, "viewer");
      const acc = await call(t, "POST", ACCEPT, undefined, { token: toAccept.token, name: `${name}-Joined Person`, password: "Fresh-pass-77" });
      expect(acc.statusCode).toBe(201);
      const members = await t.prisma.firmMember.findMany({ where: { firm_id: f.firmId } });
      W[name] = {
        f,
        name,
        userIds: members.map((m) => m.user_id),
        markerEmail: marker.email,
        markerName: `${name}-Marker Person`,
        invitations: { pending: pending.id, revoked: toRevoke.id, expired: toExpire.id, accepted: toAccept.id },
        pendingToken: pending.token,
        sharedToken: shared.token,
        emails: (await t.prisma.user.findMany({ where: { id: { in: members.map((m) => m.user_id) } } })).map((u) => u.email),
        invitationEmails: [
          `${name.toLowerCase()}.pending@example.com`,
          `${name.toLowerCase()}.revoked@example.com`,
          `${name.toLowerCase()}.expired@example.com`,
          `${name.toLowerCase()}.joined@example.com`,
        ],
      };
    }
  }, 180_000);
  afterAll(async () => {
    await t?.close();
  });

  it("fixture sanity: each firm has 6 members and 5 invitations (pending x2, revoked, expired, accepted)", async () => {
    for (const n of NAMES) {
      expect(W[n].userIds).toHaveLength(6);
      expect(await t.prisma.invitation.count({ where: { firm_id: W[n].f.firmId } })).toBe(5);
    }
  });

  describe("lists never include another firm's rows, and counts are exact", () => {
    it.each(NAMES)("GET /users as firm %s owner and manager", async (n) => {
      const mine = W[n];
      for (const role of ["owner", "manager"] as const) {
        const res = await call(t, "GET", `${USERS}?limit=100`, mine.f.cookies[role]);
        expect(res.statusCode).toBe(200);
        const ids = res.json().data.map((u: { id: string }) => u.id).sort();
        expect(ids).toEqual([...mine.userIds].sort());
        expect(res.json().meta.total).toBe(6);
        for (const o of others(n)) {
          for (const id of W[o].userIds) expect(res.body).not.toContain(id);
          for (const email of W[o].emails) expect(res.body).not.toContain(email);
          expect(res.body).not.toContain(W[o].markerName);
          expect(res.body).not.toContain(W[o].f.firmId);
        }
      }
    });

    it.each(NAMES)("GET /invitations as firm %s owner: only own rows, exact totals per status", async (n) => {
      const mine = W[n];
      const all = await call(t, "GET", `${INVITATIONS}?limit=100`, mine.f.cookies.owner);
      expect(all.json().meta.total).toBe(5);
      expect(all.json().data.map((i: { id: string }) => i.id).sort()).toEqual(
        (await t.prisma.invitation.findMany({ where: { firm_id: mine.f.firmId } })).map((i) => i.id).sort(),
      );
      const totals: Record<string, number> = { pending: 2, accepted: 1, revoked: 1, expired: 1 };
      for (const [status, total] of Object.entries(totals)) {
        const res = await call(t, "GET", `${INVITATIONS}?status=${status}`, mine.f.cookies.owner);
        expect(res.json().meta.total, status).toBe(total);
        expect(res.json().data.every((i: { status: string }) => i.status === status)).toBe(true);
      }
      for (const o of others(n)) {
        for (const email of W[o].invitationEmails) expect(all.body).not.toContain(email);
        for (const id of Object.values(W[o].invitations)) expect(all.body).not.toContain(id);
        expect(all.body).not.toContain(W[o].f.userIds.owner);
        expect(all.body).not.toContain(`${W[o].name}-Joined Person`);
      }
      // no token or hash of anything, ever
      expect(all.body).not.toMatch(/token/i);
    });

    it.each(NAMES)("search and filters of firm %s never reach into the other firms", async (n) => {
      const mine = W[n];
      const cookie = mine.f.cookies.owner;
      const q = (qs: string) => call(t, "GET", `${USERS}?${qs}`, cookie);
      // own marker found, others' markers not
      expect((await q(`search=${encodeURIComponent(mine.markerName)}`)).json().meta.total).toBe(1);
      for (const o of others(n)) {
        for (const term of [W[o].markerName, W[o].markerEmail, `${W[o].name.toLowerCase()}-firm.example`, W[o].markerName.toUpperCase(), W[o].markerName.slice(0, 3)]) {
          const res = await q(`search=${encodeURIComponent(term)}`);
          expect(res.statusCode).toBe(200);
          if (!term.startsWith(mine.name) && !mine.markerName.toLowerCase().includes(term.toLowerCase())) {
            expect(res.json().meta.total, `${n} searching ${term}`).toBe(0);
          }
          expect(res.body).not.toContain(W[o].markerEmail);
        }
        for (const email of W[o].emails) expect((await q(`search=${encodeURIComponent(email)}`)).json().meta.total).toBe(0);
        for (const id of W[o].userIds) expect((await q(`search=${id}`)).json().meta.total).toBe(0);
      }
      // wildcard search matches only this firm's rows: all of them, not all three firms'
      for (const term of ["%", "_", "example"]) {
        const res = await q(`search=${encodeURIComponent(term)}&limit=100`);
        const expected = term === "example" ? 6 : 0;
        expect(res.json().meta.total, term).toBe(expected);
      }
      // role and status filters count only this firm
      const counts: Record<string, number> = { owner: 1, manager: 1, employee: 2, viewer: 2 };
      for (const [role, total] of Object.entries(counts)) {
        expect((await q(`role=${role}`)).json().meta.total, role).toBe(total);
      }
      expect((await q("status=active")).json().meta.total).toBe(6);
      expect((await q("status=inactive")).json().meta.total).toBe(0);
    });

    it("lists stay exact when another firm is large (45 extra members in firm B)", async () => {
      const extra = Array.from({ length: 45 }, (_, i) => ({
        email: `bulk${i}@b-bulk.example`,
        name: `Bulk ${String(i).padStart(2, "0")}`,
        password_hash: "not-a-real-hash",
      }));
      const created = [];
      for (const e of extra) {
        created.push(await t.prisma.user.create({ data: { ...e, memberships: { create: { firm_id: W.B.f.firmId, role: "viewer" } } } }));
      }
      const bAll = await call(t, "GET", `${USERS}?limit=100`, W.B.f.cookies.owner);
      expect(bAll.json().meta.total).toBe(51);
      const a = await call(t, "GET", `${USERS}?limit=100`, W.A.f.cookies.owner);
      expect(a.json().meta.total).toBe(6);
      expect(a.body).not.toContain("b-bulk.example");
      // page through firm B in pages of 20: union is exactly B's members, no duplicates, nothing of A or C
      const seen: string[] = [];
      for (const page of [1, 2, 3, 4]) {
        const res = await call(t, "GET", `${USERS}?page=${page}&limit=20`, W.B.f.cookies.owner);
        for (const u of res.json().data) seen.push(u.id);
      }
      expect(seen).toHaveLength(51);
      expect(new Set(seen).size).toBe(51);
      for (const id of [...W.A.userIds, ...W.C.userIds]) expect(seen).not.toContain(id);
      // clean up so later tests keep the 6-member world
      await t.prisma.user.deleteMany({ where: { id: { in: created.map((u) => u.id) } } });
      expect((await call(t, "GET", USERS, W.B.f.cookies.owner)).json().meta.total).toBe(6);
    });
  });

  describe("another firm's ids are 404 for every role on every endpoint (and nothing changes)", () => {
    it.each(NAMES)("firm %s identities against both other firms' users", async (n) => {
      const before = await snapshotsOf(NAMES.slice());
      for (const role of ROLES) {
        const cookie = W[n].f.cookies[role];
        for (const o of others(n)) {
          for (const id of W[o].userIds) {
            const get = await call(t, "GET", `${USERS}/${id}`, cookie);
            expectEnvelope(get, 404, "NOT_FOUND");
            const patch = await call(t, "PATCH", `${USERS}/${id}`, cookie, { name: "Cross Firm Rename" });
            expectEnvelope(patch, 404, "NOT_FOUND");
            const roleRes = await call(t, "PATCH", `${USERS}/${id}/role`, cookie, { role: "viewer" });
            const statusRes = await call(t, "PATCH", `${USERS}/${id}/status`, cookie, { is_active: false });
            // owner-only routes: the owner sees 404; everyone else is stopped at the role check (403)
            expect(roleRes.statusCode, `${n}/${role} role ${id}`).toBe(role === "owner" ? 404 : 403);
            expect(statusRes.statusCode, `${n}/${role} status ${id}`).toBe(role === "owner" ? 404 : 403);
            // identical to a user id that does not exist at all
            const unknown = await call(t, "GET", `${USERS}/${NO_ONE}`, cookie);
            expect(get.body).toBe(unknown.body);
          }
          for (const id of Object.values(W[o].invitations)) {
            const res = await call(t, "DELETE", `${INVITATIONS}/${id}`, cookie);
            expect(res.statusCode, `${n}/${role} delete ${id}`).toBe(role === "owner" ? 404 : 403);
            if (role === "owner") {
              const unknown = await call(t, "DELETE", `${INVITATIONS}/${NO_ONE}`, cookie);
              expect(res.body).toBe(unknown.body);
            }
          }
        }
      }
      expect(await snapshotsOf(NAMES.slice())).toEqual(before);
    });

    it("the owner's own firm still works after all those attempts (not blocked, nothing leaked in error bodies)", async () => {
      for (const n of NAMES) {
        const self = await call(t, "GET", `${USERS}/${W[n].f.userIds.employee}`, W[n].f.cookies.owner);
        expect(self.statusCode).toBe(200);
        expect(self.json().data.id).toBe(W[n].f.userIds.employee);
      }
    });
  });

  describe("smuggled firm / identity fields are ignored or rejected", () => {
    it("query, header and body firm ids on reads and writes never change which firm answers", async () => {
      const before = await snapshotsOf(["B", "C"]);
      const aOwner = W.A.f.cookies.owner;
      const smuggledHeaders = {
        "x-firm-id": W.B.f.firmId,
        "x-tenant-id": W.B.f.firmId,
        "firm-id": W.B.f.firmId,
        "x-forwarded-firm": W.B.f.firmId,
        "x-user-id": W.B.f.userIds.owner,
        "x-original-url": `${USERS}/${W.B.f.userIds.owner}`,
      };
      const list = await call(t, "GET", `${USERS}?firm_id=${W.B.f.firmId}&firmId=${W.B.f.firmId}&user_id=${W.B.f.userIds.owner}&limit=100`, aOwner, undefined, smuggledHeaders);
      expect(list.json().data.map((u: { id: string }) => u.id).sort()).toEqual([...W.A.userIds].sort());
      const inv = await call(t, "GET", `${INVITATIONS}?firm_id=${W.B.f.firmId}&limit=100`, aOwner, undefined, smuggledHeaders);
      expect(inv.json().meta.total).toBe(5);
      expect(inv.body).not.toContain(W.B.invitationEmails[0]!);

      const invited = await call(
        t,
        "POST",
        INVITE,
        aOwner,
        {
          email: "smuggle.a@example.com",
          role: "viewer",
          firm_id: W.B.f.firmId,
          invited_by_id: W.B.f.userIds.owner,
          status: "accepted",
          id: W.B.invitations.pending,
        },
        smuggledHeaders,
      );
      expect(invited.statusCode).toBe(201);
      const row = await t.prisma.invitation.findUniqueOrThrow({ where: { id: invited.json().data.id } });
      expect(row.firm_id).toBe(W.A.f.firmId);
      expect(row.invited_by_id).toBe(W.A.f.userIds.owner);
      expect(row.status).toBe("pending");
      expect(row.id).not.toBe(W.B.invitations.pending);

      const rename = await call(
        t,
        "PATCH",
        `${USERS}/${W.A.f.userIds.viewer}`,
        aOwner,
        { name: "Smuggle Rename", firm_id: W.B.f.firmId, id: W.B.f.userIds.viewer, role: "owner", is_active: false, email: "hijack@example.com", password: "Hijack-pass-1" },
        smuggledHeaders,
      );
      expect(rename.statusCode).toBe(200);
      expect(rename.json().data).toMatchObject({ id: W.A.f.userIds.viewer, name: "Smuggle Rename", role: "viewer", is_active: true });
      expect(rename.json().data.email).not.toBe("hijack@example.com");

      const roleRes = await call(t, "PATCH", `${USERS}/${W.A.f.userIds.viewer}/role`, aOwner, { role: "employee", firm_id: W.B.f.firmId, user_id: W.B.f.userIds.viewer }, smuggledHeaders);
      expect(roleRes.json().data.id).toBe(W.A.f.userIds.viewer);
      const status = await call(t, "PATCH", `${USERS}/${W.A.f.userIds.viewer}/status`, aOwner, { is_active: true, firm_id: W.B.f.firmId }, smuggledHeaders);
      expect(status.json().data.id).toBe(W.A.f.userIds.viewer);

      expect(await snapshotsOf(["B", "C"])).toEqual(before);
      // restore A's viewer for later tests
      await call(t, "PATCH", `${USERS}/${W.A.f.userIds.viewer}/role`, aOwner, { role: "viewer" });
      await call(t, "PATCH", `${USERS}/${W.A.f.userIds.viewer}`, aOwner, { name: "Test viewer" });
      await call(t, "DELETE", `${INVITATIONS}/${invited.json().data.id}`, aOwner);
    });

    it("a path or query that names the other firm's id while the id in the path is own: path id wins, other firm unchanged", async () => {
      const before = await snapshotsOf(["B"]);
      const url = `${USERS}/${W.A.f.userIds.employee}?id=${W.B.f.userIds.employee}&user_id=${W.B.f.userIds.employee}`;
      const res = await call(t, "GET", url, W.A.f.cookies.owner);
      expect(res.json().data.id).toBe(W.A.f.userIds.employee);
      const res2 = await call(t, "GET", `${USERS}/${W.B.f.userIds.employee}?firm_id=${W.A.f.firmId}`, W.A.f.cookies.owner);
      expect(res2.statusCode).toBe(404);
      expect(await snapshotsOf(["B"])).toEqual(before);
    });

    it("forged sessions mixing firms (A's user with B's firm and the reverse, any claimed role) are 401 on every users/invitations endpoint", async () => {
      const urls: [string, string, unknown?][] = [
        ["GET", USERS],
        ["POST", INVITE, { email: "x@example.com", role: "viewer" }],
        ["GET", `${USERS}/${W.A.f.userIds.owner}`],
        ["GET", `${USERS}/${W.B.f.userIds.owner}`],
        ["PATCH", `${USERS}/${W.B.f.userIds.viewer}`, { name: "Nope" }],
        ["PATCH", `${USERS}/${W.B.f.userIds.viewer}/role`, { role: "manager" }],
        ["PATCH", `${USERS}/${W.B.f.userIds.viewer}/status`, { is_active: false }],
        ["GET", INVITATIONS],
        ["DELETE", `${INVITATIONS}/${W.B.invitations.pending}`],
        ["GET", ME],
      ];
      const before = await snapshotsOf(NAMES.slice());
      for (const [ua, ub] of [
        [W.A, W.B],
        [W.B, W.A],
        [W.C, W.A],
      ] as const) {
        for (const role of ROLES) {
          const forged = cookieFor(t, ua.f.userIds.owner, ub.f.firmId, role);
          for (const [m, url, body] of urls) {
            const res = await call(t, m as "GET", url, forged, body);
            expect(res.statusCode, `${ua.name}->${ub.name} ${role} ${m} ${url}`).toBe(401);
          }
        }
      }
      expect(await snapshotsOf(NAMES.slice())).toEqual(before);
    });
  });

  describe("invitations never cross firms", () => {
    it("A's owner inviting an address that is a member (any role) of firm B succeeds without revealing B: same 201 shape as a fresh address", async () => {
      const fresh = await call(t, "POST", INVITE, W.A.f.cookies.owner, { email: "fresh.address@example.com", role: "viewer" });
      const cross = await call(t, "POST", INVITE, W.A.f.cookies.owner, { email: W.B.emails[0]!, role: "viewer" });
      expect(fresh.statusCode).toBe(201);
      expect(cross.statusCode).toBe(201);
      expect(Object.keys(cross.json().data).sort()).toEqual(Object.keys(fresh.json().data).sort());
      expect(cross.body).not.toContain(W.B.f.firmId);
      expect(cross.body).not.toContain(W.B.f.userIds.owner);
      // an address that is already a member of A's own firm IS a 409
      const own = await call(t, "POST", INVITE, W.A.f.cookies.owner, { email: W.A.emails[0]!, role: "viewer" });
      expectEnvelope(own, 409, "CONFLICT");
      expect(own.body).not.toContain(W.B.f.firmId);
      // B's lists did not change
      const bInv = await call(t, "GET", `${INVITATIONS}?limit=100`, W.B.f.cookies.owner);
      expect(bInv.json().meta.total).toBe(5);
      for (const res of [fresh, cross]) {
        await call(t, "DELETE", `${INVITATIONS}/${res.json().data.id}`, W.A.f.cookies.owner);
      }
    });

    it("a firm B member, invited by A, accepting A's link gets 409 and stays in B only (nothing created in A)", async () => {
      const inv = await inviteVia(t, W.A.f.cookies.owner, W.B.emails[1]!, "manager");
      const usersBefore = await t.prisma.user.count();
      const res = await call(t, "POST", ACCEPT, undefined, { token: inv.token, name: "Cross Join", password: "Fresh-pass-77" });
      expectEnvelope(res, 409, "CONFLICT");
      expect(await t.prisma.user.count()).toBe(usersBefore);
      const memberships = await t.prisma.firmMember.findMany({ where: { user: { email: W.B.emails[1]! } } });
      expect(memberships.map((m) => m.firm_id)).toEqual([W.B.f.firmId]);
      await call(t, "DELETE", `${INVITATIONS}/${inv.id}`, W.A.f.cookies.owner);
    });

    it("preview shows only the issuing firm's name, whoever asks; no ids, no other firm", async () => {
      for (const n of NAMES) {
        for (const asker of NAMES) {
          const res = await call(t, "GET", PREVIEW(W[n].pendingToken), W[asker].f.cookies.owner);
          expect(res.statusCode).toBe(200);
          expect(res.json().data).toEqual({
            email: `${n.toLowerCase()}.pending@example.com`,
            role: "manager",
            firm_name: `Firm ${n} Associates`,
            expires_at: res.json().data.expires_at,
          });
          for (const x of NAMES.filter((x) => x !== n)) expect(res.body).not.toContain(`Firm ${x} Associates`);
          expect(res.body).not.toContain(W[n].f.firmId);
        }
      }
    });

    it("the same email invited by all three firms: one accept wins (201, that firm only), the others are 409 and create nothing; losers can be revoked", async () => {
      const order: FirmName[] = ["B", "A", "C"];
      const winner = order[0]!;
      const usersBefore = await t.prisma.user.count();
      const tokens = Object.fromEntries(NAMES.map((n) => [n, W[n].sharedToken]));
      const results = await Promise.all(
        order.map((n) => call(t, "POST", ACCEPT, undefined, { token: tokens[n]!, name: `Shared via ${n}`, password: "Fresh-pass-77" })),
      );
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 409, 409]);
      expect(await t.prisma.user.count()).toBe(usersBefore + 1);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { email: "shared.person@example.com" }, include: { memberships: true } });
      expect(user.memberships).toHaveLength(1);
      const winnerIdx = results.findIndex((r) => r.statusCode === 201);
      const winnerFirm = order[winnerIdx]!;
      expect(user.memberships[0]!.firm_id).toBe(W[winnerFirm].f.firmId);
      // role is the one THAT firm's invitation carried, not another firm's
      const wantedRole = winnerFirm === "A" ? "manager" : winnerFirm === "B" ? "viewer" : "employee";
      expect(user.memberships[0]!.role).toBe(wantedRole);
      expect(results[winnerIdx]!.json().data.firm.id).toBe(W[winnerFirm].f.firmId);
      void winner;
      // losers' invitations are still pending but their owners can revoke; the winner's firm shows accepted
      for (const n of NAMES) {
        const list = await call(t, "GET", `${INVITATIONS}?limit=100`, W[n].f.cookies.owner);
        const row = list.json().data.find((i: { email: string }) => i.email === "shared.person@example.com");
        expect(row.status, n).toBe(n === winnerFirm ? "accepted" : "pending");
        if (n !== winnerFirm) {
          expect((await call(t, "DELETE", `${INVITATIONS}/${row.id}`, W[n].f.cookies.owner)).statusCode).toBe(200);
        }
      }
      // the new user is a member of the winner only: other firms' lists do not contain them
      for (const n of NAMES.filter((x) => x !== winnerFirm)) {
        const res = await call(t, "GET", `${USERS}?limit=100`, W[n].f.cookies.owner);
        expect(res.body).not.toContain("shared.person@example.com");
      }
      // keep the world consistent for later tests: remove the new user
      await t.prisma.user.delete({ where: { id: user.id } });
    });

    it("tokens bind to their own invitation: accept with firm B's token yields firm B membership only, never A's, and the new user sees only B", async () => {
      const inv = await inviteVia(t, W.B.f.cookies.owner, "only.b@example.com", "manager");
      const beforeA = await firmSnapshot(W.A);
      const res = await call(t, "POST", ACCEPT, W.A.f.cookies.owner, { token: inv.token, name: "Only B", password: "Fresh-pass-77" });
      expect(res.statusCode).toBe(201);
      expect(res.json().data.firm.id).toBe(W.B.f.firmId);
      expect(res.json().data.role).toBe("manager");
      expect(await firmSnapshot(W.A)).toBe(beforeA);
      const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
      const list = await call(t, "GET", `${USERS}?limit=100`, cookie);
      expect(list.statusCode).toBe(200);
      expect(list.json().meta.total).toBe(7);
      expect(list.body).not.toContain(W.A.f.userIds.owner);
      for (const id of W.A.userIds) {
        expect((await call(t, "GET", `${USERS}/${id}`, cookie)).statusCode).toBe(404);
      }
      expect((await call(t, "GET", INVITATIONS, cookie)).statusCode).toBe(403);
      // clean up
      await t.prisma.user.deleteMany({ where: { email: "only.b@example.com" } });
      await t.prisma.invitation.deleteMany({ where: { id: inv.id } });
    });

    it("a token of firm B's invitation id or hash is not a credential for firm A: revoke by A's owner uses ids only for A's rows", async () => {
      const row = await t.prisma.invitation.findUniqueOrThrow({ where: { id: W.B.invitations.pending } });
      for (const candidate of [row.token_hash, row.id, W.B.invitations.pending.replace(/-/g, "")]) {
        expect((await call(t, "GET", PREVIEW(candidate))).statusCode).toBe(404);
        const acc = await call(t, "POST", ACCEPT, undefined, { token: candidate, name: "Nope", password: "Fresh-pass-77" });
        expect(acc.statusCode).toBe(404);
      }
      expect((await call(t, "DELETE", `${INVITATIONS}/${W.B.invitations.pending}`, W.A.f.cookies.owner)).statusCode).toBe(404);
      expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: W.B.invitations.pending } })).status).toBe("pending");
    });

    it("revoking in firm A never touches firm B's pending invitation, even with identical emails and roles", async () => {
      const a = await inviteVia(t, W.A.f.cookies.owner, "twin@example.com", "viewer");
      const b = await inviteVia(t, W.B.f.cookies.owner, "twin@example.com", "viewer");
      expect((await call(t, "DELETE", `${INVITATIONS}/${a.id}`, W.A.f.cookies.owner)).statusCode).toBe(200);
      expect((await t.prisma.invitation.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("pending");
      expect((await call(t, "GET", PREVIEW(b.token))).statusCode).toBe(200);
      expect((await call(t, "GET", PREVIEW(a.token))).statusCode).toBe(404);
      await call(t, "DELETE", `${INVITATIONS}/${b.id}`, W.B.f.cookies.owner);
    });
  });

  describe("changes in one firm are invisible to the others", () => {
    it("deactivating or re-roling in A does not touch B's or C's same-named users or their sessions", async () => {
      const before = await snapshotsOf(["B", "C"]);
      for (const role of ["manager", "employee", "viewer"] as const) {
        await call(t, "PATCH", `${USERS}/${W.A.f.userIds[role]}/status`, W.A.f.cookies.owner, { is_active: false });
        expect((await call(t, "GET", ME, W.A.f.cookies[role])).statusCode).toBe(401);
        expect((await call(t, "GET", ME, W.B.f.cookies[role])).statusCode).toBe(200);
        expect((await call(t, "GET", ME, W.C.f.cookies[role])).statusCode).toBe(200);
        await call(t, "PATCH", `${USERS}/${W.A.f.userIds[role]}/status`, W.A.f.cookies.owner, { is_active: true });
      }
      expect(await snapshotsOf(["B", "C"])).toEqual(before);
    });

    it("all three owners changing their own firm's members at the same moment only ever change their own firm", async () => {
      const results = await Promise.all(
        NAMES.flatMap((n) => [
          call(t, "PATCH", `${USERS}/${W[n].f.userIds.employee}/role`, W[n].f.cookies.owner, { role: "manager" }),
          call(t, "PATCH", `${USERS}/${W[n].f.userIds.viewer}`, W[n].f.cookies.owner, { name: `Renamed in ${n}` }),
          call(t, "POST", INVITE, W[n].f.cookies.owner, { email: `parallel.${n.toLowerCase()}@example.com`, role: "viewer" }),
        ]),
      );
      expect(results.map((r) => r.statusCode)).toEqual([200, 200, 201, 200, 200, 201, 200, 200, 201]);
      for (const n of NAMES) {
        const members = await t.prisma.firmMember.findMany({ where: { firm_id: W[n].f.firmId }, include: { user: true } });
        expect(members.find((m) => m.user_id === W[n].f.userIds.employee)!.role).toBe("manager");
        expect(members.find((m) => m.user_id === W[n].f.userIds.viewer)!.user.name).toBe(`Renamed in ${n}`);
        const inv = await t.prisma.invitation.findMany({ where: { email: `parallel.${n.toLowerCase()}@example.com` } });
        expect(inv.map((i) => i.firm_id)).toEqual([W[n].f.firmId]);
      }
    });
  });
});
