// UI tests for Milestone 9: reports, user management, audit logs (administrator only).
const { chromium } = require("playwright");
const fs = require("fs");
const { serve, newPage, calls, signedInAs } = require("./harness");
let pass = 0, fail = 0; const failed = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log("  PASS", n); } else { fail++; failed.push(n); console.log("  FAIL", n, x ? "| " + x : ""); } };

const user = (id, role, fn, ln, o = {}) => ({ id, email: `${id}@nyota.test`, password: "Passw0rd!", first_name: fn, last_name: ln, phone: o.phone || null, role, account_status: o.status || "active", created_at: "2026-10-01T08:00:00Z" });
const USERS = [user("a1", "administrator", "Alice", "Njoroge"), user("m1", "manager", "Brian", "Mutua"), user("e1", "employee", "Cynthia", "Wanjiru"),
  user("e2", "employee", "Daniel", "Otieno", { status: "inactive" }), user("c1", "customer", "John", "Kamau", { phone: "0712345678" }),
  user("x1", "customer", '<img src=x onerror="window.__x=1">', "Evil")];
const userRows = USERS.map(({ password, ...u }) => u);
const REPORT = { from: "2026-10-01", to: "2026-10-25", total: 40, complaints: 18, compliments: 12, suggestions: 10, resolved_complaints: 9, pending: 10, in_progress: 8, resolved: 22,
  avg_rating: 3.85, avg_resolution_hours: 26.5, rating_distribution: [2, 4, 10, 14, 10],
  by_category: [{ name: "Phones", count: 20 }, { name: "<b>TV</b>", count: 10 }, { name: "Not specified", count: 10 }],
  by_employee: [{ id: "e1", name: "Cynthia Wanjiru", assigned: 12, resolved: 9, avg_hours: 20.5 }],
  trend: Array.from({ length: 25 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, count: i % 3 })) };
const ROWS = [
  { reference_number: "NYO-20261001-AAAAAAAA", created_at: "2026-10-01T08:00:00Z", feedback_type: "complaint", status: "Resolved", subject: '=HYPERLINK("http://evil","x")', customer_name: 'John "JK" Kamau', category: "Phones", service_rating: 2, assigned_employee: "Cynthia Wanjiru", resolved_at: "2026-10-02T10:00:00Z", resolution_hours: 26 },
  { reference_number: "NYO-20261002-BBBBBBBB", created_at: "2026-10-02T08:00:00Z", feedback_type: "compliment", status: "Pending", subject: "+cmd, with comma", customer_name: "Mary Atieno", category: null, service_rating: 5, assigned_employee: null, resolved_at: null, resolution_hours: null },
];
const logs = Array.from({ length: 45 }, (_, i) => ({ id: 100 - i, created_at: `2026-10-${String(24 - (i % 20)).padStart(2, "0")}T08:00:00Z`, actor_name: i === 0 ? "<i>Sneaky</i>" : i % 2 ? "Brian Mutua" : "System", action: i % 2 ? "feedback_assigned" : "role_changed", entity_type: "feedback", entity_id: "x", metadata: { reference: "NYO-1", note: "<script>1</script>" }, total_count: 45 }));
const base = (o = {}) => ({ rpc: { report_summary: { data: REPORT, error: null }, report_rows: { data: ROWS, error: null }, list_audit_logs: { data: logs.slice(0, 20), error: null } }, userRows, ...o });

