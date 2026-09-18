# Local companion threat model

Wisper's local companion is a narrow capability broker, not a remote shell.

## Assets and boundaries

- User files, browser sessions, app automation privileges, connector tokens and model keys stay outside workflow payloads and audit data.
- The dashboard/API is untrusted input. The companion listens only on `127.0.0.1`, runs as a non-admin user and accepts structured operations, never shell strings.
- Every operation is classified: safe metadata/read operations may run; writes, app control and outbound effects require an approval bound to the exact operation digest; unknown operations fail closed.

## Controls

- Executable allowlist and argument inspection; `spawn(..., {shell:false})` prevents shell expansion.
- Canonical workspace-root check blocks `..` traversal. Production packaging must also reject symlinks for every file-operation target.
- 30-second maximum runtime, 256 KB output cap, child kill on timeout/output overflow.
- Environment is minimized. No inherited credentials are passed to child commands.
- `WISPER_COMPANION_DISABLED=1` is the kill switch and is checked before every operation.
- Each preview, denial, start, finish and failure is appended to a mode-0600 JSONL audit. Production packaging should hash-chain and periodically checkpoint this log into the engine's immutable audit store.
- Approval tokens are one-use and bound to the exact command digest. They cannot approve changed arguments.

## Main threats

| Threat | Mitigation | Remaining work before live use |
| --- | --- | --- |
| Prompt injection requests destructive command | closed planner schema, policy classification, exact preview and explicit approval | add signed local IPC and adversarial eval suite |
| Path escape or symlink swap | realpath root containment | use directory handles/openat-style operations in native helper |
| Secret leakage in output/audit | minimized environment and no secret fields | streaming redaction and DLP patterns |
| Runaway process | timeout, output cap, kill | process-group termination and CPU/memory limits |
| Browser/app takeover | no live adapter in this milestone | macOS TCC-scoped, per-app adapters with visible session indicator |
| Stolen dashboard token | localhost binding and hashed tokens | OS keychain, secure cookies and origin/CSRF binding |

## Approval classes for future operations

- `auto_read`: workspace metadata, directory listing, git status, health checks.
- `explicit`: file writes, terminal effects, browser/app clicks, messages and connector sends.
- `blocked`: privilege escalation, disabling controls, credential reads, arbitrary shell strings, paths outside the workspace.
