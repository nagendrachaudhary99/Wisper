# Local Mac beta

## One command

1. Install Docker Desktop.
2. Copy `.env.example` to `.env.local`. Fake mode is the default and needs no provider credentials.
3. Run `./wisper local up`.
4. Open http://localhost:5173. The command prints the local API token during first-time seeding.
5. Stop everything with `./wisper local down`. Set `WISPER_COMPANION_DISABLED=1` and restart the companion to engage the kill switch.

If a printed API token is exposed, rotate only that tenant's sole token without resetting any database:

```bash
./wisper local rotate-token <tenant_id>
```

The old token is revoked atomically. Paste the replacement directly into the dashboard and do not send it in chat. The command refuses to guess if the tenant has zero or multiple tokens.

The script starts Postgres, self-hosted Temporal, Temporal UI, API, worker, web dashboard and the localhost-only companion. Nothing deploys to a cloud service.

The equivalent direct command is `docker compose --profile local up --build`
(add `-d` to detach). Run `bash scripts/verify-compose.sh` first if the stack
fails to start; it checks the Temporal config files and profile wiring.

## Troubleshooting

- Re-running the command is safe. Temporal schema setup and the database
  volumes are idempotent; containers can be stopped and restarted freely.
- `Temporal exits with "development-sql.yaml: no such file"`: the
  `temporal/dynamicconfig/` folder is missing from the checkout. Pull the
  latest branch and re-run.
- `database "temporal_visibility" already exists` on restart: you are on an
  older revision without `SKIP_DB_CREATE`. Pull the latest branch and re-run;
  existing data is kept.
- First run builds the app images and can take several minutes.
- If `./wisper local up` fails at the migrate step because the API container
  is still starting, wait a few seconds and run
  `docker compose exec api pnpm migrate` again.

## Outcome targets

The beta is measured by duplicate effects (target zero), replay recovery, approval latency, successful/failed run rate, time to diagnose a failure from the audit timeline, and the ability to reverse or stop local control. These are outcome comparisons, not claims about another product's internal design.
