# Full deployment guide: Supabase (backend) + GitHub Pages (frontend)

Time needed: about 45 minutes the first time. Do the parts in order: **A** prepare, **B** Supabase, **C** connect the frontend, **D** GitHub Pages, **E** finish and verify.

Words used here: **ref** = your Supabase project reference (the part before `.supabase.co` in the Project URL). **USER** = your GitHub username. **REPO** = the repository name you choose, for example `nyota-feedback`. Your live site will be `https://USER.github.io/REPO/`.

---
## Part A. Prepare (10 minutes)
1. Accounts: a free GitHub account (github.com) and a free Supabase account (supabase.com).
2. Install on your computer: **Node.js 18 or newer** (nodejs.org) and **Git** (git-scm.com). Check with `node -v` and `git --version`.
3. Unzip the project. Open a terminal **inside the unzipped `nyota-feedback` folder** (the folder that contains `index.html` and `supabase/`). Every command below is run from there.
4. Decide the repository name (REPO). Short, lowercase, no spaces.
5. GitHub Pages is free for **public** repositories. Making this one public is safe: the project contains no secrets (the Supabase *anon* key is public by design and Row Level Security protects the data). A private repository needs a paid GitHub plan for Pages.

## Part B. Supabase backend (20 minutes)

### B1. Create the project
supabase.com -> **New project** -> name `nyota-feedback`, pick a strong database password (save it in a password manager), choose a region close to your users (for Kenya: Europe, e.g. Frankfurt or London). Wait about 2 minutes until it is ready.

### B2. Create the database (run the 9 SQL files)
Open **SQL Editor -> New query**. For **each** file in `supabase/migrations/`, **in this exact order**, open it in a text editor, copy everything, paste into the SQL Editor and click **Run**. Wait for **Success** before the next one.

| Order | File |
|---|---|
| 1 | `20261024000100_core_schema.sql` |
| 2 | `20261024000200_helpers_and_triggers.sql` |
| 3 | `20261024000300_workflow_functions.sql` |
| 4 | `20261024000400_rls_policies.sql` |
| 5 | `20261024000500_storage.sql` |
| 6 | `20261024000600_staff_overview.sql` |
| 7 | `20261024000700_list_feedback_assignment_filter.sql` |
| 8 | `20261024000800_admin_reports_users_audit.sql` |
| 9 | `20261024000900_anonymous_feedback.sql` |

If a file shows an error, **stop**, do not continue, and send me the exact message. (Running a file twice fails with "already exists"; that is a sign it already ran.)
Check: **Table Editor** now lists `profiles`, `feedback`, `feedback_assignments`, `feedback_responses`, `audit_logs`, and so on; **Storage** shows a private bucket `feedback-attachments`.

### B3. Sign-in settings
1. **Authentication -> Sign In / Providers -> Email**: keep **Confirm email ON**. Set minimum password length to 8 or more. Turn on leaked-password protection if your plan offers it.
2. **Authentication -> URL Configuration** (you can finish this after Part D when the real address exists, but set a first value now):
   - **Site URL:** `https://USER.github.io/REPO/`
   - **Redirect URLs:** add `https://USER.github.io/REPO/customer/login.html` and `https://USER.github.io/REPO/reset-password.html`
3. Real email delivery: Supabase's built-in email is limited to a few messages per hour. For real users set **Project Settings -> Authentication -> SMTP** with your own provider (Resend, Brevo, SendGrid, Gmail app password...). For a demo the built-in sender is fine.

### B4. Copy the two public keys
**Project Settings -> API**: copy **Project URL** (`https://ref.supabase.co`) and the **anon / public** key. Do **not** use the `service_role` key anywhere in the project.

### B5. Deploy the two Edge Functions (staff creation and account status)
In the project folder:
```
npx supabase@latest login
npx supabase@latest link --project-ref ref
npx supabase@latest functions deploy create-staff-user
npx supabase@latest functions deploy set-account-status
npx supabase@latest secrets set ALLOWED_ORIGINS=https://USER.github.io
```
Notes:
- `login` opens a browser to authorise the CLI. `ref` is the project reference from B4. It asks for the database password you saved in B1 when linking.
- `ALLOWED_ORIGINS` is the site **origin**: `https://USER.github.io` with **no path and no trailing slash**. For a custom domain add it comma-separated: `https://USER.github.io,https://feedback.example.com`. (Local testing adds `http://localhost:8080`.)
- If a deploy complains about Docker, add `--use-api` to the deploy command.
- Check: Supabase dashboard -> **Edge Functions** lists both functions; secrets list shows `ALLOWED_ORIGINS`. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically; never type the service key anywhere.

## Part C. Connect the frontend (5 minutes)
1. Open `js/supabase-client.js`. Replace `https://YOUR-PROJECT-REF.supabase.co` with your Project URL and `YOUR-ANON-KEY` with the anon key. Save.
2. Run the safety gate:
   ```
   node scripts/check-release.mjs
   ```
   It must print **`Release check passed.`** If it says "placeholder", step 1 was not saved. If it mentions a service-role key or a JWT with another role, you pasted the wrong key: remove it.
3. (Recommended) Test locally first with `node scripts/serve.mjs` and open `http://localhost:8080/`. Add `http://localhost:8080` to the Supabase Redirect URLs and to `ALLOWED_ORIGINS` for this (see `LOCAL_TESTING.md`). Never open the HTML files by double-clicking; they must be served over http.

