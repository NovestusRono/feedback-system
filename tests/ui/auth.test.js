// UI tests for Milestone 3: login, registration, role guards, navigation.
// Run: node tests/ui/auth.test.js   (needs playwright)
const { chromium } = require("playwright");
const { serve, newPage, calls, signedInAs } = require("./harness");

let pass = 0, fail = 0; const failed = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log("  PASS", n); } else { fail++; failed.push(n); console.log("  FAIL", n, x ? "| " + x : ""); } };

const mk = (id, role, extra = {}) => ({ id, email: `${role}@nyota.test`, password: "Passw0rd!", first_name: role[0].toUpperCase() + role.slice(1), last_name: "Tester", phone: null, role, account_status: "active", ...extra });
const USERS = [mk("c1", "customer"), mk("a1", "administrator"), mk("m1", "manager"), mk("e1", "employee"),
  mk("e2", "employee", { email: "off@nyota.test", account_status: "inactive" }), mk("c2", "customer", { email: "banned@nyota.test", banned: true }),
  mk("x1", "customer", { email: "xss@nyota.test", first_name: '<img src=x onerror="window.__xss=1">' })];
const path = (page) => new URL(page.url()).pathname + new URL(page.url()).search;

(async () => {
  const { srv, base } = await serve();
  const browser = await chromium.launch();
  const open = (o) => newPage(browser, base, { users: USERS, ...o });
  const login = async (page, url, email, pw) => {
    await page.goto(base + url);
    await page.fill("#email", email); await page.fill("#password", pw);
    await page.click("#submit");
  };

  console.log("\nBackend not configured");
  { const { ctx, page } = await newPage(browser, base, { users: USERS, configured: false });
    await page.goto(base + "/staff/login.html");
    check("warning shown and submit disabled", /not configured/i.test(await page.textContent("#alert")) && await page.isDisabled("#submit"));
    await ctx.close(); }

  console.log("\nHomepage");
  { const { ctx, page } = await open();
    await page.goto(base + "/index.html");
    check("hero text and three types present", /WE VALUE YOUR FEEDBACK/.test(await page.textContent("h1")) && /Complaints.*Compliments.*Suggestions/s.test(await page.textContent(".ne-types")));
    check("Submit Feedback leads to customer login when signed out", (await page.getAttribute("#cta", "href")) === "customer/login.html?next=customer%2Fsubmit.html");
    check("staff login reachable from footer", (await page.locator("footer a[href='staff/login.html']").count()) === 1);
    await ctx.close(); }

  console.log("\nCustomer login");
  { const { ctx, page } = await open();
    await login(page, "/customer/login.html", "customer@nyota.test", "wrongpass1");
    await page.waitForSelector("#alert:not(.d-none)");
    check("wrong password shows generic message", /Incorrect email or password/.test(await page.textContent("#alert")));
    check("stays on login", path(page).endsWith("/customer/login.html"));
    await page.fill("#email", "ghost@nyota.test"); await page.click("#submit");
    await page.waitForFunction(() => document.getElementById("submit").disabled === false);
    check("unknown email gets the same message (no account enumeration)", /Incorrect email or password/.test(await page.textContent("#alert")));
    await page.fill("#email", "not-an-email"); await page.click("#submit");
    check("invalid email rejected client-side", /Enter your email and password/.test(await page.textContent("#alert")));
    await page.fill("#email", "customer@nyota.test"); await page.fill("#password", "Passw0rd!"); await page.click("#submit");
    await page.waitForURL("**/customer/dashboard.html");
    check("customer lands on customer dashboard", true);
    check("top bar shows the signed-in customer name", /Customer Tester/.test(await page.textContent(".ne-topbar .who")));
    await ctx.close(); }
  for (const [email, label, re] of [["administrator@nyota.test", "administrator", /staff portal/i], ["manager@nyota.test", "manager", /staff portal/i], ["employee@nyota.test", "employee", /staff portal/i]]) {
    const { ctx, page } = await open();
    await login(page, "/customer/login.html", email, "Passw0rd!");
    await page.waitForSelector("#alert:not(.d-none)");
    check(`${label} cannot use the customer portal`, re.test(await page.textContent("#alert")) && path(page).endsWith("/customer/login.html"));
    check(`${label} session is cleared after wrong portal`, (await page.evaluate(() => localStorage.getItem("stub_session"))) === null);
    await ctx.close();
  }
  { const { ctx, page } = await open();
    await login(page, "/customer/login.html", "banned@nyota.test", "Passw0rd!");
    await page.waitForSelector("#alert:not(.d-none)");
    check("banned account shows deactivated message", /deactivated/i.test(await page.textContent("#alert")));
    await ctx.close(); }

  console.log("\nStaff login");
  for (const [role, dest] of [["administrator", "/admin/dashboard.html"], ["manager", "/manager/dashboard.html"], ["employee", "/employee/dashboard.html"]]) {
    const { ctx, page } = await open();
    await login(page, "/staff/login.html", `${role}@nyota.test`, "Passw0rd!");
    await page.waitForURL("**" + dest);
    check(`${role} lands on ${dest}`, true);
    await ctx.close();
  }
  { const { ctx, page } = await open();
    await login(page, "/staff/login.html", "customer@nyota.test", "Passw0rd!");
    await page.waitForSelector("#alert:not(.d-none)");
    check("customer cannot use the staff portal", /customer portal/i.test(await page.textContent("#alert")) && (await page.evaluate(() => localStorage.getItem("stub_session"))) === null);
    await ctx.close(); }
  { const { ctx, page } = await open();
    await login(page, "/staff/login.html", "off@nyota.test", "Passw0rd!");
    await page.waitForSelector("#alert:not(.d-none)");
    check("deactivated employee refused and signed out", /deactivated/i.test(await page.textContent("#alert")) && (await page.evaluate(() => localStorage.getItem("stub_session"))) === null);
    await ctx.close(); }
  { const { ctx, page } = await open({ stub: { profileError: { message: "boom" } } });
    await login(page, "/staff/login.html", "administrator@nyota.test", "Passw0rd!");
    await page.waitForSelector("#alert:not(.d-none)");
    check("missing profile refuses sign-in", /not set up/i.test(await page.textContent("#alert")) && (await page.evaluate(() => localStorage.getItem("stub_session"))) === null);
    await ctx.close(); }
  { const { ctx, page } = await open();
    await page.goto(base + "/staff/login.html");
    check("staff login uses work email wording", /Work email/.test(await page.textContent("label[for=email]")));
    check("password field is masked", (await page.getAttribute("#password", "type")) === "password");
    check("no create-account link on staff portal", (await page.locator("a[href*='register']").count()) === 0);
    await ctx.close(); }

  console.log("\nRedirect safety (next parameter)");
  for (const [next, expectPath] of [["admin/dashboard.html", "/admin/dashboard.html"], ["//evil.example/x.html", "/admin/dashboard.html"], ["https://evil.example/", "/admin/dashboard.html"], ["javascript:alert(1)", "/admin/dashboard.html"], ["../../etc/passwd.html", "/admin/dashboard.html"], ["/admin/x.html", "/admin/dashboard.html"]]) {
    const { ctx, page } = await open();
    await login(page, "/staff/login.html?next=" + encodeURIComponent(next), "administrator@nyota.test", "Passw0rd!");
    await page.waitForLoadState("load"); await page.waitForTimeout(400);
    check(`next=${next} -> ${expectPath}`, new URL(page.url()).origin === base && path(page) === expectPath, page.url());
    await ctx.close();
  }

  console.log("\nRoute guards");
  { const { ctx, page } = await open();
    await page.goto(base + "/admin/dashboard.html");
    await page.waitForURL("**/staff/login.html**");
    check("signed-out visitor to admin page goes to staff login with next", path(page) === "/staff/login.html?next=admin%2Fdashboard.html", path(page));
    await page.goto(base + "/customer/dashboard.html");
    await page.waitForURL("**/customer/login.html**");
    check("signed-out visitor to customer page goes to customer login", path(page).startsWith("/customer/login.html"), path(page));
    check("protected content never became visible", true);
    await ctx.close(); }
  const cross = [["c1", "/admin/dashboard.html", "/customer/dashboard.html"], ["c1", "/manager/dashboard.html", "/customer/dashboard.html"], ["c1", "/employee/dashboard.html", "/customer/dashboard.html"],
    ["e1", "/admin/dashboard.html", "/employee/dashboard.html"], ["e1", "/manager/dashboard.html", "/employee/dashboard.html"], ["e1", "/customer/dashboard.html", "/employee/dashboard.html"],
    ["m1", "/admin/dashboard.html", "/manager/dashboard.html"], ["m1", "/employee/dashboard.html", "/manager/dashboard.html"],
    ["a1", "/manager/dashboard.html", "/admin/dashboard.html"], ["a1", "/employee/dashboard.html", "/admin/dashboard.html"], ["a1", "/customer/dashboard.html", "/admin/dashboard.html"]];
  for (const [id, visit, lands] of cross) {
    const { ctx, page } = await open(); await signedInAs(page, id);
    await page.goto(base + visit); await page.waitForTimeout(500);
    check(`${id} visiting ${visit} is sent to ${lands}`, path(page) === lands, path(page));
    await ctx.close();
  }
  for (const [id, p] of [["a1", "/admin/dashboard.html"], ["m1", "/manager/dashboard.html"], ["e1", "/employee/dashboard.html"], ["c1", "/customer/dashboard.html"]]) {
    const { ctx, page } = await open(); await signedInAs(page, id);
    await page.goto(base + p); await page.waitForSelector("main .ne-panel");
    check(`${id} can open ${p}`, path(page) === p);
    await ctx.close();
  }
  { const { ctx, page } = await open(); await signedInAs(page, "e2");
    await page.goto(base + "/employee/dashboard.html"); await page.waitForURL("**/staff/login.html**");
    check("deactivated user with a live session is thrown out", (await page.evaluate(() => localStorage.getItem("stub_session"))) === null);
    await ctx.close(); }
  { const { ctx, page } = await open(); await signedInAs(page, "a1");
    await page.goto(base + "/staff/login.html"); await page.waitForURL("**/admin/dashboard.html");
    check("signed-in admin opening login is sent to their dashboard", true);
    await ctx.close(); }

  console.log("\nNavigation and shell");
  const navOf = async (id, p) => { const { ctx, page } = await open(); await signedInAs(page, id); await page.goto(base + p); await page.waitForSelector(".ne-sidebar");
    const items = await page.$$eval(".ne-sidebar .items > *", (els) => els.map((e) => ({ t: e.firstChild.textContent.trim(), link: e.tagName === "A" }))); const badge = await page.textContent(".role-badge"); await ctx.close(); return { items, badge }; };
  { const a = await navOf("a1", "/admin/dashboard.html");
    check("admin menu: Dashboard, Feedback, Users, Reports, Audit Logs", a.items.map((i) => i.t).join() === "Dashboard,Feedback,Users,Reports,Audit Logs" && a.badge === "Administrator", JSON.stringify(a));
    check("every admin menu item is a live link", a.items.every((i) => i.link));
    const m = await navOf("m1", "/manager/dashboard.html");
    check("manager menu has no Reports or Users", !m.items.some((i) => /Report|User/.test(i.t)), JSON.stringify(m.items));
    const e = await navOf("e1", "/employee/dashboard.html");
    check("employee menu has only Dashboard and My Assigned Feedback", e.items.map((i) => i.t).join() === "Dashboard,My Assigned Feedback");
    const c = await navOf("c1", "/customer/dashboard.html");
    check("customer menu: My Feedback, Submit Feedback", c.items.map((i) => i.t).join() === "My Feedback,Submit Feedback"); }
  { const { ctx, page } = await open(); await signedInAs(page, "x1");
    await page.goto(base + "/customer/dashboard.html"); await page.waitForSelector("main .ne-panel");
    check("HTML in a profile name is escaped, not executed", (await page.evaluate(() => window.__xss)) === undefined && /<img/.test(await page.textContent(".ne-topbar .who")));
    await ctx.close(); }
  { const { ctx, page } = await open(); await signedInAs(page, "a1");
    await page.goto(base + "/admin/dashboard.html"); await page.waitForSelector("#logoutBtn");
    await page.click("#logoutBtn"); await page.waitForURL("**/staff/login.html");
    check("staff logout goes to staff login and clears session", (await page.evaluate(() => localStorage.getItem("stub_session"))) === null);
    await page.goto(base + "/admin/dashboard.html"); await page.waitForURL("**/staff/login.html**");
    check("after logout the admin page is no longer reachable", true);
    await ctx.close(); }
  { const { ctx, page } = await open(); await signedInAs(page, "c1");
    await page.goto(base + "/customer/dashboard.html"); await page.waitForSelector("#logoutBtn");
    await page.click("#logoutBtn"); await page.waitForURL("**/customer/login.html");
    check("customer logout goes to customer login", true);
    await ctx.close(); }

  console.log("\nRegistration");
  { const { ctx, page } = await open({ stub: { signUpSession: false } });
    await page.goto(base + "/customer/register.html");
    await page.click("#submit");
    check("empty form shows field errors and does not call the backend", (await page.locator(".is-invalid").count()) >= 4 && !(await calls(page)).signUp);
    await page.fill("#first", "Jane"); await page.fill("#last", "Doe"); await page.fill("#email", "jane@example.com"); await page.fill("#phone", "0712 345 678");
    await page.fill("#password", "short1"); await page.fill("#confirm", "short1"); await page.click("#submit");
    check("short password rejected", /at least 8/.test(await page.locator("#password ~ .invalid-feedback").textContent()));
    await page.fill("#password", "onlyletters"); await page.fill("#confirm", "onlyletters"); await page.click("#submit");
    check("password without a number rejected", /letter and one number/.test(await page.locator("#password ~ .invalid-feedback").textContent()));
    await page.fill("#password", "Passw0rd99"); await page.fill("#confirm", "Different99"); await page.click("#submit");
    check("mismatched confirmation rejected", /do not match/.test(await page.locator("#confirm ~ .invalid-feedback").textContent()));
    await page.fill("#phone", "abc"); await page.fill("#confirm", "Passw0rd99"); await page.click("#submit");
    check("bad phone rejected", /valid phone/.test(await page.locator("#phone ~ .invalid-feedback").textContent()));
    await page.fill("#phone", "0712 345 678"); await page.click("#submit");
    await page.waitForSelector("#alert.alert-success");
    const sent = (await calls(page)).signUp[0];
    check("valid sign-up shows confirm-your-email message", /confirmation link/.test(await page.textContent("#alert")) && (await page.locator("#form.d-none").count()) === 1);
    check("sign-up payload carries names and phone but NO role", JSON.stringify(Object.keys(sent.options.data).sort()) === JSON.stringify(["first_name", "last_name", "phone"]) && !JSON.stringify(sent).includes("role"), JSON.stringify(sent));
    check("password sent only to the auth API, redirect points at customer login", sent.password === "Passw0rd99" && /customer\/login\.html$/.test(sent.options.emailRedirectTo));
    await ctx.close(); }
  { const { ctx, page } = await open({ stub: { signUpError: { message: "User already registered", status: 422 } } });
    await page.goto(base + "/customer/register.html");
    await page.fill("#first", "A"); await page.fill("#last", "B"); await page.fill("#email", "dup@example.com"); await page.fill("#password", "Passw0rd99"); await page.fill("#confirm", "Passw0rd99");
    await page.click("#submit"); await page.waitForSelector("#alert.alert-danger");
    check("duplicate email shows a neutral message", /could not create your account/i.test(await page.textContent("#alert")) && !/user already registered/i.test(await page.textContent("#alert")));
    check("button re-enabled after failure", !(await page.isDisabled("#submit")));
    await ctx.close(); }
  { const { ctx, page } = await open({ stub: { signUpSession: true } });
    await page.goto(base + "/customer/register.html");
    await page.fill("#first", "A"); await page.fill("#last", "B"); await page.fill("#email", "ok@example.com"); await page.fill("#password", "Passw0rd99"); await page.fill("#confirm", "Passw0rd99");
    await page.click("#submit"); await page.waitForURL("**/customer/dashboard.html");
    check("when no email confirmation is required the customer goes to their dashboard", true);
    await ctx.close(); }

  console.log("\nPassword reset");
  { const { ctx, page } = await open();
    await page.goto(base + "/forgot-password.html?from=staff");
    check("back link follows the portal the user came from", (await page.getAttribute("#back", "href")) === "staff/login.html");
    await page.fill("#email", "ghost@nyota.test"); await page.click("#submit"); await page.waitForSelector("#alert.alert-success");
    check("unknown email gets the same neutral success message", /If that email has an account/.test(await page.textContent("#alert")));
    const c = (await calls(page)).reset[0];
    check("reset link redirects to reset-password.html", /reset-password\.html$/.test(c.o.redirectTo));
    await ctx.close(); }
  { const { ctx, page } = await open({ stub: { recovery: true } });
    await page.goto(base + "/reset-password.html"); await page.waitForSelector("#form:not(.d-none)");
    await page.fill("#password", "weak"); await page.fill("#confirm", "weak"); await page.click("#submit");
    check("weak new password rejected", (await page.locator(".is-invalid").count()) >= 1 && !(await calls(page)).updateUser);
    await page.fill("#password", "NewPassw0rd1"); await page.fill("#confirm", "NewPassw0rd1"); await page.click("#submit");
    await page.waitForURL("**/login.html");
    check("successful reset signs out and returns to login", (await calls(page)).updateUser?.length === 1);
    await ctx.close(); }
  { const { ctx, page } = await open();
    await page.goto(base + "/reset-password.html"); await page.waitForSelector("#alert:not(.d-none)", { timeout: 6000 });
    check("opening reset page without a recovery link shows an expired-link message and no form", /invalid or has expired/.test(await page.textContent("#alert")) && (await page.locator("#form.d-none").count()) === 1);
    await ctx.close(); }

  console.log("\nResponsive");
  for (const p of ["/index.html", "/staff/login.html", "/customer/login.html", "/customer/register.html"]) {
    const { ctx, page } = await open({ viewport: { width: 375, height: 700 } });
    await page.goto(base + p);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal scroll at 375px on ${p}`, overflow <= 0, String(overflow));
    await ctx.close();
  }
  { const { ctx, page } = await open({ viewport: { width: 375, height: 700 } }); await signedInAs(page, "a1");
    await page.goto(base + "/admin/dashboard.html"); await page.waitForSelector(".ne-sidebar");
    check("mobile menu is collapsed until toggled", !(await page.isVisible(".ne-sidebar .items")));
    await page.click("#menuToggle");
    check("mobile menu opens", await page.isVisible(".ne-sidebar .items"));
    check("no horizontal scroll on mobile dashboard", (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(" - " + failed.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
