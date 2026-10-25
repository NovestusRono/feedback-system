# Milestone 10 report: integration, security checks, deployment, documentation

## Delivered
- Root `README.md`, `DEPLOYMENT.md` (step-by-step plus a real-project verification checklist), `SECURITY.md` (control matrix and honest limits).
- `scripts/check-release.mjs`: blocks placeholders, service-role keys, non-anon JWTs and CDN assets without integrity hashes. Negative-tested with a planted fake service key.
- `.github/workflows/pages.yml`: runs the gate, publishes only website files to GitHub Pages.
- Subresource Integrity (SHA-384) on Bootstrap CSS, supabase-js and Chart.js across all 23 pages. The hashes were computed from the exact files in the pinned npm packages (supabase-js and Chart.js now load their unminified distribution files so the hash matches byte for byte).
- `scripts/run-all-tests.sh`, `404.html`, `.nojekyll`.
- The unused `legacy-prototype/` folder from an earlier abandoned approach was moved out of the repository to `../legacy-prototype-archive` (nothing deleted).

## Results
Database 229/229, Edge Function logic 12/12, UI 85/48/37/48/53/56/79, release gate passes in dry-run mode.

## Not done / needs you
1. Run the checklist in `DEPLOYMENT.md` on your real Supabase project. I have no access to one, so real Auth emails, real Storage and the deployed Edge Functions are unverified.
2. Provide the project URL and anon key (a public value) in `js/supabase-client.js`.
3. Decisions still open: assignment leaves status Pending until the employee starts (assumed); no manager "unassign"; About/Help content on the home page; forced password change for new staff.
