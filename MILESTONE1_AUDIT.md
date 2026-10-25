# Milestone 1: Repository Audit and Existing UI Preservation

Project: Nyota Electronics Centralised Web-Based Feedback Management System
Status: **Audit complete. No application code was changed.** Waiting on the decisions in section 8 before Milestone 2.

---

## 1. Headline findings

1. **There is no existing GitHub repository or original front-end source in this workspace.** The only code here is a functional prototype I generated earlier in this conversation. It was built *before* I had looked at the approved wireframes.
2. **That prototype does not match the approved UI.** It uses a top navbar and default Bootstrap look, with a different palette (`#14213d` / `#fca311`). The approved design uses a dark left sidebar, a blue top bar, and navy/amber (`#1b2a4a` / `#e8a33d`). Under rule 10 of the master prompt, I am treating the **approved wireframes in Milestone 2 (Figures 2.2 to 2.10)** as the source of truth. I have not claimed the prototype is "the existing UI".
3. **The prototype's behaviour also conflicts with the master prompt** (see section 6): guests can submit without an account, managers can see reports, the status names differ, and there is no rating, audit log or assignment history. Its visual layer should be replaced, and its database schema redone.
4. **The approved wireframes cover only 9 of the screens the master prompt needs.** Customer login/register, customer history/tracking, manager and employee dashboards, staff forgot-password, staff registration, service ratings, system logs, settings, About and Help have no approved design. They will have to be derived from the existing components. I list them for your approval in section 5.

## 2. What I inspected

| Source | Result |
|---|---|
| `Milestone2_Project_Design.docx` | All 19 figures extracted. Wireframes for 2.2.2 to 2.2.10 reviewed, plus Fig 2.1 (navigation), 2.15 (use case), 2.19 (ERD). Copies saved in `design-reference/`. |
| Proposal (`Centralised Feedback Management System - Copy.docx`) | Read in full. Describes the original PHP/MySQL stack, which the master prompt now replaces. |
| Master project prompt | Read in full. |
| GitHub repository | **Not provided.** No `.git` directory, no remote, no HTML/CSS from a prior build. |
| Prototype in `nyota-feedback/` | 27 files, about 1,500 lines. Inventoried in section 6. |

## 3. Approved design tokens (measured from the wireframes)

| Token | Value | Where it appears |
|---|---|---|
| Navy | `#1b2a4a` | Title/top chrome, sidebar, headings, table header text, logo disc, primary text |
| Top bar blue | `#2e4372` | Bar under the title containing "Logout" and "Admin ▾" |
| Amber | `#e8a33d` | Primary buttons (SUBMIT, SEARCH, VIEW, UPDATE, GENERATE), active sidebar item, In Progress pill |
| Page background | `#f4f6fa` | App background |
| Hero panel | `#eef2fa` | Homepage hero card |
| Red | `#d95f5f` | Pending pill, Complaint stat bar |
| Green | `#3fa772` | Resolved pill, Compliment stat bar, success tick |
| Link blue | approx. `#3b7ab5` (eyeballed, not sampled) | "Forgot Password?", "Edit" |
| Muted grey | approx. `#8a93a6` | Sub-headings, placeholder text |
| Type | Sans-serif (looks like DejaVu Sans/Verdana in the renders), bold uppercase page titles | |
| Shapes | Rounded rectangles (about 8px) on buttons, inputs and cards; fully rounded pills for status | |

The traffic-light dots and window title bar in each figure are the wireframe's mock "browser window" frame. I intend to treat them as presentation, not as part of the app (see Q5).

## 4. UI preservation checklist

This is what the build must match. Each item is checked again at the end of every milestone.

- [ ] Dark navy left sidebar with the amber active-item highlight (Dashboard, Feedback, Users, Reports, Settings).
- [ ] Blue top bar with right-aligned "Logout" and "<Role> ▾" menu.
- [ ] Uppercase bold navy page titles.
- [ ] Stat cards: white, light border, thick coloured left bar, big number, small uppercase label.
- [ ] Status pills: Pending red, In Progress amber, Resolved green.
- [ ] Tables: light grey header row, thin row dividers, amber VIEW buttons, blue "Edit" text links.
- [ ] Amber filled buttons for primary actions; light grey for secondary (EXPORT CSV, CLOSE).
- [ ] Homepage: wordmark left, **Home / About / Help** right, hero card with SUBMIT FEEDBACK and "Complaints • Compliments • Suggestions", footer "© 2026 Nyota Electronics".
- [ ] Feedback form field order and labels: Full Name, Phone Number, Email Address, Feedback Type (radios), Subject, Description, Attachment, SUBMIT FEEDBACK.
- [ ] Confirmation: green tick, "Feedback Submitted Successfully", navy pill with the reference, "Please keep this number for future reference.", RETURN HOME.
- [ ] Staff login: "NE" navy disc, NYOTA ELECTRONICS, "Feedback Management System", amber LOGIN, "Forgot Password?" link.
- [ ] Dashboard: Feedback Trend (line/area, amber) and By Category (doughnut), then RECENT FEEDBACK table.
- [ ] Reports: Report Type, Start Date, End Date, GENERATE REPORT, three result cards, category breakdown bars, EXPORT CSV, PRINT REPORT.
- [ ] Users: "+ ADD USER" button, Name / Username / Role / Status / Action table.
- [ ] Responsive on desktop, tablet and phone (sidebar collapses on small screens).

