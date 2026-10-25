// UI tests for Milestone 6: administrator dashboard, feedback management, feedback details.
const { chromium } = require("playwright");
const { serve, newPage, calls, signedInAs } = require("./harness");
let pass = 0, fail = 0; const failed = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log("  PASS", n); } else { fail++; failed.push(n); console.log("  FAIL", n, x ? "| " + x : ""); } };

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = (id, role, o = {}) => ({ id, email: `${id}@nyota.test`, password: "Passw0rd!", first_name: o.fn || role, last_name: o.ln || "Tester", phone: o.phone || null, role, account_status: "active" });
const USERS = [user("a1", "administrator", { fn: "Alice", ln: "Njoroge" }), user("m1", "manager", { fn: "Brian", ln: "Mutua" }), user("e1", "employee", { fn: "Cynthia", ln: "Wanjiru" }), user("c1", "customer", { fn: "John", ln: "Kamau", phone: "0712345678" }), user("x9", "customer")];
const T = ["complaint", "compliment", "suggestion"], S = ["Pending", "In Progress", "Resolved"];
const listRows = Array.from({ length: 23 }, (_, i) => ({
  id: uuid(i + 1), reference_number: `NYO-20261024-${String(i + 1).padStart(8, "0")}`, feedback_type: T[i % 3], subject: i === 0 ? '<img src=x onerror="window.__x=1">Blender' : `Subject ${i + 1}`,
  status: S[i % 3], service_rating: 3, created_at: `2026-10-${String(1 + (i % 20)).padStart(2, "0")}T08:00:00Z`,
  customer_name: i === 1 ? "Mary Atieno" : `Customer ${i + 1}`, assigned_employee_id: i % 2 ? "e1" : null, assigned_employee_name: i % 2 ? "Cynthia Wanjiru" : null,
}));
const trend = Array.from({ length: 30 }, (_, i) => ({ day: `2026-10-${String(i + 1).padStart(2, "0")}`, count: i % 4 }));
const STATS = { total: 250, complaints: 120, compliments: 70, suggestions: 60, pending: 100, in_progress: 50, resolved: 100, avg_rating: 4.2, trend };
const base = (o = {}) => ({ rpc: { dashboard_stats: { data: STATS, error: null } }, listRows, tables: {}, ...o });

