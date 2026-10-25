// UI tests for Milestone 8: employee dashboard, assigned list, start / respond / resolve.
const { chromium } = require("playwright");
const { serve, newPage, calls, signedInAs } = require("./harness");
let pass = 0, fail = 0; const failed = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log("  PASS", n); } else { fail++; failed.push(n); console.log("  FAIL", n, x ? "| " + x : ""); } };

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = (id, role, fn, ln) => ({ id, email: `${id}@nyota.test`, password: "Passw0rd!", first_name: fn, last_name: ln, phone: "0712345678", role, account_status: "active" });
const USERS = [user("a1", "administrator", "Alice", "Njoroge"), user("m1", "manager", "Brian", "Mutua"), user("e1", "employee", "Cynthia", "Wanjiru"), user("c1", "customer", "John", "Kamau"), user("c2", "customer", "Mary", "Atieno")];
const T = ["complaint", "compliment", "suggestion"], S = ["Pending", "In Progress", "Resolved"];
const row = (i, o = {}) => ({ id: uuid(i), customer_id: i % 2 ? "c1" : "c2", reference_number: `NYO-20261024-${String(i).padStart(8, "0")}`, feedback_type: T[i % 3], subject: `Subject ${i}`, status: S[i % 3],
  created_at: `2026-10-${String(1 + i).padStart(2, "0")}T08:00:00Z`, service_rating: 3, ...o });
const rows = Array.from({ length: 15 }, (_, i) => row(i + 1));         // 5 Pending, 5 In Progress, 5 Resolved
const detailTables = (f, extra = {}) => ({ feedback: [{ ...row(1), description: "Stopped <b>working</b>.", resolved_at: null, resolved_by: null, resolution_details: null, served_by_employee_id: null, ...f }],
  feedback_assignments: [{ id: 1, feedback_id: uuid(1), assigned_employee_id: "e1", assigned_by_manager_id: "m1", assigned_at: "2026-10-21T09:00:00Z", unassigned_at: null, assignment_note: "VIP" }],
  feedback_responses: [], feedback_status_history: [{ id: 1, feedback_id: uuid(1), previous_status: null, new_status: "Pending", changed_by: "c1", change_note: null, changed_at: "2026-10-20T08:00:00Z" }], feedback_attachments: [], ...extra });
const ok = { data: null, error: null };
const base = (o = {}) => ({ tables: { feedback: rows, system_settings: [] }, rpc: { start_feedback: ok, add_feedback_response: ok, resolve_feedback: ok }, ...o });

