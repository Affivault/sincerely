# Prospector — built-in lead database (Apollo/Lemlist-style)

The Prospector lets customers search B2B people, spend monthly plan credits to
reveal verified work emails, and save them straight into lead lists — the same
loop Apollo, Lemlist and Snov.io sell.

## How it works

```
Search (free) ──► results WITHOUT emails (never leaves the server)
                       │
Reveal (1 credit) ─────┤ 1. dedupe: already revealed? → free, return contact
                       │ 2. try_spend_prospect_credits() — atomic, per-user lock
                       │ 3. get email (search cache → provider enrich fallback)
                       │ 4. no email? → automatic refund, nothing saved
                       │ 5. upsert contact (source: 'prospector') + add to list
                       ▼
             Lead list → campaigns → CRM
```

- **Credits** are a ledger (`prospect_credit_ledger`): spends are negative rows,
  refunds/top-ups positive. Balance = plan allowance + this month's net deltas.
  Monthly reset is implicit (calendar-month window), no cron needed.
- **Allowances** live in one place: `PLANS[*].prospectCredits` in
  `shared/src/billing.types.ts` (free 25 · starter 250 · growth 1000 · scale ∞).
  Tune them there; server and client both read it.
- **Dedupe**: `prospect_reveals` guarantees a user is never charged twice for
  the same person, even across months.
- **Only successful reveals cost credits** — no email found or provider error
  triggers an automatic refund. This is a customer-visible selling point.

## Data providers

You don't build the people database — you license it. Adapters live in
`server/src/services/prospect-providers.ts` behind one interface, so vendors
are swappable without touching credits, routes, or UI.

| Provider | Env key | Notes |
|---|---|---|
| People Data Labs | `PDL_API_KEY` | Person Search + Enrich. Search returns emails (held server-side, still credit-gated for users). Billed per matched record — model your margin. |
| Apollo | `APOLLO_API_KEY` | Cheap and good coverage, **but** check the current API ToS on reselling/white-labelling before using it in production. |

Set one key in the server environment and restart — the Prospector page
switches on automatically. With no key, the page shows a setup notice and the
API returns 503.

**Before production:** verify each adapter's request/response fields against
the provider's current docs (marked in the adapter file), and review the
provider agreement for redistribution terms, caching limits, and GDPR/CCPA
obligations (you become a data controller for revealed records; make sure your
privacy policy covers third-party B2B data).

## Rollout steps

1. Run `supabase/migrations/028_prospector_credits.sql` in the Supabase SQL editor.
2. Pick a provider, sign an API plan, set the env key, redeploy.
3. Sanity-check unit economics: your credit price vs. provider cost per reveal
   (e.g. PDL ~$0.10–0.28/match at low volume vs. Growth = 1000 credits on $59).
   Adjust `prospectCredits` per plan accordingly.
4. Later: paid credit top-ups (a `topup` ledger row after a Stripe one-off
   payment — the ledger already supports it), team-shared credit pools, and a
   company (account-level) search tab.
