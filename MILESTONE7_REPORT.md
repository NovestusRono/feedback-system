# Milestone 7 report: manager dashboard and assignment

## Completed
- **Manager dashboard:** cards (Total, Pending, In Progress, Resolved), "Awaiting assignment" queue (newest 5 unassigned, with an Assign button and a count of the rest). No charts and no report links.
- **All Feedback** (`manager/feedback.html`): the same list as the administrator, plus an Assignment filter (All / Unassigned / Assigned) kept in the address bar.
- **Assignments** (`manager/assignments.html`): the unassigned queue (filter locked) and a Team workload table (each active employee's open cases).
- **Case details with assignment** (`manager/feedback-details.html`): full case view (internal notes included, as managers may see them), and an Assign / Reassign form: choose an active employee (open-case counts shown, current assignee disabled), optional note up to 500 characters. On success the page refreshes and shows who it is assigned to; history keeps every earlier assignment. Resolved cases show no form.
- **Migration 7:** `list_feedback` gets the assignment filter (old signature dropped, privileges re-granted).
- Shared pieces: `js/case-view.js` (one case renderer for admin and manager), `js/assignments.js`. The administrator's details page now uses the same renderer and remains read-only.

## Rules enforced (database; the page only reflects them)
- Only an active manager can assign (administrators, employees and customers are refused: tested in M2 and re-tested through the UI path).
- Target must be an active employee; the same employee twice, and resolved cases, are rejected; the previous assignee immediately loses access; both employees are notified.
- Friendly messages for each rejection; internal database wording never reaches the page.

## Tests
- Database: **185 checks** (5 new for the assignment filter).
- UI: `tests/ui/manager.test.js` **53 checks** (dashboard, queue, filters, URL state, assign/reassign payloads, six error messages, resolved and empty-team states, internal notes, 12 cross-role redirects, 375px).
- Earlier suites still pass: admin 48, tracking 37, form 48, login/guards 85, Edge Functions 12.
- Checked the manager details page visually.

## Caveats and assumptions
1. Assignment keeps the status Pending until the employee starts the case (decision from M2, still open for your confirmation). The manager list will therefore show an assigned case as Pending with an assignee.
2. There is no manager wireframe in the document set; the screens reuse the administrator dashboard and list styles.
3. A manager cannot unassign without reassigning (not in the requirements). Tell me if you want an Unassign action.
4. Real-project verification (live JWTs, real RPC round trips) happens in Milestone 10.

## Next
Milestone 8: employee dashboard, "My Assigned Feedback" list, start work, add response, resolve with required resolution details.
