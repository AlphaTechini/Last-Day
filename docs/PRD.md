# Last Day: Product Requirements

Status: draft v1, 3 Nov 2026. Built for the Vultr Agent Rush hackathon (lablab.ai), Challenge 2 "Powering the Future of Work", HR & Recruitment focus area.

## 1. One-liner

HR clicks "Offboard now" and Last Day finds every account, API key and server the leaver still has across the company's systems (including ones under a different name), puts each one in front of a human, revokes on approval, and proves it from each system's own API.

## 2. Who it's for

- **Primary user: the people-ops / HR person** at a 20-300 person company who ends up owning offboarding, often doing IT "on the side".
- **Secondary: the leaver's manager**, who approves only the final destroy of servers the leaver left behind.
- **Setup user: the admin / IT person**, who connects the company's systems once.
- **Buyer profile:** companies that run a mix of SSO, team chat, GitHub and a cloud account without enterprise SCIM provisioning.

Framed as an HR workflow (the mirror image of onboarding), not a security product.

## 3. Problem

People leave; their accounts don't.

| Fact | Source |
|---|---|
| 79% of ex-workers said at least one work account stayed active after their last day; 82% at companies under 250 staff vs 70% at 1,000+. 64% could still reach sensitive data. | Sagiss / Pollfish survey of 1,000 US adults, 22 Oct 2026: https://www.efficientlyconnected.com/?p=9885 |
| 33% said nobody clearly owned shutting access off. | Same survey |
| A fired employee logged back in after HR and IT each waited on the other; damage "hundreds of thousands of dollars" plus weeks of delay. (A 1,000+ person company; used as an illustration, not as the SMB statistic.) | The Register, 3 Sep 2026: https://www.theregister.com/a/5292763 |
| Identity providers only cover apps behind SSO (about two-thirds on average) and may disable without deleting or reclaiming. | 1Password blog, 4 Dec 2025: https://1password.com/blog/the-hidden-offboarding-step-draining-your-budget |
| The "obvious fix", SCIM auto-deprovisioning, is locked behind enterprise pricing in about 42% of 721 SaaS apps and missing in 57%. Slack SCIM needs Enterprise Grid. | Stitchflow (vendor), updated 28 Jan 2026: https://www.stitchflow.com/blog/scim-tax-worst-offenders |
| Cloud waste is estimated at 29% of cloud spend; servers a leaver launched are part of it. | Flexera 2026 State of the Cloud, 18 Mar 2026: https://www.flexera.com/about-us/press-center/flexera-finds-cloud-value-is-rising-while-ai-waste-grows |

Caveats: Sagiss and Stitchflow are vendor sources. Do not headline the undated Ponemon "8 hours per leaver" figure.

### Why the obvious fixes are weak

- **"Just use Okta / SCIM":** only reaches SSO-connected apps, and SCIM is paywalled or missing in most apps small companies use.
- **"Use an offboarding checklist":** the checklist is what fails. A third of leavers say nobody owned the shutoff.
- **"Match accounts by email":** accounts sit under personal emails, nicknames, old usernames and contractor aliases. Exact-match rules miss exactly the accounts that matter.

## 4. Goals and non-goals

### Goals
1. One click from HR revokes a leaver's access across every connected system.
2. Find accounts that don't match by email, using an AI resolver that shows its evidence.
3. Nothing is revoked without a human approval.
4. Every revocation is proven by re-reading the target system's own API.
5. One automatic re-check 24 hours after a fully successful run.
6. Show what each run cost in AI calls.

### Non-goals (never)
- Scheduling future offboardings or recurring sweeps.
- A chat interface.
- Auto-revoke without human approval.
- Destroying a server without a second, separate approval.
- Deleting user data or files.
- Payroll or final-pay calculations.
- Claiming SCIM support for third-party apps.
- Creating fake GitHub accounts (GitHub allows one free personal account per person plus one machine account).

## 5. Systems Last Day connects to

All real systems, reached through their real admin APIs.

