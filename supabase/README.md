# Supabase backend (Nyota Feedback System)

## Setup
1. Create a Supabase project. Auth > Providers: enable Email. (Optionally require email confirmation.)
2. Apply the migrations in order (SQL Editor, or `supabase db push`):
   `20261024000100_core_schema.sql` → `…0200_helpers_and_triggers.sql` → `…0300_workflow_functions.sql` → `…0400_rls_policies.sql` → `…0500_storage.sql` → `…0600_staff_overview.sql` → `…0700` (list_feedback assignment filter) → `…0800_admin_reports_users_audit.sql` → `…0900_anonymous_feedback.sql`
3. Copy the project URL and **anon** key into the frontend config (see `/.env.example`). Never use the service-role key in the frontend.
4. Create the first administrator: sign up normally (or Auth > Users > Add user), then in the SQL Editor:
   ```sql
   update public.profiles set role = 'administrator' where email = 'you@example.com';
   ```
   This works because the SQL editor is a trusted context (`auth.uid() is null`). Browser users can never change roles.
5. Other staff accounts are created by an administrator through an Edge Function (Milestone 3).

## Security model
- Role lives only in `public.profiles.role`. Sign-up metadata is ignored (`handle_new_user` always creates a customer).
- RLS is on for every table; `anon` has no table access. Clients have no UPDATE/DELETE on `feedback`.
- Assignment, status, responses and resolution change only through the SECURITY DEFINER functions below.
- "Trusted context" = `auth.uid() is null` (SQL editor, migrations, service-role Edge Function).
- Managers can read feedback rows (needed to assign). "No reports for managers" is enforced by admin-only report functions (Milestone 9) and no manager report pages.

## Tables
| Table | Purpose |
|---|---|
| profiles | One row per auth user: names, email, phone, role, account_status |
| feedback | Customer submissions; reference `NYO-YYYYMMDD-XXXXXXXX`; status Pending / In Progress / Resolved; resolution fields |
| feedback_assignments | Assignment history; one current row per feedback (partial unique index) |
| feedback_responses | Employee responses; visibility `customer` or `internal` |
| feedback_status_history | Every status change |
| audit_logs | Security/workflow events (admin read only, no message bodies) |
| feedback_attachments | Attachment metadata (files live in the private `feedback-attachments` bucket) |
| notifications | In-app notifications; users may only mark their own as read |
| system_settings | Attachment limits, categories, minimum resolution length |

## SECURITY DEFINER functions (all `set search_path = ''`, fully qualified names)
Helpers (read-only role checks, executable by signed-in users): `current_app_role`, `is_administrator`, `is_manager`, `is_employee`, `is_customer`, `is_staff`, `is_assigned_to_me(uuid)`, `can_view_feedback(uuid)`.
Internal (not executable by clients): `log_audit`, `notify_user`, `generate_reference_number`, `setting_int`, and the trigger functions.
Overview RPCs (migration 6; refuse anyone but an active administrator or manager): `dashboard_stats()` (counts, average rating, 30-day trend, Nairobi time) and `list_feedback(search, type, status, limit, offset, assignment)` (assignment: null, 'assigned' or 'unassigned' since migration 7; customer name and current assignee, LIKE wildcards escaped, page size capped at 100). They return counts and list rows only.

