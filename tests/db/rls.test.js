// Database security tests: applies the migrations to a scratch PostgreSQL database
// (with a Supabase stub) and attacks the rules as every role.
//
//   PGHOST=<socket dir or host> PGPORT=5432 PGUSER=postgres node rls.test.js
//
// Requires the "pg" package. Uses a throwaway database named nyota_test.
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const DB = "nyota_test";
const ROOT = path.join(__dirname, "..", "..");
let passed = 0, failed = 0;
const failures = [];

function check(name, cond, extra = "") {
  if (cond) { passed++; console.log("  PASS", name); }
  else { failed++; failures.push(name); console.log("  FAIL", name, extra ? "| " + extra : ""); }
}

async function connect(db = DB) {
  const c = new Client({ database: db });
  await c.connect();
  return c;
}

/** Run one statement in its own transaction as a given identity. ctx = null => trusted (postgres). */
async function run(ctx, sql, params = []) {
  const c = await connect();
  try {
    await c.query("begin");
    if (ctx) {
      await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)",
        [ctx.id || "", ctx.role || "authenticated"]);
      await c.query(`set local role ${ctx.role || "authenticated"}`);
    }
    const r = await c.query(sql, params);
    await c.query("commit");
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    await c.query("rollback").catch(() => {});
    return { ok: false, error: e.message, code: e.code };
  } finally {
    await c.end();
  }
}

const U = {
  admin:   "00000000-0000-0000-0000-0000000000a1",
  admin2:  "00000000-0000-0000-0000-0000000000a2",
  manager: "00000000-0000-0000-0000-0000000000b1",
  emp1:    "00000000-0000-0000-0000-0000000000e1",
  emp2:    "00000000-0000-0000-0000-0000000000e2",
  empOff:  "00000000-0000-0000-0000-0000000000e3",   // deactivated employee
  cust1:   "00000000-0000-0000-0000-0000000000c1",
  cust2:   "00000000-0000-0000-0000-0000000000c2",
  evil:    "00000000-0000-0000-0000-0000000000ee",
};
const as = (key) => ({ id: U[key], role: "authenticated" });
const anon = { id: "", role: "anon" };

const INSERT_FB = `insert into public.feedback
  (customer_id, feedback_type, subject, description, service_rating, served_by_employee_id,
   product_service_category, preferred_response_method)
  values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, reference_number, status, customer_id`;
const fb = (who, subject, o = {}) => run(as(who), INSERT_FB, [
  o.customer_id ?? U[who], o.type ?? "complaint", subject, o.description ?? "The blender stopped working after two days.",
  o.rating ?? 3, o.served_by ?? null, o.category ?? "Electronics", o.method ?? "email"]);

async function setup() {
  const admin = await connect("postgres");
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.query(`create database ${DB}`);
  await admin.end();

  const c = await connect();
  await c.query(fs.readFileSync(path.join(__dirname, "00_supabase_stub.sql"), "utf8"));
  const dir = path.join(ROOT, "supabase", "migrations");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try { await c.query(fs.readFileSync(path.join(dir, f), "utf8")); console.log("  applied", f); }
    catch (e) { console.log("  MIGRATION FAILED", f, e.message); process.exit(1); }
  }

  // Sign-ups. The "evil" user tries to smuggle a role in through sign-up metadata.
  const users = [
    ["admin", "admin@nyota.test", { first_name: "Alice", last_name: "Njoroge" }],
    ["admin2", "admin2@nyota.test", { first_name: "Amos" }],
    ["manager", "manager@nyota.test", { first_name: "Brian", last_name: "Mutua" }],
    ["emp1", "emp1@nyota.test", { first_name: "Cynthia", last_name: "Wanjiru" }],
    ["emp2", "emp2@nyota.test", { first_name: "Daniel", last_name: "Otieno" }],
    ["empOff", "empoff@nyota.test", { first_name: "Eve" }],
    ["cust1", "cust1@nyota.test", { first_name: "John", last_name: "Kamau", phone: "0712 345 678" }],
    ["cust2", "cust2@nyota.test", { first_name: "Mary", last_name: "Atieno" }],
    ["evil", "evil@nyota.test", { first_name: "Mallory", role: "administrator", account_status: "active" }],
  ];
  for (const [k, email, meta] of users) {
    await c.query("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [U[k], email, meta]);
  }
  // Staff are promoted from a trusted context (what the Edge Function / dashboard SQL does).
  const promote = { admin: "administrator", manager: "manager", emp1: "employee", emp2: "employee", empOff: "employee" };
  for (const [k, role] of Object.entries(promote)) {
    await c.query("update public.profiles set role=$2 where id=$1", [U[k], role]);
  }
  await c.query("update public.profiles set account_status='inactive' where id=$1", [U.empOff]);
  await c.query("delete from public.audit_logs");   // start the audit assertions from a clean slate
  await c.end();
}

