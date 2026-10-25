// Test harness: serves the repo statically and replaces the Supabase SDK + CDN CSS with stubs,
// so UI behaviour (guards, forms, redirects) can be tested without a backend.
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split("?")[0]);
      const f = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
      res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" });
      // SRI hashes match the real CDN files, not the test stubs, so they are removed for tests only.
      if (path.extname(f) === ".html") return res.end(fs.readFileSync(f, "utf8").replace(/ integrity="[^"]*" crossorigin="anonymous"/g, ""));
      fs.createReadStream(f).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

// Fake supabase-js UMD. Behaviour is driven by window.__stub (set by addInitScript) and
// the signed-in user is kept in localStorage so reloads/navigation behave like a real session.
const SDK = `
window.supabase = { createClient() {
  const S = () => window.__stub;
  const sess = () => { try { return JSON.parse(localStorage.getItem("stub_session")); } catch { return null; } };
  const listeners = [];
  const log = (k, v) => { (S().calls[k] = S().calls[k] || []).push(v); localStorage.setItem("stub_calls", JSON.stringify(S().calls)); };
  return {
    auth: {
      async getSession() { const s = sess(); return { data: { session: s ? { user: { id: s.id } } : null } }; },
      async signInWithPassword({ email, password }) {
        log("signIn", { email });
        const u = S().users.find((x) => x.email === email && x.password === password);
        if (!u) return { error: { code: "invalid_credentials", message: "Invalid login credentials", status: 400 } };
        if (u.banned) return { error: { code: "user_banned", message: "User is banned", status: 400 } };
        localStorage.setItem("stub_session", JSON.stringify({ id: u.id }));
        return { data: { session: {} }, error: null };
      },
      async signUp(args) { log("signUp", args); if (S().signUpError) return { error: S().signUpError }; return { data: { session: S().signUpSession ? {} : null, user: {} }, error: null }; },
      async signOut() { log("signOut", 1); localStorage.removeItem("stub_session"); return { error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); if (S().recovery) setTimeout(() => cb("PASSWORD_RECOVERY"), 50); return { data: { subscription: {} } }; },
      async resetPasswordForEmail(email, o) { log("reset", { email, o }); return { error: S().resetError || null }; },
      async updateUser(a) { log("updateUser", Object.keys(a)); return { error: S().updateError || null }; },
    },
    rpc(name, args) {
      log("rpc", { name, args });
      if (name === "list_feedback" && S().listRows) {
        if (S().listError) return Promise.resolve({ data: null, error: { message: "boom" } });
        let rows = S().listRows.filter((r) => (!args.p_type || r.feedback_type === args.p_type) && (!args.p_status || r.status === args.p_status)
          && (!args.p_assignment || (args.p_assignment === "unassigned") === !r.assigned_employee_id)
          && (!args.p_search || [r.reference_number, r.subject, r.customer_name].some((v) => v.toLowerCase().includes(args.p_search.toLowerCase()))));
        const total = rows.length; rows = rows.slice(args.p_offset, args.p_offset + args.p_limit).map((r) => ({ ...r, total_count: total }));
        return Promise.resolve({ data: rows, error: null });
      }
      if (name === "list_users" && S().userRows) {
        const q = (args.p_search || "").toLowerCase();
        let rows = S().userRows.filter((u) => (!args.p_role || u.role === args.p_role) && (!args.p_status || u.account_status === args.p_status)
          && (!q || [u.first_name, u.last_name, u.email].join(" ").toLowerCase().includes(q)));
        const total = rows.length; rows = rows.slice(args.p_offset, args.p_offset + args.p_limit).map((u) => ({ ...u, total_count: total }));
        return Promise.resolve({ data: rows, error: null });
      }
      const r = S().rpc && S().rpc[name]; return Promise.resolve(r || { data: [], error: null });
    },
    functions: { async invoke(name, opts) {
      log("fn", { name, body: opts && opts.body });
      const r = S().fnResult && S().fnResult[name];
      if (r && r.error) return { data: null, error: { message: "Edge Function returned a non-2xx status code", context: { json: async () => ({ error: r.error }) } } };
      return { data: (r && r.data) || { ok: true }, error: null };
    } },
    storage: { from(bucket) { return { async createSignedUrl(path, ttl) { log("signed", { path, ttl }); return S().signFail ? { error: { message: "x" } } : { data: { signedUrl: "https://signed.example/" + path }, error: null }; }, async upload(path, file, opts) {
      log("upload", { bucket, path, type: opts && opts.contentType, size: file.size });
      const f = S().uploadFail; if (f && (f === true || path.endsWith(f))) return { error: { message: "upload failed" } };
      return { data: { path }, error: null }; } }; } },
    from(table) {
      const q = { _f: {}, _in: {}, _op: "select", _row: null };
      q.select = () => q; q.eq = (c, v) => { q._f[c] = v; return q; }; q.in = (c, v) => { q._in[c] = v; return q; };
      q.order = () => q; q.limit = () => q;
      q.insert = (row) => { q._op = "insert"; q._row = row; return q; };
      q.update = (row) => { q._op = "update"; q._row = row; return q; };
      const run = () => {
        if (q._op === "insert") {
          log("insert:" + table, q._row);
          const err = S().insertError && S().insertError[table];
          if (err) return { data: null, error: err };
          const ret = (S().insertResult && S().insertResult[table]) || { id: "f-1", reference_number: "NYO-20261024-ABCD1234" };
          return { data: ret, error: null };
        }
        if (q._op === "update") { log("update:" + table, { set: q._row, where: q._f }); return { data: null, error: (S().updateErr && S().updateErr[table]) || null }; }
        log("select", table);
        if (table === "profiles" && q._in.id) return { data: S().users.filter((x) => q._in.id.includes(x.id)).map(({ password, banned, ...p }) => p), error: null };
        if (table === "profiles") {
          const u = S().users.find((x) => x.id === q._f.id);
          if (!u || S().profileError) return { data: null, error: S().profileError || null };
          const { password, banned, ...profile } = u; return { data: profile, error: null };
        }
        let rows = (S().tables && S().tables[table]) || [];
        for (const [c, v] of Object.entries(q._f)) rows = rows.filter((r) => r[c] === v);
        for (const [c, v] of Object.entries(q._in)) rows = rows.filter((r) => v.includes(r[c]));
        return { data: rows, error: null };
      };
      q.maybeSingle = async () => { const r = run(); return Array.isArray(r.data) ? { data: r.data[0] || null, error: r.error } : r; };
      q.single = async () => { const r = run(); if (Array.isArray(r.data)) return r.data[0] ? { data: r.data[0], error: null } : { data: null, error: { message: "no rows" } }; return r; };
      q.then = (res, rej) => Promise.resolve(run()).then(res, rej);
      return q;
    },
  };
} };`;

async function newPage(browser, base, { users = [], stub = {}, configured = true, viewport } = {}) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await page.route(/\/assets\/vendor\//, (route) => {
    const u = route.request().url();
    if (u.includes("supabase")) return route.fulfill({ contentType: "text/javascript", body: SDK });
    if (u.includes("chart.umd")) return route.fulfill({ contentType: "text/javascript", body: "window.__charts=[];window.Chart=class{constructor(el,cfg){window.__charts.push({id:el.id,type:cfg.type,data:cfg.data});}}" });
    if (u.includes("bootstrap")) return route.fulfill({ contentType: "text/css", body: ".d-none{display:none!important}.invalid-feedback{display:none}.is-invalid~.invalid-feedback{display:block}" });
    return route.abort();
  });
  if (configured) {
    await page.route("**/js/supabase-client.js", async (route) => {
      let body = fs.readFileSync(path.join(ROOT, "js", "supabase-client.js"), "utf8");
      body = body.replace("https://YOUR-PROJECT-REF.supabase.co", "https://test.supabase.co").replace("YOUR-ANON-KEY", "anon-test");
      route.fulfill({ contentType: "text/javascript", body });
    });
  }
  await page.addInitScript(({ users, stub }) => {
    let calls = {};
    try { calls = JSON.parse(localStorage.getItem("stub_calls")) || {}; } catch {}
    window.__stub = Object.assign({ users, calls }, stub);
  }, { users, stub });
  return { ctx, page };
}
const calls = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("stub_calls") || "{}"));
// Seeds a session once per browser context (not on every navigation, or logout could never stick).
const signedInAs = (page, id) => page.addInitScript((id) => {
  if (!localStorage.getItem("stub_seeded")) { localStorage.setItem("stub_seeded", "1"); localStorage.setItem("stub_session", JSON.stringify({ id })); }
}, id);

module.exports = { serve, newPage, calls, signedInAs };
