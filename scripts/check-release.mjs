// Pre-deploy gate. Fails (exit 1) when the site would ship secrets, an unconfigured backend, or
// CDN assets without integrity hashes. Run: node scripts/check-release.mjs
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git", "tests", "supabase", "design-reference", ".github", "scripts"]);
const problems = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(html|js|css|json|md)$/.test(e.name)) scan(p);
  }
}
function scan(file) {
  const rel = path.relative(ROOT, file), text = fs.readFileSync(file, "utf8");
  if (/service_role[\w-]*\s*[:=]\s*["'`]?eyJ/i.test(text) || /SERVICE_ROLE_KEY\s*[:=]\s*["'`]?[\w.-]{40,}/.test(text)) problems.push(`${rel}: looks like a service-role key`);
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\./g)) {
    try { const role = JSON.parse(Buffer.from(m[1], "base64url").toString()).role; if (role && role !== "anon") problems.push(`${rel}: JWT with role "${role}" (only the anon key may be public)`); } catch { /* not a JWT */ }
  }
  if (file.endsWith(".html")) {
    for (const m of text.matchAll(/<(script|link)\b[^>]*(?:src|href)="https:\/\/[^"]+"[^>]*>/g)) {
      if (!/integrity="sha(256|384|512)-/.test(m[0]) && !/fonts\.googleapis/.test(m[0])) problems.push(`${rel}: external asset without integrity: ${m[0].slice(0, 90)}`);
    }
  }
}
walk(ROOT);
const cfg = fs.readFileSync(path.join(ROOT, "js/supabase-client.js"), "utf8");
if (/YOUR-PROJECT-REF|YOUR-ANON-KEY/.test(cfg) && !process.argv.includes("--allow-placeholders")) problems.push("js/supabase-client.js still has placeholder URL/anon key (use --allow-placeholders for a dry run)");
if (problems.length) { console.error("RELEASE CHECK FAILED\n - " + problems.join("\n - ")); process.exit(1); }
console.log("Release check passed.");
