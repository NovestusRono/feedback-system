# Milestone 3 report: authentication and role-based access

## Completed
- **Pages (preserving the approved wireframes):** homepage `index.html`, `staff/login.html` (work email + password, "Forgot Password?"), `customer/login.html`, `customer/register.html`, `forgot-password.html`, `reset-password.html`, and four role dashboards (`admin/`, `manager/`, `employee/`, `customer/dashboard.html`) inside the navy sidebar + top-bar shell.
- **JS modules:** `supabase-client.js`, `auth.js`, `permissions.js`, `navigation.js`, `validation.js`.
- **Rules implemented**
  - Customers self-register; sign-up sends names and phone only, never a role (the database forces `customer`).
  - Separate portals: staff cannot use the customer portal and customers cannot use the staff portal; the wrong-portal session is cleared immediately.
  - Deactivated or profile-less accounts are refused and signed out; a live session of a deactivated user is thrown out on the next page load.
  - Every protected page is hidden until the role check passes; wrong role goes to that user's own dashboard; signed-out visitors go to the right login with a safe `next` (same-site `.html` paths only).
  - Neutral messages: wrong password and unknown email read the same; password reset and duplicate sign-up do not reveal whether an email exists.
  - Menus per role; pages not built yet show as disabled "soon" items, so there are no dead links. Managers and employees never see Reports or Users.
  - All dynamic text is escaped (a profile name containing HTML is shown as text).
- **Edge Functions** (admin-only, service key server-side): `create-staff-user`, `set-account-status` (with auth ban/unban, rollback and audit).
- `supabase/README.md` updated (auth settings, deploy steps); `supabase/config.toml`.

## Tests (all passing)
- UI: **85 checks** (login/portal separation, 14 cross-role guard cases, redirect-injection attempts, registration validation and payload, reset flow, XSS, logout, 375px layout).
- Edge Functions: **12 tests** (non-admin and deactivated admin refused, validation, duplicate email, rollback on role failure, CORS, ban failure rollback, self-change blocked).
- Database: 159 checks from Milestone 2 still apply.
- Visually checked the staff login, homepage and admin shell against the wireframes.

## Limits and honest caveats
- UI tests use a stubbed Supabase SDK. They prove page logic, not the real service. The real round trip (sign-up e-mail, real JWTs, deployed functions) is tested once you create the Supabase project; I will include that in Milestone 10.
- The Edge Function code is tested through its handler with fakes. I could not run Deno here, so the thin `index.ts` wiring has not been executed.
- Client guards are usability only. Real protection is RLS and the database functions (tested in Milestone 2).
- There is no admin screen for creating staff yet (Milestone 9); until then use the function with curl.
- Staff get a temporary password set by the admin. There is no forced change at first login yet; staff can use "Forgot Password?" to set their own. Tell me if you want a forced change.
- Homepage "About" and "Help" are shown disabled: I have no content for them.
- "Submit Feedback" on the homepage leads to customer login for now; the form arrives in Milestone 4.

## Assumptions to confirm
1. Password rule: 8+ characters with a letter and a number (customers), 10+ for staff temporary passwords.
2. Footer links "Customer login | Staff login" added to the homepage (the wireframe has no other way to reach the staff portal).
3. Password reset pages sit at the site root, shared by both portals.

## Next
Milestone 4: homepage polish and the feedback submission form (type, subject, description, 1-5 rating, served-by dropdown, optional attachments).
