# Payments, privacy, financial compliance and IT security: analysis (2026-10-01)

Background for CLAUDE.md §18. The rules themselves are in CLAUDE.md. This file records what
the 2026-10-01 full code review found, and what now holds.

- **Billing did not exist.** `subscriptions` was assigned by hand in the platform console. Now Platform's `modules/billing` takes payment through Stripe (USD/EUR) and Razorpay (INR), keeps an invoice ledger, and syncs plan limits from signed webhooks (`0102`).
- **No data-subject tooling.** Nothing handled access, erasure, consent, retention or breach notification. Now Compliance's `modules/privacy` does (`0103`), with a member self-service page (`/my-privacy`) and an admin centre (`/settings/privacy`).
- **The audit trail could be silently edited.** `audit_logs` had no client write policy, but any service-role caller could UPDATE or DELETE a row unseen. Now both audit tables are append-only for every role, and `audit_logs` is SHA-256 hash-chained per tenant with `verify_audit_chain()` and `/audit/integrity` (`0104`).
- **Control frameworks had no financial or privacy coverage.** Now there are SOX ITGC, SOC 1, PCI DSS, GLBA, DORA, RBI, SEBI CSCRF, CERT-In, GDPR and DPDP control sets (`0105`).
- **Sensitive tenant tables were readable by every member through PostgREST.** The existing RLS pattern (`tenant_id in current_tenant_ids()`) does not distinguish roles. Invoices, privacy requests and breach records now use `has_tenant_permission(tenant, key)` (`0101`), a narrower database-side check under the application's authorization engine.
- **Security headers and pipeline had gaps.** There was no HSTS, COOP/CORP, CSP `object-src`/`frame-src`, `poweredByHeader: false`, or cross-site write check on the JSON API. There was no CI for typecheck, lint, unit tests or dependency audit, and no `security.txt`. All are added. The encryption key could not be rotated; now `SECRET_ENCRYPTION_KEY_PREVIOUS` allows that.
- **The framework had a critical advisory.** `next@16.3.5` was inside the range of GHSA-vcvr-r3jv-pc5j (RCE in `next/og`). It was patched to 16.3.8.
- **Concurrency is part of correctness for money.** Invoice numbers are drawn in the same transaction that stores them (`assign_invoice_number()`), only one processor claims a webhook event (`claimed_at`), and a second checkout is refused while one is open.
- **Won't do (owner decision, 2026-10-10).** Supabase Auth's leaked-password protection stays off. The advisor warning is accepted.
- **Still open.** The CSP still allows `'unsafe-inline'` scripts for Next's bootstrap. Moving to per-request nonces is a recorded follow-up.
