# Security notes

## Controls in place (and where they are tested)
| Risk | Control | Tested in |
|---|---|---|
| Reading or changing another user's data | Row Level Security default-deny on every table; policies per role | `tests/db/rls.test.js` (229 checks, every role plus anonymous) |
| Role escalation | Role only in `profiles.role`; sign-up always creates a customer; `profiles_guard` trigger blocks role/status/email edits by non-admins; last active administrator cannot be demoted | db tests |
| Skipping the workflow (self-resolving, editing someone else's case) | Status changes only through SECURITY DEFINER functions that check role, assignment and current status; direct table writes denied | db tests |
| Staff creation abuse | Edge Function checks the caller is an active administrator, uses the service-role key server-side only, rolls back on failure, audits | `tests/functions` |
| Leaked secrets | `scripts/check-release.mjs` blocks service-role keys/non-anon JWTs; CI runs it before publishing; `.gitignore` excludes env files | gate negative-tested |
| XSS | Every dynamic value escaped with `esc()`/`textContent`; HTML payloads in names, subjects, categories and audit data are covered by UI tests | UI suites |
| Malicious uploads | JPG/PNG/PDF only, 5 MB, 3 files, file-signature check on the client, storage policy and size/type limits on the server; private bucket, path bound to the owner | db + UI submit tests |
| Attachment link sharing | Signed URLs valid 60 seconds, issued only where storage RLS allows | db + UI tests |
| Open redirect after login | `safeNext()` accepts only same-site relative `.html` paths | auth UI tests |
| CSV formula injection | Cells starting with `= + - @` are prefixed | admin-m9 UI tests |
| Supply chain | Bootstrap 5.3.3, supabase-js 2.45.4 and Chart.js 4.4.3 are self-hosted in `assets/vendor/` (exact npm files, licences included); no third-party scripts load at runtime | gate |
| Report data exposure | Reports admin-only; CSV carries names only | db + UI tests |
| Account enumeration | Password reset always reports success; generic login errors | auth UI tests |
| Anonymous submissions | One narrow `anon`-callable function; no direct table access; server-side validation, honeypot, duplicate guard, hourly cap and an administrator off-switch; nothing identifying is stored (no IP, no account); a logged-in customer is deliberately not linked; staff see only "Anonymous User" | db (60 checks) + anonymous UI tests |
| Audit trail | Role/status changes, assignments, responses, resolutions, settings, report events; metadata whitelisted, no secrets | db tests |

## Known limits (be honest in the report)
- Anonymous feedback is open to the internet by design. The hourly cap and honeypot reduce abuse but are not a CAPTCHA; a determined spammer can exhaust the cap. Use the off-switch (`anonymous_feedback_enabled`) in an emergency.
- The browser guards (`requireRole`) only hide pages; the database enforces access. A user who edits the JavaScript still gets nothing the policies deny.
- GitHub Pages cannot set HTTP headers, so there is no Content-Security-Policy, `X-Frame-Options` or HSTS from the site itself. GitHub serves HTTPS; clickjacking protection would need a different host or a proxy.
- Tests ran against PostgreSQL 16 with a **stub** of Supabase's `auth` and `storage` schemas and a stubbed supabase-js. Real-project verification is the checklist in `DEPLOYMENT.md`.
- Edge Function entry points (`index.ts`, `Deno.serve`) were not executed in this environment; their logic (`handler.ts`) is unit-tested.
- Rate limiting and breached-password protection rely on Supabase Auth settings.
- Newly created staff accounts have an administrator-chosen temporary password; there is no forced change on first login yet. Staff can change it with "Forgot password".
- The service-role key is the crown jewel: if it ever appears in a commit, rotate it in Supabase immediately.