## 5. Page-to-section mapping

| Section | Page | Approved design | In prototype today | Plan |
|---|---|---|---|---|
| 2.2.2 | Homepage | Yes (Fig 2.2) | `docs/index.html`, wrong look | Rebuild to wireframe; add **Staff Login** after Help |
| 2.2.3 | Feedback submission | Yes (Fig 2.3) | `submit.html`, wrong look, guest allowed | Rebuild; add rating 1 to 5, "served by", category, product, preferred response method |
| 2.2.4 | Confirmation | Yes (Fig 2.4) | Inline panel in submit page | Own page; add Copy, Track, date and Pending status |
| 2.2.5 | Staff login | Yes (Fig 2.5) | `login.html`, different design | Rebuild to wireframe; **Username field → work email (Q3)** |
| 2.2.5.1 | Staff forgot password | **No wireframe** | Partly (customer + staff mixed) | Derive from the login card; **needs approval** |
| 2.2.5.2 | Staff registration | **No wireframe** | None (role edit only) | Derive from login card + Add User; needs Edge Function |
| 2.2.6 | Admin dashboard | Yes (Fig 2.6) | `staff/dashboard.html`, wrong look | Rebuild; keep the four stat cards, add Pending / In Progress / Resolved / Avg rating (Q4) |
| 2.2.7 | Feedback management | Yes (Fig 2.7) | `staff/feedback.html` | Rebuild; add pagination, sorting, date filter, assignment column |
| 2.2.8 | Feedback details | Yes (Fig 2.8) | `staff/details.html` | Rebuild; add history, internal notes vs customer response, resolution |
| 2.2.9 | Reports | Yes (Fig 2.9) | `staff/reports.html` | Rebuild; **admin only** |
| 2.2.10 | User management | Yes (Fig 2.10) | `staff/users.html` | Rebuild; Add User, Edit, filters |
| not in 2.2.x | Customer login / register | **No wireframe** | `login.html` tabs | Derive from staff login card; needs approval |
| not in 2.2.x | Customer My Feedback / Track | **No wireframe** | `account/index.html`, `track.html` | Derive from table + status-pill components; needs approval |
| not in 2.2.x | Manager dashboard + assignments | **No wireframe** | None | Reuse admin dashboard layout with a manager sidebar |
| not in 2.2.x | Employee dashboard + assigned feedback | **No wireframe** | None | Reuse the same layout with an employee sidebar |
| Fig 2.1 | Settings, Profile, Service Ratings, System Logs | **No wireframe** (Settings and Profile only appear in the nav tree and sidebar) | None | Derive from existing components; needs approval |
| 2.2.2 | About, Help | **No wireframe or content** | None | Need your content or approval for simple placeholder pages |

## 6. Prototype inventory and what to keep

| Area | Files | Verdict |
|---|---|---|
| Visual layer | `docs/css/style.css`, all `*.html` | **Replace.** Does not match the approved UI. |
| Auth guards, role redirects | `js/auth.js`, `pages/login.js` | **Keep the logic**, restyle. Needs redo for 4 roles with Pending-workflow and the admin-only rules. |
| Escaping, CSV injection guard, busy buttons | `js/ui.js`, `pages/reports.js` | **Keep.** |
| Database | `supabase/schema.sql` | **Redo.** See below. |
| Test harness (mocked Supabase + Playwright) | scratch folder | Keep as the basis for `tests/`. |

Where the prototype contradicts the master prompt:

| Master prompt | Prototype |
|---|---|
| Customers must register and log in to submit | Guests can submit and track by contact details |
| Status: Pending → In Progress → Resolved | New / In Progress / Resolved / Closed |
| Only the **administrator** sees reports | Managers also see reports |
| Manager assigns; employee resolves; admin oversees | Admin and manager can both edit status |
| Employee must give resolution details to resolve | Any status change allowed |
| Staff are created by an admin through a secure server-side process | Admin promotes existing customer accounts |
| 1 to 5 service rating, "served by" employee, category, product, response method | Not present |
| Assignment history, status history, audit logs, internal notes vs customer-visible responses | One current assignment, a single public/internal flag, no history, no audit |
| Reference format `NYO-YYYYMMDD-XXXXXXXX` (illustrative) | `NYT-YYYY-000001` |