## Part D. GitHub Pages frontend (10 minutes)
1. github.com -> **New repository**: name REPO, **Public**, do **not** add a README or .gitignore (the project has them). Create.
2. In your terminal, in the project folder (it already contains a git history):
   ```
   git remote add origin https://github.com/USER/REPO.git
   git branch -M main
   git push -u origin main
   ```
   (GitHub asks you to sign in. Use a Personal Access Token as the password, or GitHub Desktop / `gh auth login`.)
   If you changed `js/supabase-client.js`, commit it first: `git add -A` then `git commit -m "Configure Supabase"` then push.
3. Repository **Settings -> Pages -> Build and deployment -> Source: GitHub Actions**.
4. Open the **Actions** tab. The run "Deploy to GitHub Pages" starts by itself (re-run it from there if it started before you set the Source). Wait for a green tick (1-2 minutes). It first runs the release gate, so it refuses to publish if secrets or placeholders are present.
5. Your site is live at `https://USER.github.io/REPO/`. Open it: you should see the home page with **Submit Feedback** and **Submit Anonymously**.
6. Go back to Supabase **Authentication -> URL Configuration** and confirm the Site URL and Redirect URLs match this exact address (B3), and that `ALLOWED_ORIGINS` matches `https://USER.github.io` (B5).

## Part E. Finish and verify (15 minutes)

### E1. First administrator
1. On the live site: **Customer login -> Create an account**, register with your email, click the link in the confirmation email.
   (No email arrives? Supabase dashboard -> Authentication -> Users -> **Add user** with "Auto confirm" ticked.)
2. Supabase **SQL Editor**, run (replace the email):
   ```sql
   update public.profiles set role = 'administrator' where email = 'you@example.com';
   ```
3. Go to `https://USER.github.io/REPO/staff/login.html` and sign in. You land on the Admin dashboard.

### E2. Staff accounts
Admin -> **Users -> + ADD USER**: create one manager and one employee (work email, a temporary password of 10+ characters with letters and numbers). Share the temporary password securely; staff can change it with **Forgot Password?**.

### E3. Walk through the whole system (tick each)
- [ ] Register a customer, confirm the email, log in, **Submit Feedback** with a PNG or PDF attachment. A reference `NYO-YYYYMMDD-XXXXXXXX` appears.
- [ ] Log out. On the home page click **Submit Anonymously**, submit without logging in. A reference appears.
- [ ] Manager (staff login): **Assignments** shows both cases; the anonymous one lists the customer as **Anonymous User**. Assign them to the employee.
- [ ] Employee: sees only their assigned cases. Start one, add a reply, resolve it with details.
- [ ] Customer: sees only their own feedback, the new status and the reply (not internal notes). The anonymous case is not in their list.
- [ ] Administrator: dashboard numbers match; **Reports** for this month shows the cases; **EXPORT CSV** opens in Excel (names only, no email/phone); **Users** shows all accounts; **Audit Logs** shows assignments, role changes and report exports.
- [ ] Deactivate the employee in Users: that employee can no longer sign in.
- [ ] Wrong-door checks: a customer opening `admin/dashboard.html` is sent away; the staff login rejects the customer account and the customer login rejects staff.
- [ ] Phone: open the site on a phone; pages fit the screen.

### E4. Before real users arrive
- Confirm **Confirm email** is ON and custom SMTP is set (B3).
- Decide whether to keep anonymous feedback on. To switch it off at any time: `update public.system_settings set value='false'::jsonb where key='anonymous_feedback_enabled';`
- Project Settings -> Database: note that backups are daily on paid plans only; export data periodically if it matters.

---
## Updating the live site later
- **Frontend change:** edit files, then `git add -A`, `git commit -m "message"`, `git push`. The workflow redeploys automatically.
- **Database change:** a new `.sql` file in `supabase/migrations/` is run once in the SQL Editor, in order, after the earlier ones. Never edit an old migration that has already run.
- **Function change:** `npx supabase@latest functions deploy <name>`.
- **Roll back the site:** Actions -> pick an earlier green run -> **Re-run**, or `git revert` the bad commit and push.
- **Change the repository name or domain:** update Site URL, Redirect URLs and `ALLOWED_ORIGINS` together.

## Troubleshooting
| Symptom | Likely cause and fix |
|---|---|
| Page stays on "Loading..." or a yellow banner appears | Opened as a file, or files missing. Use the https address or `node scripts/serve.mjs`; push the whole project including `js/` and `assets/` |
| "The backend is not configured" | Placeholders still in `js/supabase-client.js`; redo C1 and push |
| Actions run fails at "Refuse to publish..." | The release gate found placeholders, a secret key or an external script; read its message |
| Actions run is green but the site is 404 | Settings -> Pages Source must be **GitHub Actions**; re-run the workflow |
| Registered but no email | Built-in email limit or Confirm email; add SMTP (B3) or auto-confirm the user (E1) |
| Email link opens the wrong site | Site URL / Redirect URLs (B3) |
| Lists are empty for the administrator | Role not set (E1 step 2) or a migration did not run (B2) |
| Anonymous form says "unavailable" or errors | Migration 9 not run, or the switch is off (E4) |
| + ADD USER shows a network or CORS error | Functions not deployed, or `ALLOWED_ORIGINS` differs from the site origin (no path, no trailing slash) |
| "Only administrators can..." | Signed in as a different role |
| Supabase CLI cannot link | Run `login` first; check `ref`; use the database password from B1 |

## Security reminders
- The only secret is the **service_role** key. It lives only inside Supabase. If it is ever pasted into a file, a commit or a chat, rotate it immediately (Project Settings -> API).
- Keep **Confirm email** on in production and give staff strong temporary passwords.
- Do not weaken Row Level Security to "fix" an error: send me the error instead.
