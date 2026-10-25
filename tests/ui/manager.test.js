// UI tests for Milestone 7: manager dashboard, all feedback, assignment queue, assign/reassign.
const { chromium } = require("playwright");
const { serve, newPage, calls, signedInAs } = require("./harness");
let pass = 0, fail = 0; const failed = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log("  PASS", n); } else { fail++; failed.push(n); console.log("  FAIL", n, x ? "| " + x : ""); } };

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = (id, role, fn, ln, o = {}) => ({ id, email: `${id}@nyota.test`, password: "Passw0rd!", first_name: fn, last_name: ln, phone: o.phone || null, role, account_status: "active" });
const USERS = [user("a1", "administrator", "Alice", "Njoroge"), user("m1", "manager", "Brian", "Mutua"), user("e1", "employee", "Cynthia", "Wanjiru"), user("e2", "employee", "Daniel", "Otieno"), user("c1", "customer", "John", "Kamau", { phone: "0712345678" })];
const T = ["complaint", "compliment", "suggestion"], S = ["Pending", "In Progress", "Resolved"];
const listRows = Array.from({ length: 14 }, (_, i) => ({
  id: uuid(i + 1), reference_number: `NYO-20261024-${String(i + 1).padStart(8, "0")}`, feedback_type: T[i % 3], subject: `Subject ${i + 1}`, status: i % 4 === 3 ? "Resolved" : "Pending",
  service_rating: 3, created_at: `2026-10-${String(1 + i).padStart(2, "0")}T08:00:00Z`, customer_name: `Customer ${i + 1}`,
  assigned_employee_id: i % 2 ? "e1" : null, assigned_employee_name: i % 2 ? "Cynthia Wanjiru" : null }));
const STATS = { total: 14, complaints: 5, compliments: 5, suggestions: 4, pending: 10, in_progress: 0, resolved: 4, avg_rating: 3, trend: [] };
const TEAM = { data: [{ id: "e1", first_name: "Cynthia", last_name: "Wanjiru", open_cases: 3 }, { id: "e2", first_name: "Daniel", last_name: "Otieno", open_cases: 0 }], error: null };
const F = (o = {}) => ({ id: uuid(1), customer_id: "c1", reference_number: "NYO-20261024-00000001", feedback_type: "complaint", subject: "Faulty blender", description: "Stopped working.", service_rating: 2, status: "Pending",
  created_at: "2026-10-20T08:00:00Z", resolved_at: null, resolved_by: null, resolution_details: null, served_by_employee_id: null, ...o });
const tbl = (o = {}) => ({ feedback: [F(o.f)], feedback_assignments: o.a || [], feedback_responses: o.r || [], feedback_status_history: [{ id: 1, feedback_id: uuid(1), previous_status: null, new_status: "Pending", changed_by: "c1", change_note: null, changed_at: "2026-10-20T08:00:00Z" }], feedback_attachments: [] });
const base = (o = {}) => ({ rpc: { dashboard_stats: { data: STATS, error: null }, list_assignable_employees: TEAM, assign_feedback: { data: uuid(77), error: null } }, listRows, tables: tbl(), ...o });

