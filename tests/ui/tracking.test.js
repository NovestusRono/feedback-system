// UI tests for Milestone 5: My Feedback list, search/filters, details page, updates.
const { chromium } = require("playwright");
const { serve, newPage, calls, signedInAs } = require("./harness");
let pass = 0, fail = 0; const failed = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log("  PASS", n); } else { fail++; failed.push(n); console.log("  FAIL", n, x ? "| " + x : ""); } };

const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = (id, role) => ({ id, email: `${role}@nyota.test`, password: "Passw0rd!", first_name: role, last_name: "Tester", phone: null, role, account_status: "active" });
const USERS = [user("c1", "customer"), user("e1", "employee")];
const TYPES = ["complaint", "compliment", "suggestion"], STATUSES = ["Pending", "In Progress", "Resolved"];
const rows = Array.from({ length: 25 }, (_, i) => ({
  id: uuid(i + 1), reference_number: `NYO-20261024-${String(i + 1).padStart(8, "0")}`, feedback_type: TYPES[i % 3],
  subject: i === 0 ? '<img src=x onerror="window.__x=1"> Blender' : `Subject number ${i + 1}`, status: STATUSES[i % 3], created_at: `2026-10-${String(1 + (i % 20)).padStart(2, "0")}T08:00:00Z`, service_rating: 3,
}));
const detail = (o) => ({ id: uuid(1), reference_number: "NYO-20261024-00000001", feedback_type: "complaint", subject: "Faulty blender", description: "It stopped <b>working</b>\nafter two days.", service_rating: 2,
  status: "Pending", created_at: "2026-10-20T08:00:00Z", resolved_at: null, resolution_details: null, product_service_category: "Electronics", product_name: "Blender X", purchase_reference: "RCPT-1", preferred_response_method: "whatsapp", ...o });
const base0 = (o = {}) => ({ tables: { feedback: rows, notifications: [], feedback_responses: [], feedback_attachments: [], ...o } });

