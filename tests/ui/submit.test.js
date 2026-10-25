// UI tests for Milestone 4: homepage CTA, feedback form, attachments, confirmation.
const { chromium } = require("playwright");
const { serve, newPage, calls, signedInAs } = require("./harness");
let pass = 0, fail = 0; const failed = [];
const check = (n, c, x = "") => { if (c) { pass++; console.log("  PASS", n); } else { fail++; failed.push(n); console.log("  FAIL", n, x ? "| " + x : ""); } };

const FID = "11111111-1111-1111-1111-111111111111";
const REF = "NYO-20261024-ABCD1234";
const user = (id, role, o = {}) => ({ id, email: `${role}@nyota.test`, password: "Passw0rd!", first_name: role, last_name: "Tester", phone: "0712345678", role, account_status: "active", ...o });
const USERS = [user("c1", "customer"), user("e1", "employee"), user("a1", "administrator")];
const STUB = {
  rpc: { list_servable_employees: { data: [{ id: "e-1", first_name: "Cynthia" }, { id: "e-2", first_name: '<b onmouseover="window.__x=1">Dan</b>' }], error: null } },
  tables: {
    system_settings: [{ key: "feedback_categories", value: ["Electronics", "Delivery", "<i>Other</i>"] }],
    feedback: [{ id: FID, reference_number: REF }],
  },
  insertResult: { feedback: { id: FID, reference_number: REF } },
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(200)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200)]);

