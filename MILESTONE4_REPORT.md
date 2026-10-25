# Milestone 4 report: homepage and feedback submission

## Completed
- **`customer/submit.html`** follows wireframe 2.2.3: Full Name, Phone, Email (filled from the account, read-only), Feedback Type radios (Complaint default), Subject, Description (4000 limit with counter), Attachment, SUBMIT FEEDBACK.
- **Added per the master prompt:** 1-5 star service rating (required), "Who served you?" (optional; first names of active employees only), product/service category (from `system_settings`), product name, receipt/order number, preferred response method.
- **Attachments:** up to 3 JPG/PNG/PDF, 5 MB each (limits read from settings). The browser checks type, size and the file's real signature; storage and database enforce the same limits again. Files go to the private bucket at `<customer id>/<feedback id>/<random>.<ext>`, so the original file name never appears in a path.
- **`customer/confirmation.html`** follows wireframe 2.2.4. The reference number is read back from the database (RLS: only the owner), never taken from the URL. (This is the first piece of Milestone 5; tracking remains for M5.)
- **Homepage:** "Submit Feedback" sends signed-out visitors to login and then straight to the form; signed-in customers go directly to the form. Registration keeps the destination.
- `js/feedback.js` holds options, validation, insert and upload logic.

## Security properties
- The browser sends only the 10 allowed columns. Status, reference number, customer id enforcement and resolution fields are set by the database (tested in M2: spoofed values are overridden).
- Duplicate submits: button disabled while sending, and the database rejects an identical submission within 2 minutes.
- Database errors are translated to plain messages; no policy or table names reach the user.
- All dynamic text (employee names, categories, file names) is escaped; stored file names are sanitised.
- A failed upload does not lose the feedback: the customer is told which file failed, with the reference number.

## Tests
- `tests/ui/submit.test.js`: **48 checks** (layout, prefilled read-only fields, validation, exact payload, double click, duplicate and RLS errors, 9 attachment cases, failed upload, confirmation page, entry flow from the homepage, 375px).
- Earlier suites still pass: M3 UI 85, Edge Function 12, database 159. The database suite already exercises the same insert, attachment and storage calls this form makes.
- Visually checked both pages against the wireframes.

## Caveats and assumptions
1. The form shows name, phone and email as read-only account details (the wireframe shows them as inputs). Customers cannot change them here; a profile page is not in the milestone plan. Tell me if you want them editable.
2. If an upload succeeds but its metadata row fails, an orphan file stays in storage (customers have no delete right by design). An admin cleanup can be added in M9 if wanted.
3. Rating is required and shown as stars; "Who served you?" lists first names only, to avoid exposing staff details.
4. Tests use the stubbed Supabase SDK; the real bucket round trip is verified in Milestone 10.

## Next
Milestone 5: confirmation is done; remaining is the customer tracking page (`My Feedback`: list, status, customer-visible responses, search by reference).
