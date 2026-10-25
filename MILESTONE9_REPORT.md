# Milestone 9 report: reports, user management, audit logs (administrator only)

## What was built
- **Migration 0800** (`supabase/migrations/20261024000800_admin_reports_users_audit.sql`): `report_summary`, `report_rows`, `list_users`, `list_audit_logs`, `log_admin_event`, plus helpers `require_administrator` and `report_bounds`. Documented in `supabase/README.md`.
- **admin/reports.html** (wireframe 2.2.9): Report Type (daily/weekly/monthly/yearly/custom), Start/End Date, GENERATE REPORT, the three wireframe cards (Total Feedback, Complaints, Resolved Complaints), the Feedback Category Breakdown bars, EXPORT CSV and PRINT REPORT. Additions beyond the wireframe: compliments/suggestions/average rating/average resolution cards, a per-day trend chart, a rating chart and an employee performance table.
- **admin/users.html** (wireframe 2.2.10): Name, Email (wireframe says Username; we sign in with email), Role, Status, Action "Edit", "+ ADD USER", search and role/status filters, paging.
  - Add user -> `create-staff-user` Edge Function (service-role key stays server-side).
  - Edit -> change a staff role (direct profile update; allowed by RLS for administrators only, audited by the database trigger) and activate/deactivate (`set-account-status` Edge Function).
  - You cannot change your own role/status; customers keep the customer role.
- **admin/audit.html**: audit log viewer (When, Who, Action, Details) with an action filter. Not in the wireframes, so it reuses the existing table, filter and pager components.
- Sidebar: Users and Reports are now live; "Audit Logs" added.

## Security
- All five new RPCs refuse anyone but an active administrator (verified for manager, employee, customer and anonymous). Helper functions are not callable by clients.
- CSV contains customer names only (no email, phone or description) and neutralises spreadsheet formulas (`= + - @`), with quotes and commas escaped.
- Report generation, export and print are written to the audit log through a whitelisted function that stores only the dates.
- Every dynamic value in the new pages is escaped; no secrets in the frontend.

## Tests (all green)
| Suite | Result |
|---|---|
| Database / RLS | 229 / 229 (was 185; +44 for reports, users, audit, refusals) |
| Edge Function handlers | 12 / 12 |
| UI admin-m9 (new) | 79 / 79 |
| UI auth / submit / tracking / admin / manager / employee | 85 / 48 / 37 / 48 / 53 / 56 |

Two older expectations changed on purpose: the admin menu now has five live items.

## Not verified / assumptions
- Still tested against stubs: real Supabase verification is Milestone 10.
- The Edge Function `index.ts` wiring has never been run (no Deno here).
- Role change uses a plain `confirm()` dialog (styled dialog is a later polish item).
- A reset of a staff member's password and a forced password change on first login are not built.
- Reports count feedback by **creation date**; "Resolved Complaints" are complaints created in the period that are now resolved.
