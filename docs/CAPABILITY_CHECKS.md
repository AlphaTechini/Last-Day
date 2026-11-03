# Last Day: Capability Checks (run before major code)

Each check is a small script in `scripts/capability-checks/`. They read credentials from `.env` (see `.env.example`), print PASS/FAIL with the raw responses, and write a log to `evidence/capability-checks/<date>-<check>.log`. Clone, fill in `.env`, run them, and only then start the main build.

Order matters: C1 and C7 can change the design, so run them first.

## C1. Vultr IAM leaver loop (top priority)

The goal is to prove we can create a Vultr identity for "Dana", give it an API key, then suspend it and remove the key via API, verifying each step.

Steps:
1. Check whether the hackathon account has, or can create, an IAM organization.
2. **Invited user path:**
   - invite an alias email via API (endpoint **to find**);
   - does the invitee need their own Vultr account, and a payment method?
   - accept the invite;
   - `POST /v2/users/{user-id}/apikeys` to create a key for that user;
   - `PUT /v2/organizations/{org}/user/{user}/suspend`;
   - delete the user's API key (endpoint not documented; **to find**);
   - re-read the user status and key list after each step.
3. **Service user path:**
   - create a service user directly (docs: https://docs.vultr.com/platform/iam/service-user/how-to-create-a-service-user; console steps documented, API path **to find**, Terraform `vultr_user` with `service_user = true` is a hint);
   - check whether it can hold API keys;
   - suspend it and delete its key, verifying each step.

Fallback ladder (decide by end of day 1):
- (a) If invited users work fully, use them.
- (b) If only service users work, Dana's Vultr footprint becomes "her CI service user + its API key + her servers".
- (c) If only suspend works, the Vultr connector does read + suspend, and the README says so.

## C2. Vultr instances
1. Create the smallest Regular instance with a label/tag `owner:dana`.
2. `GET /v2/instances` returns the tag, label and hostname.
3. `GET /v2/plans` gives the hourly/monthly price for that plan.
4. `POST /v2/instances/{id}/halt`, then confirm the status is stopped.
5. `POST /v2/snapshots` with `instance_id`, then poll until complete and record its size and storage cost.
6. `DELETE /v2/instances/{id}`, then confirm it's gone.
7. Note the timings. Halted instances keep billing until destroyed (https://docs.vultr.com/support/platform/billing/are-stopped-instances-still-billed-on-vultr), so check the console billing view too.

## C3. Keycloak admin API (current Docker image)
1. Run Keycloak with a realm `company` and a confidential client with a service account holding `view-users` and `manage-users`.
2. Get a token via client credentials.
3. List users; create a test user; log them in once so a session exists.
4. `PUT /admin/realms/company/users/{id}` with `{"enabled": false}`.
5. `POST /admin/realms/company/users/{id}/logout`.
6. Re-read the user (`enabled: false`) and their sessions (empty).

## C4. Mattermost admin API (Team Edition)
1. Create a system admin personal access token. Personal access tokens must be enabled in System Console.
2. List users with paging.
3. Create a test user and log in once.
4. `POST /api/v4/users/{id}/sessions/revoke/all`.
5. `DELETE /api/v4/users/{id}` (deactivate).
6. Re-read: `delete_at > 0`, and a login attempt fails.

## C5. GitHub Free org
1. Use a fine-grained token with org Members read/write.
2. List members, pending invitations and outside collaborators.
3. Invite an email to the org, then `DELETE /orgs/{org}/invitations/{id}` to cancel.
4. Invite an email as a repo collaborator, then `DELETE /repos/{owner}/{repo}/invitations/{id}`.
5. With the consenting real "Dana" account (if available): add as a member, then `DELETE /orgs/{org}/memberships/{username}`, then re-list.
6. Check the invitation rate limit for new orgs on the GitHub docs page before seeding.

GitHub terms allow one free personal account per person plus one free machine account (https://docs.github.com/en/site-policy/github-terms/github-terms-of-service). No fake accounts.

## C6. Serverless Inference: structured output and model check
1. `GET /v1/models`: confirm `glm-5.3-flash`, `glm-5.2` and `deepseek-v4.1-flash-1017` exist today.
2. 20 calls to `/v1/chat/completions` on `glm-5.3-flash` with a `json_schema` response format, using real-looking resolver inputs. All 20 must parse against the schema.
3. Every response has `usage` (prompt and completion tokens), and `model` equals the requested id.
4. Send a deliberately misspelled model id. Record whether it returns 404 or silently falls back to the default model; the docs disagree.
5. Repeat step 2 on the escalation candidate.

## C7. Credit and billing
1. Redeem the hackathon gift code. Note whether it asked for a payment method.
2. Create the Serverless Inference subscription and read the console "charges note".
3. After the C6 calls, check `GET /v1/usage` and the billing page: is usage drawing from the $200 promo credit, and which pricing applies (flat subscription or per-model rates)?

## C8. Company stack fits on VM 2
Run Keycloak, Mattermost and Postgres together on a VX1 2 vCPU / 8 GB. Check memory under light load and that both web consoles respond.

## `.env.example` variables (for these checks)

```
VULTR_API_KEY=
VULTR_ORG_ID=
VULTR_INFERENCE_API_KEY=
VULTR_INFERENCE_BASE_URL=https://api.vultrinference.com/v1
KEYCLOAK_BASE_URL=
KEYCLOAK_REALM=company
KEYCLOAK_CLIENT_ID=
KEYCLOAK_CLIENT_SECRET=
MATTERMOST_BASE_URL=
MATTERMOST_ADMIN_TOKEN=
GITHUB_TOKEN=
GITHUB_ORG=
GITHUB_TEST_REPO=
TEST_ALIAS_EMAIL=
```