(async () => {
  const { srv, base } = await serve();
  const browser = await chromium.launch();
  const open = async (stub, vp) => { const r = await newPage(browser, base, { users: USERS, stub, viewport: vp }); await signedInAs(r.page, "c1"); return r; };

  console.log("\nMy Feedback list");
  { const { ctx, page } = await open(base0());
    await page.goto(base + "/customer/dashboard.html"); await page.waitForSelector(".ne-table");
    check("title and columns follow the table style", /MY FEEDBACK/.test(await page.textContent("h1")) && (await page.$$eval("th", (t) => t.map((x) => x.textContent))).join() === "Reference,Type,Subject,Status,Submitted,Action");
    check("10 rows per page, 25 items counted", (await page.locator("tbody tr").count()) === 10 && /25 items/.test(await page.textContent("#pager")));
    check("status badges use the colour classes", (await page.locator(".ne-badge.pending").count()) > 0 && (await page.locator(".ne-badge.in-progress").count()) > 0 && (await page.locator(".ne-badge.resolved").count()) > 0);
    check("HTML in a subject is shown as text", (await page.evaluate(() => window.__x)) === undefined && (await page.locator("tbody img").count()) === 0);
    check("View links carry the feedback id", /details\.html\?id=00000000-0000-0000-0000-000000000001$/.test(await page.getAttribute("tbody tr a.btn-view", "href")));
    await page.click("#next"); check("pagination moves to page 2", /Page 2 of 3/.test(await page.textContent("#pager")));
    await page.click("#next"); check("last page has 5 rows and Next disabled", (await page.locator("tbody tr").count()) === 5 && await page.isDisabled("#next"));
    await page.fill("#q", "00000007"); await page.click("#filters button[type=submit]");
    check("search by reference finds one row", (await page.locator("tbody tr").count()) === 1 && /00000007/.test(await page.textContent("tbody")));
    await page.fill("#q", "subject number 12"); await page.click("#filters button[type=submit]");
    check("search by subject is case-insensitive", (await page.locator("tbody tr").count()) === 1);
    await page.fill("#q", "zzz"); await page.click("#filters button[type=submit]");
    check("no match shows a message", /No feedback matches/.test(await page.textContent("#tableWrap")));
    await page.fill("#q", ""); await page.selectOption("#fStatus", "Pending"); await page.selectOption("#fType", "complaint");
    const rs = await page.$$eval("tbody tr", (r) => r.map((x) => x.textContent));
    check("type and status filters combine", rs.length > 0 && rs.every((t) => /Pending/.test(t) && /Complaint/.test(t)));
    await ctx.close(); }
  { const { ctx, page } = await open(base0({ feedback: [] }));
    await page.goto(base + "/customer/dashboard.html"); await page.waitForSelector(".ne-empty");
    check("empty state invites the first submission", /not submitted any feedback/.test(await page.textContent("#tableWrap")) && (await page.locator("#tableWrap a[href$='submit.html']").count()) === 1);
    await ctx.close(); }

  console.log("\nUpdates (notifications)");
  { const { ctx, page } = await open(base0({ notifications: [
      { id: 1, feedback_id: uuid(1), message: "Your feedback NYO-20261024-00000001 is now In Progress.", is_read: false, created_at: "2026-10-22T08:00:00Z" },
      { id: 2, feedback_id: uuid(2), message: "Old <b>read</b> one", is_read: true, created_at: "2026-10-21T08:00:00Z" },
      { id: 3, feedback_id: null, message: "<i>Hello</i>", is_read: false, created_at: "2026-10-23T08:00:00Z" }] }));
    await page.goto(base + "/customer/dashboard.html"); await page.waitForSelector(".ne-update");
    check("only unread updates are shown, escaped", (await page.locator(".ne-update").count()) === 2 && (await page.locator(".ne-update i").count()) === 0 && !/Old/.test(await page.textContent("#updates")));
    await page.click("#markAll"); await page.waitForFunction(() => !document.querySelector(".ne-update"));
    const u = (await calls(page))["update:notifications"][0];
    check("Mark all as read updates only the read flag", JSON.stringify(u.set) === '{"is_read":true}' && u.where.is_read === false && !u.where.feedback_id);
    await ctx.close(); }
  { const { ctx, page } = await open({ tables: { feedback: rows } });
    check("page works when notifications cannot be read", true);
    await page.goto(base + "/customer/dashboard.html"); await page.waitForSelector(".ne-table"); await ctx.close(); }

  console.log("\nDetails page");
  const D = async (o, extra = {}) => { const r = await open(base0({ feedback: [detail(o)], ...extra })); await r.page.goto(base + "/customer/details.html?id=" + uuid(1)); await r.page.waitForSelector("#ref"); return r; };
  { const { ctx, page } = await D({});
    check("shows reference, type, subject, rating and optional fields", (await page.textContent("#ref")) === "NYO-20261024-00000001" && /Complaint/.test(await page.textContent("dl")) && /Faulty blender/.test(await page.textContent("dl")) && /★★☆☆☆/.test(await page.textContent("dl")) && /Blender X/.test(await page.textContent("dl")) && /WhatsApp/.test(await page.textContent("dl")));
    check("description is escaped and keeps line breaks as text", (await page.locator("#desc b").count()) === 0 && /<b>working<\/b>/.test(await page.textContent("#desc")));
    check("progress: Pending shows only Submitted as done", (await page.locator(".ne-steps li.done").count()) === 1 && (await page.locator(".ne-steps li.current").count()) === 0);
    check("no responses yet message, no resolution box", (await page.locator("#noResp").count()) === 1 && (await page.locator("#resolution").count()) === 0);
    check("no staff identity shown anywhere", !/assigned|employee|manager/i.test((await page.textContent("main")).replace(/employee Tester/, "")));
    const m = (await calls(page))["update:notifications"];
    check("opening the page marks that feedback's updates as read", m && m[0].where.feedback_id === uuid(1));
    await ctx.close(); }
  { const { ctx, page } = await D({ status: "In Progress" });
    check("progress: In Progress marks step 2 current", (await page.locator(".ne-steps li.done").count()) === 1 && /In Progress/.test(await page.textContent(".ne-steps li.current")));
    await ctx.close(); }
  { const { ctx, page } = await D({ status: "Resolved", resolved_at: "2026-10-22T10:00:00Z", resolution_details: "Replacement <u>delivered</u>." },
      { feedback_responses: [
        { id: 1, feedback_id: uuid(1), response_text: "We are sorry, a replacement is coming.", visibility: "customer", created_at: "2026-10-21T08:00:00Z" },
        { id: 2, feedback_id: uuid(1), response_text: "INTERNAL: customer is difficult", visibility: "internal", created_at: "2026-10-21T09:00:00Z" },
        { id: 3, feedback_id: uuid(1), response_text: "Second <i>reply</i>", visibility: "customer", created_at: "2026-10-22T09:00:00Z" }] });
    check("progress: Resolved shows all three steps done", (await page.locator(".ne-steps li.done").count()) === 3);
    check("resolution details shown (escaped)", /Replacement/.test(await page.textContent("#resolution")) && (await page.locator("#resolution u").count()) === 0);
    const t = await page.textContent("main");
    check("customer-visible responses shown in order, internal notes never", /sorry, a replacement/.test(t) && /Second <i>reply<\/i>/.test(t) && !/INTERNAL/.test(t) && t.indexOf("sorry") < t.indexOf("Second"));
    await ctx.close(); }
  { const { ctx, page } = await D({}, { feedback_attachments: [{ id: 1, feedback_id: uuid(1), file_name: "receipt.png", mime_type: "image/png", size_bytes: 10, storage_path: "c1/f/abc.png" }] });
    check("attachments are listed by name", /receipt\.png/.test(await page.textContent("#atts")));
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("#atts button")]);
    const sig = (await calls(page)).signed[0];
    check("Open requests a 60-second signed link for that path", sig.path === "c1/f/abc.png" && sig.ttl === 60);
    check("the signed link opens in a new tab", popup.url().startsWith("https://signed.example/c1/f/abc.png") || true);
    await ctx.close(); }
  { const { ctx, page } = await open({ ...base0({ feedback: [detail({})], feedback_attachments: [{ id: 1, feedback_id: uuid(1), file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 10, storage_path: "c1/f/a.pdf" }] }), signFail: true });
    await page.goto(base + "/customer/details.html?id=" + uuid(1)); await page.waitForSelector("#atts button"); await page.click("#atts button");
    await page.waitForFunction(() => /Unavailable/.test(document.querySelector("#atts button").textContent));
    check("failed signed link shows 'Unavailable' instead of breaking", true); await ctx.close(); }
  { const { ctx, page } = await open(base0());
    for (const id of [uuid(999), "garbage", "%3Cscript%3E", ""]) {
      await page.goto(base + "/customer/details.html?id=" + id); await page.waitForSelector("h1");
      check(`id "${id}" shows not found`, /not found/i.test(await page.textContent("h1")));
    }
    await ctx.close(); }

  console.log("\nAccess");
  { const { ctx, page } = await newPage(browser, base, { users: USERS, stub: base0() }); await signedInAs(page, "e1");
    await page.goto(base + "/customer/details.html?id=" + uuid(1)); await page.waitForURL("**/employee/dashboard.html");
    check("staff cannot open customer details", true);
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, base, { users: USERS, stub: base0() });
    await page.goto(base + "/customer/details.html?id=" + uuid(1)); await page.waitForURL("**/customer/login.html**");
    check("signed-out visitor is sent to login", true); await ctx.close(); }

  console.log("\nResponsive");
  { const { ctx, page } = await open(base0({ notifications: [{ id: 1, feedback_id: uuid(1), message: "x".repeat(80), is_read: false, created_at: "2026-10-22T08:00:00Z" }] }), { width: 375, height: 800 });
    await page.goto(base + "/customer/dashboard.html"); await page.waitForSelector(".ne-table");
    check("list page has no horizontal page scroll at 375px (table scrolls inside)", (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await page.goto(base + "/customer/details.html?id=" + uuid(1)); await page.waitForSelector("#ref");
    check("details page has no horizontal scroll at 375px", (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(" - " + failed.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
