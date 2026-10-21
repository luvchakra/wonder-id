-- Access Agent — owner decision 2026-10-21 (test feedback): a Tenant
-- Administrator may approve a request-policy change they proposed
-- themselves, as for onboarding (0188, 2026-10-14). Everyone else still
-- needs a second person, and nobody rejects their own change.
--
-- The four-eyes check now allows decider = proposer only when the row is
-- marked self_approved, which the service sets only for an administrator
-- approving with a note, audited as a self-approval. Additive: a new column
-- (false for every existing row) and the check replaced by a wider one.

alter table governance_changes add column self_approved boolean not null default false;
alter table governance_changes drop constraint governance_changes_check;
alter table governance_changes add constraint governance_changes_four_eyes
  check (decided_by is null or decided_by <> requested_by or (self_approved and status = 'approved' and decision_note is not null));
