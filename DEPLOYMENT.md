# Deployment guide

## 1. Supabase project
1. https://supabase.com -> New project. Note the **Project URL** and the **anon public key** (Project Settings -> API). Never copy the `service_role` key anywhere except Supabase secrets.
2. SQL Editor: run each file in `supabase/migrations/` **in filename order** (0100 ... 0800). Or `supabase link` then `supabase db push`.
3. Create the first administrator: register a normal account in the app (customer portal), confirm the email, then in the SQL Editor:
   ```sql
   update public.profiles set role = 'administrator' where email = 'you@example.com';
   ```
4. Authentication -> URL Configuration: Site URL = `https://<user>.github.io/<repo>/`; add `.../customer/login.html`, `.../reset-password.html` to Redirect URLs.
5. Authentication -> Providers -> Email: keep **Confirm email** on; minimum password length 8 or more; enable leaked-password protection if your plan has it.
6. Authentication -> Rate limits: leave the defaults or tighten them.

## 2. Edge Functions
```
supabase functions deploy create-staff-user
supabase functions deploy set-account-status
supabase secrets set ALLOWED_ORIGINS=https://<user>.github.io
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase. `verify_jwt` is on (see `supabase/config.toml`). Without `ALLOWED_ORIGINS` the browser calls are refused (safe default).

## 3. Frontend configuration
Edit `js/supabase-client.js`: set `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The anon key is public by design; Row Level Security protects the data. Then:
```
node scripts/check-release.mjs
```
It must print `Release check passed.` (it fails on placeholders, any service-role key or non-anon JWT, and any external script or stylesheet without an integrity hash; the site itself loads nothing from a CDN).

## 4. GitHub Pages
```
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```
Repository Settings -> Pages -> Source: **GitHub Actions**. The workflow `.github/workflows/pages.yml` publishes only the website files (not tests, SQL or docs). All links are relative, so a project path such as `/<repo>/` works.

## 5. Verify on the real project (checklist; this is the one thing the automated tests cannot do)
Create four accounts (customer by registering; manager, employee, second administrator by Users -> + ADD USER) and tick each:
- [ ] Customer registers, confirms email, logs in, submits feedback with a PNG and a PDF; reference `NYO-...` shown.
- [ ] Customer sees only their own feedback (use a second customer to confirm).
- [ ] Manager sees it as Unassigned, assigns it to the employee.
- [ ] Employee sees only that case, clicks Start, replies, resolves with details (below the minimum length is refused).
- [ ] Customer sees the status change and the customer-visible reply, not internal notes.
- [ ] Administrator dashboard numbers match; Reports for this month shows the case; CSV opens in Excel with names and no email/phone.
- [ ] Administrator deactivates the employee: that employee can no longer sign in and an open session stops working on the next request.
- [ ] Customer cannot open `admin/dashboard.html` (redirected) and, in the browser console, `sb.from('feedback').select()` returns only their rows.
- [ ] A manager cannot call `report_summary` (returns "Not allowed").
- [ ] The staff portal rejects the customer account and the customer portal rejects staff.
- [ ] Audit Logs shows the assignment, role change and report events.

## Troubleshooting
| Symptom | Cause |
|---|---|
| Page shows "backend is not configured" | placeholders still in `js/supabase-client.js` |
| Add user fails with a CORS/network error | functions not deployed or `ALLOWED_ORIGINS` missing/wrong (must match the site origin exactly, no trailing slash) |
| Confirmation email link goes to the wrong place | Auth Site URL / Redirect URLs |
| Blank list for a role that should see data | migration not applied (run all in order); check the SQL Editor for errors |
