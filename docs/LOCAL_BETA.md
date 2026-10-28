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

## Terminal control (local.run_command)

The engine can run terminal commands on the Mac through the companion. The
path keeps every existing guarantee:

1. The planner proposes `local.run_command` only for allowlisted executables
   (`pwd, ls, git, node, pnpm` by default) and prefers read-only usage.
2. Policy always requires explicit approval; the dashboard and chat approval
   cards show the exact command before anything runs.
3. After approval, the worker mints a single-use companion approval bound to
   the exact command digest, authenticated by a shared local token. The
   companion re-checks its allowlist, classification and kill switch, runs the
   command without a shell, bounds time and output, and appends to its own
   audit log.
4. The result (command, exit code, stdout, stderr) renders readably in the
   dashboard and lands in the run trace.

Honest boundary: the companion's workspace check only fixes the command's
working directory - it is not a sandbox. The companion itself runs as a
Docker container with only the Wisper project folder mounted in, so an
approved command can read and change files in that project folder -
including credentials stored in project files such as .env.local - and use
the network. Other host folders are not mounted into the container.
The approval card says this in plain language, which is why the exact
command is shown before anything executes.

Setup: add `WISPER_COMPANION_TOKEN=<random string>` to `.env.local` and
restart with `./wisper local down && ./wisper local up`. Without the token
the worker uses the fake companion and no command ever executes. Setting
`WISPER_COMPANION_DISABLED=1` in `.env.local` remains the kill switch.

## Browser control (experimental)

`browser.navigate` opens one page in a fresh headless Chromium inside the
worker container - never the user's own browser profile; cookies and logins
do not carry over. It is approval-gated and http/https-only. The page's own
scripts DO run and can load resources; Wisper never clicks, types or
submits, and the returned text is treated as untrusted content (shown to the
user, never turned into actions).

Network policy is enforced at request resolution time: every request the
page makes - the document, each redirect hop and every subresource - is
scheme-checked and host-classified, with hostnames DNS-resolved before the
request is allowed. If the approved URL is public, any private/local target
is aborted. If the approved URL is private (the card warns about this), only
that exact host is reachable. A public hostname that resolves to a private
address is refused outright, since the approval warning keys off the URL the
user saw. Residual gap: DNS answers can change between the check and the
connection (TOCTOU); this is a known limit, not a claim of immunity.

Setup: the worker image installs headless Chromium during build; no extra
configuration is needed. The fake browser provider stays the default when
`WISPER_BROWSER_PROVIDER` is unset.