(async () => {
  const { srv, base: B } = await serve();
  const browser = await chromium.launch();
  const open = async (stub, id = "a1", vp) => { const r = await newPage(browser, B, { users: USERS, stub, viewport: vp }); await signedInAs(r.page, id); r.page.on("dialog", (d) => d.accept()); return r; };

  console.log("\nNavigation");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/dashboard.html"); await page.waitForSelector(".ne-sidebar a");
    const links = await page.$$eval(".ne-sidebar nav a", (a) => a.map((x) => x.textContent));
    check("admin sidebar: Dashboard, Feedback, Users, Reports, Audit Logs all live", links.join() === "Dashboard,Feedback,Users,Reports,Audit Logs" && (await page.locator(".disabled-item").count()) === 0, links.join());
    await ctx.close(); }

  console.log("\nReports");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/reports.html"); await page.waitForSelector("#cards .ne-card");
    check("wireframe controls: Report Type, Start Date, End Date, GENERATE REPORT", (await page.textContent("#form")).replace(/\s+/g, " ").includes("Report Type") && (await page.locator("#rFrom").count()) === 1 && (await page.locator("#rTo").count()) === 1 && /GENERATE REPORT/.test(await page.textContent("#gen")));
    check("Monthly Report is the default type", (await page.inputValue("#rType")) === "monthly");
    check("the three wireframe cards", (await page.$$eval("#cards .ne-card", (c) => c.map((x) => x.querySelector(".num").textContent + "|" + x.querySelector(".lbl").textContent))).join() === "40|Total Feedback,18|Complaints,9|Resolved Complaints");
    check("extra cards: compliments, suggestions, avg rating, avg resolution", (await page.$$eval("#cards2 .ne-card", (c) => c.map((x) => x.querySelector(".num").textContent))).join() === "12,10,3.85 / 5,26.5 h");
    check("category bars with counts, widths relative to the largest", (await page.$$eval(".ne-bar-row .val", (v) => v.map((x) => x.textContent))).join() === "20,10,10" && (await page.$$eval(".ne-bar-fill", (b) => b.map((x) => x.style.width))).join() === "100%,50%,50%");
    check("HTML in category names is escaped", (await page.locator("#bars b").count()) === 0 && /<b>TV<\/b>/.test(await page.textContent("#bars")));
    check("employee performance table", /Cynthia Wanjiru/.test(await page.textContent("#staff")) && /20\.5/.test(await page.textContent("#staff")));
    const ch = await page.evaluate(() => window.__charts);
    check("trend (25 points) and rating (5 bars) charts get data", ch.find((c) => c.id === "trend").data.datasets[0].data.length === 25 && JSON.stringify(ch.find((c) => c.id === "ratings").data.datasets[0].data) === "[2,4,10,14,10]");
    check("charts have accessible labels", (await page.getAttribute("#trend", "aria-label")).length > 10 && (await page.getAttribute("#ratings", "aria-label")).length > 10);
    let c = await calls(page);
    const rs = c.rpc.find((x) => x.name === "report_summary");
    check("auto-generated for the current month with from/to dates", rs && /^\d{4}-\d{2}-01$/.test(rs.args.p_from) && /^\d{4}-\d{2}-\d{2}$/.test(rs.args.p_to));
    check("generating is recorded in the audit trail", c.rpc.some((x) => x.name === "log_admin_event" && x.args.p_action === "report_generated"));
    // type -> dates
    await page.selectOption("#rType", "daily");
    check("daily preset sets start = end", (await page.inputValue("#rFrom")) === (await page.inputValue("#rTo")));
    await page.selectOption("#rType", "yearly");
    check("yearly preset starts on 1 January", /-01-01$/.test(await page.inputValue("#rFrom")));
    await page.fill("#rFrom", "2026-10-10");
    check("editing a date switches to Custom Range", (await page.inputValue("#rType")) === "custom");
    // validation
    await page.fill("#rFrom", "2026-10-20"); await page.fill("#rTo", "2026-10-01"); await page.click("#gen");
    check("start after end is rejected client-side", /start date must be/i.test(await page.textContent("#alert")));
    await page.fill("#rFrom", "2024-01-01"); await page.fill("#rTo", "2026-10-01"); await page.click("#gen");
    check("range over 366 days is rejected client-side", /366/.test(await page.textContent("#alert")));
    await page.fill("#rFrom", ""); await page.click("#gen");
    check("missing date is rejected", /Choose a start and end date/.test(await page.textContent("#alert")));
    // CSV
    await page.fill("#rFrom", "2026-10-01"); await page.fill("#rTo", "2026-10-25"); await page.click("#gen"); await page.waitForTimeout(150);
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#csv")]);
    const csv = fs.readFileSync(await dl.path(), "utf8");
    check("CSV file name carries the period", dl.suggestedFilename() === "nyota-feedback-report_2026-10-01_to_2026-10-25.csv", dl.suggestedFilename());
    check("CSV has a header and one line per feedback", csv.replace(/^﻿/, "").split("\r\n").filter(Boolean).length === 3 && /^﻿Reference,Created/.test(csv));
    check("CSV neutralises formulas (= + - @) with a leading apostrophe", csv.includes("\"'=HYPERLINK(") && csv.includes("\"'+cmd, with comma\""));
    check("CSV quotes commas and doubles quotes", csv.includes('"John ""JK"" Kamau"'));
    check("CSV dates are in Nairobi time (UTC+3)", /01 Oct 2026, 11:00|01 Oct 2026,? 11:00/.test(csv) || /11:00/.test(csv));
    check("CSV has no email or phone columns", !/email|phone/i.test(csv.split("\r\n")[0]));
    c = await calls(page);
    check("export is recorded in the audit trail", c.rpc.some((x) => x.name === "log_admin_event" && x.args.p_action === "report_exported"));
    // print
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await page.click("#print");
    check("PRINT REPORT calls the browser print dialog", (await page.evaluate(() => window.__printed)) === 1);
    check("print hides the sidebar/top bar/forms", await page.evaluate(() => /no-print|ne-report-form/.test(document.querySelector("#form").className)));
    await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { report_summary: { data: null, error: { message: "denied" } } } }));
    await page.goto(B + "/admin/reports.html"); await page.waitForSelector("#alert:not(.d-none)");
    check("report failure shows a message and no fake numbers", /could not load/i.test(await page.textContent("#alert")) && (await page.locator("#cards .ne-card").count()) === 0);
    await ctx.close(); }
  { const empty = { ...REPORT, total: 0, complaints: 0, compliments: 0, suggestions: 0, resolved_complaints: 0, avg_rating: null, avg_resolution_hours: null, rating_distribution: [0, 0, 0, 0, 0], by_category: [], by_employee: [] };
    const { ctx, page } = await open(base({ rpc: { report_summary: { data: empty, error: null } } }));
    await page.goto(B + "/admin/reports.html"); await page.waitForSelector("#cards .ne-card");
    check("empty period: zeros, n/a and friendly messages", /n\/a/.test(await page.textContent("#cards2")) && /No feedback was submitted/.test(await page.textContent("#bars")) && /No assigned cases/.test(await page.textContent("#staff")));
    await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { report_summary: { data: REPORT, error: null }, report_rows: { data: null, error: { message: "x" } } } }));
    await page.goto(B + "/admin/reports.html"); await page.waitForSelector("#cards .ne-card");
    await page.click("#csv"); await page.waitForSelector("#alert:not(.d-none)");
    check("CSV failure shows an error and downloads nothing", /could not load/i.test(await page.textContent("#alert")));
    await ctx.close(); }
  { const { ctx, page } = await open(base(), "a1", { width: 375, height: 800 });
    await page.goto(B + "/admin/reports.html"); await page.waitForSelector("#cards .ne-card");
    check("no horizontal scroll on a 375px phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth));
    await ctx.close(); }

  console.log("\nUser management");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/users.html"); await page.waitForSelector(".ne-table");
    check("columns: Name, Email, Role, Status, Action", (await page.$$eval("th", (t) => t.map((x) => x.textContent))).join() === "Name,Email,Role,Status,Action");
    check("+ ADD USER button exists", /ADD USER/.test(await page.textContent("#addBtn")));
    check("lists all 6 users, staff before customers", (await page.locator("tbody tr").count()) === 6 && /Administrator|Manager|Employee/.test(await page.textContent("tbody tr:first-child td:nth-child(3)")));
    check("status badges show Active / Inactive", /Inactive/.test(await page.textContent("tbody")) && /Active/.test(await page.textContent("tbody")));
    check("HTML in names is not executed", (await page.evaluate(() => window.__x)) === undefined);
    check("own row is marked (you)", /\(you\)/.test(await page.textContent("tbody")));
    await page.selectOption("#fRole", "employee");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 2);
    check("role filter", (await page.locator("tbody tr").count()) === 2);
    await page.selectOption("#fStatus", "inactive");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
    check("role + status filters combine", /Daniel/.test(await page.textContent("tbody")));
    await page.selectOption("#fRole", ""); await page.selectOption("#fStatus", ""); await page.fill("#q", "cynth"); await page.press("#q", "Enter");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
    check("search by name", /Cynthia/.test(await page.textContent("tbody")));
    await page.fill("#q", "nobody"); await page.press("#q", "Enter"); await page.waitForSelector(".ne-empty");
    check("no matches shows a message", /No users match/.test(await page.textContent("#tableWrap")));
    await ctx.close(); }

  console.log("\nAdd user");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/users.html"); await page.waitForSelector(".ne-table");
    await page.click("#addBtn"); await page.waitForSelector("#addForm");
    check("role choices are staff roles only (no customer)", (await page.$$eval("#aRole option", (o) => o.map((x) => x.value))).join() === "employee,manager,administrator");
    await page.click("#aSave");
    check("empty form shows field errors and calls nothing", (await page.locator("#addForm .is-invalid").count()) >= 4 && !((await calls(page)).fn || []).length);
    await page.fill("#aFirst", "Grace"); await page.fill("#aLast", "Kiptoo"); await page.fill("#aEmail", "grace@nyota.test"); await page.fill("#aPass", "short1");
    await page.click("#aSave");
    check("weak temporary password is rejected", /10 to 72/.test(await page.textContent("#addForm")) && !((await calls(page)).fn || []).length);
    await page.fill("#aPass", "Temp-Pass-2026"); await page.selectOption("#aRole", "manager"); await page.click("#aSave");
    await page.waitForSelector("#alert.alert-success");
    const fn = (await calls(page)).fn;
    check("calls the create-staff-user Edge Function with the form values", fn.length === 1 && fn[0].name === "create-staff-user" && fn[0].body.email === "grace@nyota.test" && fn[0].body.role === "manager" && fn[0].body.temporary_password === "Temp-Pass-2026");
    check("success message never repeats the password", !/Temp-Pass/.test(await page.textContent("#alert")));
    check("form closes and list reloads", (await page.locator("#addForm").count()) === 0);
    await ctx.close(); }
  { const { ctx, page } = await open(base({ fnResult: { "create-staff-user": { error: "An account with that email already exists." } } }));
    await page.goto(B + "/admin/users.html"); await page.waitForSelector(".ne-table"); await page.click("#addBtn");
    await page.fill("#aFirst", "G"); await page.fill("#aLast", "K"); await page.fill("#aEmail", "e1@nyota.test"); await page.fill("#aPass", "Temp-Pass-2026"); await page.click("#aSave");
    await page.waitForSelector("#alert.alert-danger");
    check("server error text (duplicate email) is shown and the form stays open", /already exists/.test(await page.textContent("#alert")) && (await page.locator("#addForm").count()) === 1);
    await page.click("#aCancel");
    check("Cancel closes the form", (await page.locator("#addForm").count()) === 0);
    await ctx.close(); }

  console.log("\nEdit user");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/users.html"); await page.waitForSelector(".ne-table");
    await page.locator("tr", { hasText: "Cynthia" }).locator("[data-edit]").click(); await page.waitForSelector("#editForm");
    check("edit shows the user's email and current role", /e1@nyota\.test/.test(await page.textContent("#editForm")) && (await page.inputValue("#eRole")) === "employee");
    check("button offers Deactivate for an active account", /Deactivate/.test(await page.textContent("#eToggle")));
    await page.selectOption("#eRole", "manager"); await page.click("#eSave"); await page.waitForSelector("#alert.alert-success");
    const up = (await calls(page))["update:profiles"];
    check("role change updates only the role of that user", up.length === 1 && JSON.stringify(up[0].set) === '{"role":"manager"}' && up[0].where.id === "e1");
    await page.locator("tr", { hasText: "Cynthia" }).locator("[data-edit]").click(); await page.waitForSelector("#editForm");
    await page.click("#eToggle"); await page.waitForSelector("#alert.alert-success");
    const fn = (await calls(page)).fn;
    check("deactivate calls set-account-status with inactive", fn.length === 1 && fn[0].name === "set-account-status" && fn[0].body.user_id === "e1" && fn[0].body.status === "inactive");
    await page.locator("tr", { hasText: "Daniel" }).locator("[data-edit]").click(); await page.waitForSelector("#editForm");
    check("inactive account offers Activate", /Activate account/.test(await page.textContent("#eToggle")));
    await page.click("#eToggle"); await page.waitForSelector("#alert.alert-success");
    check("activate sends status active", (await calls(page)).fn.at(-1).body.status === "active");
    await page.locator("tr", { hasText: "John" }).locator("[data-edit]").click(); await page.waitForSelector("#editForm");
    check("customer role cannot be changed (disabled), but status can", (await page.isDisabled("#eRole")) && (await page.isDisabled("#eSave")) && !(await page.isDisabled("#eToggle")));
    await page.locator("tr", { hasText: "Alice" }).locator("[data-edit]").click(); await page.waitForSelector("#editForm");
    check("own account: role, save and deactivate are all disabled", (await page.isDisabled("#eRole")) && (await page.isDisabled("#eSave")) && (await page.isDisabled("#eToggle")) && /cannot change your own/.test(await page.textContent("#editForm")));
    await ctx.close(); }
  { const { ctx, page } = await open(base({ fnResult: { "set-account-status": { error: "The only active administrator cannot be deactivated." } }, updateErr: { profiles: { message: "The only active administrator cannot be demoted or deactivated." } } }));
    await page.goto(B + "/admin/users.html"); await page.waitForSelector(".ne-table");
    await page.locator("tr", { hasText: "Brian" }).locator("[data-edit]").click(); await page.waitForSelector("#editForm");
    await page.click("#eToggle"); await page.waitForSelector("#alert.alert-danger");
    check("server refusal on deactivate is shown", /only active administrator/.test(await page.textContent("#alert")));
    await page.locator("tr", { hasText: "Brian" }).locator("[data-edit]").click(); await page.waitForSelector("#editForm");
    await page.selectOption("#eRole", "employee"); await page.click("#eSave"); await page.waitForSelector("#alert.alert-danger");
    check("server refusal on role change is mapped to a clear message", /only active administrator cannot be demoted/.test(await page.textContent("#alert")));
    await ctx.close(); }
  { const many = Array.from({ length: 25 }, (_, i) => ({ ...userRows[4], id: `cc${i}`, first_name: `Cust${i}`, email: `cc${i}@x.test` }));
    const { ctx, page } = await open(base({ userRows: many }));
    await page.goto(B + "/admin/users.html"); await page.waitForSelector(".ne-table");
    check("pager: 25 users over 3 pages", /25 users/.test(await page.textContent("#pager")) && /Page 1 of 3/.test(await page.textContent("#pager")));
    await page.click("#next"); await page.waitForFunction(() => /Page 2 of 3/.test(document.getElementById("pager").textContent));
    check("next page loads", /Cust10/.test(await page.textContent("tbody")));
    await ctx.close(); }

  console.log("\nAudit logs");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/audit.html"); await page.waitForSelector(".ne-table");
    check("columns: When, Who, Action, Details", (await page.$$eval("th", (t) => t.map((x) => x.textContent))).join() === "When,Who,Action,Details");
    check("20 rows per page with a total of 45", (await page.locator("tbody tr").count()) === 20 && /45 entries/.test(await page.textContent("#pager")));
    check("actions show friendly labels", /Role changed/.test(await page.textContent("tbody")) && /Feedback assigned/.test(await page.textContent("tbody")));
    check("actor names and details are escaped (no injected HTML)", (await page.locator("tbody i, tbody script").count()) === 0 && /<i>Sneaky<\/i>/.test(await page.textContent("tbody")));
    check("System shown for automatic entries", /System/.test(await page.textContent("tbody")));
    await page.selectOption("#fAction", "role_changed"); await page.waitForTimeout(150);
    const a = (await calls(page)).rpc.filter((x) => x.name === "list_audit_logs").at(-1);
    check("action filter is sent to the database", a.args.p_action === "role_changed" && a.args.p_offset === 0);
    await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { list_audit_logs: { data: null, error: { message: "x" } } } }));
    await page.goto(B + "/admin/audit.html"); await page.waitForSelector(".alert-danger");
    check("audit load failure shows an error", /could not load/i.test(await page.textContent("#alert")));
    await ctx.close(); }

  console.log("\nAccess control");
  for (const [id, dest] of [["m1", "/manager/dashboard.html"], ["e1", "/employee/dashboard.html"], ["c1", "/customer/dashboard.html"]]) {
    for (const p of ["/admin/reports.html", "/admin/users.html", "/admin/audit.html"]) {
      const { ctx, page } = await open(base(), id);
      await page.goto(B + p); await page.waitForTimeout(450);
      const c = await calls(page);
      check(`${id} opening ${p} is sent away and nothing is loaded`, new URL(page.url()).pathname === dest && !(c.rpc || []).some((x) => /report_|list_users|list_audit/.test(x.name)), page.url());
      await ctx.close();
    }
  }
  { const r = await newPage(browser, B, { users: USERS, stub: base() });
    await r.page.goto(B + "/admin/users.html"); await r.page.waitForTimeout(450);
    check("signed-out visitor is sent to the staff login with a safe next", /staff\/login\.html\?next=admin%2Fusers\.html/.test(r.page.url()), r.page.url());
    await r.ctx.close(); }
  { const r = await newPage(browser, B, { users: USERS, stub: {}, configured: false });
    await r.page.goto(B + "/admin/reports.html"); await r.page.waitForTimeout(300);
    check("unconfigured backend shows a setup message instead of breaking", /not configured|configure/i.test(await r.page.textContent("body")));
    await r.ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("Failed:\n - " + failed.join("\n - ")); process.exit(1); }
})();
