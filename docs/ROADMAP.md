# Roadmap: from this slice to the full engine

Milestone 1 (this branch) is the foundation: durable runs, policy gate,
approval boundary, once-only execution, audit. Follow-on milestones, in order:

## M2 - Real providers
- Google OAuth (Gmail read, Calendar write) behind the existing
  `GmailProvider` / `CalendarProvider` interfaces; token storage encrypted at rest.
- Model planner adapter behind `ModelPlanner` (provider-agnostic, with the
  deterministic planner as offline fallback and eval baseline).

## M3 - Reliability hardening
- Unknown-outcome reconciliation sweeper (attempts left `in_progress` by a
  crash are probed against the provider before any retry).
- Compensation actions (e.g. calendar.delete_event) for approved undo.
- Rate limits and per-tenant budgets enforced in policy context.

## M4 - More actions + drafts-first writes
- gmail.send / calendar.update / docs.* as new ActionIntent kinds, all
  default-deny until granted; every write lands as a reviewable draft first.
- Per-kind grants table + grant management UI.

## M5 - Eval harness + SLOs
- Golden-task eval suite run in CI on every planner/policy change; publish
  pass rates. Targets: >95% verified completion, 0 unauthorized mutations,
  <700ms first response, <2% of tasks needing user correction.

## M6 - Production deploy
- One cloud picked (open), Terraform, CI/CD with migration gate, secret
  manager, observability stack, alerting on failed runs and stuck approvals.

## M7 - Browser automation
- Isolated browser pods for sites without APIs, behind the same policy,
  approval, and idempotency machinery as API actions.
