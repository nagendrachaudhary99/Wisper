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

## Milestone 2 (implemented on feat/milestone-2-real-providers)
- Provider-agnostic structured model adapter with schema validation and deterministic offline fallback.
- Google OAuth Authorization Code + PKCE, one-time state, encrypted tenant-scoped tokens.
- Gmail read-only metadata connector (`gmail.readonly`).
- Calendar event connector (`calendar.events`) behind the unchanged exact action-hash approval gate.
- Render deployment blueprint; private access remains enforced by the tenant bearer token.

## Local-first beta execution plan (M4-M8)

These are not complete. Each milestone closes only when its acceptance tests pass.

### M4 - Native Mac companion
- Package a signed, non-admin helper using authenticated local IPC and macOS Keychain.
- Implement race-safe file reads/writes and process-group resource limits.
- Add per-app Automation/Accessibility permission onboarding and a menu-bar kill switch.
- Exit: destructive-command adversarial suite is blocked; allowlisted read and approved write fixtures pass on a clean Mac.

### M5 - Durable work, memory and monitoring
- Add task dependencies, schedules, event subscriptions, retries, compensation and user-correctable memory with provenance.
- Add queue controls and recovery states to the dashboard.
- Exit: crash/restart and duplicate-event tests pass across every workflow state; dashboard can explain every wait and failure.

### M6 - Live connector wave
- Promote Google, Twilio/WhatsApp, Slack and GitHub adapters from mock to live behind the same policy contract; keep social adapters disabled until review scopes are approved.
- Add webhook signature checks, token rotation and connector-specific rate limits.
- Exit: provider sandboxes pass receive, draft, approval, send, dedupe and reconciliation tests without secrets appearing in logs.

### M7 - Browser and app automation
- Add scoped browser sessions and native app adapters with screenshots, operation previews, bounded recovery and unknown-outcome reconciliation.
- Exit: benchmark tasks meet completion/latency targets and every effect can be stopped, audited or reconciled after interruption.

### M8 - Installer and beta release
- Ship a notarized installer, migration/backup flow, diagnostics bundle with redaction, automatic updates and an offline-first onboarding path.
- Run full security review, cost/latency/reliability benchmarks and clean-Mac end-to-end testing.
- Exit: one-command install and rollback work; beta checklist has zero high-severity open findings.
