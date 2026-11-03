# Last Day

HR clicks "Offboard now" and Last Day finds every account, API key and server a leaver still has across the company's systems (including ones under a different name), puts each one in front of a human, revokes on approval, and proves it from each system's own API.

Built for the Vultr Agent Rush hackathon (lablab.ai), Challenge 2: Powering the Future of Work, HR & Recruitment focus area.

- **Finds** accounts by rules (exact work email, SSO subject, saved link) and, for the rest, with an AI resolver that returns a confidence and written evidence.
- **Asks** a human before anything is revoked: every probable match and every revoke needs a recorded approval.
- **Executes** with deterministic code through each system's real admin API: Keycloak, Mattermost, GitHub and the company's Vultr account.
- **Proves** each revocation by re-reading the target system, then re-checks the whole run once more 24 hours later.

Live app: `<app URL>` (judge login: `<shared in submission form>`). Judge quick path: [section 9](#9-judge-quick-path).

## Screenshots

Captured against the local sandbox (see [section 10](#10-run-it-locally-in-5-minutes)), not the real systems. Real-system before/after screenshots are listed under [Evidence](#12-evidence).

| | |
|---|---|
| ![Run in review](evidence/screenshots/sandbox/run-review.png) | ![Run verified](evidence/screenshots/sandbox/run-verified.png) |
| Review: exact matches, AI probable matches with evidence, a server with its monthly cost | Verified: every line green only after the system confirmed it |
| ![Dashboard](evidence/screenshots/sandbox/dashboard.png) | ![Employee profile](evidence/screenshots/sandbox/employee.png) |
| Dashboard | Employee profile with linked accounts and Offboard now |

## 1. Contents

[Problem](#3-the-problem) · [How it works](#4-how-it-works) · [AI](#5-where-the-ai-is-used-and-where-it-is-not) · [Vultr](#6-vultr-services-used) · [Systems](#7-systems-and-exact-api-actions) · [Safety](#8-safety-model) · [Judge path](#9-judge-quick-path) · [Run locally](#10-run-it-locally-in-5-minutes) · [Deploy](#11-deploy-on-vultr) · [Evidence](#12-evidence) · [Stack and docs](#13-tech-stack-repo-layout-tests-docs) · [Limitations](#14-limitations-and-honest-notes)

## 2. Honesty note

The demo company ("Northwind Labs"), its 30 people and all seed data are fictional and made by the builder. The systems are real (Keycloak and Mattermost on a Vultr VM, a GitHub Free org, a Vultr account) and so are the API calls Last Day makes to them in deployment.

`scripts/mock-company` is a local sandbox that emulates the four admin APIs and an OpenAI-compatible inference endpoint. It is for development and tests only. Nothing the sandbox produces (timings, costs, AI confidences, screenshots under `evidence/screenshots/sandbox/`) is evidence about the real systems or the real models.

## 3. The problem

People leave; their accounts don't.

| Fact | Source |
|---|---|
| 79% of ex-workers said at least one work account stayed active after their last day; 82% at companies under 250 staff vs 70% at 1,000+. 64% could still reach sensitive data. 33% said nobody clearly owned shutting access off. | Sagiss / Pollfish survey of 1,000 US adults, 22 Oct 2026 (vendor-run survey): https://www.efficientlyconnected.com/?p=9885 |
| A fired employee logged back in after HR and IT each waited on the other; damage "hundreds of thousands of dollars" plus weeks of delay. (A 1,000+ person company; an illustration, not the SMB statistic.) | The Register, 3 Sep 2026: https://www.theregister.com/a/5292763 |
| Identity providers only cover apps behind SSO (about two-thirds on average) and may disable without deleting or reclaiming. | 1Password blog, 4 Dec 2025: https://1password.com/blog/the-hidden-offboarding-step-draining-your-budget |
| SCIM auto-deprovisioning is locked behind enterprise pricing in about 42% of 721 SaaS apps and missing in 57%. Slack SCIM needs Enterprise Grid. | Stitchflow (vendor), updated 28 Jan 2026: https://www.stitchflow.com/blog/scim-tax-worst-offenders |
| Cloud waste is estimated at 29% of cloud spend; servers a leaver launched are part of it. | Flexera 2026 State of the Cloud, 18 Mar 2026: https://www.flexera.com/about-us/press-center/flexera-finds-cloud-value-is-rising-while-ai-waste-grows |

Caveat: Sagiss and Stitchflow are vendors with a product to sell; read their numbers accordingly.

**Why the obvious fixes fall short**

- **"Just use Okta / SCIM":** it only reaches SSO-connected apps, and SCIM is paywalled or missing in most apps small companies use.
- **"Use an offboarding checklist":** the checklist is what fails. A third of leavers say nobody owned the shutoff.
- **"Match accounts by email":** accounts sit under personal emails, nicknames, old usernames and contractor aliases. Exact-match rules miss exactly the accounts that matter.

Users: the people-ops / HR person who ends up owning offboarding (primary), the leaver's manager who approves only the final destroy of leftover servers, and the admin who connects the systems once. It is framed as an HR workflow, the mirror image of onboarding.

## 4. How it works

```
 HR: Offboard now (profile -> confirm)
        |
        v
 scoped sweep ........ read every account in every connected system (read-only)
        |
        v
 rule matcher ........ saved link, SSO subject, exact work email, username = email local part
        |  unmatched
        v
 AI resolver ......... json_schema answer: employee | null, confidence, evidence
        |              flash model first; escalate once if confidence < threshold
        v
 human review ........ exact matches, probable matches (Yes / Not her), servers with $/month
        |
        v
 approval 1 (HR) ..... recorded: approver, time, exact action list
        |
        v
 deterministic executor ... one system at a time, one action at a time, 3 retries, idempotent
        |
        v
 verifier ............ re-read the target system; a line turns green only if it confirms
        |
        +--> servers: halted + snapshotted (still billing)
        |        approval 2 (the leaver's manager) -> destroy -> verify 404
        v
 24h re-check ........ one durable timer per run; "still clean" or "regressed" (red, Needs attention)
```

1. **Offboard now** creates a run for the employee: every account already linked to them plus probable matches from a sweep scoped to that person.
2. **Rules first.** The matcher links by saved manual link, SSO subject id, exact work email (case-insensitive), then username equal to the email local part. The method is stored on each link.
3. **AI only for what rules cannot link.** Candidates are pre-filtered in code (string similarity, creation date near start date) so prompts stay small.
4. **Human review.** HR confirms or rejects each probable match, then approves. Nothing is revoked before this.
5. **Executor** is plain code. It performs the approved actions, not the model.
6. **Verifier** re-reads each system after each action and stores the observed state. A run is verified when every approved item is confirmed.
7. **Servers** are a two-step flow: HR approval halts and snapshots; the manager's separate approval destroys.
8. **24-hour re-check:** when a run is fully verified, `recheck_at = now + delay` (Settings, default 24h) is stored. A one-shot timer in the app process fires it; on restart pending rechecks are reloaded from Postgres, and the row is claimed atomically so it can never run twice. If anything came back, the run turns red.
9. **Manual tools:** Sweep now (re-scan for unknown accounts, results go to Unknown owners) and Re-check now (per run).

## 5. Where the AI is used and where it is not

**Used for:** identity resolution of accounts the rules cannot link, and ownership attribution of unlabelled servers. Its output only changes what HR sees on the review screen.

**Not used for:** deciding to revoke, executing anything, or holding credentials. The model has no tools, never receives a credential, and receives account metadata only (username, display name, emails, created date, system) plus the leaver's profile.

| Design choice | What it does | Code |
|---|---|---|
| `json_schema` output | `{ employee_id: string\|null, confidence: 0-1, evidence: string[], reason_if_none }`, validated in code; falls back to `json_object` plus validation if a model rejects strict schemas | `src/lib/server/engine/inference.ts`, `resolver.ts` |
| Flash first, then escalate | Default `glm-5.3-flash` ($0.10 / $0.35 per 1M tokens). Below the confidence threshold (setting, default 0.8) the question is re-asked once on `glm-5.2` | `resolver.ts`, `src/lib/server/models.ts` |
| Returned-model check | Vultr's gateway answers a wrong model id by silently falling back to `deepseek-v4.1-flash-1017`. Every response's `model` field is compared with the requested id and recorded | `inference.ts` |
| `reasoning_effort: low` | The candidate models are reasoning models and reasoning tokens are billed; effort is low and `max_completion_tokens` is capped | `inference.ts` |
| Every call logged | Requested and returned model, prompt and completion tokens from `usage`, price from the model table, latency, run id (table `ai_calls`) | `engine/cost.ts` |
| Cost per run | Summed per run and shown on the run page | `engine/cost.ts` |

### Identity-match benchmark

`evidence/benchmark/labelled-identities.json` holds 51 labelled cases written by the builder (disclosed as builder-made): 33 should link to an employee, 18 should not (contractors, bots, lookalikes).

| Pipeline | Accuracy | Precision | Recall | AI cost | Source |
|---|---|---|---|---|---|
| Rules only | 58.8% | 100% | 36.4% | $0 | Real, reproducible offline |
| Rules + `glm-5.3-flash` | pending real run | pending real run | pending real run | pending real run | Needs a Vultr inference key |
| Rules + `glm-5.3-flash` + escalation to `glm-5.2` | pending real run | pending real run | pending real run | pending real run | Needs a Vultr inference key |

The rules-only row shows what the AI has to earn: rules never link a wrong account (precision 100%) but find only about a third of the ones that should link. The AI rows are not filled in because the benchmark has not yet been run against the real Vultr endpoint, and sandbox numbers would not be evidence. To reproduce, run `pnpm benchmark` with a key:

```bash
VULTR_INFERENCE_API_KEY=... pnpm benchmark    # writes evidence/benchmark/results-<date>.json
```

Optional env: `BENCH_DEFAULT_MODEL`, `BENCH_ESCALATION_MODEL`, `BENCH_THRESHOLD`.

## 6. Vultr services used

| Vultr service | Role in Last Day |
|---|---|
| **Cloud Compute VM 1 (app)** | Runs Caddy, the SvelteKit server (UI, API routes, workflow engine, executor, verifier), Postgres 17 and the re-check timer, with Docker Compose. This is the central backend, not static hosting. |
| **Serverless Inference** | Every AI resolver call (`/v1/chat/completions`, OpenAI-compatible), default `glm-5.3-flash`, escalation `glm-5.2`. Usage and cost are logged per call. |
| **The Vultr account as a governed system** | Last Day reads IAM users, service users and their API keys, instances and plans; suspends users, deletes API keys, halts and snapshots instances, and destroys them on manager approval. |
| **Cloud Compute VM 2 (company stack)** | Hosts the demo company's Keycloak and Mattermost (plus Postgres and Caddy), which Last Day governs. |
| Firewall Group | VM 1: 80/443 public, SSH from the builder's IP only. Postgres is never exposed. |

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

There is no separate worker, queue or cron: everything runs in the one Node process, and Postgres holds the durable state.

## 7. Systems and exact API actions

From `src/lib/server/connectors/{keycloak,mattermost,github,vultr}.ts`. Every call is written to the audit log with method, endpoint and status.

| System | Read (sweep) | Revoke | Verify (read-back) |
|---|---|---|---|
| **Keycloak** (realm `company`, client-credentials service account) | `GET /admin/realms/{realm}/users` (paged), `/users/count` | `PUT /users/{id}` `{enabled:false}`; `POST /users/{id}/logout` | `GET /users/{id}`: `enabled == false`; `GET /users/{id}/sessions` is empty |
| **Mattermost** (admin personal access token) | `GET /api/v4/users` (active and inactive, paged), `GET /api/v4/bots` | `POST /users/{id}/sessions/revoke/all`; `DELETE /users/{id}` (deactivate, not permanent) | `GET /users/{id}`: `delete_at > 0`; sessions empty |
| **GitHub org** (token with org and repo admin) | `GET /orgs/{org}/members`, `/invitations`, `/outside_collaborators`; `GET /repos/{owner}/{repo}/invitations` | `DELETE /orgs/{org}/memberships/{user}`; `DELETE /orgs/{org}/invitations/{id}`; `DELETE /orgs/{org}/outside_collaborators/{user}`; `DELETE /repos/{owner}/{repo}/invitations/{id}` | Re-list the same collection: no longer present |
| **Vultr IAM** | `GET /v2/users`, `GET /v2/users/{id}/apikeys`, `GET /v2/organizations`, `GET /v2/organizations/{org}/suspended-users` | `PUT /v2/organizations/{org}/user/{id}/suspend`; `DELETE /v2/users/{id}/apikeys/{key}`; fallback `PATCH /v2/users/{id}` `{api_enabled:false}` | User in `suspended-users` (or 404, or `api_enabled:false` when fallback was used); key absent from the key list |
| **Vultr instances** | `GET /v2/instances`, `GET /v2/plans` (price per month) | Approval 1: `POST /v2/instances/{id}/halt`, `POST /v2/snapshots`. Approval 2 (manager): `DELETE /v2/instances/{id}` | `power_status: stopped`; snapshot `complete` with size and storage estimate; after destroy `GET` returns 404 |
| **Employee record** | Last Day's own Postgres | Status set to `offboarded` when the run completes | n/a |

Verification passes for a missing object (404) as well, since "gone" satisfies the goal.

## 8. Safety model

- **Human approval for every revoke.** Approvals record approver, time, scope and the exact action list. There is no auto-revoke path.
- **Second approval for destroy.** Destroying a server needs a separate approval by the leaver's manager, not HR.
- **Credentials:** encrypted at rest with AES-256-GCM, key derived from `MASTER_KEY`. Decrypted only inside sweep, executor and verifier at call time. Never returned to the browser; the Connections page shows a saved flag, not the value. The AI never sees them.
- **Audit log:** every sweep, match decision, approval, API call (method, endpoint, status), verification and re-check, with actor and timestamp.
- **Roles:** `admin`, `hr`, `manager`, `judge`. The judge role is scoped to the demo company: it can reset it, offboard demo employees and read the audit log, but cannot edit connections or settings (`src/lib/server/permissions.ts`).
- **Passwords:** argon2id.
- **Idempotent, bounded execution:** one action at a time per system, idempotency key per `(run, account, action)`, three retries with backoff, then the line fails visibly.
- **"Still billing" honesty:** a halted server still bills, and a snapshot is billed storage. Until destroyed, the server card says "$X/month still billing", never "saved".
- **Non-goals:** no chat interface, no scheduled recurring offboardings, no deleting user data, no fake GitHub accounts, no claim of SCIM support.

## 9. Judge quick path

URL: `<app URL>`. Login: `<shared in submission form>` (judge role).

1. Sign in with the judge login.
2. On the dashboard, click **Reset demo company** (re-seeds Northwind Labs through the real APIs).
3. Open **Employees**, then **Dana Okafor**, and click **Offboard now**.
4. On the run page review the exact matches, the AI probable matches (evidence and confidence) and the leftover server with its monthly cost. Confirm or reject each probable match, then approve.
5. Watch the lines turn green one by one as each system confirms. Compare with the Keycloak, Mattermost, GitHub and Vultr consoles if you wish.
6. Open the **Audit log** to see each API call, and the run's AI cost.
7. Click **Re-check now** on the run: expect "still clean".
8. The server card says "still billing" until the manager approves destroy (sign in as the manager to see that second approval).

## 10. Run it locally in 5 minutes

Uses the sandbox, so no accounts or keys are needed. Requires Node 22+, pnpm 10 and Postgres 17 (or any recent Postgres).

```bash
pnpm install

# Postgres (matches the default DATABASE_URL)
docker run -d --name lastday-pg -p 5432:5432 \
  -e POSTGRES_USER=lastday -e POSTGRES_PASSWORD=lastday -e POSTGRES_DB=lastday postgres:17-alpine

cp .env.example .env
set -a; . ./.env; set +a          # the scripts and dev server read process env, not .env directly

# Point the AI resolver at the sandbox (an inference URL on localhost needs no real key)
export VULTR_INFERENCE_BASE_URL=http://localhost:4010/inference/v1
export VULTR_INFERENCE_API_KEY=mock-inference-key

pnpm db:migrate                   # schema + first users (admin, judge)
pnpm mock                         # run in a second terminal and keep it running: sandbox on :4010
pnpm connect:mock                 # points the four connections at the sandbox
pnpm seed                         # creates Northwind Labs inside the sandbox, plus HR and manager logins
pnpm dev                          # http://localhost:5173
```

Run `pnpm mock` in a second terminal before `connect:mock` and `seed`. The sandbox is in memory: after restarting it, run `pnpm seed` again. Optional: `MOCK_LATENCY=0 pnpm mock` for instant responses.

Development logins (defaults when not in production):

| Role | Email | Password |
|---|---|---|
| admin | `admin@lastday.local` | `lastday-admin` |
| HR | `hr@northwind.example` | `demo-hr` |
| Manager (Priya Raman) | `priya.raman@northwind.example` | `demo-manager` |
| judge | `judge@lastday.local` | `judge-demo` |

Try it: sign in as HR, open Dana Okafor, Offboard now. The sandbox's indirect match (GitHub `dok-dev`) exercises escalation, and `POST http://localhost:4010/__admin/tamper` with `{"system":"keycloak"}` undoes a revocation so Re-check now turns the run red. Details: `scripts/mock-company/README.md`.

## 11. Deploy on Vultr

Two VMs, each with Docker Compose.

- **VM 1, the app:** Caddy + SvelteKit + Postgres 17. Runs migrations on start. Guide: [deploy/app/README.md](deploy/app/README.md).

  ```bash
  docker compose --env-file .env -f deploy/app/docker-compose.yml up -d --build
  ```

- **VM 2, the company stack:** Keycloak (realm `company` imported with the `last-day` service-account client), Mattermost Team Edition, Postgres, Caddy, on two `sslip.io` hostnames. Guide: [deploy/company-stack/README.md](deploy/company-stack/README.md).

Then, in Last Day, add the four connections on the Connections page, run **Test**, run `pnpm seed` against the real systems, and set `VULTR_INFERENCE_API_KEY` for the resolver.

### Capability checks (`scripts/capability-checks`)

Day-one scripts that test the vendor behaviour the build depends on before relying on it, with logs appended to `evidence/capability-checks/`. Spec: [docs/CAPABILITY_CHECKS.md](docs/CAPABILITY_CHECKS.md). Usage: [scripts/capability-checks/README.md](scripts/capability-checks/README.md).

```bash
pnpm tsx scripts/capability-checks/run-all.ts            # dry run, read-only probes
pnpm tsx scripts/capability-checks/c1-vultr-iam.ts --apply   # one check, with changes (cleaned up in finally)
```

| Check | What it proves |
|---|---|
| C1 | Vultr IAM leaver loop: key works, suspend, key refused, key deleted (invited and service-user paths) |
| C2 | Vultr instances: create tagged, halt, snapshot, price, destroy; timings |
| C3 | Keycloak: token, disable, logout, sessions empty, new login refused |
| C4 | Mattermost: admin token, revoke sessions, deactivate, login fails |
| C5 | GitHub Free org: list members and invitations, email invitation create and cancel |
| C6 | Serverless Inference: 20 `json_schema` calls, `usage` present, model echoed, wrong-id behaviour |
| C7 | Credit and billing: balance and usage reads |
| C8 | Company stack: endpoints answer, memory headroom on VM 2 |

## 12. Evidence

Committed now:

- `evidence/benchmark/labelled-identities.json`: the 51 builder-made labelled cases and the employees they refer to.
- `evidence/screenshots/sandbox/`: UI screenshots captured against the local sandbox (not real-system evidence).

To be added after the real runs (nothing below is claimed until it is committed):

- `evidence/capability-checks/`: logs of C1 to C8 against the real Vultr account and VM 2.
- Two complete offboarding runs against the real systems: audit-log export and verifier read-backs.
- Before/after screenshots of the Keycloak, Mattermost, GitHub and Vultr consoles.
- `evidence/benchmark/results-<date>.json` from `pnpm benchmark` against the real Vultr endpoint, and AI cost per run cross-checked with the Vultr usage view.

## 13. Tech stack, repo layout, tests, docs

**Stack:** SvelteKit 3 and Svelte 5 with `adapter-node`, TypeScript, Node 22, pnpm, PostgreSQL 17 with `postgres.js` and plain SQL migrations, Zod, argon2id (`@node-rs/argon2`), Caddy, Docker Compose, Vitest.

```
src/lib/server/engine/       sweep, matcher, resolver (AI), executor, verifier, recheck, cost, inference client
src/lib/server/connectors/   keycloak, mattermost, github, vultr (one interface: test, list, revoke, verify)
src/lib/server/queries/      page data and actions (employees, runs, audit, connections, settings)
src/lib/server/db/           postgres.js client and SQL migrations
src/lib/server/demo/         Northwind Labs company and seed
src/lib/components/          Svelte UI: pages/, run/, ui/, shell/
src/routes/                  (app) pages: dashboard, employees, runs, unknown, connections, audit, settings; login; api
scripts/                     migrate, seed-demo-company, benchmark-matching, connect-mock, mock-company, capability-checks
deploy/                      app (VM 1) and company-stack (VM 2) Compose files
evidence/                    benchmark data and committed run evidence
docs/                        product, architecture and API notes
```

**Tests**

```bash
pnpm test     # Vitest: matcher, resolver, connectors, engine and query integration tests (need Postgres), permissions, CSV, seed
pnpm check    # svelte-check and TypeScript
pnpm build    # production build
```

The integration tests and the connector tests use the sandbox; they test the code paths, not the real vendors.

**Docs**

| Doc | Content |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product requirements, goals and non-goals, AI design, risks |
| [docs/USER_FLOWS.md](docs/USER_FLOWS.md) | Screen-by-screen flows |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data model, deployment, security |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Vendor endpoints with confidence tags and design-changing findings |
| [docs/CAPABILITY_CHECKS.md](docs/CAPABILITY_CHECKS.md) | Day-one checks and the Vultr IAM fallback ladder |
| [docs/ROUTES_CONTRACT.md](docs/ROUTES_CONTRACT.md) | Route and data contract between UI and server |
| [docs/DEMO_PLAN.md](docs/DEMO_PLAN.md) | Demo company, video script, judge path |
| [docs/HACKATHON.md](docs/HACKATHON.md) | Hackathon fit and submission checklist |

## 14. Limitations and honest notes

- **Vultr API key shapes are not fully verified.** `GET/DELETE /v2/users/{id}/apikeys` are documented on docs.vultr.com but absent from Vultr's published OpenAPI and SDKs, so field names rest on capability check C1. The user-id type also conflicts between docs (UUID string) and the IAM OpenAPI (integer). The connector treats ids as opaque strings and, when suspend or key deletion is unavailable, falls back to `PATCH /v2/users/{id}` with `api_enabled: false`. That disables all of the user's keys, and the line says which method was used.
- **GitHub allows one free personal account per person.** The demo cannot mass-produce fake accounts and does not try. The GitHub footprint is a consenting real person plus real pending org invitations to alias emails. Repo invitations need a username, not an email. New orgs are limited to 50 org invitations per 24 hours, which limits repeated demo resets.
- **No SCIM.** Last Day uses each product's admin API with an admin credential. It does not claim SCIM support for third-party apps and does not cover systems without a connector.
- **Halted servers still bill**, and snapshots are billed storage. The product shows both; only the manager's destroy stops the instance cost.
- **Mattermost deactivation** archives the user (`delete_at` set) and ends sessions; it is not a permanent delete. User data is never deleted.
- **AI is narrow on purpose.** Rules alone catch about a third of the labelled cases that should link; the AI's measured contribution is pending the real benchmark run.
- **Vultr Serverless Inference** model ids and prices churn. Prices in `src/lib/server/models.ts` are a fallback from a late-Oct 2026 catalog capture; the Vultr console usage view is authoritative.
- **Sandbox is not evidence.** See [section 2](#2-honesty-note).
