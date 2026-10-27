# Test locally before deploying

You need: Node 18+ (for the tiny web server) and a Supabase project. The quickest safe way is a **separate free Supabase project just for testing** (call it `nyota-dev`). You deploy the real one later with the same steps. (Docker option at the bottom.)

## 1. Create the test backend (10 minutes)
1. supabase.com -> New project `nyota-dev`. Save the database password.
2. **SQL Editor**: open each file in `supabase/migrations/` **in filename order** (`...0100` to `...0900`), paste, Run. Each must finish with "Success". Stop and tell me if one errors.
3. **Authentication -> Providers -> Email**: turn **Confirm email OFF** for local testing (so you don't need real inboxes). Turn it back on for production.
4. **Authentication -> URL Configuration**: Site URL `http://localhost:8080`; add `http://localhost:8080/**` to Redirect URLs.
5. **Project Settings -> API**: copy the **Project URL** and the **anon public** key.

## 2. Point the app at it
Edit `js/supabase-client.js`, replace the two placeholders with the URL and anon key. (The anon key is public by design. Never paste the `service_role` key anywhere in the project.)

## 3. Run the site
```
node scripts/serve.mjs
```
Open http://localhost:8080/ . If a page ever sits on "Loading..." or stays blank, you opened the file directly or some files are missing: a banner at the top of the page now says which.

## 4. First administrator
1. Go to Customer login -> Register and create an account with your email.
2. SQL Editor: `update public.profiles set role = 'administrator' where email = 'your@email';`
3. Log in at **Staff login** (`/staff/login.html`). You should land on the admin dashboard.

## 5. Staff accounts (needs the Edge Functions)
Option A, deployed to the test project (simplest):
```
npm i -g supabase            # or: npx supabase ...
supabase login
supabase link --project-ref <your-dev-project-ref>
supabase functions deploy create-staff-user
supabase functions deploy set-account-status
supabase secrets set ALLOWED_ORIGINS=http://localhost:8080
```
Then Users -> + ADD USER creates the manager and employee. (Their sign-in uses the temporary password you set.)

No CLI yet? You can still test everything except the Add-user button: register two more customers, then promote them in SQL:
```sql
update public.profiles set role = 'manager'  where email = 'manager@test.com';
update public.profiles set role = 'employee' where email = 'employee@test.com';
```

## 6. Walk through the system
Follow the checklist in `DEPLOYMENT.md`, section "Verify on the real project" (customer submits -> manager assigns -> employee resolves -> customer sees it -> admin reports/CSV/audit). Use two browsers (or one normal + one private window) so two roles stay signed in at once.

## If something looks wrong
| Symptom | Fix |
|---|---|
| "backend is not configured" | URL/anon key still placeholders |
| Blank/unstyled page | opened from disk; use `node scripts/serve.mjs` and http://localhost:8080 |
| Lists empty for admin | a migration did not run; rerun in order |
| "Add user" network/CORS error | functions not deployed, or `ALLOWED_ORIGINS` is not exactly `http://localhost:8080` |
| Register succeeds but cannot log in | Confirm email still ON (turn off, or click the email link) |
| Press F12 -> Console/Network | send me the red errors and I will fix them |

## Option B: fully local with Docker (no cloud project)
```
supabase init            # in a scratch folder; copy this project's supabase/migrations and functions into it
supabase start           # prints API URL (http://127.0.0.1:54321) and anon key
supabase db reset        # applies the migrations
supabase functions serve --env-file .env.local   # .env.local: ALLOWED_ORIGINS=http://localhost:8080
```
Use the printed URL and anon key in `js/supabase-client.js`. Local Auth emails appear at http://127.0.0.1:54324 (Inbucket).

Before the real deployment: put the production URL/anon key back, turn **Confirm email** on, set the Site URL to your GitHub Pages address, and run `node scripts/check-release.mjs`.