| System | Role in the demo | Actions |
|---|---|---|
| Employee record (Last Day's own Postgres) | Source of truth | Status, manager, department, role |
| Keycloak (open-source SSO), self-hosted on Vultr | Company SSO | Disable user, end all sessions, verify |
| Mattermost Team Edition (open-source team chat), self-hosted on Vultr | Company chat | Deactivate user, revoke all sessions, verify |
| GitHub Free organization | Company code | Remove org member, cancel pending org invitations, remove outside collaborator, verify |
| Vultr account (IAM) | Company cloud | Suspend organization user, delete their API keys, halt + snapshot their servers, destroy on manager approval, verify |

Why Keycloak and Mattermost rather than Okta and Slack: Slack's deactivation API sits behind Enterprise Grid/SCIM, which is exactly the small-company gap. Google Workspace (14-day free trial, cancelled before it ends) is P1.

## 6. User flows

See [USER_FLOWS.md](USER_FLOWS.md) for screen-by-screen flows. Summary:

1. **Setup (admin, once):** connect systems, import employees, first sweep links accounts to employees; unlinked ones go to an Unknown owner list.
2. **Offboard now (HR):** open a profile, click Offboard now, confirm. The run starts immediately.
3. **Review:** exact matches (rules), probable matches (AI, with evidence and confidence), leftover servers (with monthly cost).
4. **Approve:** HR confirms or rejects each probable match, then approves revocation.
5. **Execute and verify:** each action runs, then each system is re-read; a line turns green only when that system confirms.
6. **Servers:** halted and snapshotted on HR approval; destroyed only on the manager's separate approval. Until destroyed the card says "$X/month still billing", never "saved".
7. **24-hour re-check:** once every revocation in a run is confirmed, one re-check fires 24 hours later. If anything came back, the run turns red and goes to Needs attention.
8. **Manual tools:** Sweep now (re-scan all systems for unknown accounts) and Re-check now (per run).

## 7. Functional requirements

### P0 (must ship)
| ID | Requirement |
|---|---|
| F1 | Employee directory: create/import (CSV), view profile, status (active / offboarding / offboarded), manager, department, role, work email. |
| F2 | Connections page: add an admin credential per system, Test button, health status. Credentials encrypted at rest; never shown again after saving. |
| F3 | Sweep: pull every account from every connected system and store a normalized account record (system, external id, username, display name, emails, created date, last activity if available, linked employee, link method). |
| F4 | Rule matcher: link accounts to employees by exact work email, SSO subject id, or a stored manual link. |
| F5 | AI resolver: for accounts the rules can't link, call Vultr Serverless Inference with a `json_schema` response and get `{employee_id or null, confidence 0-1, evidence[]}`. Low-confidence results escalate once to a stronger model. The model receives account metadata only, never credentials, and has no tools that change anything. |
| F6 | Offboard now: from a profile, with a confirmation dialog. Creates an offboarding run with every account linked to that employee plus probable matches. |
| F7 | Review screen: cards grouped by system; exact vs probable (with evidence and confidence) vs servers (plan, $/month). Per-card Yes/Not her for probable matches. |
| F8 | Approval: approve all or per card. Approval is recorded with approver, time and the exact action list. |
| F9 | Executor: deterministic code performs each approved action through the system's API. One action at a time per system, retries with backoff, idempotent. |
| F10 | Verifier: after each action, re-read the target system and record the observed state. A line is green only if the system confirms. |
| F11 | Servers: approval 1 (HR) halts and snapshots; approval 2 (the leaver's manager) destroys. Card shows instance $/month and snapshot storage cost. |
| F12 | 24-hour re-check: when every action in a run is verified, store `recheck_at = now + 24h`. A durable one-shot timer fires once, re-reads every revoked account and marks the run "still clean" or "regressed". Delay is a setting (default 24h; demo value a few minutes). |
| F13 | Re-check now and Sweep now buttons. |
| F14 | Audit log: every sweep, match decision, approval, API call (method, endpoint, status), verification result and re-check, with timestamps and actor. |
| F15 | Cost meter: tokens and model per AI call from the response `usage` and `model` fields, priced from the model catalog, summed per run. |
| F16 | Identity-match benchmark: a script that runs the labelled test set through rules only, rules + flash model, rules + flash + escalation, and prints accuracy and cost. Results committed to `evidence/`. |
| F17 | Demo company: seed script that creates the fictional company through the real APIs, plus a Reset demo company button. |
| F18 | Judge login on the public URL, scoped to the demo company: can reset it, offboard demo employees and read the audit log; cannot edit connections or settings. |

### P1 (if time allows)
- Joiner flow (new hire gets accounts from a role template) and mover flow (department change swaps groups/channels).
- Vultr IAM Audit Logs as independent proof of Last Day's actions.
- Google Workspace connector (free trial, cancelled before it ends).
- Exported evidence bundle per run.
- Notifications to the manager by email.

## 8. AI design

- **Where the AI is used:** only for identity resolution and ownership attribution of unlinked accounts and untagged servers.
- **Where it is not used:** deciding to revoke, executing anything, or holding credentials.
- **Models (Vultr Serverless Inference, OpenAI-compatible `/v1/chat/completions`):**
  - Default: `glm-5.3-flash` ($0.10 / $0.35 per 1M tokens, supports `json_schema`).
  - Escalation for confidence below threshold: `glm-5.2` (supports `json_schema`; 30 RPM / 8 concurrent) or `deepseek-v4.1-flash-1017`. Decide by benchmark.
  - Prices and limits from the Vultr model catalog as of 3 Nov 2026; re-check on day 1.
- **Inputs per candidate:** the leaver's profile (name, work email, known aliases, start date, team) and the unlinked account (username, display name, emails, created date, last activity, system).
- **Output schema:** `{ "employee_id": string|null, "confidence": number, "evidence": [string], "reason_if_none": string }`.
- **Always check** the response `model` field equals what was requested (docs conflict on whether a wrong id falls back silently or returns 404).

## 9. Success metrics (shown in the demo and README)

- Time from Offboard now to all lines verified green, per run.
- Accounts found per run, and how many were found only by the AI resolver.
- Identity-match accuracy on the labelled set: rules only vs rules + AI, with cost per run.
- AI cost per run in dollars.
- Re-check result (clean or regressed).

## 10. Evidence plan (what judges will see, all real)

- Real Keycloak and Mattermost on a Vultr VM, a real GitHub Free org and a real Vultr account with real IAM users/service users, API keys and instances.
- Screenshots of each system's own admin console before and after, plus the verifier's API read-backs, committed to `evidence/`.
- The labelled identity set (builder-made, disclosed as such) and the benchmark script, so the table can be re-run.
- GitHub side: one consenting real person plays the leaver, or the leaver's GitHub footprint is real pending org and repo invitations to her email; the builder's machine account can be her "CI bot". Never fake accounts, and the demo narrative must match the real account used.

## 11. Constraints

- **Hackathon rules:** Vultr VM backend and web app deployed on Vultr; Vultr is the central backend for planning, workflows and operations. No Vultr GPUs.
- **Spend:** zero beyond the $200 Vultr credit and free tiers.
- **Builder:** solo.
- **Deadline:** 8 Nov 2026, 22:00 UTC.

## 12. Risks and open questions

| Risk / question | Plan |
|---|---|
| Vultr IAM: inviting an organization user via API, whether invitees need their own Vultr account, deleting a user's API key (endpoint not documented), whether service users can hold API keys. | Capability check C1 before any code; fallback ladder in [CAPABILITY_CHECKS.md](CAPABILITY_CHECKS.md). |
| Promo credit: whether it redeems without a card and pays for Serverless Inference. | Capability check C7. |
| GitHub's one-free-account-per-person rule. | Line up one consenting real person on day 1; fallback to real pending invitations. |
| Halted Vultr servers keep billing; snapshots are billed storage. | Two-step server flow; show both costs honestly. |
| AI's role is narrow (matching), and "how effectively models are integrated" is a judging criterion. | Make the benchmark table visible: what the AI finds that rules miss, and at what cost. |
| Can one participant submit two projects to this event? | Ask on lablab Discord. |
