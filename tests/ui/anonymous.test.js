// UI tests: anonymous feedback (no registration, no login) and how staff see it.
const { chromium } = require("playwright");
const { serve, newPage, calls, signedInAs } = require("./harness");
let pass = 0, fail = 0; const failed = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log("  PASS", n); } else { fail++; failed.push(n); console.log("  FAIL", n, x ? "| " + x : ""); } };
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = (id, role, fn, ln) => ({ id, email: `${id}@nyota.test`, password: "Passw0rd!", first_name: fn, last_name: ln, phone: "0700000000", role, account_status: "active" });
const USERS = [user("a1", "administrator", "Alice", "Njoroge"), user("m1", "manager", "Brian", "Mutua"), user("e1", "employee", "Cynthia", "Wanjiru"), user("c1", "customer", "John", "Kamau")];
const OPTS = { data: { enabled: true, categories: ["Electronics", "Delivery"] }, error: null };
const base = (o = {}) => ({ rpc: { anonymous_form_options: OPTS, submit_anonymous_feedback: { data: "NYO-20261027-AB12CD34", error: null } }, ...o });

(async () => {
  const { srv, base: B } = await serve();
  const browser = await chromium.launch();
  const visitor = async (stub, vp) => newPage(browser, B, { users: USERS, stub, viewport: vp });

  console.log("\nEntry points");
  { const { ctx, page } = await visitor(base());
    await page.goto(B + "/index.html");
    check("home page has a 'Submit Anonymously' button next to 'Submit Feedback'", (await page.textContent("#anon")).trim() === "Submit Anonymously" && /customer\/anonymous\.html$/.test(await page.getAttribute("#anon", "href")) && /login\.html/.test(await page.getAttribute("#cta", "href")));
    await page.goto(B + "/customer/login.html");
    check("customer login page offers anonymous feedback", /anonymous/i.test(await page.textContent("#anon")) && /anonymous\.html$/.test(await page.getAttribute("#anon", "href")));
    await ctx.close(); }

  console.log("\nAnonymous form (not logged in)");
  { const { ctx, page } = await visitor(base());
    await page.goto(B + "/customer/anonymous.html"); await page.waitForSelector("#form");
    check("opens without logging in: no redirect, no login or account fields", /anonymous\.html$/.test(page.url()) && (await page.locator("#fullName, #email, #phone, input[type=password]").count()) === 0);
    check("explains how anonymity works (no reply, no tracking, staff see 'Anonymous User')", /Anonymous User/.test(await page.textContent(".ne-notice")) && /cannot reply/i.test(await page.textContent(".ne-notice")) && /track/i.test(await page.textContent(".ne-notice")));
    check("offers log in / register as the alternative", (await page.locator(".ne-notice a[href*='login.html']").count()) === 1);
    check("has no attachments, no 'who served you' and no response-method fields", (await page.locator("#files, #servedBy, #method, #purchaseRef").count()) === 0);
    check("has type, subject, description, rating, category and product", (await page.locator("input[name=type]").count()) === 3 && (await page.locator("#subject, #description, #category, #productName").count()) === 4 && (await page.locator("input[name=rating]").count()) === 5);
    check("categories come from the server", (await page.$$eval("#category option", (o) => o.map((x) => x.textContent))).join() === "Select a category,Electronics,Delivery");
    check("honeypot field is hidden from people", await page.evaluate(() => { const r = document.getElementById("website").getBoundingClientRect(); return r.left < -1000 || r.width === 0; }));
    await page.fill("#description", "12345"); check("character counter works", (await page.textContent("#count")) === "5");
    await page.click("#submit");
    check("empty form shows errors and sends nothing", (await page.locator(".is-invalid").count()) >= 2 && /rate our service/i.test(await page.textContent("#ratingErr")) && !((await calls(page)).rpc || []).some((x) => x.name === "submit_anonymous_feedback"));
    await page.fill("#subject", "Rude service"); await page.fill("#description", "The cashier ignored me for ten minutes."); await page.check("#t-suggestion"); await page.selectOption("#category", "Delivery");
    await page.fill("#productName", "Blender X"); await page.click("label[for=r4]"); await page.click("#submit");
    await page.waitForSelector("#ref");
    const c = (await calls(page)).rpc.find((x) => x.name === "submit_anonymous_feedback");
    check("sends the right values to the server function", c && c.args.p_type === "suggestion" && c.args.p_subject === "Rude service" && c.args.p_rating === 4 && c.args.p_category === "Delivery" && c.args.p_product_name === "Blender X" && c.args.p_purchase_reference === null && c.args.p_website === null, JSON.stringify(c));
    check("sends no identity of any kind", Object.keys(c.args).sort().join() === "p_category,p_description,p_product_name,p_purchase_reference,p_rating,p_subject,p_type,p_website" && !(await calls(page)).signIn);
    check("shows the reference number and the no-tracking message", (await page.textContent("#ref")) === "NYO-20261027-AB12CD34" && /cannot identify you/i.test(await page.textContent("#content")));
    check("the reference is not put in the URL or browser storage", !/NYO-/.test(page.url()) && !(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes("NYO-20261027"));
    await ctx.close(); }
  { const { ctx, page } = await visitor(base());
    await page.goto(B + "/customer/anonymous.html"); await page.waitForSelector("#form");
    await page.fill("#subject", "Spam subject"); await page.fill("#description", "A bot filled in the hidden field."); await page.click("label[for=r3]");
    await page.evaluate(() => { document.getElementById("website").value = "http://spam"; }); await page.click("#submit"); await page.waitForSelector("#ref");
    check("a filled honeypot is passed to the server (which discards it)", (await calls(page)).rpc.find((x) => x.name === "submit_anonymous_feedback").args.p_website === "http://spam");
    await ctx.close(); }
  for (const [msg, re, label] of [["Too many anonymous submissions right now.", /lot of anonymous feedback/, "hourly cap"], ["Anonymous feedback is currently switched off.", /currently unavailable/, "switched off"], ["This feedback was already submitted a moment ago.", /already sent/, "duplicate"], ["boom internal detail xyz", /could not submit/, "unknown error"]]) {
    const { ctx, page } = await visitor(base({ rpc: { anonymous_form_options: OPTS, submit_anonymous_feedback: { data: null, error: { message: msg } } } }));
    await page.goto(B + "/customer/anonymous.html"); await page.waitForSelector("#form");
    await page.fill("#subject", "Some subject"); await page.fill("#description", "Some description text."); await page.click("label[for=r3]"); await page.click("#submit");
    await page.waitForSelector("#alert:not(.d-none)");
    const t = await page.textContent("#alert");
    check(`server error "${label}" gives a friendly message, form stays`, re.test(t) && !/xyz/.test(t) && (await page.locator("#form").count()) === 1 && !(await page.isDisabled("#submit")));
    await ctx.close();
  }
  { const { ctx, page } = await visitor(base({ rpc: { anonymous_form_options: { data: { enabled: false, categories: [] }, error: null } } }));
    await page.goto(B + "/customer/anonymous.html"); await page.waitForSelector("h1");
    check("when an administrator switches it off the form is replaced by a notice with a login link", (await page.locator("#form").count()) === 0 && /currently unavailable/.test(await page.textContent("#content")) && (await page.locator("#content a[href*='login.html']").count()) === 1);
    await ctx.close(); }
  { const { ctx, page } = await visitor(base({ rpc: { anonymous_form_options: { data: null, error: { message: "x" } }, submit_anonymous_feedback: { data: "NYO-X", error: null } } }));
    await page.goto(B + "/customer/anonymous.html"); await page.waitForSelector("#form");
    check("if the options cannot load the form still works (no categories)", (await page.locator("#category").count()) === 0 && (await page.locator("#subject").count()) === 1);
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, B, { users: USERS, stub: {}, configured: false });
    await page.goto(B + "/customer/anonymous.html"); await page.waitForTimeout(300);
    check("unconfigured backend shows a setup message", /not configured/i.test(await page.textContent("body")));
    await ctx.close(); }
  { const { ctx, page } = await visitor(base(), { width: 375, height: 800 });
    await page.goto(B + "/customer/anonymous.html"); await page.waitForSelector("#form");
    check("no horizontal scroll on a 375px phone", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await ctx.close(); }
  { const r = await newPage(browser, B, { users: USERS, stub: base() }); await signedInAs(r.page, "c1");
    await r.page.goto(B + "/customer/anonymous.html"); await r.page.waitForSelector("#form");
    check("a logged-in customer may use the form and stays on it (not redirected)", /anonymous\.html$/.test(r.page.url()));
    await r.ctx.close(); }

  console.log("\nHow staff see it");
  const F = { id: uuid(1), customer_id: null, is_anonymous: true, reference_number: "NYO-20261027-AB12CD34", feedback_type: "complaint", subject: "Rude service", description: "The cashier ignored me.", service_rating: 2, status: "Pending",
    created_at: "2026-10-27T08:00:00Z", resolved_at: null, resolved_by: null, resolution_details: null, served_by_employee_id: null, product_service_category: null, product_name: null, purchase_reference: null, preferred_response_method: null };
  const tables = { feedback: [F], feedback_assignments: [{ id: 1, feedback_id: uuid(1), assigned_employee_id: "e1", assigned_by_manager_id: "m1", assigned_at: "2026-10-27T09:00:00Z", unassigned_at: null, assignment_note: null }],
    feedback_responses: [], feedback_status_history: [{ id: 1, feedback_id: uuid(1), previous_status: null, new_status: "Pending", changed_by: null, change_note: "Submitted anonymously", changed_at: "2026-10-27T08:00:00Z" }], feedback_attachments: [] };
  const listRows = [{ id: uuid(1), reference_number: F.reference_number, feedback_type: "complaint", subject: "Rude service", status: "Pending", service_rating: 2, created_at: F.created_at, customer_name: "Anonymous User", assigned_employee_id: null, assigned_employee_name: null },
    { id: uuid(2), reference_number: "NYO-20261027-00000002", feedback_type: "compliment", subject: "Great", status: "Pending", service_rating: 5, created_at: F.created_at, customer_name: "John Kamau", assigned_employee_id: null, assigned_employee_name: null }];
  for (const [id, path] of [["a1", "/admin/feedback.html"], ["m1", "/manager/feedback.html"]]) {
    const r = await newPage(browser, B, { users: USERS, stub: { tables, listRows, rpc: { dashboard_stats: { data: {}, error: null } } } }); await signedInAs(r.page, id);
    await r.page.goto(B + path); await r.page.waitForSelector(".ne-table");
    check(`${id}: list shows 'Anonymous User' as the customer, real names unchanged`, (await r.page.$$eval("tbody tr", (t) => t.map((x) => x.children[1].textContent))).join() === "Anonymous User,John Kamau");
    await r.ctx.close();
  }
  { const r = await newPage(browser, B, { users: USERS, stub: { tables } }); await signedInAs(r.page, "a1");
    await r.page.goto(B + "/admin/feedback-details.html?id=" + uuid(1)); await r.page.waitForSelector("#ref");
    const dl = await r.page.textContent("dl"), main = await r.page.textContent("main");
    check("admin details: customer is 'Anonymous User' with no email or phone", /Customer:Anonymous User/.test(dl) && !/@|0700/.test(dl.replace(/NYO.*?\d/, "")) && /Anonymous User/.test(main));
    check("history says 'Submitted ... by Anonymous User'", /Submitted \(Pending\) by Anonymous User/.test(main) && !/Staff member/.test(main));
    await r.ctx.close(); }
  { const r = await newPage(browser, B, { users: USERS, stub: { tables } }); await signedInAs(r.page, "e1");
    await r.page.goto(B + "/employee/assigned.html"); await r.page.waitForSelector(".ne-table");
    check("employee queue shows 'Anonymous User'", /Anonymous User/.test(await r.page.textContent("tbody")));
    await r.page.goto(B + "/employee/case.html?id=" + uuid(1)); await r.page.waitForSelector("#ref");
    check("employee case view shows 'Anonymous User' and no contact line", /Anonymous User/.test(await r.page.textContent("dl")) && !/@nyota/.test(await r.page.textContent("dl")));
    check("employee can still act on it (action panel present)", (await r.page.locator("#actionPanel").count()) === 1);
    await r.ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("Failed:\n - " + failed.join("\n - ")); process.exit(1); }
})();
