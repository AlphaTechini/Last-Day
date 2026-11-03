# Capability checks (day 1)

These scripts test the vendor and tool behaviour that the build depends on, before the main build starts. The spec is `docs/CAPABILITY_CHECKS.md`. The endpoints come from `docs/API_REFERENCE.md`.

## Run

1. Copy `.env.example` to `.env` at the repository root and fill in what you have. Scripts load `.env` from the working directory, so run them from the repository root.
2. Dry run, read-only probes only:

   ```sh
   pnpm tsx scripts/capability-checks/run-all.ts
   ```

3. One check, with the changes it needs:

   ```sh
   pnpm tsx scripts/capability-checks/c1-vultr-iam.ts --apply
   ```

Flags:

- `--apply` lets a check create or change resources: test users, API keys, invitations, instances, snapshots. Everything a check creates is removed in a `finally` block, and each removal is verified. Without the flag the check prints what it would do.
- `--escalation` makes C6 also run 5 calls on `glm-5.2`.

A check whose variables are missing prints `SKIP` with the names of the missing variables and exits 0. Exit code 1 means at least one assertion failed.

Run order in `run-all`: C1, C7, C2, C3, C4, C5, C6, C8. C1 and C7 come first because they can change the design.

## Logs

Each run appends to `evidence/capability-checks/<YYYY-MM-DD>-<check>.log`. Every line printed to the console goes into the log too. Values of secret variables, `Authorization` headers, `api_key` and similar JSON fields, and generated passwords are replaced with `[REDACTED]` before printing. Read a log before sharing it anyway.

## Variables

| Variable | Used by | Required |
|---|---|---|
| `VULTR_API_KEY` | C1, C2, C7 | yes |
| `TEST_ALIAS_EMAIL` | C1 (invitation), C4 (optional), C5 (org invitation) | C1, C5 |
| `VULTR_API_URL` | all Vultr checks | default `https://api.vultr.com/v2` |
| `VULTR_ORG_ID` | C1 | optional: otherwise the first IAM org is used |
| `VULTR_INFERENCE_API_KEY` | C6 (required), C7 (optional, for `/v1/usage`) | C6 |
| `VULTR_INFERENCE_BASE_URL` | C6, C7 | default `https://api.vultrinference.com/v1` |
| `KEYCLOAK_BASE_URL` | C3, C8 | yes |
| `KEYCLOAK_REALM` | C3, C8 | default `company` |
| `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | C3 | yes |
| `KEYCLOAK_LOGIN_CLIENT_ID` | C3 | optional: default `demo-login` (a public client with direct access grants, used only to create a session) |
| `MATTERMOST_BASE_URL`, `MATTERMOST_ADMIN_TOKEN` | C4, C8 | yes |
| `GITHUB_TOKEN`, `GITHUB_ORG`, `GITHUB_TEST_REPO` | C5 | yes |
| `GITHUB_DANA_USERNAME` | C5 | optional, not in `.env.example`: a consenting real GitHub account. Without it the repo-invite and membership steps are skipped. |

## What each check proves

- **C1, Vultr IAM leaver loop.** Creates a key for a user, checks it authenticates, suspends the user, checks the key is refused, deletes the key, checks it is gone. It runs on two paths. The invited-user path needs a human to accept the invitation email first, so it stays PENDING until a rerun. The service-user path creates a `service_user=true` account and always runs with `--apply`. The dry run also probes the suspend endpoint with a UUID and with an integer id, using ids that do not exist, to show which format the API accepts. The run ends by printing the fallback ladder decision.
- **C2, Vultr instances.** Creates the smallest Regular (`vc2`) instance tagged `owner:dana`, checks the tag, label and hostname in the list, reads the plan price, halts it, snapshots it and records the snapshot size and storage estimate, then destroys the instance and deletes the snapshot. Timings are logged. Halted instances keep billing, so check the console billing view.
- **C3, Keycloak.** Gets a client-credentials token. With `--apply`, creates a test user, logs it in once to create a session, disables it, logs it out, and checks that its sessions are empty and that a new login is refused. The test user is deleted afterwards.
- **C4, Mattermost.** Checks the admin token is a system admin and pages through the user list. With `--apply`, creates a test user, logs it in, revokes its sessions, deactivates it, and checks that a new login fails. The user is left deactivated, because a hard delete is a non-goal.
- **C5, GitHub Free org.** Lists members, invitations, outside collaborators and the test repo's invitations. With `--apply`, invites `TEST_ALIAS_EMAIL` to the org by email and cancels the invitation. Repo invitations need a username, not an email (API_REFERENCE 0.9), so that step uses `GITHUB_DANA_USERNAME` and is skipped without it. The printed reminder covers the 50-invitations-per-day limit for new orgs.
- **C6, Serverless Inference.** Checks the public model catalog for `glm-5.3-flash`, `glm-5.2` and `deepseek-v4.1-flash-1017`. Runs 20 `json_schema` calls on `glm-5.3-flash` with `reasoning_effort: low` and a `max_completion_tokens` cap. Each reply must parse against the schema, carry `usage`, and echo the requested model. Then sends a misspelled model id and records whether it returns 404 or falls back silently. Prints the estimated cost from catalog prices.
- **C7, Credit and billing.** Prints the manual console steps (gift code, payment method, charges note, billing page, promo credit, flat versus per-model pricing). Then reads `GET /v2/account` for the balance, `GET /v1/usage` if the inference key is set, and `GET /v2/inference/{id}/usage`. Read-only.
- **C8, Company stack on VM 2.** Checks that the Keycloak realm discovery, the Keycloak admin console, the Mattermost ping and the Mattermost web app all answer. Prints the `docker stats --no-stream` command to run under light load, and the host's MemTotal and MemAvailable when run on Linux.

## Fallback ladder (CAPABILITY_CHECKS.md, C1)

Decide by the end of day 1.

- **(a)** Invited users work fully (invite, accept, key, suspend, delete key): use them.
- **(b)** Only service users work: Dana's Vultr footprint becomes her CI service user, its API key, and her servers.
- **(c)** Only suspend works: the Vultr connector does read and suspend, and the README says so.
- **(c+)** If the suspend route fails with the UUID, C1 tries `PATCH /v2/users/{id}` with `{"api_enabled": false}`, which disables all of the user's keys. The run logs which route worked.

## Notes

- C2 deletes the snapshot with `DELETE /v2/snapshots/{id}`. That route is not in API_REFERENCE, so the log marks it for verification.
- The C1 invitation is never cancelled by the script, because no documented API route cancels one. It expires after 3 days.
- `--apply` creates billed or identity-bearing resources in your accounts. Run it on purpose, and check the logs afterwards for anything left behind.
