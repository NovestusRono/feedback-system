# Anonymous feedback (post-Milestone 10 change request)

**Request:** visitors can submit feedback without registering or logging in; staff see the customer as "Anonymous User".

## What changed
- Migration 0900: `feedback.is_anonymous`, nullable `customer_id` with a CHECK tying them together, `submit_anonymous_feedback()` and `anonymous_form_options()` (both callable by `anon`), updated insert/update triggers, `notify_user` ignores a null recipient, `list_feedback` and `report_rows` show "Anonymous User" (and search finds it). Settings `anonymous_feedback_enabled` and `anonymous_max_per_hour`.
- `customer/anonymous.html` (public page, same form design as the customer form, plus an explanation panel). Home page and customer login page link to it.
- Staff views (admin, manager, employee lists and case details, history, CSV, reports) show "Anonymous User" with no contact details.

## Decisions I made (tell me if you want them different)
1. **No tracking or replies.** With no account there is no safe way to look it up again, and storing an IP or email would defeat "anonymous". The sender is shown the reference number once.
2. **No attachments**, no "who served you" (staff names would be public), no response method, no receipt number on the anonymous form.
3. **A logged-in customer using the anonymous form is not linked** to the submission.
4. **Abuse protection** is a honeypot, strict validation, a 2-minute duplicate guard, a global cap of 30 per hour and an administrator off-switch. A CAPTCHA is the stronger option if spam appears.
5. The label is "Anonymous User".

## Tests
Database 282/282 (was 229; +53), anonymous UI 32/32, all earlier suites unchanged and green (auth 85, submit 48, tracking 37, admin 48, manager 53, employee 56, admin-m9 79, functions 12).
Not verified on a real Supabase project: re-run migration 0900 there and use the new checklist line in `DEPLOYMENT.md`.
