# Local Mac beta

## One command

1. Install Docker Desktop.
2. Copy `.env.example` to `.env.local`. Fake mode is the default and needs no provider credentials.
3. Run `./wisper local up`.
4. Open http://localhost:5173. The command prints the local API token during first-time seeding.
5. Stop everything with `./wisper local down`. Set `WISPER_COMPANION_DISABLED=1` and restart the companion to engage the kill switch.

The script starts Postgres, self-hosted Temporal, Temporal UI, API, worker, web dashboard and the localhost-only companion. Nothing deploys to a cloud service.

## Outcome targets

The beta is measured by duplicate effects (target zero), replay recovery, approval latency, successful/failed run rate, time to diagnose a failure from the audit timeline, and the ability to reverse or stop local control. These are outcome comparisons, not claims about another product's internal design.
