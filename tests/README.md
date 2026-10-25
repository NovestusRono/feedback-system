# Tests
## Database / RLS (`tests/db`)
Needs a local PostgreSQL 14+ and the `pg` npm package. The test creates and drops a database named `nyota_test`.
```
npm i pg
PGHOST=/path/to/socket-or-host PGPORT=5432 PGUSER=postgres node tests/db/rls.test.js
```
`00_supabase_stub.sql` emulates the Supabase roles, `auth` and `storage` schemas. It is not used in production.
Final real-project verification with four test accounts happens in Milestone 10.

## Edge Function logic (`tests/functions`)
`node --test tests/functions/handlers.test.mjs` (Node 22.18+). Uses fake dependencies: role checks, validation, rollback, CORS, audit.

## UI (`tests/ui`)
`node tests/ui/auth.test.js` (needs `npm i playwright` and a Chromium). Serves the repo locally and replaces supabase-js and the vendored libraries with stubs, so it tests page logic (login, registration, guards, redirects, navigation, mobile layout), not the real backend.
`node tests/ui/submit.test.js` covers the feedback form, attachments and confirmation page.
`node tests/ui/tracking.test.js` covers the My Feedback list, filters, updates and details page.
`node tests/ui/admin.test.js` covers the administrator dashboard, feedback management and details.
`node tests/ui/manager.test.js` covers the manager dashboard, lists, assignment queue and assign/reassign.
`node tests/ui/employee.test.js` covers the employee dashboard, assigned list, start, respond and resolve.
`node tests/ui/admin-m9.test.js` covers reports (presets, validation, charts, CSV export and formula guard, print), user management (filters, add, edit role, activate/deactivate, self-protection) and audit logs.