Administrator-only functions (migration 8; every one starts with `require_administrator()`, so managers, employees, customers and anonymous callers are refused): `report_summary(from, to)` (totals, type/status counts, ratings, average resolution time, category and per-employee breakdowns, daily trend; Nairobi-time day bounds; range limited to 366 days), `report_rows(from, to)` (one line per feedback for CSV, customer *name* only, no email/phone/description, capped at 10,000 rows), `list_users(search, role, status, limit, offset)`, `list_audit_logs(action, limit, offset)` and `log_admin_event(action, metadata)` (whitelisted to `report_generated`, `report_exported`, `report_printed`, and stores only the from/to dates, so it cannot forge other audit entries). All are SECURITY DEFINER with `set search_path = ''`.
Workflow RPCs (signed-in only, each re-checks the caller's role and locks the row):
- `list_servable_employees()`: active employees' first names for the "served by" dropdown.
- `list_assignable_employees()`: manager/admin; employees with open case counts.
- `assign_feedback(feedback, employee, note)`: manager only; closes the previous assignment, keeps history, notifies.
- `start_feedback(feedback, note)`: the assigned employee; Pending → In Progress.
- `add_feedback_response(feedback, text, visibility)`: the assigned employee; not once Resolved.
- `resolve_feedback(feedback, details, customer_response, internal_note)`: the assigned employee; must be In Progress; details required.

## Storage
Private bucket `feedback-attachments`, 5 MB, JPEG/PNG/PDF. Path `<customer_uid>/<feedback_id>/<random>.<ext>`. Customers upload only to their own folder; reads follow feedback visibility; no update/delete.

## Tests
`tests/db/rls.test.js` applies the migrations to a scratch PostgreSQL with a Supabase stub and attacks them as every role. See `tests/README.md`.

## Authentication settings (Dashboard > Authentication)
- Providers: Email enabled. Keep "Confirm email" on for customers (recommended).
- URL Configuration: Site URL = your GitHub Pages URL (e.g. `https://<user>.github.io/<repo>/`). Add Redirect URLs: `.../customer/login.html` and `.../reset-password.html`.
- Password policy: minimum length 8 (the UI enforces a letter and a number as well).
- Staff are created by an administrator through the Edge Function, so they never need to confirm an email.

## Edge Functions (admin only; the service-role key never leaves Supabase)
| Function | Purpose |
|---|---|
| `create-staff-user` | Creates an auth user with a temporary password, then promotes the profile to administrator/manager/employee. Rolls back if the role cannot be set. Audited. |
| `set-account-status` | Activates/deactivates any account: updates `profiles.account_status` (RLS stops access at once) and bans/unbans the auth user (no new sessions). Cannot target yourself; the DB blocks deactivating the last administrator. Audited. |

Both verify the caller's JWT, then check in `profiles` that the caller is an active administrator. Browser users cannot do either action any other way.

```
supabase link --project-ref <ref>
supabase secrets set ALLOWED_ORIGINS=https://<user>.github.io
supabase functions deploy create-staff-user
supabase functions deploy set-account-status
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically; do not copy the service key anywhere else.

Calling from the app (Milestone 9 adds the screens): `sb.functions.invoke("create-staff-user", { body: { email, first_name, last_name, phone, role, temporary_password } })`.
Until then an administrator can call it with curl using their own access token.

## Anonymous feedback (migration 9)
Visitors can submit feedback without registering or logging in (`customer/anonymous.html`).
- `feedback.is_anonymous` is true exactly when `customer_id` is null (CHECK constraint). The row stores no IP address, user agent, email or account, so the sender can never be identified, tracked or answered.
- The only way to create such a row is `submit_anonymous_feedback(type, subject, description, rating, category, product_name, purchase_reference, website)` (SECURITY DEFINER, `search_path=''`, executable by `anon` and `authenticated`; staff are refused). It validates everything on the server, discards submissions whose honeypot field `website` is filled (returning a fake reference), refuses an identical resubmission within 2 minutes, and enforces `anonymous_max_per_hour` (default 30, across all visitors). A logged-in customer who uses it is **not** linked to the row.
- `anonymous_form_options()` (executable by `anon`) returns only `{enabled, categories}`.
- Administrators can switch the form off: `update public.system_settings set value='false'::jsonb where key='anonymous_feedback_enabled';` and change the hourly cap with `anonymous_max_per_hour`.
- Staff lists, details, reports and CSV show the customer as **Anonymous User** with no contact data. The normal workflow (assign, start, reply, resolve) works; nobody is notified because there is nobody to notify.
- Not offered to anonymous visitors: attachments, "who served you" (it would expose staff names publicly), purchase/receipt number and a response method.
- Trade-off: a global hourly cap stops floods but a determined attacker could use it up and block honest visitors for the hour. A CAPTCHA in front of the form is the stronger fix if abuse appears; the switch above is the emergency stop.