(async () => {
  console.log("Setup");
  await setup();

  // -------------------------------------------------------------- sign-up
  console.log("\nSign-up and profiles");
  let r = await run(null, "select role, account_status, first_name, last_name, phone from public.profiles where id=$1", [U.evil]);
  check("sign-up metadata cannot create a privileged account (role stays customer)", r.rows[0]?.role === "customer", JSON.stringify(r.rows[0]));
  r = await run(null, "select first_name, last_name, phone from public.profiles where id=$1", [U.cust1]);
  check("profile gets names and normalised phone from sign-up", r.rows[0]?.first_name === "John" && r.rows[0]?.phone === "0712345678", JSON.stringify(r.rows[0]));
  r = await run(null, "select count(*)::int n from public.profiles where role='customer'");
  check("sign-ups created 4 customers (cust1, cust2, evil, admin2 not yet promoted)", r.rows[0].n === 4, String(r.rows[0].n));

  // -------------------------------------------------------------- anonymous
  console.log("\nAnonymous visitors");
  r = await run(anon, "select * from public.feedback");
  check("anon cannot read feedback", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(anon, "select * from public.profiles");
  check("anon cannot read profiles", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(anon, "select * from public.list_servable_employees()");
  check("anon cannot call list_servable_employees", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(anon, INSERT_FB, [U.cust1, "complaint", "anon attempt", "Anonymous attempt to insert.", 3, null, null, null]);
  check("anon cannot insert feedback", !r.ok && /permission denied/i.test(r.error), r.error);

  // -------------------------------------------------------------- customer submission
  console.log("\nCustomer submission");
  r = await fb("cust1", "Faulty blender", { served_by: U.emp1, rating: 2 });
  check("customer can submit feedback", r.ok, r.error);
  const FB1 = r.rows?.[0];
  check("reference matches NYO-YYYYMMDD-XXXXXXXX", /^NYO-\d{8}-[0-9A-F]{8}$/.test(FB1?.reference_number || ""), FB1?.reference_number);
  check("initial status is Pending", FB1?.status === "Pending");

  r = await run(as("cust1"), `insert into public.feedback (customer_id, feedback_type, subject, description, service_rating, status, resolved_at, resolved_by, resolution_details)
        values ($1,'compliment','Spoofed fields','Trying to set status and owner myself.',5,'Resolved',now(),$2,'I resolved this myself ok') returning customer_id, status, resolved_at`,
    [U.cust2, U.manager]);
  check("spoofed customer_id/status/resolution are overridden by the server",
    r.ok && r.rows[0].customer_id === U.cust1 && r.rows[0].status === "Pending" && r.rows[0].resolved_at === null, JSON.stringify(r.rows?.[0] || r.error));

  for (const bad of [0, 6, -1]) {
    r = await fb("cust1", "Bad rating " + bad, { rating: bad });
    check(`rating ${bad} rejected`, !r.ok && /service_rating|check constraint/i.test(r.error), r.error);
  }
  for (const good of [1, 5]) {
    r = await fb("cust1", "Good rating " + good, { rating: good });
    check(`rating ${good} accepted`, r.ok, r.error);
  }
  r = await fb("cust1", "Weird type", { type: "rant" });
  check("invalid feedback type rejected", !r.ok);
  r = await fb("cust1", "ab");
  check("too-short subject rejected", !r.ok);
  r = await fb("cust1", "Short description", { description: "too short" });
  check("too-short description rejected", !r.ok);
  r = await fb("cust1", "Bad response method", { method: "carrier pigeon" });
  check("invalid preferred response method rejected", !r.ok);
  r = await fb("cust1", "Served by manager", { served_by: U.manager });
  check("cannot pick a manager as 'served by'", !r.ok && /not available/i.test(r.error), r.error);
  r = await fb("cust1", "Served by admin", { served_by: U.admin });
  check("cannot pick an administrator as 'served by'", !r.ok);
  r = await fb("cust1", "Served by inactive", { served_by: U.empOff });
  check("cannot pick a deactivated employee as 'served by'", !r.ok);
  r = await fb("cust1", "Served by nobody", { served_by: null });
  check("'served by' may be left blank", r.ok, r.error);

  r = await fb("cust1", "Faulty blender", { served_by: U.emp1, rating: 2 });
  check("identical double-submit within 2 minutes rejected", !r.ok && /already submitted/i.test(r.error), r.error);

  r = await run(as("emp1"), INSERT_FB, [U.cust1, "complaint", "Employee submit", "Employees cannot submit feedback.", 3, null, null, null]);
  check("employee cannot submit feedback", !r.ok, r.error);
  r = await run(as("manager"), INSERT_FB, [U.cust1, "complaint", "Manager submit", "Managers cannot submit feedback.", 3, null, null, null]);
  check("manager cannot submit feedback", !r.ok, r.error);

  r = await run(as("cust1"), "select * from public.list_servable_employees()");
  const names = (r.rows || []).map((x) => x.first_name).sort().join(",");
  check("customers see only active employees' first names", r.ok && names === "Cynthia,Daniel" && Object.keys(r.rows[0]).sort().join() === "first_name,id", names + " " + JSON.stringify(Object.keys(r.rows?.[0] || {})));

  // uniqueness, sequentially and under concurrency
  const refs = new Set();
  for (let i = 0; i < 25; i++) { const x = await fb("cust2", "Sequential " + i); if (x.ok) refs.add(x.rows[0].reference_number); }
  check("25 sequential submissions got 25 distinct references", refs.size === 25, String(refs.size));
  const par = await Promise.all(Array.from({ length: 30 }, (_, i) => fb(i % 2 ? "cust1" : "cust2", "Parallel " + i)));
  const parRefs = new Set(par.filter((x) => x.ok).map((x) => x.rows[0].reference_number));
  check("30 concurrent submissions all succeeded with distinct references", par.every((x) => x.ok) && parRefs.size === 30, `${par.filter((x) => x.ok).length} ok, ${parRefs.size} distinct`);
  r = await run(null, "select count(*)::int n, count(distinct reference_number)::int d from public.feedback");
  check("database has no duplicate references", r.rows[0].n === r.rows[0].d, JSON.stringify(r.rows[0]));

  // -------------------------------------------------------------- customer isolation
  console.log("\nCustomer isolation");
  r = await run(as("cust2"), "select id from public.feedback where id=$1", [FB1.id]);
  check("customer 2 cannot read customer 1's feedback", r.ok && r.rowCount === 0);
  r = await run(as("cust1"), "select id from public.feedback where id=$1", [FB1.id]);
  check("customer 1 can read their own feedback", r.ok && r.rowCount === 1);
  r = await run(as("cust2"), "select count(*)::int n from public.feedback where customer_id <> $1", [U.cust2]);
  check("customer sees no rows belonging to others", r.rows[0].n === 0);
  r = await run(as("cust1"), "update public.feedback set status='Resolved' where id=$1", [FB1.id]);
  check("customer cannot update feedback status", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(as("cust1"), "delete from public.feedback where id=$1", [FB1.id]);
  check("customer cannot delete feedback", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(as("cust1"), "select * from public.profiles");
  check("customer sees only their own profile", r.ok && r.rowCount === 1 && r.rows[0].id === U.cust1, String(r.rowCount));
  r = await run(as("cust1"), "select * from public.audit_logs");
  check("customer cannot read audit logs", r.ok && r.rowCount === 0);
  r = await run(as("cust1"), "select * from public.feedback_assignments");
  check("customer cannot read assignments", r.ok && r.rowCount === 0);
  r = await run(as("cust1"), "select * from public.feedback_status_history");
  check("customer cannot read status history", r.ok && r.rowCount === 0);
  r = await run(as("cust1"), "insert into public.feedback_responses (feedback_id, author_id, response_text, visibility) values ($1,$2,'hi','customer')", [FB1.id, U.cust1]);
  check("customer cannot write responses directly", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(as("cust1"), "insert into public.feedback_assignments (feedback_id, assigned_employee_id, assigned_by_manager_id) values ($1,$2,$2)", [FB1.id, U.emp1]);
  check("customer cannot create assignments directly", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(as("cust1"), "select public.assign_feedback($1,$2,null)", [FB1.id, U.emp1]);
  check("customer cannot call assign_feedback", !r.ok && /Only managers/i.test(r.error), r.error);
  r = await run(as("cust1"), "select public.start_feedback($1)", [FB1.id]);
  check("customer cannot call start_feedback", !r.ok && /assigned to you/i.test(r.error), r.error);
  r = await run(as("cust1"), "select public.resolve_feedback($1,'I resolved my own case, thanks.')", [FB1.id]);
  check("customer cannot call resolve_feedback", !r.ok && /assigned to you/i.test(r.error), r.error);

  console.log("\nPrivilege escalation attempts");
  r = await run(as("cust1"), "update public.profiles set role='administrator' where id=$1", [U.cust1]);
  check("customer cannot promote themselves", !r.ok && /not allowed to change role/i.test(r.error), r.error);
  r = await run(as("cust1"), "update public.profiles set account_status='active', email='x@y.zz' where id=$1", [U.cust1]);
  check("customer cannot change their own email via profile update", !r.ok, r.error);
  r = await run(as("cust1"), "update public.profiles set role='administrator' where id=$1", [U.cust2]);
  check("customer cannot touch another profile", r.ok && r.rowCount === 0);
  r = await run(as("cust1"), "update public.profiles set first_name='Johnny', phone='0700111222' where id=$1 returning first_name", [U.cust1]);
  check("customer can update their own name and phone", r.ok && r.rows[0]?.first_name === "Johnny", r.error);
  r = await run(as("evil"), "update public.profiles set role='manager' where id=$1", [U.evil]);
  check("sign-up 'evil' user cannot self-promote either", !r.ok);
  r = await run(as("emp1"), "update public.profiles set role='administrator' where id=$1", [U.emp1]);
  check("employee cannot promote themselves", !r.ok && /not allowed to change role/i.test(r.error), r.error);
  r = await run(as("manager"), "update public.profiles set role='administrator' where id=$1", [U.manager]);
  check("manager cannot promote themselves to administrator", !r.ok || r.rowCount === 0, r.error);
  r = await run(null, "select role from public.profiles where id in ($1,$2,$3,$4)", [U.cust1, U.evil, U.emp1, U.manager]);
  check("no role changed as a result of the attempts", r.rows.map((x) => x.role).sort().join() === "customer,customer,employee,manager", r.rows.map((x) => x.role).join());

  // -------------------------------------------------------------- manager
  console.log("\nManager");
  r = await run(as("manager"), "select count(*)::int n from public.feedback");
  const total = (await run(null, "select count(*)::int n from public.feedback")).rows[0].n;
  check("manager sees all feedback", r.rows[0].n === total && total > 50, `${r.rows[0].n}/${total}`);
  r = await run(as("manager"), "select * from public.list_assignable_employees()");
  check("manager lists only active employees", r.ok && r.rows.map((x) => x.first_name).sort().join() === "Cynthia,Daniel", JSON.stringify(r.rows));
  r = await run(as("admin"), "select public.assign_feedback($1,$2,'oversight try')", [FB1.id, U.emp1]);
  check("administrator cannot assign (manager-only per permission matrix)", !r.ok && /Only managers/i.test(r.error), r.error);
  for (const [label, who] of [["a customer", U.cust1], ["a manager", U.manager], ["an administrator", U.admin], ["a deactivated employee", U.empOff]]) {
    r = await run(as("manager"), "select public.assign_feedback($1,$2,null)", [FB1.id, who]);
    check(`manager cannot assign to ${label}`, !r.ok && /active employee/i.test(r.error), r.error);
  }
  r = await run(as("manager"), "select public.assign_feedback($1,$2,'Please investigate')", [FB1.id, U.emp1]);
  check("manager can assign to an active employee", r.ok, r.error);
  r = await run(null, "select status from public.feedback where id=$1", [FB1.id]);
  check("assignment leaves status Pending until the employee starts", r.rows[0].status === "Pending");
  r = await run(as("manager"), "select public.assign_feedback($1,$2,null)", [FB1.id, U.emp1]);
  check("assigning to the same employee again is rejected", !r.ok && /already assigned/i.test(r.error), r.error);
  r = await run(as("manager"), "select public.assign_feedback($1,$2,'Reassigning')", [FB1.id, U.emp2]);
  check("manager can reassign", r.ok, r.error);
  r = await run(as("manager"), "select assigned_employee_id, unassigned_at is null as current, assigned_by_manager_id from public.feedback_assignments where feedback_id=$1 order by assigned_at, id", [FB1.id]);
  check("assignment history preserved (2 rows, only latest current)", r.rowCount === 2 && r.rows[0].current === false && r.rows[1].current === true && r.rows[1].assigned_employee_id === U.emp2 && r.rows[1].assigned_by_manager_id === U.manager, JSON.stringify(r.rows));
  r = await run(null, "select count(*)::int n from public.feedback_assignments where feedback_id=$1 and unassigned_at is null", [FB1.id]);
  check("exactly one current assignment", r.rows[0].n === 1);
  r = await run(null, "select user_id, type from public.notifications order by created_at");
  check("employees were notified of assignment and reassignment", r.rowCount === 3 && r.rows.filter((x) => x.user_id === U.emp1).length === 2 && r.rows.filter((x) => x.user_id === U.emp2).length === 1, JSON.stringify(r.rows));
  r = await run(as("manager"), "select * from public.audit_logs");
  check("manager cannot read audit logs", r.ok && r.rowCount === 0);
  r = await run(as("manager"), "select * from public.profiles where role in ('administrator','manager')");
  check("manager cannot read administrator/manager profiles", r.ok && r.rows.every((x) => x.id === U.manager), JSON.stringify(r.rows.map((x) => x.role)));
  r = await run(as("manager"), "update public.system_settings set value='99'::jsonb where key='attachments_max_per_feedback'");
  check("manager cannot change system settings", r.ok && r.rowCount === 0);
  r = await run(as("manager"), "update public.profiles set account_status='inactive' where id=$1", [U.emp1]);
  check("manager cannot deactivate staff", r.ok && r.rowCount === 0);
  r = await run(as("manager"), "update public.feedback set status='Resolved' where id=$1", [FB1.id]);
  check("manager cannot change feedback status directly", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(as("manager"), "select public.start_feedback($1)", [FB1.id]);
  check("manager cannot start/resolve cases", !r.ok);

  // -------------------------------------------------------------- employee
  console.log("\nEmployee");
  r = await run(as("emp2"), "select id from public.feedback");
  check("employee sees exactly the one assigned case", r.ok && r.rowCount === 1 && r.rows[0].id === FB1.id, String(r.rowCount));
  r = await run(as("emp1"), "select id from public.feedback");
  check("previous assignee loses access after reassignment", r.ok && r.rowCount === 0, String(r.rowCount));
  r = await run(as("emp1"), "select public.start_feedback($1)", [FB1.id]);
  check("employee cannot start a case not assigned to them", !r.ok && /assigned to you/i.test(r.error), r.error);
  r = await run(as("emp1"), "select public.add_feedback_response($1,'sneaky','internal')", [FB1.id]);
  check("employee cannot add notes to a case not assigned to them", !r.ok, r.error);
  r = await run(as("emp1"), "select public.resolve_feedback($1,'Resolving someone else''s case.')", [FB1.id]);
  check("employee cannot resolve another employee's case", !r.ok, r.error);
  r = await run(as("emp2"), "select * from public.profiles");
  check("employee sees only self + the assigned case's customer", r.ok && r.rows.map((x) => x.id).sort().join() === [U.emp2, U.cust1].sort().join(), JSON.stringify(r.rows.map((x) => x.first_name)));
  r = await run(as("emp2"), "update public.feedback set status='Resolved' where id=$1", [FB1.id]);
  check("employee cannot update feedback table directly", !r.ok && /permission denied/i.test(r.error), r.error);
  r = await run(as("emp2"), "select public.assign_feedback($1,$2,null)", [FB1.id, U.emp1]);
  check("employee cannot assign or reassign", !r.ok && /Only managers/i.test(r.error), r.error);
  r = await run(as("emp2"), "select * from public.audit_logs");
  check("employee cannot read audit logs", r.ok && r.rowCount === 0);
  r = await run(as("emp2"), "select * from public.feedback_assignments");
  check("employee sees only their own assignment rows", r.ok && r.rows.every((x) => x.assigned_employee_id === U.emp2), String(r.rowCount));
  r = await run(as("emp2"), "select public.resolve_feedback($1,'Trying to resolve before starting.')", [FB1.id]);
  check("cannot resolve a Pending case (must start it first)", !r.ok && /Start the case/i.test(r.error), r.error);
  r = await run(as("emp2"), "select public.start_feedback($1,'Looking into it')", [FB1.id]);
  check("assigned employee can start the case", r.ok, r.error);
  r = await run(null, "select status from public.feedback where id=$1", [FB1.id]);
  check("status is now In Progress", r.rows[0].status === "In Progress");
  r = await run(as("emp2"), "select public.start_feedback($1)", [FB1.id]);
  check("cannot start a case twice", !r.ok);
  r = await run(as("emp2"), "select public.add_feedback_response($1,'Customer called, will replace unit.','internal')", [FB1.id]);
  check("employee can add an internal note", r.ok, r.error);
  r = await run(as("emp2"), "select public.add_feedback_response($1,'We are sorry, a replacement is on its way.','customer')", [FB1.id]);
  check("employee can add a customer-visible response", r.ok, r.error);
  r = await run(as("emp2"), "select public.add_feedback_response($1,'x','secret')", [FB1.id]);
  check("invalid visibility rejected", !r.ok);
  for (const bad of [null, "", "too short", "         "]) {
    r = await run(as("emp2"), "select public.resolve_feedback($1,$2)", [FB1.id, bad]);
    check(`resolve without proper details rejected (${JSON.stringify(bad)})`, !r.ok && /resolution details/i.test(r.error), r.error);
  }
  r = await run(as("emp2"), "select public.resolve_feedback($1,'Replacement blender delivered and tested.','Your replacement has been delivered.','Closed with replacement, stock updated.')", [FB1.id]);
  check("employee can resolve with details", r.ok, r.error);
  r = await run(null, "select status, resolved_by, resolved_at is not null as at, resolution_details from public.feedback where id=$1", [FB1.id]);
  check("resolution records status, resolver, timestamp and details", r.rows[0].status === "Resolved" && r.rows[0].resolved_by === U.emp2 && r.rows[0].at && /Replacement blender/.test(r.rows[0].resolution_details), JSON.stringify(r.rows[0]));
  r = await run(as("emp2"), "select public.resolve_feedback($1,'Resolving again for no reason.')", [FB1.id]);
  check("cannot resolve twice", !r.ok);
  r = await run(as("emp2"), "select public.add_feedback_response($1,'Late note after resolution','internal')", [FB1.id]);
  check("cannot add responses after resolution", !r.ok);
  r = await run(as("manager"), "select public.assign_feedback($1,$2,null)", [FB1.id, U.emp1]);
  check("cannot reassign a resolved case", !r.ok && /Resolved/i.test(r.error), r.error);
  r = await run(null, "select previous_status, new_status, changed_by from public.feedback_status_history where feedback_id=$1 order by changed_at, id", [FB1.id]);
  check("status history: null→Pending, Pending→In Progress, In Progress→Resolved",
    r.rowCount === 3 && r.rows.map((x) => x.new_status).join() === "Pending,In Progress,Resolved" && r.rows[0].previous_status === null && r.rows[2].changed_by === U.emp2, JSON.stringify(r.rows));
  r = await run(null, "select resolved_at is null as bad from public.feedback where status='Resolved' and (resolved_by is null or resolution_details is null)");
  check("no Resolved case exists without resolver and details", r.rowCount === 0);
  r = await run(null, "update public.feedback set status='Resolved' where id=(select id from public.feedback where status='Pending' limit 1)");
  check("database constraint blocks 'Resolved' without resolution fields even for trusted SQL", !r.ok && /feedback_resolution_consistent/.test(r.error), r.error);
  r = await run(null, "update public.feedback set reference_number='NYO-HACK' where id=$1", [FB1.id]);
  check("reference number is immutable even for trusted SQL", !r.ok && /cannot be changed/i.test(r.error), r.error);

  console.log("\nVisibility of notes and responses");
  r = await run(as("cust1"), "select visibility, response_text from public.feedback_responses where feedback_id=$1", [FB1.id]);
  check("customer sees only customer-visible responses (2), never internal notes", r.ok && r.rowCount === 2 && r.rows.every((x) => x.visibility === "customer"), JSON.stringify(r.rows));
  r = await run(as("cust2"), "select * from public.feedback_responses");
  check("other customers see none", r.ok && r.rowCount === 0);
  r = await run(as("manager"), "select visibility from public.feedback_responses where feedback_id=$1", [FB1.id]);
  check("manager sees internal and customer responses", r.rowCount === 4 && r.rows.some((x) => x.visibility === "internal"), String(r.rowCount));
  r = await run(as("admin"), "select visibility from public.feedback_responses where feedback_id=$1", [FB1.id]);
  check("administrator sees internal and customer responses", r.rowCount === 4);
  r = await run(as("emp1"), "select * from public.feedback_responses");
  check("previous assignee sees no responses", r.ok && r.rowCount === 0);
  r = await run(as("cust1"), "select user_id, message from public.notifications");
  check("customer got notifications about start, response and resolution", r.rowCount === 3 && r.rows.every((x) => x.user_id === U.cust1) && r.rows.every((x) => /NYO-/.test(x.message) && !/blender/i.test(x.message)), JSON.stringify(r.rows.map((x) => x.message)));
  r = await run(as("cust2"), "select * from public.notifications");
  check("notifications are private to their owner", r.ok && r.rowCount === 0);
  r = await run(as("cust1"), "update public.notifications set is_read=true where user_id=$1 returning is_read", [U.cust1]);
  check("user can mark own notifications read", r.ok && r.rows.length === 3 && r.rows.every((x) => x.is_read));
  r = await run(as("cust1"), "update public.notifications set message='hacked' where user_id=$1", [U.cust1]);
  check("user cannot edit notification content", !r.ok && /read flag/i.test(r.error), r.error);

  // -------------------------------------------------------------- administrator
  console.log("\nAdministrator");
  r = await run(as("admin"), "select count(*)::int n from public.feedback");
  check("administrator sees all feedback", r.rows[0].n === total);
  r = await run(as("admin"), "select action from public.audit_logs");
  const acts = new Set(r.rows.map((x) => x.action));
  check("audit log has assignment, reassignment, status, response and resolution events",
    ["feedback_assigned", "feedback_reassigned", "status_changed", "response_added", "feedback_resolved"].every((a) => acts.has(a)), [...acts].join());
  r = await run(null, "select metadata::text m from public.audit_logs");
  check("audit metadata contains no message bodies", !r.rows.some((x) => /replacement|sorry/i.test(x.m)));
  r = await run(as("admin"), "update public.profiles set role='employee' where id=$1", [U.cust2]);
  check("administrator can change a role", r.ok && r.rowCount === 1, r.error);
  r = await run(as("admin"), "select action, metadata from public.audit_logs where action='role_changed'");
  check("role change is audited", r.rowCount === 1 && r.rows[0].metadata.to === "employee", JSON.stringify(r.rows));
  await run(null, "update public.profiles set role='customer' where id=$1", [U.cust2]);
  r = await run(as("admin"), "update public.profiles set role='employee' where id=$1", [U.admin]);
  check("only active administrator cannot demote themselves", !r.ok && /only active administrator/i.test(r.error), r.error);
  r = await run(as("admin"), "update public.profiles set account_status='inactive' where id=$1", [U.admin]);
  check("only active administrator cannot be deactivated", !r.ok && /only active administrator/i.test(r.error), r.error);
  r = await run(null, "delete from public.profiles where id=$1", [U.admin]);
  check("only active administrator cannot be deleted", !r.ok && /only active administrator/i.test(r.error), r.error);
  await run(null, "update public.profiles set role='administrator' where id=$1", [U.admin2]);
  r = await run(as("admin"), "update public.profiles set role='manager' where id=$1", [U.admin2]);
  check("with a second administrator, demoting one admin works", r.ok, r.error);
  await run(null, "update public.profiles set role='administrator' where id=$1", [U.admin2]);
  r = await run(as("admin"), "update public.profiles set account_status='inactive' where id=$1", [U.admin2]);
  check("administrator can deactivate another administrator when one remains", r.ok, r.error);
  await run(null, "update public.profiles set account_status='active', role='customer' where id=$1", [U.admin2]);
  r = await run(as("admin"), "update public.system_settings set value=to_jsonb(4) where key='attachments_max_per_feedback' returning updated_by", []);
  check("administrator can change settings and the change is stamped", r.ok && r.rows[0]?.updated_by === U.admin, r.error);
  await run(as("admin"), "update public.system_settings set value=to_jsonb(3) where key='attachments_max_per_feedback'");
  r = await run(as("emp2"), "update public.system_settings set value='1'::jsonb where key='attachments_max_per_feedback'");
  check("employee cannot change settings", r.ok && r.rowCount === 0);
  r = await run(as("cust1"), "select key from public.system_settings where key='feedback_categories'");
  check("signed-in users can read settings (for form dropdowns)", r.ok && r.rowCount === 1);

  console.log("\nDeactivation takes effect immediately");
  await fb("cust2", "Case for deactivation test");
  const target = (await run(null, "select id from public.feedback where customer_id=$1 and subject=$2", [U.cust2, "Case for deactivation test"])).rows[0].id;
  await run(as("manager"), "select public.assign_feedback($1,$2,null)", [target, U.emp1]);
  r = await run(as("emp1"), "select id from public.feedback where id=$1", [target]);
  check("employee sees their case while active", r.rowCount === 1);
  await run(as("admin"), "update public.profiles set account_status='inactive' where id=$1", [U.emp1]);
  r = await run(as("emp1"), "select id from public.feedback");
  check("deactivated employee immediately sees no feedback", r.ok && r.rowCount === 0);
  r = await run(as("emp1"), "select public.start_feedback($1)", [target]);
  check("deactivated employee cannot act on their case", !r.ok);
  r = await run(as("manager"), "select public.assign_feedback($1,$2,null)", [target, U.emp1]);
  check("deactivated employee cannot be assigned new cases", !r.ok && /active employee/i.test(r.error), r.error);
  r = await run(as("manager"), "select * from public.list_assignable_employees()");
  check("deactivated employee disappears from the assignable list", r.rows.every((x) => x.id !== U.emp1));
  await run(as("admin"), "update public.profiles set account_status='inactive' where id=$1", [U.cust1]);
  r = await fb("cust1", "Submit while deactivated");
  check("deactivated customer cannot submit", !r.ok);
  r = await run(as("cust1"), "select id from public.feedback");
  check("deactivated customer cannot read their feedback", r.ok && r.rowCount === 0);
  await run(null, "update public.profiles set account_status='active' where id in ($1,$2)", [U.emp1, U.cust1]);

  // -------------------------------------------------------------- attachments
  console.log("\nAttachments and storage");
  const att = (who, fid, p, o = {}) => run(as(who),
    "insert into public.feedback_attachments (feedback_id, uploaded_by, storage_path, file_name, mime_type, size_bytes) values ($1,$2,$3,$4,$5,$6)",
    [fid, o.uploader ?? U[who], p, o.name ?? "receipt.pdf", o.mime ?? "application/pdf", o.size ?? 1000]);
  const FB2 = (await fb("cust2", "Attachment case")).rows[0];
  const pathOf = (cust, fid, n) => `${cust}/${fid}/file${n}.pdf`;
  r = await att("cust2", FB2.id, pathOf(U.cust2, FB2.id, 1));
  check("customer can register an attachment for their own feedback", r.ok, r.error);
  r = await att("cust2", FB2.id, pathOf(U.cust1, FB2.id, 2));
  check("attachment path must be in the customer's own folder", !r.ok, r.error);
  r = await att("cust1", FB2.id, pathOf(U.cust1, FB2.id, 3));
  check("customer cannot attach to someone else's feedback", !r.ok, r.error);
  r = await att("cust2", FB2.id, pathOf(U.cust2, FB2.id, 4), { mime: "text/html", name: "x.html" });
  check("HTML upload type rejected", !r.ok && /not allowed/i.test(r.error), r.error);
  r = await att("cust2", FB2.id, pathOf(U.cust2, FB2.id, 5), { mime: "application/x-msdownload", name: "x.exe" });
  check("executable type rejected", !r.ok);
  r = await att("cust2", FB2.id, pathOf(U.cust2, FB2.id, 6), { size: 6 * 1024 * 1024 });
  check("oversized attachment rejected", !r.ok && /too large/i.test(r.error), r.error);
  r = await att("cust2", FB2.id, pathOf(U.cust2, FB2.id, 7), { uploader: U.cust1 });
  check("cannot register an attachment as someone else", !r.ok);
  await att("cust2", FB2.id, pathOf(U.cust2, FB2.id, 8));
  await att("cust2", FB2.id, pathOf(U.cust2, FB2.id, 9));
  r = await att("cust2", FB2.id, pathOf(U.cust2, FB2.id, 10));
  check("fourth attachment rejected (limit 3)", !r.ok && /Too many/i.test(r.error), r.error);

  const obj = (who, name, bucket = "feedback-attachments") => run(as(who), "insert into storage.objects (bucket_id, name, owner) values ($1,$2,$3)", [bucket, name, U[who]]);
  r = await obj("cust2", pathOf(U.cust2, FB2.id, 1));
  check("customer can upload into their own folder for their own feedback", r.ok, r.error);
  r = await obj("cust2", pathOf(U.cust1, FB2.id, 1));
  check("customer cannot upload into another customer's folder", !r.ok, r.error);
  r = await obj("cust1", pathOf(U.cust1, FB2.id, 1));
  check("customer cannot upload against someone else's feedback id", !r.ok, r.error);
  r = await obj("emp2", pathOf(U.emp2, FB2.id, 1));
  check("employee cannot upload customer attachments", !r.ok, r.error);
  r = await run(as("cust2"), "insert into storage.objects (bucket_id, name, owner) values ('other-bucket',$1,$2)", [pathOf(U.cust2, FB2.id, 1), U.cust2]);
  check("cannot upload to a different bucket through these policies", !r.ok);
  const readObj = (who) => run(as(who), "select name from storage.objects where bucket_id='feedback-attachments' and name=$1", [pathOf(U.cust2, FB2.id, 1)]);
  check("owner customer can read the file", (await readObj("cust2")).rowCount === 1);
  check("another customer cannot read the file", (await readObj("cust1")).rowCount === 0);
  check("manager can read the file", (await readObj("manager")).rowCount === 1);
  check("administrator can read the file", (await readObj("admin")).rowCount === 1);
  check("unassigned employee cannot read the file", (await readObj("emp2")).rowCount === 0);
  await run(as("manager"), "select public.assign_feedback($1,$2,null)", [FB2.id, U.emp2]);
  check("assigned employee can read the file", (await readObj("emp2")).rowCount === 1);
  r = await run(as("cust2"), "delete from storage.objects where name=$1", [pathOf(U.cust2, FB2.id, 1)]);
  check("customers cannot delete uploaded files", r.ok && r.rowCount === 0);
  r = await run(null, "select public, file_size_limit, allowed_mime_types from storage.buckets where id='feedback-attachments'");
  check("bucket is private, 5 MB, JPG/PNG/PDF only", r.rows[0].public === false && Number(r.rows[0].file_size_limit) === 5242880 && r.rows[0].allowed_mime_types.join() === "image/jpeg,image/png,application/pdf", JSON.stringify(r.rows[0]));

  // -------------------------------------------------------------- staff overview (migration 6)
  console.log("\nStaff overview functions");
  r = await run(as("admin"), "select public.dashboard_stats() s");
  const st = r.rows?.[0]?.s;
  const truth = (await run(null, `select count(*)::int total,
      count(*) filter (where feedback_type='complaint')::int complaints, count(*) filter (where status='Resolved')::int resolved,
      round(avg(service_rating)::numeric,1) avg from public.feedback`)).rows[0];
  check("admin dashboard_stats totals match the table", r.ok && st.total === truth.total && st.complaints === truth.complaints && st.resolved === truth.resolved && Number(st.avg_rating) === Number(truth.avg), JSON.stringify(st) + JSON.stringify(truth));
  check("by-type and by-status counts add up to the total", st.complaints + st.compliments + st.suggestions === st.total && st.pending + st.in_progress + st.resolved === st.total);
  check("trend has 30 zero-filled days summing to today's submissions", st.trend.length === 30 && st.trend.reduce((a, d) => a + d.count, 0) === st.total, st.trend.length);
  r = await run(as("manager"), "select public.dashboard_stats() s");
  check("manager may call dashboard_stats", r.ok);
  for (const who of ["emp2", "cust1"]) {
    r = await run(as(who), "select public.dashboard_stats()");
    check(`${who} cannot call dashboard_stats`, !r.ok && /Not allowed/.test(r.error), r.error);
  }
  r = await run(anon, "select public.dashboard_stats()");
  check("anon cannot call dashboard_stats", !r.ok);
  r = await run(as("admin"), "select * from public.list_feedback(null,null,null,10,0)");
  check("list_feedback returns 10 rows newest first with the total count", r.ok && r.rowCount === 10 && Number(r.rows[0].total_count) === (await run(null, "select count(*)::int n from public.feedback")).rows[0].n && r.rows[0].created_at >= r.rows[9].created_at, r.error);
  check("rows carry customer name and no email/phone", r.rows[0].customer_name.length > 0 && !("email" in r.rows[0]) && !("phone" in r.rows[0]));
  r = await run(as("admin"), "select * from public.list_feedback($1,null,null,100,0)", [FB1.reference_number.toLowerCase()]);
  check("search by reference (case-insensitive) finds exactly that case with its assignee", r.rowCount === 1 && r.rows[0].assigned_employee_name === "Daniel Otieno" && r.rows[0].status === "Resolved", JSON.stringify(r.rows));
  r = await run(as("admin"), "select * from public.list_feedback('mary',null,null,100,0)");
  check("search by customer name works", r.rowCount > 0 && r.rows.every((x) => /mary/i.test(x.customer_name)));
  r = await run(as("admin"), "select * from public.list_feedback('%',null,null,100,0)");
  check("LIKE wildcards in search are treated literally", r.rowCount === 0, String(r.rowCount));
  r = await run(as("admin"), "select * from public.list_feedback('Faulty blender','complaint','Resolved',100,0)");
  check("filters combine (search + type + status)", r.rowCount === 1);
  r = await run(as("manager"), "select * from public.list_feedback(null,null,'Pending',5,5)");
  check("manager can list; status filter and offset work", r.ok && r.rows.every((x) => x.status === "Pending") && r.rowCount === 5);
  r = await run(as("admin"), "select * from public.list_feedback(null,null,null,100000,0)");
  check("page size is capped at 100", r.ok && r.rowCount <= 100);
  r = await run(as("admin"), "select * from public.list_feedback(null,'rant',null,10,0)");
  check("invalid type filter rejected", !r.ok);
  r = await run(as("admin"), "select * from public.list_feedback(null,null,'Closed',10,0)");
  check("invalid status filter rejected", !r.ok);
  for (const who of ["emp2", "cust1"]) {
    r = await run(as(who), "select * from public.list_feedback(null,null,null,10,0)");
    check(`${who} cannot call list_feedback`, !r.ok && /Not allowed/.test(r.error), r.error);
  }
  r = await run(anon, "select * from public.list_feedback(null,null,null,10,0)");
  check("anon cannot call list_feedback", !r.ok);
  r = await run(as("manager"), "select * from public.list_feedback(null,null,null,100,0,'unassigned')");
  const unassignedTruth = (await run(null, "select count(*)::int n from public.feedback f where not exists (select 1 from public.feedback_assignments a where a.feedback_id=f.id and a.unassigned_at is null)")).rows[0].n;
  check("assignment filter 'unassigned' returns only cases with no current assignee", r.ok && r.rows.length === Math.min(100, unassignedTruth) && r.rows.every((x) => x.assigned_employee_id === null), r.error);
  r = await run(as("manager"), "select * from public.list_feedback(null,null,null,100,0,'assigned')");
  check("assignment filter 'assigned' returns only assigned cases", r.ok && r.rows.length > 0 && r.rows.every((x) => x.assigned_employee_id !== null));
  r = await run(as("manager"), "select * from public.list_feedback(null,null,null,10,0,'whatever')");
  check("invalid assignment filter rejected", !r.ok);
  r = await run(as("emp2"), "select * from public.list_feedback(null,null,null,10,0,'unassigned')");
  check("employee still cannot call the new list_feedback", !r.ok && /Not allowed/.test(r.error), r.error);
  r = await run(anon, "select * from public.list_feedback(null,null,null,10,0,'unassigned')");
  check("anon cannot call the new list_feedback", !r.ok);
  await run(as("admin"), "update public.profiles set account_status='inactive' where id=$1", [U.admin2]);
  r = await run(as("admin2"), "select public.dashboard_stats()");
  check("a deactivated administrator is refused", !r.ok);

  // -------------------------------------------------------------- admin reports, users, audit (migration 8)
  console.log("\nAdministrator reports, users and audit functions");
  await run(null, "update public.profiles set account_status='active' where id=$1", [U.admin2]);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10), from = new Date(Date.now() - 300 * 86400000).toISOString().slice(0, 10);
  r = await run(as("admin"), "select public.report_summary($1,$2) s", [from, to]);
  const rep = r.rows?.[0]?.s;
  const tr = (await run(null, `select count(*)::int total, count(*) filter (where feedback_type='complaint' and status='Resolved')::int rc,
      count(*) filter (where status='Resolved')::int resolved, round(avg(service_rating)::numeric,2) avg from public.feedback`)).rows[0];
  check("report_summary totals match the table", r.ok && rep.total === tr.total && rep.resolved_complaints === tr.rc && rep.resolved === tr.resolved && Number(rep.avg_rating) === Number(tr.avg), r.error + JSON.stringify(rep));
  check("type and status counts add up", rep.complaints + rep.compliments + rep.suggestions === rep.total && rep.pending + rep.in_progress + rep.resolved === rep.total);
  check("rating distribution has 5 buckets summing to the total", rep.rating_distribution.length === 5 && rep.rating_distribution.reduce((a, b) => a + b, 0) === rep.total);
  check("by_category sums to the total, with 'Not specified' for blanks", rep.by_category.reduce((a, c) => a + c.count, 0) === rep.total);
  check("by_employee lists Daniel with 1 resolved case and a resolution time", rep.by_employee.some((e) => e.name === "Daniel Otieno" && e.resolved === 1 && Number(e.avg_hours) >= 0), JSON.stringify(rep.by_employee));
  check("trend has one entry per day in the range", rep.trend.length === Math.round((new Date(to) - new Date(from)) / 86400000) + 1 && rep.trend.reduce((a, d) => a + d.count, 0) === rep.total);
  r = await run(as("admin"), "select public.report_summary($1,$1) s", [to]);
  check("a one-day range works: one trend entry, never more than the full period", r.ok && r.rows[0].s.trend.length === 1 && r.rows[0].s.total <= tr.total, r.error);
  r = await run(as("admin"), "select public.report_summary('2000-01-01','2000-01-02') s");
  check("an empty period returns zeros and null average", r.ok && r.rows[0].s.total === 0 && r.rows[0].s.avg_rating === null && r.rows[0].s.by_employee.length === 0);
  for (const [a, b2, why] of [["2026-02-01", "2026-01-01", "from after to"], ["2020-01-01", "2026-01-01", "range over 366 days"], [null, "2026-01-01", "null date"]]) {
    r = await run(as("admin"), "select public.report_summary($1,$2)", [a, b2]);
    check(`report_summary rejects ${why}`, !r.ok && /valid date range|366/.test(r.error), r.error);
  }
  r = await run(as("admin"), "select * from public.report_rows($1,$2)", [from, to]);
  check("report_rows returns one line per feedback, with names and no contact data", r.ok && r.rowCount === tr.total && !("email" in r.rows[0]) && !("phone" in r.rows[0]) && !("description" in r.rows[0]) && !("resolution_details" in r.rows[0]));
  check("resolved rows carry resolution hours", r.rows.filter((x) => x.status === "Resolved").every((x) => x.resolution_hours !== null) && r.rows.filter((x) => x.status !== "Resolved").every((x) => x.resolution_hours === null));
  for (const who of ["manager", "emp2", "cust1"]) {
    for (const q of ["select public.report_summary('2026-01-01','2026-01-31')", "select * from public.report_rows('2026-01-01','2026-01-31')", "select * from public.list_users(null,null,null,10,0)", "select * from public.list_audit_logs(null,20,0)", "select public.log_admin_event('report_exported')"]) {
      r = await run(as(who), q);
      check(`${who} is refused: ${q.slice(7, 40)}`, !r.ok && /Not allowed|permission denied/.test(r.error), r.error);
    }
  }
  for (const q of ["select public.report_summary('2026-01-01','2026-01-31')", "select * from public.list_users(null,null,null,10,0)", "select * from public.list_audit_logs(null,20,0)"]) {
    r = await run(anon, q); check(`anon is refused: ${q.slice(7, 40)}`, !r.ok, r.error);
  }
  r = await run(as("admin"), "select public.require_administrator()");
  check("helper functions are not directly callable", !r.ok && /permission denied/.test(r.error), r.error);

  r = await run(as("admin"), "select * from public.list_users(null,null,null,100,0)");
  const nUsers = (await run(null, "select count(*)::int n from public.profiles")).rows[0].n;
  check("list_users returns every profile with total count, staff before customers", r.ok && r.rowCount === nUsers && Number(r.rows[0].total_count) === nUsers && r.rows[0].role !== "customer", r.error);
  r = await run(as("admin"), "select * from public.list_users('cynth','employee','active',10,0)");
  check("list_users search + role + status filters", r.rowCount === 1 && r.rows[0].first_name === "Cynthia");
  r = await run(as("admin"), "select * from public.list_users('_',null,null,10,0)");
  check("underscore in user search is literal", r.ok && r.rowCount === 0);
  r = await run(as("admin"), "select * from public.list_users(null,'root',null,10,0)");
  check("invalid role filter rejected", !r.ok);
  r = await run(as("admin"), "select * from public.list_users(null,null,'banned',10,0)");
  check("invalid status filter rejected", !r.ok);
  r = await run(as("admin"), "select * from public.list_users(null,null,'inactive',100,0)");
  check("status filter 'inactive' finds the deactivated employee", r.rows.some((x) => x.id === U.empOff) && r.rows.every((x) => x.account_status === "inactive"));

  r = await run(as("admin"), "select public.log_admin_event('report_exported', '{\"from\":\"2026-01-01\",\"to\":\"2026-01-31\",\"secret\":\"x\"}'::jsonb)");
  check("admin can log a report export", r.ok, r.error);
  r = await run(as("admin"), "select public.log_admin_event('role_changed')");
  check("log_admin_event refuses non-whitelisted actions (no audit forgery)", !r.ok && /Unknown event/.test(r.error), r.error);
  r = await run(as("admin"), "select * from public.list_audit_logs('report_exported',20,0)");
  check("audit entry has the actor name and only safe metadata", r.rowCount === 1 && r.rows[0].actor_name === "Alice Njoroge" && JSON.stringify(Object.keys(r.rows[0].metadata).sort()) === '["from","to"]', JSON.stringify(r.rows));
  r = await run(as("admin"), "select * from public.list_audit_logs(null,5,0)");
  check("list_audit_logs is newest-first with a page size cap", r.ok && r.rowCount === 5 && r.rows[0].created_at >= r.rows[4].created_at && Number(r.rows[0].total_count) > 5);
  r = await run(as("admin"), "select * from public.list_audit_logs('feedback_assigned',20,0)");
  check("audit filter by action works and names the manager", r.rowCount > 0 && r.rows.every((x) => x.action === "feedback_assigned") && r.rows[0].actor_name === "Brian Mutua");
  r = await run(null, "select count(*)::int n from public.audit_logs where metadata::text ~* '(password|token|secret)'");
  check("no audit entry contains passwords, tokens or secrets", r.rows[0].n === 0);

  // -------------------------------------------------------------- anonymous feedback (migration 9)
  console.log("\nAnonymous feedback");
  const ANON = "select public.submit_anonymous_feedback($1,$2,$3,$4,$5,$6,$7,$8) ref";
  const pick = (o, k, d) => (k in o ? o[k] : d);
  const args = (o = {}) => [pick(o, "type", "complaint"), pick(o, "subject", "Rude service"), pick(o, "desc", "The cashier ignored me for ten minutes."), pick(o, "rating", 2), pick(o, "cat", "Customer Service"), pick(o, "prod", null), pick(o, "ref", null), pick(o, "web", null)];
  const before = (await run(null, "select count(*)::int n from public.feedback")).rows[0].n;
  r = await run(anon, ANON, args());
  const aRef = r.rows?.[0]?.ref;
  check("a visitor who is not logged in can submit and gets a reference number", r.ok && /^NYO-\d{8}-[0-9A-F]{8}$/.test(aRef), r.error);
  r = await run(null, "select * from public.feedback where reference_number=$1", [aRef]);
  const A = r.rows[0];
  check("stored as anonymous: no customer, status Pending, rating and type kept", A && A.is_anonymous === true && A.customer_id === null && A.status === "Pending" && A.service_rating === 2 && A.feedback_type === "complaint" && A.preferred_response_method === null);
  r = await run(null, "select * from public.feedback_status_history where feedback_id=$1", [A.id]);
  check("first history row exists with no user and an anonymous note", r.rowCount === 1 && r.rows[0].changed_by === null && /anonymous/i.test(r.rows[0].change_note));
  check("nothing identifying is stored on the row", !Object.keys(A).some((k) => /^(ip|ip_address|user_agent|email|phone|session|session_id|user_id)$/i.test(k)), Object.keys(A).join());

  r = await run(anon, "insert into public.feedback (is_anonymous, feedback_type, subject, description, service_rating) values (true,'complaint','direct','direct insert try',3)");
  check("anonymous visitors cannot insert into the table directly", !r.ok, r.error);
  r = await run(anon, "select count(*) from public.feedback");
  check("anonymous visitors cannot read feedback", !r.ok || Number(r.rows[0].count) === 0, r.error);
  r = await run(as("cust1"), "insert into public.feedback (is_anonymous, feedback_type, subject, description, service_rating) values (true,'complaint','sneaky','customer posing as anonymous',3)");
  check("a logged-in customer cannot insert an anonymous row directly", !r.ok && /anonymous form|row-level/i.test(r.error), r.error);

  r = await run(as("cust1"), ANON, args({ subject: "Logged in but anonymous", desc: "I am logged in yet want this anonymous." }));
  const cRef = r.rows?.[0]?.ref;
  check("a logged-in customer may use the anonymous form", r.ok, r.error);
  r = await run(null, "select customer_id, is_anonymous from public.feedback where reference_number=$1", [cRef]);
  check("...and it is NOT linked to their account", r.rows[0].customer_id === null && r.rows[0].is_anonymous === true);
  r = await run(as("cust1"), "select reference_number from public.feedback where reference_number in ($1,$2)", [aRef, cRef]);
  check("customers cannot see anonymous feedback, not even their own anonymous one", r.ok && r.rowCount === 0, JSON.stringify(r.rows));
  for (const who of ["admin", "manager", "emp1"]) {
    r = await run(as(who), ANON, args({ subject: "Staff attempt", desc: "Staff should not submit feedback at all." }));
    check(`${who} cannot submit feedback anonymously`, !r.ok && /Staff accounts/i.test(r.error), r.error);
  }

  const bad = [[{ type: "rant" }, "bad type"], [{ type: null }, "missing type"], [{ subject: "ab" }, "short subject"], [{ subject: "x".repeat(151) }, "long subject"],
    [{ desc: "too short" }, "short description"], [{ desc: "y".repeat(4001) }, "long description"], [{ rating: 0 }, "rating 0"], [{ rating: 6 }, "rating 6"], [{ rating: null }, "no rating"],
    [{ cat: "c".repeat(81) }, "long category"], [{ prod: "p".repeat(151) }, "long product"], [{ ref: "r".repeat(101) }, "long reference"]];
  for (const [o, why] of bad) {
    r = await run(anon, ANON, args(o));
    check(`invalid input refused: ${why}`, !r.ok && /22023/.test(r.code || ""), r.error);
  }
  r = await run(anon, ANON, args({ subject: "Bot", desc: "I am a bot filling in everything.", web: "http://spam.example" }));
  check("honeypot: bots get a reference but nothing is stored", r.ok && /^NYO-/.test(r.rows[0].ref) && (await run(null, "select count(*)::int n from public.feedback where reference_number=$1", [r.rows[0].ref])).rows[0].n === 0);
  r = await run(anon, ANON, args());
  check("an identical resubmission within 2 minutes is refused", !r.ok && /already submitted/i.test(r.error), r.error);
  r = await run(anon, ANON, args({ subject: "  Padded subject  ", desc: "  Padded description with spaces.  ", cat: "", prod: "  " }));
  r = await run(null, "select subject, description, product_service_category, product_name from public.feedback where reference_number=$1", [r.rows[0].ref]);
  check("text is trimmed and blank optional fields become null", r.rows[0].subject === "Padded subject" && r.rows[0].description === "Padded description with spaces." && r.rows[0].product_service_category === null && r.rows[0].product_name === null);

  // flood cap + admin switch
  await run(null, "update public.system_settings set value=to_jsonb(2) where key='anonymous_max_per_hour'");
  r = await run(anon, ANON, args({ subject: "Over the cap", desc: "This one should hit the hourly cap." }));
  check("hourly cap refuses further submissions", !r.ok && /Too many/i.test(r.error) && r.code === "54000", r.error);
  await run(null, "update public.system_settings set value=to_jsonb(30) where key='anonymous_max_per_hour'");
  await run(null, "update public.system_settings set value='false'::jsonb where key='anonymous_feedback_enabled'");
  r = await run(anon, ANON, args({ subject: "Switch off", desc: "Anonymous feedback is switched off now." }));
  check("administrator switch turns the form off on the server", !r.ok && /switched off/i.test(r.error), r.error);
  r = await run(anon, "select public.anonymous_form_options() o");
  check("form options report enabled=false", r.ok && r.rows[0].o.enabled === false);
  await run(null, "update public.system_settings set value='true'::jsonb where key='anonymous_feedback_enabled'");
  r = await run(anon, "select public.anonymous_form_options() o");
  check("form options expose only the switch and the category list", r.ok && r.rows[0].o.enabled === true && Array.isArray(r.rows[0].o.categories) && Object.keys(r.rows[0].o).sort().join() === "categories,enabled");

  // what staff see
  r = await run(as("admin"), "select * from public.list_feedback($1,null,null,50,0,null)", ["anonymous"]);
  check("admin list shows the customer as 'Anonymous User' and search finds it", r.ok && r.rowCount >= 2 && r.rows.every((x) => x.customer_name === "Anonymous User"), r.error + JSON.stringify(r.rows.slice(0, 1)));
  r = await run(as("manager"), "select * from public.list_feedback($1,null,null,50,0,'unassigned')", [aRef]);
  check("manager list shows it as unassigned from 'Anonymous User'", r.rowCount === 1 && r.rows[0].customer_name === "Anonymous User");
  r = await run(as("admin"), "select * from public.list_feedback(null,null,null,100,0,null)");
  check("normal customers still show their real names", r.rows.some((x) => x.customer_name !== "Anonymous User" && x.customer_name.length > 3) && Number(r.rows[0].total_count) >= before + 3);
  r = await run(as("admin"), "select * from public.report_rows($1,$2)", [from, to]);
  check("CSV rows carry 'Anonymous User' with no contact data", r.ok && r.rows.filter((x) => x.customer_name === "Anonymous User").length >= 3);
  r = await run(as("admin"), "select public.dashboard_stats() s");
  check("dashboard counts include anonymous feedback", r.ok && r.rows[0].s.total >= before + 3, r.error);
  r = await run(as("admin"), "select public.report_summary($1,$2) s", [from, to]);
  check("reports count anonymous feedback", r.ok && r.rows[0].s.total >= before + 3);
  r = await run(as("admin"), "select id from public.feedback where id=$1", [A.id]);
  check("administrator can open the anonymous case", r.rowCount === 1);
  r = await run(as("emp1"), "select id from public.feedback where id=$1", [A.id]);
  check("an unassigned employee cannot see it", r.rowCount === 0);

  // the whole workflow works with nobody to notify
  r = await run(as("manager"), "select public.assign_feedback($1,$2,'please look')", [A.id, U.emp1]);
  check("manager can assign an anonymous case", r.ok, r.error);
  r = await run(as("emp1"), "select id, customer_id, is_anonymous from public.feedback where id=$1", [A.id]);
  check("the assigned employee sees it, with no customer behind it", r.rowCount === 1 && r.rows[0].customer_id === null);
  r = await run(as("emp1"), "select count(*)::int n from public.profiles where id <> $1 and role='customer'", [U.emp1]);
  check("the employee is not shown any customer profile for it", r.ok);
  r = await run(as("emp1"), "select public.start_feedback($1,null)", [A.id]);
  check("employee can start it", r.ok, r.error);
  r = await run(as("emp1"), "select public.add_feedback_response($1,'We are looking into it.','customer')", [A.id]);
  check("employee can add a reply (nobody is notified)", r.ok, r.error);
  r = await run(as("emp1"), "select public.resolve_feedback($1,'Spoke to the cashier and retrained the team.','Thank you, we have acted.',null)", [A.id]);
  check("employee can resolve it", r.ok, r.error);
  r = await run(null, "select status from public.feedback where id=$1", [A.id]);
  check("status is Resolved", r.rows[0].status === "Resolved");
  r = await run(null, "select count(*)::int n from public.notifications n join public.profiles p on p.id = n.user_id where n.feedback_id=$1 and p.role = 'customer'", [A.id]);
  check("no customer was notified about the anonymous case", r.rows[0].n === 0);
  r = await run(null, "update public.feedback set is_anonymous=false where id=$1", [A.id]);
  check("an anonymous case can never be turned into a customer case", !r.ok, r.error);
  r = await run(null, "update public.feedback set customer_id=$2 where id=$1", [A.id, U.cust1]);
  check("...nor be attached to a customer afterwards", !r.ok, r.error);

  r = await run(anon, "select * from public.list_feedback(null,null,null,10,0,null)");
  check("anonymous visitors cannot list feedback", !r.ok, r.error);
  r = await run(anon, "select public.report_summary('2026-01-01','2026-01-31')");
  check("anonymous visitors cannot read reports", !r.ok, r.error);
  r = await run(anon, "select * from public.list_servable_employees()");
  check("staff names are not offered to anonymous visitors", !r.ok, r.error);

  // -------------------------------------------------------------- hygiene
  console.log("\nHygiene");
  r = await run(null, `select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
                       where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
  check("every public table has RLS enabled", r.rows[0].n === 0, String(r.rows[0].n));
  r = await run(null, `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.prosecdef and not exists (
                         select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')`);
  check("every SECURITY DEFINER function pins search_path", r.rowCount === 0, r.rows.map((x) => x.proname).join());
  r = await run(null, `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')`);
  check("anon can execute only the two anonymous-form functions", r.rows.map((x) => x.proname).sort().join() === "anonymous_form_options,submit_anonymous_feedback", r.rows.map((x) => x.proname).join());
  r = await run(null, `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                       where n.nspname='public' and p.proname in ('log_audit','notify_user','generate_reference_number','setting_int')
                         and has_function_privilege('authenticated', p.oid, 'execute')`);
  check("internal helpers are not callable by signed-in users", r.rowCount === 0, r.rows.map((x) => x.proname).join());
  r = await run(null, `select table_name from information_schema.role_table_grants
                       where grantee='anon' and table_schema='public' limit 1`);
  check("anon holds no table privileges", r.rowCount === 0, JSON.stringify(r.rows));
  r = await run(null, `select count(*)::int n from public.feedback where service_rating is null or service_rating not between 1 and 5`);
  check("every stored rating is between 1 and 5", r.rows[0].n === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log("Failed:\n - " + failures.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
