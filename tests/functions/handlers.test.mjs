// Unit tests for the Edge Function handlers using fake dependencies.
// Run: node --test tests/functions/   (Node 22.18+ runs .ts imports natively)
import test from "node:test";
import assert from "node:assert/strict";
import { handle as createStaff } from "../../supabase/functions/create-staff-user/handler.ts";
import { handle as setStatus } from "../../supabase/functions/set-account-status/handler.ts";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const CUST = "00000000-0000-0000-0000-0000000000c1";
const EMP = "00000000-0000-0000-0000-0000000000e1";
const ORIGIN = "https://nyota.github.io";

function world() {
  const w = {
    profiles: {
      [ADMIN]: { role: "administrator", account_status: "active" },
      [CUST]: { role: "customer", account_status: "active" },
      [EMP]: { role: "employee", account_status: "active" },
    },
    tokens: { "admin-jwt": ADMIN, "cust-jwt": CUST, "emp-jwt": EMP },
    created: [], deleted: [], audits: [], bans: [], failRole: false, failBan: false, lastAdminGuard: false,
  };
  w.deps = {
    allowedOrigins: [ORIGIN],
    getCallerId: async (t) => w.tokens[t] ?? null,
    getProfile: async (id) => w.profiles[id] ?? null,
    createAuthUser: async ({ email, password, meta }) => {
      if (w.created.some((c) => c.email === email)) return { error: "exists" };
      const id = "00000000-0000-0000-0000-" + String(100 + w.created.length).padStart(12, "0");
      w.created.push({ id, email, password, meta });
      w.profiles[id] = { role: "customer", account_status: "active" };
      return { id };
    },
    deleteAuthUser: async (id) => { w.deleted.push(id); delete w.profiles[id]; },
    setRole: async (id, role) => { if (w.failRole) return false; w.profiles[id].role = role; return true; },
    setStatus: async (id, status) => {
      if (w.lastAdminGuard) return "You cannot deactivate or demote the only active administrator.";
      w.profiles[id].account_status = status; return null;
    },
    setBan: async (id, banned) => { if (w.failBan) return false; w.bans.push([id, banned]); return true; },
    audit: async (r) => { w.audits.push(r); },
  };
  return w;
}
const req = (body, token, o = {}) => new Request("https://x/fn", {
  method: o.method || "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}), ...(o.origin ? { origin: o.origin } : {}) },
  body: o.method === "GET" || o.method === "OPTIONS" ? undefined : JSON.stringify(body),
});
const good = { email: "New.Staff@Nyota.co.ke", first_name: "Neema", last_name: "Waweru", role: "employee", temporary_password: "Temp-Pass-2026" };

test("create-staff-user: rejects anonymous, customer, employee and invalid tokens", async () => {
  for (const t of [undefined, "bad-jwt", "cust-jwt", "emp-jwt"]) {
    const w = world();
    const r = await createStaff(req(good, t), w.deps);
    assert.ok([401, 403].includes(r.status), `token ${t}: ${r.status}`);
    assert.equal(w.created.length, 0);
  }
});
test("create-staff-user: deactivated administrator is refused", async () => {
  const w = world(); w.profiles[ADMIN].account_status = "inactive";
  assert.equal((await createStaff(req(good, "admin-jwt"), w.deps)).status, 403);
  assert.equal(w.created.length, 0);
});
test("create-staff-user: admin creates employee, email lowercased, role set, audited, no password in audit/response", async () => {
  const w = world();
  const r = await createStaff(req(good, "admin-jwt"), w.deps);
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.role, "employee");
  assert.equal(w.created[0].email, "new.staff@nyota.co.ke");
  assert.equal(w.profiles[body.id].role, "employee");
  assert.equal(w.audits[0].actor_id, ADMIN);
  assert.ok(!JSON.stringify(w.audits).includes("Temp-Pass"));
  assert.ok(!JSON.stringify(body).includes("Temp-Pass"));
});
test("create-staff-user: input validation", async () => {
  const bad = [
    { ...good, role: "customer" }, { ...good, role: "root" }, { ...good, role: undefined },
    { ...good, email: "nope" }, { ...good, first_name: "" }, { ...good, last_name: "x".repeat(61) },
    { ...good, temporary_password: "short1" }, { ...good, temporary_password: "onlyletterslong" }, { ...good, temporary_password: "1234567890123" },
    { ...good, phone: "abc" },
  ];
  for (const b of bad) {
    const w = world();
    const r = await createStaff(req(b, "admin-jwt"), w.deps);
    assert.equal(r.status, 400, JSON.stringify(b));
    assert.equal(w.created.length, 0);
  }
});
test("create-staff-user: duplicate email gives 409", async () => {
  const w = world();
  await createStaff(req(good, "admin-jwt"), w.deps);
  assert.equal((await createStaff(req(good, "admin-jwt"), w.deps)).status, 409);
});
test("create-staff-user: role assignment failure rolls back the auth user", async () => {
  const w = world(); w.failRole = true;
  const r = await createStaff(req(good, "admin-jwt"), w.deps);
  assert.equal(r.status, 500);
  assert.equal(w.deleted.length, 1);
  assert.equal(w.audits.length, 0);
});
test("create-staff-user: malformed JSON, GET, and CORS", async () => {
  const w = world();
  const bad = new Request("https://x/fn", { method: "POST", headers: { authorization: "Bearer admin-jwt" }, body: "{not json" });
  assert.equal((await createStaff(bad, w.deps)).status, 400);
  assert.equal((await createStaff(req(null, "admin-jwt", { method: "GET" }), w.deps)).status, 405);
  const ok = await createStaff(req(null, undefined, { method: "OPTIONS", origin: ORIGIN }), w.deps);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  const evil = await createStaff(req(null, undefined, { method: "OPTIONS", origin: "https://evil.example" }), w.deps);
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
});