## 7. Conflicts between the project documents

The Milestone 2 document, the proposal and the master prompt disagree in places. I have followed the master prompt for behaviour and the wireframes for appearance. These need your sign-off, and the documents should later be updated to match.

| Topic | Wireframes / Milestone 2 | Master prompt |
|---|---|---|
| Staff login field | "Username" | Work email |
| Reference format | `FB-2026-00125` (Fig 2.4/2.8) | `NYO-YYYYMMDD-XXXXXXXX` |
| Use-case diagram (Fig 2.15) | Admin assigns, updates status, categorises; Manager only views dashboard/monitors | Manager assigns; employee updates status; admin oversees |
| ERD (Fig 2.19) | 7 tables, one `USER` table with `password` and `username`, `DEPARTMENT` | `profiles` on Supabase Auth, plus assignments history, status history, audit logs, visibility on responses |
| Department | Filter on Fig 2.7, field on Fig 2.8 ("Electronics") | No department concept in the schema |
| Customer login | Customer portal has no login | Customer must register and log in |
| Dashboard cards | Total / Complaints / Compliments / Suggestions | Total / Pending / In Progress / Resolved / Avg rating |
| Stack | PHP, MySQL, XAMPP | HTML, Bootstrap, JS, Supabase |

## 8. Implementation plan (how features slot into the existing design)

- **Shared shell:** one CSS file defining the tokens in section 3 and the sidebar/top-bar layout, plus a small `navigation.js` that renders the correct sidebar per role (Admin: Dashboard, Feedback, Users, Reports, Settings; Manager: Dashboard, Feedback, Assignments; Employee: Dashboard, My Assigned Feedback; Customer: simple top bar like the homepage).
- **Structure:** follow the folder layout in section 20 of the master prompt (`customer/`, `staff/`, `admin/`, `manager/`, `employee/`, `js/`, `supabase/migrations/`). That puts `index.html` at the repository root, so GitHub Pages would serve from `/`, not `/docs`.
- **Database:** new migrations for `profiles`, `feedback`, `feedback_assignments`, `feedback_responses`, `feedback_status_history`, `audit_logs`, `attachments`, with RLS per the permission matrix, status changes through `SECURITY DEFINER` functions with pinned `search_path`, and DB-side checks (rating 1 to 5, resolution details required to resolve, employee only on own cases).
- **Staff creation:** a Supabase Edge Function (service key stays server-side) called only by authenticated admins. This is one of the cases where the prompt allows an Edge Function.
- **First administrator:** created in the Supabase dashboard, then promoted with a one-time SQL statement. Documented in the README. No public role selection.
- **Testing:** the mocked-Supabase harness gives UI checks. The RLS rules need testing against a real Supabase project with four test accounts, which means I will need you to create that project.

Milestones 2 to 10 then proceed in the order given.

## 9. Open questions

1. **Is there a real GitHub repository** with the original HTML/CSS for this design? If so, please share it. Otherwise I will build from the wireframes in `design-reference/`.
2. **Department:** keep it (as a table, matching the wireframes), or replace it with "product/service category"?
3. **Staff login identifier:** work email (master prompt) rather than "Username" (wireframe)?
4. **Admin dashboard cards:** keep the 4 wireframe cards and add a second row (Pending, In Progress, Resolved, Avg rating), or something else?
5. **Wireframe window frame** (traffic-light dots and the dark title bar): ignore as a mock-up frame (my assumption), or reproduce in the app?
6. **Reference format:** use `NYO-YYYYMMDD-XXXXXXXX` from the prompt, or `FB-YYYY-NNNNN` from the wireframes?
7. **Pages without wireframes** (section 5): approve deriving them from existing components? And do you have content for About and Help?

## 10. Decisions (recorded after review)

| # | Question | Decision |
|---|---|---|
| 1 | Existing repo? | None. Build from the wireframes in `design-reference/`. |
| 2 | Department | Follow the latest prompt: no departments table. Optional product/service category instead. |
| 3 | Staff login | Work email. |
| 4 | Admin dashboard cards | Keep the 4 wireframe cards, add a second row (Pending, In Progress, Resolved, Avg rating). |
| 5 | Wireframe window frame | Not answered. Assumed: ignore it (mock-up frame only). |
| 6 | Reference format | `NYO-YYYYMMDD-XXXXXXXX`. |
| 7 | Pages without wireframes | Not answered. Assumed: derive from existing components. About/Help content still needed. |