(async () => {
  const { srv, base: B } = await serve();
  const browser = await chromium.launch();
  const open = async (stub, id = "m1", vp) => { const r = await newPage(browser, B, { users: USERS, stub, viewport: vp }); await signedInAs(r.page, id); return r; };
  const lastRpc = async (page, name) => (await calls(page)).rpc.filter((c) => c.name === name).at(-1);

  console.log("\nManager dashboard");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/manager/dashboard.html"); await page.waitForSelector("#row1 .ne-card");
    check("cards: Total, Pending, In Progress, Resolved", (await page.$$eval("#row1 .ne-card", (c) => c.map((x) => x.querySelector(".num").textContent + "|" + x.querySelector(".lbl").textContent))).join() === "14|Total,10|Pending,0|In Progress,4|Resolved");
    await page.waitForSelector("#queue tbody tr");
    check("awaiting-assignment queue asks the server for unassigned cases only", (await lastRpc(page, "list_feedback")).args.p_assignment === "unassigned" && (await page.locator("#queue tbody tr").count()) === 5);
    check("queue rows link to the manager's details page with an Assign button", /manager\/feedback-details\.html\?id=/.test(await page.getAttribute("#queue a.btn-view", "href")) && /Assign/.test(await page.textContent("#queue a.btn-view")));
    check("shows how many more are waiting", /7 cases are waiting/.test(await page.textContent("#queue")));
    const nav = await page.$$eval(".ne-sidebar .items > *", (e) => e.map((x) => x.firstChild.textContent.trim() + (x.tagName === "A" ? "*" : "")));
    check("manager menu: Dashboard*, All Feedback*, Assignments* and no Reports/Users", nav.join() === "Dashboard*,All Feedback*,Assignments*", nav.join());
    check("no charts or report links on the manager dashboard", (await page.locator("canvas").count()) === 0 && !/report/i.test(await page.textContent("main")));
    await ctx.close(); }
  { const { ctx, page } = await open(base({ listRows: listRows.filter((r) => r.assigned_employee_id) }));
    await page.goto(B + "/manager/dashboard.html"); await page.waitForSelector("#queue .ne-empty");
    check("empty queue says nothing is waiting", /Nothing is waiting/.test(await page.textContent("#queue"))); await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { dashboard_stats: { data: null, error: { message: "x" } }, list_assignable_employees: TEAM } }));
    await page.goto(B + "/manager/dashboard.html"); await page.waitForSelector("#alert:not(.d-none)");
    check("stats failure shows an error", /could not load/i.test(await page.textContent("#alert"))); await ctx.close(); }

  console.log("\nAll feedback and queue");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/manager/feedback.html"); await page.waitForSelector(".ne-table");
    check("title ALL FEEDBACK with Assignment filter and Assigned To column", /ALL FEEDBACK/.test(await page.textContent("h1")) && (await page.locator("#fAssign").count()) === 1 && /Assigned To/.test(await page.textContent("thead")));
    await page.selectOption("#fAssign", "unassigned");
    await page.waitForFunction(() => !/Cynthia/.test(document.querySelector("tbody").textContent));
    check("Assignment filter is sent to the server and kept in the URL", (await lastRpc(page, "list_feedback")).args.p_assignment === "unassigned" && /assignment=unassigned/.test(page.url()));
    check("details links go to the manager page", /manager\/feedback-details/.test(await page.getAttribute("a.btn-view", "href")));
    await ctx.close(); }
  { const { ctx, page } = await open(base());
    await page.goto(B + "/manager/feedback.html?assignment=bogus"); await page.waitForSelector(".ne-table");
    check("invalid assignment in URL is ignored", (await lastRpc(page, "list_feedback")).args.p_assignment === null); await ctx.close(); }
  { const { ctx, page } = await open(base());
    await page.goto(B + "/manager/assignments.html"); await page.waitForSelector(".ne-table");
    check("assignment page lists only unassigned cases and hides the assignment filter", /AWAITING ASSIGNMENT/.test(await page.textContent("h1")) && (await page.locator("#fAssign").count()) === 0 && (await lastRpc(page, "list_feedback")).args.p_assignment === "unassigned");
    await page.waitForSelector("#workload tbody tr");
    check("team workload shows each active employee's open cases", (await page.$$eval("#workload tbody tr", (r) => r.map((x) => x.textContent))).join() === "Cynthia Wanjiru3,Daniel Otieno0");
    await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { dashboard_stats: { data: STATS }, list_assignable_employees: { data: [], error: null } } }));
    await page.goto(B + "/manager/assignments.html"); await page.waitForSelector("#workload .ne-empty");
    check("no employees: clear message", /no active employees/.test(await page.textContent("#workload"))); await ctx.close(); }

  console.log("\nAssign and reassign");
  const go = async (page) => { await page.goto(B + "/manager/feedback-details.html?id=" + uuid(1)); await page.waitForSelector("#ref"); };
  { const { ctx, page } = await open(base());
    await go(page); await page.waitForSelector("#assignForm");
    check("unassigned case shows an Assign form with both employees and open counts", /Assign this case/.test(await page.textContent("#assignForm")) && (await page.$$eval("#employee option", (o) => o.map((x) => x.textContent))).join() === "Choose an employee,Cynthia Wanjiru (3 open),Daniel Otieno (0 open)" && (await page.textContent("#assignBtn")) === "Assign");
    await page.click("#assignBtn");
    check("submitting without choosing an employee is refused locally", /Choose an employee first/.test(await page.textContent("#assignAlert")) && !(await lastRpc(page, "assign_feedback")));
    await page.selectOption("#employee", "e2"); await page.fill("#note", "  Please call the customer  "); await page.click("#assignBtn");
    await page.waitForSelector("#notice:not(.d-none)");
    const a = (await lastRpc(page, "assign_feedback")).args;
    check("assign_feedback is called with feedback, employee and trimmed note", a.p_feedback_id === uuid(1) && a.p_employee_id === "e2" && a.p_note === "Please call the customer");
    check("success notice names the employee and the page is refreshed", /now assigned to Daniel Otieno/.test(await page.textContent("#notice")) && (await page.locator("#assignForm").count()) === 1);
    await ctx.close(); }
  { const { ctx, page } = await open(base());
    await go(page); await page.waitForSelector("#assignForm");
    await page.selectOption("#employee", "e1"); await page.click("#assignBtn"); await page.waitForSelector("#notice:not(.d-none)");
    check("an empty note is sent as null", (await lastRpc(page, "assign_feedback")).args.p_note === null); await ctx.close(); }
  const cur = [{ id: 1, feedback_id: uuid(1), assigned_employee_id: "e1", assigned_by_manager_id: "m1", assigned_at: "2026-10-21T09:00:00Z", unassigned_at: null, assignment_note: null }];
  { const { ctx, page } = await open(base({ tables: tbl({ a: cur }) }));
    await go(page); await page.waitForSelector("#assignForm");
    check("assigned case shows Reassign, current employee disabled", /Reassign this case/.test(await page.textContent("#assignForm")) && (await page.textContent("#assignBtn")) === "Reassign" && await page.isDisabled("#employee option:nth-child(2)") && /Cynthia Wanjiru/.test(await page.textContent("#assignee")));
    await ctx.close(); }
  for (const [msg, expect] of [["This case is already assigned to that employee.", /already assigned/], ["Resolved feedback cannot be assigned.", /Resolved cases cannot/], ["Choose an active employee.", /active employee/], ["Only managers can assign feedback.", /Only managers/], ["Feedback not found.", /no longer exists/], ["boom internal error", /could not assign/i]]) {
    const { ctx, page } = await open(base({ rpc: { dashboard_stats: { data: STATS }, list_assignable_employees: TEAM, assign_feedback: { data: null, error: { message: msg } } } }));
    await go(page); await page.waitForSelector("#assignForm"); await page.selectOption("#employee", "e2"); await page.click("#assignBtn");
    await page.waitForSelector("#assignAlert:not(.d-none)");
    check(`database message "${msg}" becomes a friendly message and keeps the form`, expect.test(await page.textContent("#assignAlert")) && !/boom/.test(await page.textContent("#assignAlert")) && !(await page.isDisabled("#assignBtn")));
    await ctx.close();
  }
  { const { ctx, page } = await open(base({ tables: tbl({ f: { status: "Resolved", resolved_at: "2026-10-22T10:00:00Z", resolved_by: "e1", resolution_details: "Done." }, a: cur }) }));
    await go(page); await page.waitForSelector("#actionPanel .ne-note");
    check("resolved case: no assign form", (await page.locator("#assignForm").count()) === 0 && /can no longer be assigned/.test(await page.textContent("#actionPanel"))); await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { dashboard_stats: { data: STATS }, list_assignable_employees: { data: [], error: null } } }));
    await go(page); await page.waitForSelector("#actionPanel .ne-panel");
    check("no active employees: explains instead of showing an empty form", /no active employees/.test(await page.textContent("#actionPanel")) && (await page.locator("#assignForm").count()) === 0); await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { dashboard_stats: { data: STATS }, list_assignable_employees: { data: null, error: { message: "x" } } } }));
    await go(page); await page.waitForSelector("#actionPanel .ne-panel");
    check("team load failure is reported", /could not load the team/.test(await page.textContent("#actionPanel"))); await ctx.close(); }
  { const r = [{ id: 1, feedback_id: uuid(1), author_id: "e1", response_text: "Internal: customer called twice", visibility: "internal", created_at: "2026-10-21T10:00:00Z" }];
    const { ctx, page } = await open(base({ tables: tbl({ r, a: cur }) }));
    await go(page);
    check("manager sees internal notes with their label", /Internal note/.test(await page.textContent("main")) && /customer called twice/.test(await page.textContent("main")));
    check("history includes the assignment", /Assigned to Cynthia Wanjiru by Brian Mutua/.test(await page.textContent("#history")));
    await ctx.close(); }
  { const { ctx, page } = await open(base());
    for (const id of [uuid(404), "garbage"]) { await page.goto(B + "/manager/feedback-details.html?id=" + id); await page.waitForSelector("h1"); check(`id "${id}" shows not found`, /not found/i.test(await page.textContent("h1"))); }
    await ctx.close(); }

  console.log("\nAccess control");
  { const { ctx, page } = await open(base(), "a1");
    await page.goto(B + "/admin/feedback-details.html?id=" + uuid(1)); await page.waitForSelector("#ref");
    check("administrator's case page has no assign form (admin cannot assign)", (await page.locator("#assignForm, #employee").count()) === 0); await ctx.close(); }
  for (const [id, dest] of [["a1", "/admin/dashboard.html"], ["e1", "/employee/dashboard.html"], ["c1", "/customer/dashboard.html"]]) {
    for (const p of ["/manager/dashboard.html", "/manager/feedback.html", "/manager/assignments.html", "/manager/feedback-details.html?id=" + uuid(1)]) {
      const { ctx, page } = await open(base(), id); await page.goto(B + p); await page.waitForTimeout(450);
      check(`${id} opening ${p.split("?")[0]} is sent to ${dest}`, new URL(page.url()).pathname === dest, page.url()); await ctx.close();
    }
  }
  { const { ctx, page } = await open(base(), "m1");
    for (const p of ["/admin/dashboard.html", "/admin/feedback.html"]) { await page.goto(B + p); await page.waitForTimeout(450); check(`manager cannot open ${p}`, new URL(page.url()).pathname === "/manager/dashboard.html"); }
    await ctx.close(); }

  console.log("\nResponsive");
  { const { ctx, page } = await open(base({ tables: tbl({ a: cur }) }), "m1", { width: 375, height: 800 });
    for (const p of ["/manager/dashboard.html", "/manager/feedback.html", "/manager/assignments.html", "/manager/feedback-details.html?id=" + uuid(1)]) {
      await page.goto(B + p); await page.waitForSelector(".ne-content > *"); await page.waitForTimeout(400);
      check(`no horizontal page scroll at 375px on ${p.split("?")[0]}`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0); }
    await ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(" - " + failed.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