(async () => {
  const { srv, base: B } = await serve();
  const browser = await chromium.launch();
  const open = async (stub, id = "a1", vp) => { const r = await newPage(browser, B, { users: USERS, stub, viewport: vp }); await signedInAs(r.page, id); return r; };

  console.log("\nDashboard");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/dashboard.html"); await page.waitForSelector("#row1 .ne-card");
    const nums = async (sel) => page.$$eval(`${sel} .ne-card`, (c) => c.map((x) => x.querySelector(".num").textContent + "|" + x.querySelector(".lbl").textContent));
    check("first row: Total, Complaints, Compliments, Suggestions (wireframe cards)", (await nums("#row1")).join() === "250|Total,120|Complaints,70|Compliments,60|Suggestions");
    check("second row: Pending, In Progress, Resolved, Avg rating", (await nums("#row2")).join() === "100|Pending,50|In Progress,100|Resolved,4.2 / 5|Avg. Rating");
    const ch = await page.evaluate(() => window.__charts);
    check("trend line chart gets 30 daily points", ch.find((c) => c.id === "trend").type === "line" && ch.find((c) => c.id === "trend").data.datasets[0].data.length === 30);
    check("category doughnut gets complaints/compliments/suggestions", JSON.stringify(ch.find((c) => c.id === "byType").data.datasets[0].data) === "[120,70,60]" && ch.find((c) => c.id === "byType").type === "doughnut");
    check("charts have accessible labels", (await page.getAttribute("#trend", "aria-label")).length > 10 && (await page.getAttribute("#byType", "aria-label")).length > 10);
    check("recent feedback shows 5 rows with View links to admin details", (await page.locator("#recent tbody tr").count()) === 5 && /admin\/feedback-details\.html\?id=/.test(await page.getAttribute("#recent a.btn-view", "href")));
    check("recent feedback columns: Reference, Type, Status, Date", (await page.$$eval("#recent th", (t) => t.map((x) => x.textContent))).slice(0, 4).join() === "Reference,Type,Status,Date");
    check("HTML in data is not executed", (await page.evaluate(() => window.__x)) === undefined);
    check("sidebar highlights Dashboard and Feedback is a live link", /Dashboard/.test(await page.textContent(".ne-sidebar a.active")) && (await page.locator(".ne-sidebar a[href$='admin/feedback.html']").count()) === 1);
    await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { dashboard_stats: { data: { ...STATS, total: 0, complaints: 0, compliments: 0, suggestions: 0, pending: 0, in_progress: 0, resolved: 0, avg_rating: null, trend: [] }, error: null } }, listRows: [] }));
    await page.goto(B + "/admin/dashboard.html"); await page.waitForSelector("#row1 .ne-card");
    check("empty system: zeros, 'n/a' rating and an empty message", /n\/a/.test(await page.textContent("#row2")) && /No feedback has been submitted/.test(await page.textContent("#recent")));
    await ctx.close(); }
  { const { ctx, page } = await open(base({ rpc: { dashboard_stats: { data: null, error: { message: "denied" } } } }));
    await page.goto(B + "/admin/dashboard.html"); await page.waitForSelector("#alert:not(.d-none)");
    check("stats failure shows an error instead of fake numbers", /could not load/i.test(await page.textContent("#alert")) && (await page.locator("#row1 .ne-card").count()) === 0);
    await ctx.close(); }
  for (const [id, dest] of [["m1", "/manager/dashboard.html"], ["e1", "/employee/dashboard.html"], ["c1", "/customer/dashboard.html"]]) {
    for (const p of ["/admin/dashboard.html", "/admin/feedback.html", "/admin/feedback-details.html?id=" + uuid(1)]) {
      const { ctx, page } = await open(base(), id);
      await page.goto(B + p); await page.waitForTimeout(500);
      check(`${id} opening ${p.split("?")[0]} is sent away`, new URL(page.url()).pathname === dest, page.url());
      await ctx.close();
    }
  }

  console.log("\nFeedback management");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/feedback.html"); await page.waitForSelector(".ne-table");
    check("columns: Reference, Customer, Type, Status, Assigned To, Date, Action", (await page.$$eval("th", (t) => t.map((x) => x.textContent))).join() === "Reference,Customer,Type,Status,Assigned To,Date,Action");
    check("10 rows, 23 items, page 1 of 3", (await page.locator("tbody tr").count()) === 10 && /23 items/.test(await page.textContent("#pager")) && /Page 1 of 3/.test(await page.textContent("#pager")));
    check("unassigned cases are labelled", /Unassigned/.test(await page.textContent("tbody tr")) && /Cynthia Wanjiru/.test(await page.textContent("tbody")));
    check("hostile subject text is harmless", (await page.evaluate(() => window.__x)) === undefined);
    await page.click("#next");
    await page.waitForFunction(() => /Page 2 of 3/.test(document.getElementById("pager").textContent));
    let rpcs = (await calls(page)).rpc.filter((c) => c.name === "list_feedback");
    check("paging asks the server for offset 10, limit 10", rpcs.at(-1).args.p_offset === 10 && rpcs.at(-1).args.p_limit === 10);
    check("page is kept in the address bar", /page=2/.test(page.url()));
    await page.fill("#q", "mary"); await page.click("#filters button[type=submit]");
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
    rpcs = (await calls(page)).rpc.filter((c) => c.name === "list_feedback");
    check("search by customer name goes to the server and resets to page 1", rpcs.at(-1).args.p_search === "mary" && rpcs.at(-1).args.p_offset === 0 && /Mary Atieno/.test(await page.textContent("tbody")) && /q=mary/.test(page.url()) && !/page=/.test(page.url()));
    await page.fill("#q", ""); await page.selectOption("#fStatus", "Resolved"); await page.selectOption("#fType", "suggestion");
    await page.waitForFunction(() => /Resolved/.test(document.querySelector("tbody")?.textContent || "") || /No feedback matches/.test(document.getElementById("tableWrap").textContent));
    rpcs = (await calls(page)).rpc.filter((c) => c.name === "list_feedback");
    check("type and status filters are sent to the server together", rpcs.at(-1).args.p_type === "suggestion" && rpcs.at(-1).args.p_status === "Resolved");
    await page.fill("#q", "nothing-like-this"); await page.click("#filters button[type=submit]");
    await page.waitForFunction(() => /No feedback matches/.test(document.getElementById("tableWrap").textContent));
    check("no results shows a message", true);
    await ctx.close(); }
  { const { ctx, page } = await open(base());
    await page.goto(B + "/admin/feedback.html?q=Subject%2012&type=bogus&status=Hacked&page=-4"); await page.waitForSelector(".ne-table");
    const a = (await calls(page)).rpc.filter((c) => c.name === "list_feedback")[0].args;
    check("invalid filters in the URL are ignored; search text is applied", a.p_type === null && a.p_status === null && a.p_search === "Subject 12" && a.p_offset === 0 && (await page.inputValue("#q")) === "Subject 12");
    await page.goto(B + "/admin/feedback.html?page=99"); await page.waitForSelector(".ne-table");
    await page.waitForFunction(() => /Page 1 of 3/.test(document.getElementById("pager").textContent));
    check("a page number past the end falls back to page 1", true);
    await ctx.close(); }
  { const { ctx, page } = await open(base({ listError: true }));
    await page.goto(B + "/admin/feedback.html"); await page.waitForSelector("#alert:not(.d-none)");
    check("list failure shows an error message", /could not load the feedback list/i.test(await page.textContent("#alert")));
    await ctx.close(); }
  { const { ctx, page } = await open(base({ listRows: [] }));
    await page.goto(B + "/admin/feedback.html"); await page.waitForSelector(".ne-empty");
    check("empty system message", /No feedback has been submitted yet/.test(await page.textContent("#tableWrap")));
    await ctx.close(); }

  console.log("\nFeedback details");
  const F = { id: uuid(1), customer_id: "c1", reference_number: "NYO-20261024-00000001", feedback_type: "complaint", subject: "Faulty blender", description: "It stopped <b>working</b>.", service_rating: 2, status: "Resolved",
    created_at: "2026-10-20T08:00:00Z", resolved_at: "2026-10-22T10:00:00Z", resolved_by: "e1", resolution_details: "Replacement <u>delivered</u>.", served_by_employee_id: "e1", product_service_category: "Electronics", product_name: "Blender X", purchase_reference: "R-1", preferred_response_method: "sms" };
  const tables = { feedback: [F],
    feedback_assignments: [
      { id: 1, feedback_id: uuid(1), assigned_employee_id: "e1", assigned_by_manager_id: "m1", assigned_at: "2026-10-20T09:00:00Z", unassigned_at: "2026-10-21T09:00:00Z", assignment_note: "first try" },
      { id: 2, feedback_id: uuid(1), assigned_employee_id: "e1", assigned_by_manager_id: "m1", assigned_at: "2026-10-21T09:00:00Z", unassigned_at: null, assignment_note: null }],
    feedback_responses: [
      { id: 1, feedback_id: uuid(1), author_id: "e1", response_text: "Customer rang, replacing unit", visibility: "internal", created_at: "2026-10-21T10:00:00Z" },
      { id: 2, feedback_id: uuid(1), author_id: "e1", response_text: "We are sorry; replacement on its way", visibility: "customer", created_at: "2026-10-21T11:00:00Z" }],
    feedback_status_history: [
      { id: 1, feedback_id: uuid(1), previous_status: null, new_status: "Pending", changed_by: "c1", change_note: null, changed_at: "2026-10-20T08:00:00Z" },
      { id: 2, feedback_id: uuid(1), previous_status: "Pending", new_status: "In Progress", changed_by: "e1", change_note: null, changed_at: "2026-10-21T08:30:00Z" },
      { id: 3, feedback_id: uuid(1), previous_status: "In Progress", new_status: "Resolved", changed_by: "e1", change_note: "Resolved by employee", changed_at: "2026-10-22T10:00:00Z" }],
    feedback_attachments: [{ id: 1, feedback_id: uuid(1), file_name: "receipt.png", mime_type: "image/png", size_bytes: 9, storage_path: "c1/f/x.png" }] };
  { const { ctx, page } = await open(base({ tables }));
    await page.goto(B + "/admin/feedback-details.html?id=" + uuid(1)); await page.waitForSelector("#ref");
    const dl = await page.textContent("dl");
    check("shows reference, customer with contact, type, subject, status, assignee", /NYO-20261024-00000001/.test(dl) && /John Kamau/.test(dl) && /c1@nyota\.test, 0712345678/.test(dl) && /Complaint/.test(dl) && /Faulty blender/.test(dl) && /Resolved/.test(dl) && /Cynthia Wanjiru/.test(await page.textContent("#assignee")));
    check("shows served-by, category, product, receipt and preferred response", /Served by:Cynthia Wanjiru/.test(dl) && /Electronics/.test(dl) && /Blender X/.test(dl) && /R-1/.test(dl) && /SMS/.test(dl));
    check("description and resolution are escaped", (await page.locator("#desc b, #resolution u").count()) === 0 && /Resolution by Cynthia Wanjiru/.test(await page.textContent("main")));
    const t = await page.textContent("main");
    check("internal notes and customer-visible responses are both shown, clearly labelled", /Internal note/.test(t) && /Visible to customer/.test(t) && /Customer rang/.test(t) && /replacement on its way/.test(t));
    const hist = await page.$$eval("#history li", (l) => l.map((x) => x.textContent));
    check("history merges status changes and assignments in time order", hist.length === 5 && /Submitted \(Pending\) by John Kamau/.test(hist[0]) && /Assigned to Cynthia Wanjiru by Brian Mutua.*first try/.test(hist[1]) && /Pending → In Progress/.test(hist[2]) && /In Progress → Resolved/.test(hist[4]), JSON.stringify(hist));
    check("administrator view is read-only (no status, assign or update controls)", (await page.locator("select, textarea, button:has-text('Update'), button:has-text('Assign')").count()) === 0);
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("#atts button")]);
    check("attachment opens via a 60-second signed link", (await calls(page)).signed[0].ttl === 60);
    check("Close returns to the list", (await page.getAttribute("main a.btn-ne-secondary", "href")).endsWith("/admin/feedback.html"));
    await ctx.close(); }
  { const { ctx, page } = await open(base({ tables: { feedback: [{ ...F, status: "Pending", resolved_at: null, resolved_by: null, resolution_details: null, served_by_employee_id: null }], feedback_assignments: [], feedback_responses: [], feedback_status_history: [], feedback_attachments: [] } }));
    await page.goto(B + "/admin/feedback-details.html?id=" + uuid(1)); await page.waitForSelector("#ref");
    check("unassigned pending case: 'Unassigned', no resolution box, 'No responses yet'", /Unassigned/.test(await page.textContent("#assignee")) && (await page.locator("#resolution").count()) === 0 && /No responses yet/.test(await page.textContent("main")));
    await ctx.close(); }
  { const { ctx, page } = await open(base({ tables }));
    for (const id of [uuid(404), "garbage", ""]) { await page.goto(B + "/admin/feedback-details.html?id=" + id); await page.waitForSelector("h1"); check(`id "${id}" shows not found`, /not found/i.test(await page.textContent("h1"))); }
    await ctx.close(); }

  console.log("\nResponsive");
  { const { ctx, page } = await open(base({ tables }), "a1", { width: 375, height: 800 });
    for (const p of ["/admin/dashboard.html", "/admin/feedback.html", "/admin/feedback-details.html?id=" + uuid(1)]) {
      await page.goto(B + p); await page.waitForSelector(".ne-content > *"); await page.waitForTimeout(300);
      check(`no horizontal page scroll at 375px on ${p.split("?")[0]}`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    }
    await ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(" - " + failed.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
