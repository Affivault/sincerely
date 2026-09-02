#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  Migration 061 against a real Postgres, not a guess about one.
#
#  The renewal trigger has branches that no amount of reading catches. The
#  first version of it resurrected a renewal date somebody had deliberately
#  deleted, on the next unrelated edit to the deal, because the guard only
#  asked whether the date was null. Renewal dates get diarised; one that
#  comes back from the dead is worse than one that was never there.
#
#  Every assertion below is a query result compared to an expected value,
#  so this fails loudly rather than printing a table for somebody to read.
#
#  Run: bash scripts/renewal-sql-check.sh
# ═══════════════════════════════════════════════════════════════════════
set -uo pipefail

PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | head -1)
if [ -z "$PGBIN" ]; then echo "no postgres installed - skipping"; exit 0; fi

HERE=$(cd "$(dirname "$0")" && pwd)
MIGRATION="$HERE/../../supabase/migrations/061_post_sale_lifecycle.sql"
D=/var/tmp/pg-renewal-check
PORT=5461

rm -rf "$D"; mkdir -p "$D"; chmod 755 /var/tmp; chown -R postgres "$D"
su postgres -c "$PGBIN/initdb -D $D/data -U postgres" >/dev/null 2>&1
su postgres -c "$PGBIN/pg_ctl -D $D/data -o '-p $PORT -k $D' -l $D/log start" >/dev/null 2>&1
sleep 2

q() { su postgres -c "$PGBIN/psql -h $D -p $PORT -U postgres -tAq -c \"$1\"" 2>&1; }
# psql's status, not grep's. Piping straight into `grep -v NOTICE` made the
# pipeline exit 1 whenever every line was filtered out - which is the normal
# case for a clean run - so "did the migration apply?" was answering a
# question about grep.
runfile() {
  local out rc
  out=$(su postgres -c "$PGBIN/psql -h $D -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f $1" 2>&1)
  rc=$?
  echo "$out" | grep -v NOTICE || true
  return $rc
}

PASS=0; FAIL=0
is() { # label expected actual
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ok   $1";
  else FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "         expected [$2] got [$3]"; fi
}
refuses() { # label sql
  local out; out=$(q "$2")
  if echo "$out" | grep -q "ERROR"; then PASS=$((PASS+1)); echo "  ok   $1";
  else FAIL=$((FAIL+1)); echo "  FAIL $1 (it was accepted)"; echo "         $out"; fi
}

# ---- Enough of the real schema for the migration to bite on ------------
cat > "$D/base.sql" <<'EOF'
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $fn$ select null::uuid $fn$;
create table contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text, first_name text, last_name text, company text,
  lifecycle text not null default 'prospect'
);
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, status text not null default 'draft', list_id uuid
);
create table campaign_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status text not null default 'pending',
  current_step_order integer not null default 0,
  next_send_at timestamptz,
  unique(campaign_id, contact_id)
);
create table deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, title text not null,
  value numeric not null default 0, stage text not null default 'lead',
  closed_at timestamptz, term_months integer,
  recurring_amount numeric, recurring_period text, one_off_amount numeric,
  contact_id uuid references contacts(id) on delete set null,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001');
insert into contacts (id, user_id, email)
  values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000001','a@b.com');
EOF
runfile "$D/base.sql"

echo "applying 061 twice - it has to be re-runnable"
# Run directly rather than through a command substitution: $? after `X=$(...)`
# is the exit status of the assignment, which is always 0 and would have made
# these two assertions pass no matter what the migration did.
runfile "$MIGRATION" >/dev/null; RC1=$?
runfile "$MIGRATION" >/dev/null; RC2=$?
is "first run succeeds"  "0" "$RC1"
is "second run succeeds too (idempotent)" "0" "$RC2"

U=00000000-0000-0000-0000-000000000001

