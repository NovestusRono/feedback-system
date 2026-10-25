# Nyota Electronics - Centralised Feedback Management System

Web-based system where customers submit complaints, compliments and suggestions, a manager assigns each case to an employee, the employee resolves it, and the administrator monitors everything and produces reports.

**Stack:** HTML5, CSS3, Bootstrap 5, vanilla JavaScript (ES modules), Chart.js, Supabase (Auth, PostgreSQL with Row Level Security, private Storage, Edge Functions). Hosted as a static site on GitHub Pages. No build step.

## Roles
| Role | Can do |
|---|---|
| Customer | Register, log in, submit feedback with a 1-5 rating and attachments, track **only their own** feedback and the replies meant for them |
| Manager | See all feedback, assign and reassign it to employees |
| Employee | See **only cases assigned to them**, start work, reply, resolve with details |
| Administrator | Dashboard, all feedback (read-only), reports and CSV export, user management, audit logs |

Workflow: `Pending -> (manager assigns) -> In Progress (employee starts) -> Resolved (employee resolves)`.
Staff accounts are created only by an administrator (Edge Function). Customers cannot choose or change their role.

## Folder map
```
index.html, forgot-password.html, reset-password.html   public pages
customer/ staff/ admin/ manager/ employee/              pages per role (staff/login.html is the staff portal)
js/                 shared modules (auth, permissions, navigation, feedback, reports, ...)
assets/css/app.css  one stylesheet (design tokens from the approved wireframes)
supabase/           migrations (SQL), Edge Functions, config, supabase/README.md
tests/              database, Edge Function and UI tests (tests/README.md)
scripts/            check-release.mjs (pre-deploy gate), run-all-tests.sh
design-reference/   the approved wireframes used as the visual source of truth
MILESTONE*_REPORT.md  what was built and verified in each milestone
```

## Set up in 6 steps (details in [DEPLOYMENT.md](DEPLOYMENT.md))
1. Create a Supabase project. Apply `supabase/migrations/*.sql` in order.
2. Put the project URL and **anon** key in `js/supabase-client.js`.
3. Create the first administrator with the SQL in `supabase/README.md`.
4. Deploy the two Edge Functions and set the `ALLOWED_ORIGINS` secret.
5. Configure Auth (site URL, redirect URLs, email confirmation).
6. Push to GitHub, enable Pages (Source: GitHub Actions). The workflow refuses to publish if secrets are present or the backend is unconfigured.

## Testing
`scripts/run-all-tests.sh` runs everything (needs PostgreSQL, `npm i pg playwright`, Node 22.18+). See [tests/README.md](tests/README.md). Status at Milestone 10: database 229, Edge Function logic 12, UI 85+48+37+48+53+56+79, all passing. These run against a real PostgreSQL with a Supabase stub and a stubbed supabase-js, so [DEPLOYMENT.md](DEPLOYMENT.md) section "Verify on the real project" is still required after you connect your own Supabase project.

## Security summary
See [SECURITY.md](SECURITY.md). In short: Row Level Security is the real enforcement, the service-role key never reaches the frontend, workflow changes only go through audited database functions, attachments are private with 60-second links, and every dynamic value is escaped.
