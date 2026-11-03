# Last Day: Architecture

Status: draft v1, 3 Nov 2026. Endpoints marked **(verify)** are not yet confirmed and are covered by [CAPABILITY_CHECKS.md](CAPABILITY_CHECKS.md).

## 1. Overview

```
                    ┌──────────────────────── Vultr VM 1 (app) ────────────────────────┐
 Browser ──HTTPS──► │ Caddy ─► SvelteKit (adapter-node)                                  │
                    │            ├─ UI (Svelte 5)                                         │
                    │            ├─ server routes / actions                               │
                    │            ├─ sweep + rule matcher                                  │
                    │            ├─ AI resolver ─────────────► Vultr Serverless Inference │
                    │            ├─ executor + verifier ───┐                              │
                    │            └─ re-check timer         │                              │
                    │          Postgres 17 (Docker)        │                              │
                    └──────────────────────────────────────┼──────────────────────────────┘
                                                           │ admin APIs
          ┌──────────────── Vultr VM 2 (company stack) ────┼───┐
          │ Keycloak (SSO)   Mattermost (chat)   Postgres  │   │
          └────────────────────────────────────────────────┼───┘
                                                           ├──► GitHub REST API (Free org)
                                                           └──► Vultr API v2 (IAM users, API keys, instances)
```

Vultr's roles:
1. **Control plane:** the app, workflow engine, database and re-check timer all run on a Vultr VM.
2. **AI:** every model call goes to Vultr Serverless Inference.
3. **A governed system:** the company's Vultr account (IAM users, API keys, servers) is one of the systems Last Day offboards people from.
4. **Host for the company stack:** Keycloak and Mattermost run on a second Vultr VM.

## 2. Stack