echo
echo "the renewal date, derived from what was actually agreed"
q "insert into deals (id,user_id,title,stage,closed_at,term_months) values ('00000000-0000-0000-0000-0000000000d1','$U','Annual','won','2026-01-15T10:00:00Z',12);" >/dev/null
is "a won deal with a term gets its renewal date" \
   "2027-01-15" "$(q "select renewal_date from deals where id='00000000-0000-0000-0000-0000000000d1'")"
is "and is marked as coming up" \
   "upcoming" "$(q "select renewal_status from deals where id='00000000-0000-0000-0000-0000000000d1'")"

q "insert into deals (id,user_id,title,stage,closed_at) values ('00000000-0000-0000-0000-0000000000d2','$U','No term','won','2026-01-15T10:00:00Z');" >/dev/null
is "a won deal with NO term invents nothing" \
   "t" "$(q "select renewal_date is null and renewal_status is null from deals where id='00000000-0000-0000-0000-0000000000d2'")"

echo
echo "a date somebody has changed is theirs, not the trigger's"
q "update deals set renewal_date=null, renewal_status=null where id='00000000-0000-0000-0000-0000000000d1';" >/dev/null
q "update deals set title='renamed' where id='00000000-0000-0000-0000-0000000000d1';" >/dev/null
q "update deals set value=500 where id='00000000-0000-0000-0000-0000000000d1';" >/dev/null
is "a DELETED renewal date stays deleted through later edits" \
   "t" "$(q "select renewal_date is null from deals where id='00000000-0000-0000-0000-0000000000d1'")"

q "update deals set renewal_date='2026-04-01', renewal_status='upcoming' where id='00000000-0000-0000-0000-0000000000d1';" >/dev/null
q "update deals set title='renamed twice' where id='00000000-0000-0000-0000-0000000000d1';" >/dev/null
is "a CORRECTED renewal date survives later edits" \
   "2026-04-01" "$(q "select renewal_date from deals where id='00000000-0000-0000-0000-0000000000d1'")"

echo
echo "the honest second chance to derive one"
q "insert into deals (id,user_id,title,stage,closed_at) values ('00000000-0000-0000-0000-0000000000d5','$U','Late term','won','2026-02-01T00:00:00Z');" >/dev/null
q "update deals set term_months=24 where id='00000000-0000-0000-0000-0000000000d5';" >/dev/null
is "a term filled in after the win still derives a date" \
   "2028-02-01" "$(q "select renewal_date from deals where id='00000000-0000-0000-0000-0000000000d5'")"

echo
echo "a deal that stops being won stops having a renewal"
q "update deals set stage='proposal', closed_at=null where id='00000000-0000-0000-0000-0000000000d5';" >/dev/null
is "reopening clears the status" \
   "t" "$(q "select renewal_status is null from deals where id='00000000-0000-0000-0000-0000000000d5'")"
is "but keeps the date, which was probably right" \
   "2028-02-01" "$(q "select renewal_date from deals where id='00000000-0000-0000-0000-0000000000d5'")"
q "update deals set stage='won', closed_at='2026-03-01T00:00:00Z' where id='00000000-0000-0000-0000-0000000000d5';" >/dev/null
is "winning it again re-arms the renewal" \
   "upcoming" "$(q "select renewal_status from deals where id='00000000-0000-0000-0000-0000000000d5'")"

q "insert into deals (id,user_id,title,stage,renewal_status) values ('00000000-0000-0000-0000-0000000000d6','$U','Bad','won','upcoming');" >/dev/null
is "an upcoming renewal with no date is impossible" \
   "t" "$(q "select renewal_status is null from deals where id='00000000-0000-0000-0000-0000000000d6'")"

echo
echo "what the database refuses"
refuses "an unknown renewal status" \
  "insert into deals (user_id,title,stage,renewal_status) values ('$U','x','lead','maybe');"
refuses "a negative notice period" \
  "insert into deals (user_id,title,renewal_notice_days) values ('$U','x',-5);"
