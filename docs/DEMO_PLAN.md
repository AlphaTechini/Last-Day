# Last Day: Demo Plan

## 1. The demo company

A fictional 30-person company, seeded through the real APIs by `scripts/seed-demo-company.ts`. **Reset demo company** re-runs the seed.

- **Employee record:** 30 people with name, work email, role, department, manager, start date and aliases where known.
- **Keycloak:** a user for each employee.
- **Mattermost:** a user for each employee, with some deliberately messy identities:
  - a nickname display name (e.g. "D. O." for Dana Okafor);
  - a contractor with a chat account but no HR record (should land in Unknown owners);
  - a shared "ops-bot" service account.
- **GitHub Free org:**
  - only real, consenting accounts, plus real pending org and repo invitations to employee alias emails;
  - the builder's machine account plays "Dana's CI bot";
  - if a consenting real person plays Dana, use their real login in the narrative. Never show an account as hers that isn't.
- **Vultr:** IAM users or service users per the C1 result, at least one API key for Dana, and one small server labelled as launched by Dana.

Disclose in the README: the company, people and seed data are created by us for the demo; the systems and API calls are real.

## 2. The 2-3 minute video

1. **Problem (15s):** "79% of ex-employees still had at least one working account after they left. At small companies it's 82%, and a third say nobody owned shutting it off." (Sagiss, Oct 2026.) Show the dashboard of the demo company.
2. **Offboard now (15s):** open Dana's profile, click Offboard now, confirm.
3. **What it found (30s):**
   - exact matches by rule;
   - two probable matches by AI with evidence and confidence;
   - her server with its monthly cost.
   - Point out that the AI only proposes; it holds no credentials and can't revoke anything.
4. **Approve and run (30s):** one approval, then lines tick green one by one as each system's own API confirms. Cut to the Keycloak, Mattermost, GitHub and Vultr consoles showing her disabled or removed.
5. **Server (15s):**
   - halted and snapshotted, card shows "still billing $X/month until destroyed";
   - the manager approves destroy and it's gone.
6. **Re-check (15s):** "24 hours after a clean run, Last Day checks again." Click Re-check now: clean.
7. **Numbers (15s):**
   - time from click to all green;
   - accounts found by rules vs by AI;
   - benchmark accuracy, rules only vs rules + AI;
   - AI cost for the run.
8. **Architecture (15s):** everything runs on Vultr: app, workflow and database on a VM; AI on Vultr Serverless Inference; and the Vultr account itself is one of the governed systems.

## 3. Judge path on the live site

1. Sign in with the judge login.
2. Reset demo company.
3. Offboard Dana, review, approve.
4. Watch it go green, open the audit log, click Re-check now.

## 4. Evidence committed to the repo (`evidence/`)

- Capability-check logs (C1-C8).
- Two full offboarding runs: audit log export and verifier read-backs.
- Before/after console screenshots for each system.
- Benchmark results JSON and the labelled identity set (marked builder-made).
- AI cost per run, from `usage`, cross-checked with `GET /v1/usage`.