| Layer | Choice |
|---|---|
| Web app + backend | SvelteKit with `@sveltejs/adapter-node`, Svelte 5, TypeScript, Node 22 |
| Database | PostgreSQL 17 in Docker on VM 1 |
| DB access | Drizzle ORM or postgres.js with SQL migrations (builder's choice) |
| TLS / reverse proxy | Caddy with Let's Encrypt on an sslip.io hostname (or own domain) |
| Orchestration | Docker Compose on each VM |
| AI | Vultr Serverless Inference, OpenAI-compatible `https://api.vultrinference.com/v1` |
| Company stack | Keycloak (latest), Mattermost Team Edition, Postgres, Docker Compose on VM 2 |

No separate worker service, queue or cron. Everything runs in the SvelteKit Node process.

## 3. Components

### 3.1 Connectors
One module per system implementing the same interface:

```ts
interface Connector {
  test(): Promise<HealthResult>;
  listAccounts(): Promise<NormalizedAccount[]>;
  revoke(account: NormalizedAccount, action: ActionKind): Promise<ActionResult>;
  verify(account: NormalizedAccount, action: ActionKind): Promise<VerifyResult>;
}
```

`NormalizedAccount`: `{ system, externalId, username, displayName, emails[], createdAt?, lastActiveAt?, kind: 'user'|'service'|'invitation'|'apikey'|'instance', raw }`.

| System | Read | Revoke | Verify |
|---|---|---|---|
| Keycloak | `GET /admin/realms/{realm}/users` | `PUT /admin/realms/{realm}/users/{id}` with `{"enabled": false}`, then `POST /admin/realms/{realm}/users/{id}/logout` | `GET /admin/realms/{realm}/users/{id}`: `enabled == false`; sessions endpoint empty |
| Mattermost | `GET /api/v4/users?page=&per_page=` | `POST /api/v4/users/{id}/sessions/revoke/all`, then `DELETE /api/v4/users/{id}` (deactivate) | `GET /api/v4/users/{id}`: `delete_at > 0` |
| GitHub org | `GET /orgs/{org}/members`, `/orgs/{org}/invitations`, `/orgs/{org}/outside_collaborators`, `/repos/{owner}/{repo}/invitations` | `DELETE /orgs/{org}/memberships/{username}`; `DELETE /orgs/{org}/invitations/{id}`; `DELETE /orgs/{org}/outside_collaborators/{username}`; `DELETE /repos/{owner}/{repo}/invitations/{id}` | Re-list: not present |
| Vultr IAM | List org users **(verify)**; `GET /v2/users/{user-id}/apikeys` | Suspend: `PUT /v2/organizations/{org}/user/{user}/suspend` **(verify)**; delete user API key **(verify, endpoint not documented)** | Re-read user status and key list |
| Vultr instances | `GET /v2/instances` (tags, label, hostname, plan); `GET /v2/plans` for price | Approval 1: `POST /v2/instances/{id}/halt`, then `POST /v2/snapshots` with `instance_id`. Approval 2: `DELETE /v2/instances/{id}` | `GET /v2/instances/{id}`: stopped / 404 after destroy; `GET /v2/snapshots/{id}` exists |

Credentials:
- Keycloak: a confidential client with a service account holding `realm-management` roles (`view-users`, `manage-users`).
- Mattermost: a system admin personal access token.
- GitHub: a fine-grained token with org Members read/write and repo administration on the demo repos.
- Vultr: an API key for the account owner or an admin-scoped IAM identity.

All are stored AES-256-GCM encrypted in Postgres with a key from the `MASTER_KEY` env var, and decrypted only inside the executor and sweep at call time.

### 3.2 Sweep
- Calls `listAccounts()` on every healthy connector and upserts into `accounts`.
- Runs the rule matcher, then the AI resolver on what's left.
- Triggered by: first setup, **Sweep now**, and **Offboard now** (scoped to that employee's candidates).

### 3.3 Rule matcher
Links by, in order: saved manual link, SSO subject id, exact work email (case-insensitive), exact username equal to the email local part. Records `link_method = 'rule:<name>'`.

### 3.4 AI resolver
- Inputs: the employee profile (name, work email, known aliases, start date, team) and candidate unlinked accounts with metadata only.
- Pre-filter candidates in code (string similarity, created within N days of start date, shared email domain) to keep prompts small.
- Call: `POST /v1/chat/completions` with `response_format: {type: "json_schema", ...}`.
  - Default model `glm-5.3-flash`.
  - If `confidence` is below the threshold (setting, default 0.8), re-ask once on the escalation model (`glm-5.2` or `deepseek-v4.1-flash-1017`, picked by benchmark).
- Output: `{ employee_id: string|null, confidence: number, evidence: string[], reason_if_none: string }`.
- Logged per call in `ai_calls`: requested model, returned `model`, prompt/completion tokens from `usage`, price, latency, run id.
- Safety: the model never sees credentials, has no tools and cannot trigger actions. Its output only changes what HR sees on the review screen.

### 3.5 Executor
- Input: the approved action list for a run.
- Runs actions one system at a time and one action at a time per system, so rate limits and order stay predictable.
- Each action has an idempotency key `(run_id, account_id, action)`. Retries 3 times with exponential backoff, then fails the line.
- Order per system follows the table above (end sessions before or with disabling, so access is cut immediately).

### 3.6 Verifier
- After each action, calls `verify()` and stores the observed state (`run_items.verified_state`, `verified_at`).
- A run is **verified** when every approved item is verified. Server items are verified at "halted + snapshot exists". The later manager destroy is tracked separately and does not block the run.

### 3.7 Re-check timer (the only scheduled job)
- When a run becomes verified, insert `rechecks(run_id, due_at = now() + setting.recheck_delay, status = 'pending')`. Default 24 hours; demo value a few minutes.
- In process: `setTimeout(fire, due_at - now)`.
- On server start: `SELECT * FROM rechecks WHERE status = 'pending'` and schedule each one. If it's already overdue, fire immediately. This makes it durable across restarts with no polling.
- `fire(run_id)` first claims the row atomically (`UPDATE rechecks SET status='running' WHERE run_id=$1 AND status='pending' RETURNING *`), so it can never run twice. It then re-runs `verify()` for every item and sets the result to `clean` or `regressed`, with a diff.
- **Re-check now** calls the same `fire` path directly (it also inserts a row if none exists).
- Cost: none. It is one timer per run inside the existing process.

## 4. Data model (Postgres)

| Table | Key columns |
|---|---|
| `app_users` | id, email, password_hash (argon2id), role (`admin`, `hr`, `manager`, `judge`), employee_id |
| `employees` | id, name, work_email, aliases[], role, department, manager_id, status (`active`, `offboarding`, `offboarded`), start_date, end_date |
| `connections` | id, system, config_json, credential_ciphertext, status, last_tested_at |
| `accounts` | id, connection_id, system, external_id, kind, username, display_name, emails[], created_at, last_active_at, raw_json, first_seen_at, last_seen_at |
| `account_links` | account_id, employee_id, link_method (`rule:*`, `ai`, `manual`), confidence, evidence_json, decided_by, decided_at |
| `runs` | id, employee_id, started_by, started_at, status (`review`, `executing`, `verified`, `partial`, `failed`), verified_at, ai_cost_usd |
| `run_items` | id, run_id, account_id, action, approval_id, status, attempts, last_error, verified_state, verified_at |
| `approvals` | id, run_id, approver_id, scope (`hr_revoke`, `manager_destroy`), item_ids[], created_at |
| `rechecks` | run_id, due_at, status (`pending`, `running`, `clean`, `regressed`), result_json, fired_at |
| `ai_calls` | id, run_id, requested_model, returned_model, prompt_tokens, completion_tokens, cost_usd, latency_ms, created_at |
| `audit_log` | id, at, actor (user or `system`), run_id, kind, detail_json (method, endpoint, status, read-back) |
| `settings` | recheck_delay_seconds, ai_confidence_threshold, default_model, escalation_model |

## 5. Deployment on Vultr

| Machine | Plan (suggested) | Runs | Approx. cost for the event window |
|---|---|---|---|
| VM 1 (app) | VX1 General Purpose 2 vCPU / 8 GB | Caddy, SvelteKit, Postgres | ~$7.62 |
| VM 2 (company stack) | VX1 General Purpose 2 vCPU / 8 GB | Keycloak, Mattermost, Postgres | ~$7.62 |
| Throwaway "leaver" servers | Smallest Regular plan | Demo servers to halt/destroy | cents |
| Serverless Inference | per-token | AI resolver | a few dollars at most |

Prices are from vultr.com/pricing on 3 Nov 2026 for about 127 hours; all inside the $200 credit if the credit covers Serverless Inference (check C7).

Network:
- Firewall Group on VM 1: 80/443 public, SSH from the builder's IP only.
- VM 2 admin ports reachable only from VM 1 (VPC or firewall allowlist). The user-facing Keycloak and Mattermost URLs are public so the demo can show their consoles.

## 6. Security

- The AI never sees credentials and has no tools.
- Every destructive action needs a recorded human approval; destroying a server needs a second approval by the leaver's manager.
- Credentials are encrypted at rest and never returned to the browser.
- Every external call is written to the audit log.
- `.env.example` lists every variable; no secrets are committed.
- The judge role is scoped to the demo company and cannot edit connections or settings.

## 7. Repo layout (suggested)

```
/src
  /lib/server/connectors/{keycloak,mattermost,github,vultr}.ts
  /lib/server/{sweep,matcher,resolver,executor,verifier,recheck,crypto,audit,cost}.ts
  /lib/server/db/{schema.ts,migrations/}
  /routes/(app)/{dashboard,employees,runs,connections,unknown,audit,settings}
/scripts
  /capability-checks/      day-1 scripts (see CAPABILITY_CHECKS.md)
  seed-demo-company.ts
  benchmark-matching.ts
/evidence                  committed run logs, screenshots, benchmark results
/deploy
  /app/docker-compose.yml
  /company-stack/docker-compose.yml
/docs
.env.example
```