refuses "a notice period longer than a year" \
  "insert into deals (user_id,title,renewal_notice_days) values ('$U','x',400);"
refuses "a deal that renews into itself" \
  "update deals set renewed_to_deal_id=id where id='00000000-0000-0000-0000-0000000000d1';"
refuses "an unknown campaign audience" \
  "insert into campaigns (user_id,name,audience) values ('$U','x','warm');"
refuses "an unknown trigger" \
  "insert into campaigns (user_id,name,trigger_event) values ('$U','x','whenever');"
refuses "AN AUTOMATIC TRIGGER ON A COLD CAMPAIGN - the one that would pitch your own customers" \
  "insert into campaigns (user_id,name,audience,trigger_event) values ('$U','x','cold','renewal_due');"
refuses "a negative trigger offset" \
  "insert into campaigns (user_id,name,audience,trigger_event,trigger_offset_days) values ('$U','x','post_sale','renewal_due',-30);"

echo
echo "what it accepts"
q "insert into campaigns (id,user_id,name,audience,trigger_event,trigger_offset_days) values ('00000000-0000-0000-0000-0000000000e1','$U','Renewals','post_sale','renewal_due',90);" >/dev/null
is "a post-sale renewal campaign" \
   "post_sale|renewal_due|90" "$(q "select audience||'|'||trigger_event||'|'||trigger_offset_days from campaigns where id='00000000-0000-0000-0000-0000000000e1'")"
q "insert into campaigns (id,user_id,name) values ('00000000-0000-0000-0000-0000000000e2','$U','Cold');" >/dev/null
is "and every existing cold campaign keeps working untouched" \
   "cold|true|0" "$(q "select audience||'|'||(trigger_event is null)||'|'||trigger_offset_days from campaigns where id='00000000-0000-0000-0000-0000000000e2'")"

echo
echo "the ledger: an automatic enrolment happens exactly once"
LED="insert into lifecycle_enrolments (user_id,campaign_id,deal_id,contact_id,trigger_event,cycle_key) values ('$U','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','renewal_due'"
q "$LED,'2027-01-15');" >/dev/null
refuses "the same deal, contact and cycle cannot enrol twice" "$LED,'2027-01-15');"
q "$LED,'2028-01-15');" >/dev/null
is "but next year is a new cycle and does enrol" \
   "2" "$(q "select count(*) from lifecycle_enrolments")"

echo
echo "the queue query is an index scan, not a walk of every deal ever won"
q "insert into deals (user_id,title,stage,closed_at,term_months)
   select '$U','deal '||g,'won', now() - (g % 900) * interval '1 day', 12 from generate_series(1,30000) g;" >/dev/null
q "insert into deals (user_id,title,stage) select '$U','open '||g,'proposal' from generate_series(1,20000) g;" >/dev/null
q "analyze deals;" >/dev/null
PLAN=$(q "explain (costs off) select id,title,renewal_date from deals where user_id='$U' and renewal_status='upcoming' and renewal_date <= current_date + 90 order by renewal_date limit 200;")
if echo "$PLAN" | grep -q "Index Scan using idx_deals_renewal_due"; then
  PASS=$((PASS+1)); echo "  ok   over 50k deals it uses idx_deals_renewal_due"
else
  FAIL=$((FAIL+1)); echo "  FAIL the renewal queue query does not use its index"; echo "$PLAN" | sed 's/^/         /'
fi
if echo "$PLAN" | grep -q "Filter:.*renewal_status"; then
  FAIL=$((FAIL+1)); echo "  FAIL renewal_status is re-checked as a filter rather than absorbed by the partial index"
else
  PASS=$((PASS+1)); echo "  ok   and the partial predicate is absorbed, not re-filtered"
fi

su postgres -c "$PGBIN/pg_ctl -D $D/data stop" >/dev/null 2>&1
rm -rf "$D"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
