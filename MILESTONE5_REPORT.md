# Milestone 5 report: confirmation and customer tracking

## Completed
- **My Feedback** (`customer/dashboard.html`): table in the wireframe 2.2.7 style (Reference, Type, Subject, Status badge, Submitted, VIEW), search by reference or subject, Type and Status filters, 10 per page, empty state that invites the first submission.
- **Feedback details** (`customer/details.html?id=`): reference, status, type, subject, rating, optional product fields, description, a Submitted / In Progress / Resolved progress bar, the resolution (only when Resolved), customer-visible responses in order, attachments opened through 60-second signed links.
- **Updates panel:** unread in-app notifications (e.g. "now In Progress"), with Mark all as read; opening a case marks its updates read.
- **Confirmation page** was delivered in M4 (wireframe 2.2.4, reference read back from the database).
- Helpers in `js/dashboard.js` (badges, Nairobi-time dates), tracking functions in `js/feedback.js`. Styles for tables, badges and detail views are shared, ready for M6-M8.

## What a customer can and cannot see
- Sees: their own feedback, customer-visible responses, the resolution text, their own attachments and notifications.
- Never sees: internal notes, who is assigned, staff names, status history (the database denies these; the page also never asks for them). Responses are labelled "Responses from Nyota Electronics".
- Other people's cases: opening a foreign or unknown id shows "not found" (RLS returns nothing).

## Tests
- `tests/ui/tracking.test.js`: **37 checks** (columns, pagination, search, combined filters, escaping, empty state, updates, three status views, internal notes excluded, signed-link request, failed link, bad ids, staff/signed-out redirects, 375px).
- Earlier suites still pass: M4 48, M3 85, Edge Functions 12, database 159.

## Caveats
1. The timeline shows exact times only for Submitted and Resolved; customers cannot read the status history table (by design), so the In Progress time is not shown.
2. Search is on the loaded list (latest 500). Customers with more than 500 submissions would need server-side search; unlikely.
3. Tests use the stubbed Supabase SDK. The real signed-link and notification round trips are checked in Milestone 10.
4. There are no customer wireframes for the list and details pages; I derived them from the staff table and details wireframes (as agreed).

## Next
Milestone 6: administrator dashboard (4 wireframe cards plus the second row), feedback management list and details with filters.