(async () => {
  const { srv, base: B } = await serve();
  const browser = await chromium.launch();
  const open = async (stub, id = "e1", vp) => { const r = await newPage(browser, B, { users: USERS, stub, viewport: vp }); await signedInAs(r.page, id); r.page.on("dialog", (d) => d.accept()); return r; };
  const rpc = async (page, name) => ((await calls(page)).rpc || []).filter((c) => c.name === name);

  console.log("\nDashboard");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/employee/dashboard.html"); await page.waitForSelector("#row1 .ne-card");
    check("cards: Open cases 10, Not started 5, In Progress 5, Resolved 5", (await page.$$eval("#row1 .ne-card", (c) => c.map((x) => x.querySelector(".num").textContent + "|" + x.querySelector(".lbl").textContent))).join() === "10|Open cases,5|Not started,5|In Progress,5|Resolved");
    await page.waitForSelector("#queue tbody tr");
    const st = await page.$$eval("#queue tbody tr", (r) => r.map((x) => x.cells[3].textContent));
    check("attention list: max 5, unresolved only, Pending before In Progress", st.length === 5 && st.every((s) => s !== "Resolved") && st.slice(0, 5).join() === "Pending,Pending,Pending,Pending,Pending", st.join());
    check("rows link to the case page and show the customer's name", /employee\/case\.html\?id=/.test(await page.getAttribute("#queue a.btn-view", "href")) && /John Kamau|Mary Atieno/.test(await page.textContent("#queue tbody tr")));
    const nav = await page.$$eval(".ne-sidebar .items > *", (e) => e.map((x) => x.firstChild.textContent.trim() + (x.tagName === "A" ? "*" : "")));
    check("employee menu has only Dashboard and My Assigned Feedback", nav.join() === "Dashboard*,My Assigned Feedback*", nav.join());
    await ctx.close(); }
  { const { ctx, page } = await open(base({ tables: { feedback: [] } }));
    await page.goto(B + "/employee/dashboard.html"); await page.waitForSelector("#queue .ne-empty");
    check("no cases yet: friendly message", /has been assigned to you yet/.test(await page.textContent("#queue"))); await ctx.close(); }
  { const { ctx, page } = await open(base({ tables: { feedback: rows.filter((r) => r.status === "Resolved") } }));
    await page.goto(B + "/employee/dashboard.html"); await page.waitForSelector("#queue .ne-empty");
    check("all resolved: no open cases message", /no open cases/.test(await page.textContent("#queue"))); await ctx.close(); }

  console.log("\nMy assigned feedback");
  { const { ctx, page } = await open(base());
    await page.goto(B + "/employee/assigned.html"); await page.waitForSelector(".ne-table");
    check("columns and paging (15 items, 10 per page)", (await page.$$eval("th", (t) => t.map((x) => x.textContent))).join() === "Reference,Customer,Type,Subject,Status,Date,Action" && (await page.locator("tbody tr").count()) === 10 && /15 items/.test(await page.textContent("#pager")));
    await page.fill("#q", "00000007"); await page.click("#filters button[type=submit]");
    check("search by reference", (await page.locator("tbody tr").count()) === 1);
    await page.fill("#q", "mary"); await page.click("#filters button[type=submit]");
    check("search by customer name", (await page.locator("tbody tr").count()) > 0 && (await page.$$eval("tbody tr", (r) => r.every((x) => /Mary Atieno/.test(x.textContent)))));
    await page.fill("#q", ""); await page.selectOption("#fStatus", "Resolved"); await page.click("#filters button[type=submit]");
    check("status filter", (await page.$$eval("tbody tr", (r) => r.every((x) => /Resolved/.test(x.cells[4].textContent)))) && (await page.locator("tbody tr").count()) === 5);
    await ctx.close(); }
  { const { ctx, page } = await open(base({ tables: { feedback: [row(1, { subject: '<img src=x onerror="window.__x=1">' })] } }));
    await page.goto(B + "/employee/assigned.html"); await page.waitForSelector(".ne-table");
    check("hostile subject is harmless", (await page.evaluate(() => window.__x)) === undefined); await ctx.close(); }

  console.log("\nCase: start work");
  const go = async (page, id = 1) => { await page.goto(B + "/employee/case.html?id=" + uuid(id)); await page.waitForSelector("#ref"); };
  { const { ctx, page } = await open(base({ tables: detailTables({ status: "Pending" }) }));
    await go(page);
    check("shows customer with contact, description escaped, assignment", /John Kamau/.test(await page.textContent("dl")) && /0712345678/.test(await page.textContent("dl")) && (await page.locator("#desc b").count()) === 0 && /Cynthia Wanjiru/.test(await page.textContent("#assignee")));
    check("Pending case offers only 'Start work' (no respond/resolve forms)", (await page.locator("#startForm").count()) === 1 && (await page.locator("#respForm, #resolveForm").count()) === 0);
    check("history never shows 'Unknown'", !/Unknown/.test(await page.textContent("#history")));
    await page.fill("#startNote", " On it "); await page.click("#startBtn"); await page.waitForSelector("#notice:not(.d-none)");
    const a = (await rpc(page, "start_feedback"))[0].args;
    check("start_feedback gets the case id and trimmed note", a.p_feedback_id === uuid(1) && a.p_note === "On it");
    check("success notice shown", /now In Progress/.test(await page.textContent("#notice")));
    await ctx.close(); }
  for (const [msg, re] of [["Only Pending cases can be started.", /already been started/], ["You can only update cases assigned to you.", /not assigned to you/], ["weird failure", /could not save/i]]) {
    const { ctx, page } = await open(base({ tables: detailTables({ status: "Pending" }), rpc: { start_feedback: { data: null, error: { message: msg } } } }));
    await go(page); await page.click("#startBtn"); await page.waitForSelector("#startAlert:not(.d-none)");
    check(`start error "${msg}" is explained`, re.test(await page.textContent("#startAlert")) && !(await page.isDisabled("#startBtn"))); await ctx.close();
  }

  console.log("\nCase: respond and resolve");
  const prog = () => base({ tables: detailTables({ status: "In Progress" }) });
  { const { ctx, page } = await open(prog());
    await go(page);
    check("In Progress case offers respond and resolve forms, no Start", (await page.locator("#respForm, #resolveForm").count()) === 2 && (await page.locator("#startForm").count()) === 0);
    await page.click("#respBtn");
    check("empty response refused locally", /Enter a message first/.test(await page.textContent("#respAlert")) && (await rpc(page, "add_feedback_response")).length === 0);
    check("customer-visible is the default visibility", await page.isChecked("#visCustomer"));
    await page.fill("#respText", "  We are sending a replacement.  "); await page.click("#respBtn"); await page.waitForSelector("#notice:not(.d-none)");
    let a = (await rpc(page, "add_feedback_response"))[0].args;
    check("customer response sent trimmed with visibility 'customer'", a.p_text === "We are sending a replacement." && a.p_visibility === "customer");
    await page.fill("#respText", "Customer is upset, handle with care"); await page.check("#visInternal"); await page.click("#respBtn"); await page.waitForSelector("#notice:not(.d-none)");
    a = (await rpc(page, "add_feedback_response")).at(-1).args;
    check("internal note sent with visibility 'internal'", a.p_visibility === "internal"); await ctx.close(); }
  { const { ctx, page } = await open(prog());
    await go(page);
    await page.fill("#details", "too short"); await page.click("#resolveBtn");
    check("short resolution details refused locally (10-character minimum)", /at least 10/.test(await page.textContent("#resolveAlert")) && (await rpc(page, "resolve_feedback")).length === 0);
    await page.fill("#details", "          x          "); await page.click("#resolveBtn");
    check("whitespace padding does not count", (await rpc(page, "resolve_feedback")).length === 0);
    await ctx.close(); }
  { const { ctx, page } = await open(prog()); page.removeAllListeners("dialog"); page.on("dialog", (d) => d.dismiss());
    await go(page); await page.fill("#details", "Replacement delivered and tested."); await page.click("#resolveBtn"); await page.waitForTimeout(300);
    check("declining the confirmation sends nothing", (await rpc(page, "resolve_feedback")).length === 0 && !(await page.isDisabled("#resolveBtn"))); await ctx.close(); }
  { const { ctx, page } = await open(prog());
    await go(page); await page.fill("#details", "  Replacement delivered and tested.  "); await page.click("#resolveBtn"); await page.waitForSelector("#notice:not(.d-none)");
    const a = (await rpc(page, "resolve_feedback"))[0].args;
    check("resolve sends details; blank optional texts become null", a.p_feedback_id === uuid(1) && a.p_resolution_details === "Replacement delivered and tested." && a.p_customer_response === null && a.p_internal_note === null);
    check("success notice", /resolved and the customer notified/.test(await page.textContent("#notice")));
    await ctx.close(); }
  { const { ctx, page } = await open(prog());
    await go(page); await page.fill("#details", "Replacement delivered and tested."); await page.fill("#custMsg", " Thank you for your patience "); await page.fill("#intNote", "Stock updated");
    await page.click("#resolveBtn"); await page.waitForSelector("#notice:not(.d-none)");
    const a = (await rpc(page, "resolve_feedback"))[0].args;
    check("optional customer message and internal note are passed (trimmed)", a.p_customer_response === "Thank you for your patience" && a.p_internal_note === "Stock updated"); await ctx.close(); }
  { const { ctx, page } = await open(base({ tables: { ...detailTables({ status: "In Progress" }), system_settings: [{ key: "min_resolution_details_length", value: 25 }] } }));
    await go(page); await page.fill("#details", "Replacement delivered ok"); await page.click("#resolveBtn");
    check("minimum length follows the administrator's setting (25)", /at least 25/.test(await page.textContent("#resolveAlert")) && (await rpc(page, "resolve_feedback")).length === 0); await ctx.close(); }
  for (const [msg, re] of [["Start the case (In Progress) before resolving it.", /Start the case/], ["You can only resolve cases assigned to you.", /not assigned to you/], ["This case is already resolved.", /already resolved/], ["Enter resolution details (at least 10 characters).", /at least 10 characters\)\.$/], ["db exploded", /could not save/i]]) {
    const { ctx, page } = await open(base({ tables: detailTables({ status: "In Progress" }), rpc: { resolve_feedback: { data: null, error: { message: msg } } } }));
    await go(page); await page.fill("#details", "Replacement delivered and tested."); await page.click("#resolveBtn"); await page.waitForSelector("#resolveAlert:not(.d-none)");
    check(`resolve error "${msg}" is explained, form stays usable`, re.test(await page.textContent("#resolveAlert")) && !/exploded/.test(await page.textContent("#resolveAlert")) && !(await page.isDisabled("#resolveBtn")) && (await page.inputValue("#details")).length > 10); await ctx.close();
  }
  { const { ctx, page } = await open(base({ tables: detailTables({ status: "Resolved", resolved_at: "2026-10-22T10:00:00Z", resolved_by: "e1", resolution_details: "Replacement <u>delivered</u>." }) }));
    await go(page);
    check("Resolved case is read-only with the resolution shown (escaped)", (await page.locator("#startForm, #respForm, #resolveForm").count()) === 0 && /no further changes/i.test(await page.textContent("#actionPanel")) && (await page.locator("#resolution u").count()) === 0 && /Replacement/.test(await page.textContent("#resolution"))); await ctx.close(); }
  { const r = [{ id: 1, feedback_id: uuid(1), author_id: "e1", response_text: "Internal: called customer", visibility: "internal", created_at: "2026-10-21T10:00:00Z" }, { id: 2, feedback_id: uuid(1), author_id: "e1", response_text: "Hello customer", visibility: "customer", created_at: "2026-10-21T11:00:00Z" }];
    const { ctx, page } = await open(base({ tables: detailTables({ status: "In Progress" }, { feedback_responses: r }) }));
    await go(page);
    check("earlier notes and responses are listed with their visibility label", /Internal note/.test(await page.textContent("main")) && /Visible to customer/.test(await page.textContent("main"))); await ctx.close(); }
  { const { ctx, page } = await open(base({ tables: detailTables({ status: "In Progress" }) }));
    for (const id of [uuid(404), "garbage"]) { await page.goto(B + "/employee/case.html?id=" + id); await page.waitForSelector("h1"); check(`id "${id}" (not assigned / invalid) shows not found`, /not found/i.test(await page.textContent("h1"))); }
    await ctx.close(); }

  console.log("\nAccess control");
  for (const [id, dest] of [["a1", "/admin/dashboard.html"], ["m1", "/manager/dashboard.html"], ["c1", "/customer/dashboard.html"]]) {
    for (const p of ["/employee/dashboard.html", "/employee/assigned.html", "/employee/case.html?id=" + uuid(1)]) {
      const { ctx, page } = await open(base(), id); await page.goto(B + p); await page.waitForTimeout(450);
      check(`${id} opening ${p.split("?")[0]} is sent to ${dest}`, new URL(page.url()).pathname === dest, page.url()); await ctx.close();
    }
  }
  { const { ctx, page } = await open(base());
    for (const p of ["/admin/dashboard.html", "/manager/dashboard.html", "/manager/feedback-details.html?id=" + uuid(1), "/customer/dashboard.html"]) { await page.goto(B + p); await page.waitForTimeout(450); check(`employee cannot open ${p.split("?")[0]}`, new URL(page.url()).pathname === "/employee/dashboard.html"); }
    await ctx.close(); }

  console.log("\nResponsive");
  { const { ctx, page } = await open(prog(), "e1", { width: 375, height: 800 });
    for (const p of ["/employee/dashboard.html", "/employee/assigned.html", "/employee/case.html?id=" + uuid(1)]) {
      await page.goto(B + p); await page.waitForSelector(".ne-content > *"); await page.waitForTimeout(400);
      check(`no horizontal page scroll at 375px on ${p.split("?")[0]}`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0); }
    await ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(" - " + failed.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
