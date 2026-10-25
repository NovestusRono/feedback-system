# Milestone 2 report: Supabase setup and database schema

## Completed
- Schema for 9 tables, constraints and indexes (rating 1–5, status/role/type checks, unique reference, one current assignment per feedback, Resolved requires resolver, time and details).
- Triggers: profile creation on sign-up (always customer), role/status guard with last-administrator protection, forced Pending status and server-generated reference, duplicate-submit guard (2 minutes), identity fields immutable, attachment limits, audit and status history.
- Six workflow RPCs (assign, start, respond, resolve, two employee lists), all SECURITY DEFINER with pinned `search_path`.
- RLS on every table, default deny, `anon` has nothing. Private storage bucket with policies.

## Files
`supabase/migrations/20261024000100…0500` (5 files), `supabase/README.md`, `tests/db/00_supabase_stub.sql`, `tests/db/rls.test.js`, `tests/README.md`, `.env.example`, `.gitignore`, `MILESTONE1_AUDIT.md` (decisions section added).

## Testing
159 checks, 0 failures, on real PostgreSQL 16 with a Supabase stub. They cover sign-up role smuggling, privilege escalation, customer isolation, employee-only-assigned access, manager assignment with preserved history, resolution requirements, deactivation, last-admin guard, 55 unique references including 30 concurrent, attachment limits, and storage policies.
Limitation: this is an emulation. Re-run against a real Supabase project (four test accounts) in Milestone 10.

## Assumptions to confirm
1. Assigning leaves status Pending; the employee sets In Progress. (The prompt is ambiguous. Say if you want assignment to move the case to In Progress.)
2. `resolution_details` is customer-visible; internal notes are not.
3. Managers can read feedback rows; reports are admin-only through Milestone 9 functions.
4. Employees can see contact details of customers on their currently assigned cases.
5. Administrators cannot assign (manager-only, per the permission matrix).

## Outstanding
Edge Function for staff creation and account banning (M3), frontend (M3–M8), reports functions (M9), About/Help content, wireframe window-frame decision.

Not committed: no git repository exists yet. Tell me if you want me to initialise one and commit per milestone.