test("set-account-status: only administrators", async () => {
  for (const t of [undefined, "cust-jwt", "emp-jwt"]) {
    const w = world();
    const r = await setStatus(req({ user_id: EMP, status: "inactive" }, t), w.deps);
    assert.ok([401, 403].includes(r.status));
    assert.equal(w.profiles[EMP].account_status, "active");
  }
});
test("set-account-status: deactivates, bans, audits; reactivation unbans", async () => {
  const w = world();
  let r = await setStatus(req({ user_id: EMP, status: "inactive" }, "admin-jwt"), w.deps);
  assert.equal(r.status, 200);
  assert.equal(w.profiles[EMP].account_status, "inactive");
  assert.deepEqual(w.bans.at(-1), [EMP, true]);
  assert.equal(w.audits.at(-1).action, "account_deactivated");
  r = await setStatus(req({ user_id: EMP, status: "active" }, "admin-jwt"), w.deps);
  assert.deepEqual(w.bans.at(-1), [EMP, false]);
  assert.equal(w.audits.at(-1).action, "account_activated");
});
test("set-account-status: cannot change own status, validates input, unknown user, no-op", async () => {
  const w = world();
  assert.equal((await setStatus(req({ user_id: ADMIN, status: "inactive" }, "admin-jwt"), w.deps)).status, 400);
  assert.equal((await setStatus(req({ user_id: "nope", status: "inactive" }, "admin-jwt"), w.deps)).status, 400);
  assert.equal((await setStatus(req({ user_id: EMP, status: "banned" }, "admin-jwt"), w.deps)).status, 400);
  assert.equal((await setStatus(req({ user_id: "00000000-0000-0000-0000-00000000ffff", status: "inactive" }, "admin-jwt"), w.deps)).status, 404);
  const r = await setStatus(req({ user_id: CUST, status: "active" }, "admin-jwt"), w.deps);
  assert.equal((await r.json()).changed, false);
  assert.equal(w.bans.length, 0);
});
test("set-account-status: database guard error surfaces and nothing is banned", async () => {
  const w = world(); w.lastAdminGuard = true;
  const r = await setStatus(req({ user_id: EMP, status: "inactive" }, "admin-jwt"), w.deps);
  assert.equal(r.status, 409);
  assert.equal(w.bans.length, 0);
});
test("set-account-status: ban failure rolls the profile back", async () => {
  const w = world(); w.failBan = true;
  const r = await setStatus(req({ user_id: EMP, status: "inactive" }, "admin-jwt"), w.deps);
  assert.equal(r.status, 500);
  assert.equal(w.profiles[EMP].account_status, "active");
  assert.equal(w.audits.length, 0);
});