(async () => {
  const { srv, base } = await serve();
  const browser = await chromium.launch();
  const open = async (o = {}) => { const r = await newPage(browser, base, { users: USERS, ...o, stub: { ...STUB, ...(o.stub || {}) } }); await signedInAs(r.page, "c1"); return r; };
  const form = async (page, o = {}) => {
    await page.goto(base + "/customer/submit.html"); await page.waitForSelector("#form");
    if (o.fill !== false) {
      await page.fill("#subject", o.subject ?? "Faulty blender"); await page.fill("#description", o.description ?? "The blender stopped working after two days of use.");
      if (o.rating !== null) await page.check(`#stars label[for=r${o.rating ?? 4}]`.replace("label[for=", "input#").replace("]", ""), { force: true }).catch(async () => page.click(`label[for=r${o.rating ?? 4}]`));
    }
  };

  console.log("\nForm layout and options");
  { const { ctx, page } = await open(); await form(page, { fill: false });
    check("title and wireframe fields present", /SUBMIT FEEDBACK/.test(await page.textContent("h1")) && (await page.locator("label", { hasText: "Full Name" }).count()) === 1 && (await page.locator("label", { hasText: "Phone Number" }).count()) === 1);
    check("name, phone and email come from the account and are read-only", (await page.inputValue("#fullName")) === "customer Tester" && (await page.inputValue("#phone")) === "0712345678" && (await page.inputValue("#email")) === "customer@nyota.test" && await page.getAttribute("#email", "readonly") !== null);
    check("Complaint is selected by default, three types offered", (await page.isChecked("#t-complaint")) && (await page.locator("input[name=type]").count()) === 3);
    check("five rating options", (await page.locator("input[name=rating]").count()) === 5);
    check("served-by lists first names from the server", (await page.$$eval("#servedBy option", (o) => o.map((x) => x.textContent))).includes("Cynthia"));
    check("category list comes from settings", (await page.locator("#category option").count()) === 4);
    check("HTML in employee/category names is escaped", (await page.evaluate(() => window.__x)) === undefined && (await page.locator("#servedBy b").count()) === 0 && (await page.locator("#category i").count()) === 0);
    check("attachment hint shows the limits", /up to 3 files.*5 MB/.test(await page.textContent("label[for=files]")));
    await page.fill("#description", "hello"); check("character counter works", (await page.textContent("#count")) === "5");
    await ctx.close(); }

  console.log("\nValidation");
  { const { ctx, page } = await open(); await form(page, { fill: false });
    await page.click("#submit");
    check("empty form: errors shown, nothing sent", (await page.locator(".is-invalid").count()) >= 2 && /rate our service/.test(await page.textContent("#ratingErr")) && !(await calls(page))["insert:feedback"]);
    await page.fill("#subject", "ab"); await page.fill("#description", "short"); await page.click("#submit");
    check("short subject and description rejected", /at least 3/.test(await page.locator("#subject ~ .invalid-feedback").textContent()) && /at least 10/.test(await page.locator("#description ~ .invalid-feedback").textContent()));
    await page.fill("#subject", "      "); await page.fill("#description", "          x"); await page.click("#submit");
    check("whitespace-only subject rejected", (await page.locator("#subject.is-invalid").count()) === 1);
    await ctx.close(); }

  console.log("\nSubmission");
  { const { ctx, page } = await open(); await form(page, { rating: 5 });
    await page.check("#t-suggestion"); await page.selectOption("#servedBy", "e-1"); await page.selectOption("#category", "Delivery");
    await page.fill("#productName", "  Blender X  "); await page.selectOption("#method", "whatsapp");
    await page.click("#submit"); await page.waitForURL("**/customer/confirmation.html**");
    const row = (await calls(page))["insert:feedback"][0];
    check("payload has exactly the allowed columns", JSON.stringify(Object.keys(row).sort()) === JSON.stringify(["customer_id", "description", "feedback_type", "preferred_response_method", "product_name", "product_service_category", "purchase_reference", "served_by_employee_id", "service_rating", "subject"]), Object.keys(row).join());
    check("no status, reference or resolution fields are sent", !("status" in row) && !("reference_number" in row) && !("resolved_by" in row));
    check("values are trimmed/typed correctly", row.customer_id === "c1" && row.service_rating === 5 && row.feedback_type === "suggestion" && row.served_by_employee_id === "e-1" && row.product_name === "Blender X" && row.purchase_reference === null && row.preferred_response_method === "whatsapp" && row.product_service_category === "Delivery");
    await page.waitForSelector("#ref");
    check("confirmation shows the server's reference number", (await page.textContent("#ref")) === REF);
    check("confirmation text matches the wireframe", /Feedback Submitted Successfully/.test(await page.textContent("h1")) && /keep this number/.test(await page.textContent("main")));
    check("Return Home goes to the homepage", (await page.getAttribute("main a.btn-ne", "href")).endsWith("/index.html"));
    await ctx.close(); }
  { const { ctx, page } = await open(); await form(page, { rating: 1 });
    await page.click("#submit"); await page.waitForURL("**/confirmation.html**");
    const row = (await calls(page))["insert:feedback"][0];
    check("blank optional fields are sent as null", row.served_by_employee_id === null && row.product_name === null && row.product_service_category === null);
    await ctx.close(); }
  { const { ctx, page } = await open(); await form(page);
    await page.dblclick("#submit"); await page.waitForURL("**/confirmation.html**");
    check("double-click sends only one request", (await calls(page))["insert:feedback"].length === 1);
    await ctx.close(); }
  { const { ctx, page } = await open({ stub: { insertError: { feedback: { message: "This feedback was already submitted a moment ago." } } } }); await form(page);
    await page.click("#submit"); await page.waitForSelector("#alert:not(.d-none)");
    check("duplicate submission gives a friendly message", /already sent this feedback/.test(await page.textContent("#alert")) && /form/.test(page.url() + "form") && page.url().includes("submit.html"));
    check("button usable again and entered text kept", !(await page.isDisabled("#submit")) && (await page.inputValue("#subject")) === "Faulty blender");
    await ctx.close(); }
  { const { ctx, page } = await open({ stub: { insertError: { feedback: { message: 'new row violates row-level security policy for table "feedback"' } } } }); await form(page);
    await page.click("#submit"); await page.waitForSelector("#alert:not(.d-none)");
    check("RLS error hides internals", /not allowed to submit/.test(await page.textContent("#alert")) && !/row-level|policy|table/.test(await page.textContent("#alert")));
    await ctx.close(); }

  console.log("\nAttachments");
  { const { ctx, page } = await open(); await form(page);
    await page.setInputFiles("#files", [{ name: "receipt.png", mimeType: "image/png", buffer: PNG }, { name: "invoice.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await page.waitForSelector("#fileList li");
    check("valid PNG and PDF accepted and listed", (await page.locator("#fileList li").count()) === 2);
    await page.setInputFiles("#files", [{ name: "virus.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") }]);
    await page.waitForSelector("#alert:not(.d-none)");
    check("executable rejected", /only JPG, PNG or PDF/.test(await page.textContent("#alert")) && (await page.locator("#fileList li").count()) === 2);
    await page.setInputFiles("#files", [{ name: "page.html", mimeType: "text/html", buffer: Buffer.from("<script>") }]);
    check("HTML rejected", /only JPG, PNG or PDF/.test(await page.textContent("#alert")));
    await page.setInputFiles("#files", [{ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("this is not a png at all") }]);
    check("file whose content does not match its type is rejected", /does not match/.test(await page.textContent("#alert")));
    await page.setInputFiles("#files", [{ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]) }]);
    check("file over 5 MB rejected", /larger than 5 MB/.test(await page.textContent("#alert")));
    await page.setInputFiles("#files", [{ name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) }]);
    check("empty file rejected", /empty/.test(await page.textContent("#alert")));
    await page.setInputFiles("#files", [{ name: "a.jpg", mimeType: "image/jpeg", buffer: JPG }]);
    await page.setInputFiles("#files", [{ name: "b.jpg", mimeType: "image/jpeg", buffer: JPG }]);
    check("fourth file refused (limit 3)", (await page.locator("#fileList li").count()) === 3 && /Only 3 files/.test(await page.textContent("#alert")));
    await page.click("#fileList button[data-i='0']");
    check("a file can be removed", (await page.locator("#fileList li").count()) === 2);
    await page.click("#submit"); await page.waitForURL("**/confirmation.html**");
    const c = await calls(page);
    check("each file uploaded to <uid>/<feedback id>/<random>.<ext> in the private bucket", c.upload.length === 2 && c.upload.every((u) => u.bucket === "feedback-attachments" && new RegExp(`^c1/${FID}/[0-9a-f-]{36}\\.(png|pdf|jpg)$`).test(u.path)), JSON.stringify(c.upload));
    check("original file names never appear in storage paths", !c.upload.some((u) => /invoice|receipt|a\.jpg/.test(u.path)));
    const metas = c["insert:feedback_attachments"];
    check("metadata rows recorded for each file", metas.length === 2 && metas.every((m) => m.feedback_id === FID && m.uploaded_by === "c1" && m.size_bytes > 0) && metas[0].file_name === "invoice.pdf");
    await ctx.close(); }
  { const { ctx, page } = await open({ stub: { uploadFail: true } }); await form(page);
    await page.setInputFiles("#files", [{ name: "receipt.png", mimeType: "image/png", buffer: PNG }]);
    await page.waitForSelector("#fileList li"); await page.click("#submit"); await page.waitForURL("**/confirmation.html**");
    await page.waitForSelector("#ref");
    check("failed upload: feedback still confirmed, user told which file failed", (await page.textContent("#ref")) === REF && /receipt\.png: upload failed/.test(await page.textContent(".alert-warning")));
    check("no metadata row for a failed upload", !(await calls(page))["insert:feedback_attachments"]);
    await ctx.close(); }
  { const { ctx, page } = await open(); await form(page);
    await page.setInputFiles("#files", [{ name: '"><img src=x onerror=window.__y=1>.png', mimeType: "image/png", buffer: PNG }]);
    await page.waitForSelector("#fileList li");
    check("hostile file name is shown as text", (await page.evaluate(() => window.__y)) === undefined && (await page.locator("#fileList img").count()) === 0);
    await page.click("#submit"); await page.waitForURL("**/confirmation.html**");
    const meta = (await calls(page))["insert:feedback_attachments"][0];
    check("stored file name is sanitised", !/[<>"=]/.test(meta.file_name), meta.file_name);
    await ctx.close(); }

  console.log("\nConfirmation page");
  { const { ctx, page } = await open();
    await page.goto(base + "/customer/confirmation.html?id=" + FID + "&ref=NYO-FAKE-00000000"); await page.waitForSelector("#ref");
    check("reference comes from the database, not the URL", (await page.textContent("#ref")) === REF);
    await page.goto(base + "/customer/confirmation.html?id=22222222-2222-2222-2222-222222222222");
    await page.waitForSelector("h1"); check("unknown id shows 'not found'", /not found/i.test(await page.textContent("h1")));
    await page.goto(base + "/customer/confirmation.html?id=%3Cscript%3E");
    await page.waitForSelector("h1"); check("garbage id shows 'not found'", /not found/i.test(await page.textContent("h1")));
    await ctx.close(); }

  console.log("\nAccess and entry flow");
  { const { ctx, page } = await newPage(browser, base, { users: USERS, stub: STUB }); await signedInAs(page, "e1");
    await page.goto(base + "/customer/submit.html"); await page.waitForURL("**/employee/dashboard.html");
    check("employee cannot open the submit page", true); await ctx.close(); }
  { const { ctx, page } = await newPage(browser, base, { users: USERS, stub: STUB }); await signedInAs(page, "a1");
    await page.goto(base + "/customer/confirmation.html?id=" + FID); await page.waitForURL("**/admin/dashboard.html");
    check("administrator cannot open the customer confirmation page", true); await ctx.close(); }
  { const { ctx, page } = await newPage(browser, base, { users: USERS, stub: STUB });
    await page.goto(base + "/index.html"); await page.click("#cta"); await page.waitForURL("**/customer/login.html**");
    check("signed-out Submit Feedback leads to login keeping the destination", page.url().includes("next=customer%2Fsubmit.html"));
    await page.fill("#email", "customer@nyota.test"); await page.fill("#password", "Passw0rd!"); await page.click("#submit");
    await page.waitForURL("**/customer/submit.html");
    check("after login the customer lands on the feedback form", true);
    await page.goto(base + "/index.html"); await page.waitForTimeout(400);
    check("signed-in customer's button goes straight to the form", (await page.getAttribute("#cta", "href")).endsWith("/customer/submit.html"));
    await ctx.close(); }
  { const { ctx, page } = await newPage(browser, base, { users: USERS, stub: STUB });
    await page.goto(base + "/customer/login.html?next=customer%2Fsubmit.html");
    check("register link keeps the destination", (await page.getAttribute("#reg", "href")).includes("next=customer%2Fsubmit.html") || (await page.$eval("#reg", (a) => a.search)).includes("next="));
    await ctx.close(); }

  console.log("\nResponsive");
  { const { ctx, page } = await newPage(browser, base, { users: USERS, stub: STUB, viewport: { width: 375, height: 800 } }); await signedInAs(page, "c1");
    await page.goto(base + "/customer/submit.html"); await page.waitForSelector("#form");
    check("no horizontal scroll on the form at 375px", (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);
    await ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log(" - " + failed.join("\n - ")); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(2); });
