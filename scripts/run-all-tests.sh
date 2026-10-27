#!/usr/bin/env bash
# Runs every automated test. Needs: PostgreSQL 14+ (PGHOST/PGPORT/PGUSER), `npm i pg playwright`, Node 22.18+.
set -u
cd "$(dirname "$0")/.."
fail=0
run() { echo "=== $1"; shift; "$@" > /tmp/nyota-test.out 2>&1 && tail -1 /tmp/nyota-test.out || { tail -8 /tmp/nyota-test.out; fail=1; }; }
run "database / RLS"      node tests/db/rls.test.js
run "edge function logic" bash -c 'node --test tests/functions/handlers.test.mjs 2>&1 | grep -E "^# (pass|fail)" | tr "\n" " "; node --test tests/functions/handlers.test.mjs >/dev/null 2>&1'
for t in auth submit tracking admin manager employee admin-m9 anonymous; do run "ui $t" node tests/ui/$t.test.js; done
run "release gate (dry run)" node scripts/check-release.mjs --allow-placeholders
[ $fail = 0 ] && echo "ALL GREEN" || { echo "FAILURES"; exit 1; }
