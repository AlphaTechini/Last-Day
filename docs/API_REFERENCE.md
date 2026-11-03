# Last Day: API Reference for Connectors

Status: v1, 3 Nov 2026. Written for the coding agents that implement `src/lib/server/connectors/*` and the AI resolver. Read this together with [ARCHITECTURE.md](ARCHITECTURE.md) and [CAPABILITY_CHECKS.md](CAPABILITY_CHECKS.md).

## How to read this document

Every endpoint has a confidence tag:

| Tag | Meaning |
|---|---|
| **HIGH** | Read directly from the vendor's own source code, OpenAPI file or docs, for the version we will run. |
| **MEDIUM** | Vendor source, but an older snapshot, or two vendor sources that agree only in part. Build on it, but keep the check in CAPABILITY_CHECKS. |
| **UNVERIFIED** | Not confirmed. A best guess from the strongest evidence found, with a fallback. The day-1 capability check must confirm it before the connector depends on it. |

Research constraints: this session could not reach `vultr.com`, `docs.vultr.com`, `api.vultrinference.com`, `keycloak.org` or `docs.github.com` directly. The evidence comes from:
- vendor source repos on GitHub (Keycloak `26.8.1` tag, Mattermost `v12.0.1` tag, `vultr/govultr` at 30 Oct 2026, `vultr/terraform-provider-vultr`, `vultr/iam-management-api` (Vultr's IAM OpenAPI, 1 Jun 2026), `vultr/vultr-python-client` (main Vultr OpenAPI, Aug 2025), `vultr/model-catalog-python` (Vultr's own model catalog library with captured `/v1/models` payloads, 30 Oct 2026), `github/rest-api-description` (2 Nov 2026), `github/docs`, `sveltejs/kit`, `porsager/postgres`);
- the npm registry;
- web search snippets of docs.vultr.com pages;
- a third-party research log (`Gi-Tuu/yai-guard`) that quotes `api.vultrinference.com/docs/*.md` verbatim, captured 31 Oct 2026.

Where a fact rests on search snippets or third-party quotes, it is tagged MEDIUM or UNVERIFIED.

## 0. Design-changing findings (read first)

1. **Vultr user API keys have real endpoints.** `GET/POST /v2/users/{user-id}/apikeys` and `DELETE /v2/users/{user-id}/apikeys/{apikey-id}` (204) are documented on docs.vultr.com. They are not in govultr, Terraform or the 2025 OpenAPI snapshot, so field names are UNVERIFIED. Suspend is `PUT /v2/organizations/{org-id}/user/{user-id}/suspend` (204). It is in Vultr's IAM OpenAPI and in govultr (HIGH).
2. **Vultr user id type conflict.** `/v2/users` returns UUID strings. The IAM OpenAPI types `user_id` on the suspend, unsuspend and remove paths as `integer`, and `SuspendedUser.user_id` as integer. The how-to guide says to use the uuid. Treat the id as an opaque string. If suspend returns 400 or 404 with the uuid, log the raw response and check `GET /v2/organizations/{id}/suspended-users` for the id format.
3. **There is no "list organization users" endpoint in the IAM spec.** The docs say `GET /v2/users` lists all users in the organization, including service users. Suspension state is not in the user object (govultr `User` has no status field). Verify suspension with `GET /v2/organizations/{id}/suspended-users`.
4. **Service users get an API key on creation.** `POST /v2/users` with `"service_user": true, "api_enabled": true` returns `user.api_key` once (govultr, Terraform). Terraform still sends `email` and `password` for service users, so send them too. This makes fallback (b) in C1 cheap.
5. **Serverless Inference silently falls back on a bad model id.** Vultr's quickstart says: "A model id that does not match any model is not an error on the chat routes: the request goes to `deepseek-v4.1-flash-1017`, and the answer's `model` says so." The error table also lists 404 "No model by that name exists", most likely for other routes. Keep the `model == requested` check from the PRD. At startup, also validate model ids against `GET /v1/models`, which is public and needs no key.
6. **The PRD model ids and prices are correct.** In the latest catalog capture (late Oct 2026): `glm-5.3-flash` costs $0.10 / $0.35 per 1M tokens (120 RPM, 16 concurrent). `glm-5.2` costs $0.75 / $3.00 (30 RPM, 8 concurrent). `deepseek-v4.1-flash-1017` costs $0.15 / $0.60 (120 RPM, 16 concurrent) and is the gateway default. All three list `response_format` and `structured_outputs`. The ids churn: a mid-September capture had `deepseek-v4.1-flash` without the `-1017` suffix. Read the catalog at runtime rather than hard-coding prices.
7. **The two Inference price sources disagree.** The product page and a support doc (updated 26 Oct 2026) say a flat "$0.55 per 1M input, $2.75 per 1M output". The model catalog gives per-model prices. Price the cost meter from the catalog, show the flat rate as an upper bound, and reconcile with `GET /v1/usage` in C7.
8. **All three candidate models are reasoning models.** Reasoning tokens count toward `completion_tokens` and are billed. The default `max_completion_tokens` is 32768. Set `reasoning_effort` low (`"low"` or `"minimal"`) and cap `max_completion_tokens` for the resolver.
9. **GitHub repo invitations need a GitHub username, not an email.** `PUT /repos/{owner}/{repo}/collaborators/{username}` only takes a username. Only org invitations (`POST /orgs/{org}/invitations`) accept an `email`. The demo's "pending repo invitation to her email" is not possible. Use org email invitations for the email-only footprint.
10. **New GitHub orgs can send only 50 org invitations per 24 hours.** The limit is 500 once the org is more than a month old or on a paid plan. Demo resets that re-invite will burn through this.
11. **SvelteKit is now v3 (3.0.0 shipped 1 Oct 2026; 3.1.1 is latest).** It needs Node >= 22.17, Vite 8, and TypeScript 6. `typescript@latest` is 7.0.2, which does not satisfy Kit's peer range. `svelte.config.js` is gone (config moves into the `sveltekit()` Vite plugin), `$lib` becomes `#lib`, and `$env/*` is deprecated in favour of `$app/env/private`. adapter-node 6 removed the `ORIGIN` env var. Remote functions are still experimental. Section 6 has the details.
12. **postgres.js 4.0.0 is 5 days old** and has a known memory-growth bug that is fixed in the unreleased 4.0.1. Pin `postgres@3.4.9` unless 4.0.1+ is out and tested with drizzle.

---

## 1. Keycloak (26.8.1)

Latest release: **26.8.1** (git tag). Image: `quay.io/keycloak/keycloak:26.8.1`. HIGH.

Common to every admin call:
- Base: `{KEYCLOAK_BASE_URL}` (no `/auth` prefix since Keycloak 17).
- Header: `Authorization: Bearer {access_token}`; `Content-Type: application/json` on writes.
- Errors: 401 means the token is missing or expired (get a new one and retry once). 403 means the service account lacks a role. 404 means not found, with body `{"error":"User not found"}` (MEDIUM: exact text). Validation errors on 400 and 409 return `ErrorRepresentation` `{"errorMessage": "...", "field": "...", "params": [...]}`.

### 1.1 Token (client credentials) [HIGH]

`POST /realms/{realm}/protocol/openid-connect/token`

Headers: `Content-Type: application/x-www-form-urlencoded`

Body (form): `grant_type=client_credentials&client_id={id}&client_secret={secret}` (or HTTP Basic auth with id:secret).

```json
{
  "access_token": "eyJ...",
  "expires_in": 300,
  "refresh_expires_in": 0,
  "token_type": "Bearer",
  "not-before-policy": 0,
  "scope": "profile email"
}
```

- No refresh token is issued for client credentials by default, so request a new token when `expires_in` is close (cache with a 30 s margin).
- Errors: `401 {"error":"invalid_client"}` for a bad secret. `400 {"error":"unauthorized_client"}` if service accounts are not enabled on the client.

To create a session for the C3 test user, use the password grant on a separate public client that has `directAccessGrantsEnabled: true`. Send `grant_type=password&client_id=demo-login&username=...&password=...`. Each successful call creates a user session (HIGH).

### 1.2 List users [HIGH]

`GET /admin/realms/{realm}/users?first={offset}&max={n}&briefRepresentation={bool}`

Query params (from `UsersResource.java` at 26.8.1): `search`, `lastName`, `firstName`, `email`, `username`, `emailVerified`, `idpAlias`, `idpUserId`, `first` (offset), `max` (default 100), `enabled`, `briefRepresentation` (default false), `exact`, `q` (attribute query `key1:value1 key2:value2`), `createdAfter` and `createdBefore` (ISO date or epoch ms; new in 26.x).

- Pagination is offset based. Loop `first += max` until a page returns fewer than `max`. Total: `GET /admin/realms/{realm}/users/count` returns an integer and takes the same filters.
- Service-account users (`service-account-<clientId>`) are excluded from the plain listing.
- `briefRepresentation=true` returns only `id, username, firstName, lastName, email, emailVerified, enabled, createdTimestamp, federationLink`, with no attributes. Use `false` (the default), because we want `attributes`.
- Response 200: an array of `UserRepresentation`. 403 without `view-users`.

```json
[
  {
    "id": "6f1c2c7e-...",
    "username": "dana.k",
    "firstName": "Dana",
    "lastName": "Kim",
    "email": "dana@company.test",
    "emailVerified": true,
    "enabled": true,
    "createdTimestamp": 1793700000000,
    "federationLink": null,
    "attributes": { "employee_id": ["E042"] },
    "totp": false,
    "notBefore": 0,
    "requiredActions": [],
    "disableableCredentialTypes": [],
    "access": { "manage": true }
  }
]
```

`createdTimestamp` is epoch milliseconds. Keycloak keeps no "last login" field. For `lastActiveAt`, use the max `lastAccess` from the sessions endpoint (1.5), or leave it null.

### 1.3 Get user [HIGH]

`GET /admin/realms/{realm}/users/{id}` (optional `?userProfileMetadata=true`)

Returns the same `UserRepresentation`. When identity brokering is enabled in the realm, it also includes `federatedIdentities: [{ "identityProvider": "github", "userId": "...", "userName": "..." }]`. Federated identities are not in the list response. If you need them for every user, call `GET /admin/realms/{realm}/users/{id}/federated-identity`, which returns an array of `{identityProvider, userId, userName}`. That is N+1 calls, so only do it for candidates.

Verify: `enabled == false`. 404 means the user was deleted, which also counts as revoked; store it as a distinct state.

### 1.4 Disable user [HIGH]

`PUT /admin/realms/{realm}/users/{id}` with body `{"enabled": false}`, returns **204**.

- In 26.8.1, `updateUser` keeps existing attributes when `attributes` is absent from the body (`profile.update(false)`), so a partial body is safe. If validation fails (for example a required user-profile attribute is missing), you get a 400 with `ErrorRepresentation`. Fallback: GET the user, set `enabled=false` and PUT the full representation.
- Needs `manage-users`. 409 means a username or email conflict, which should not happen on a disable.

### 1.5 End sessions [HIGH]

`POST /admin/realms/{realm}/users/{id}/logout` (no body), returns **204**.

The implementation sets the user's `notBefore` to now, which invalidates every token issued earlier, including offline and refresh tokens. It then back-channel logs out each online user session.

`GET /admin/realms/{realm}/users/{id}/sessions` returns 200 with an array of `UserSessionRepresentation`:

```json
[
  { "id": "a1b2...", "username": "dana.k", "userId": "6f1c...", "ipAddress": "203.0.113.5",
    "start": 1793710000000, "lastAccess": 1793711000000, "rememberMe": false,
    "clients": { "c-uuid": "account-console" }, "transientUser": false }
]
```

Verify: the array is empty. Offline sessions are listed per client with `GET /admin/realms/{realm}/users/{id}/offline-sessions/{clientUuid}`. They are optional to check, because `notBefore` already invalidates offline tokens.

### 1.6 Realm bootstrap for docker-compose [MEDIUM]

Compose service:

```yaml
keycloak:
  image: quay.io/keycloak/keycloak:26.8.1
  command: ["start-dev", "--import-realm"]   # use `start` + KC_HOSTNAME + TLS in prod
  environment:
    KC_BOOTSTRAP_ADMIN_USERNAME: admin        # 26.x name (KEYCLOAK_ADMIN is legacy)
    KC_BOOTSTRAP_ADMIN_PASSWORD: ${KC_ADMIN_PASSWORD}
    KC_DB: postgres
    KC_DB_URL: jdbc:postgresql://postgres:5432/keycloak
    KC_DB_USERNAME: keycloak
    KC_DB_PASSWORD: ${KC_DB_PASSWORD}
    KC_HTTP_ENABLED: "true"
    KC_HEALTH_ENABLED: "true"                 # health on management port 9000
    LASTDAY_CLIENT_SECRET: ${LASTDAY_CLIENT_SECRET}
  volumes:
    - ./keycloak/import:/opt/keycloak/data/import:ro
```

`./keycloak/import/company-realm.json` (minimal). `view-users` is a composite role that includes `query-users` and `query-groups`. Keycloak's import replaces `${ENV_VAR}` placeholders with environment values (MEDIUM). Hard-code the secret if the placeholder does not resolve.

```json
{
  "realm": "company",
  "enabled": true,
  "clients": [
    {
      "clientId": "last-day",
      "name": "Last Day offboarding",
      "enabled": true,
      "protocol": "openid-connect",
      "publicClient": false,
      "clientAuthenticatorType": "client-secret",
      "secret": "${LASTDAY_CLIENT_SECRET}",
      "serviceAccountsEnabled": true,
      "standardFlowEnabled": false,
      "directAccessGrantsEnabled": false,
      "implicitFlowEnabled": false
    },
    {
      "clientId": "demo-login",
      "enabled": true,
      "publicClient": true,
      "directAccessGrantsEnabled": true,
      "standardFlowEnabled": true,
      "redirectUris": ["*"]
    }
  ],
  "users": [
    {
      "username": "service-account-last-day",
      "enabled": true,
      "serviceAccountClientId": "last-day",
      "clientRoles": { "realm-management": ["view-users", "manage-users"] }
    }
  ]
}
```

The import runs only if the realm does not exist yet. To reset the demo, drop the realm with `DELETE /admin/realms/company` using the master-realm admin, or rebuild the volume. You can also seed the demo users through `POST /admin/realms/{realm}/users`, which returns 201 with the new id in the `Location` header.

Create-user body (seed script):

```json
{ "username": "dana.k", "email": "dana@company.test", "firstName": "Dana", "lastName": "Kim",
  "enabled": true, "emailVerified": true, "attributes": { "department": ["Data"] },
  "credentials": [{ "type": "password", "value": "...", "temporary": false }] }
```

Keycloak 26 turns on the declarative user profile by default. Custom `attributes` that are not declared in the realm user profile are dropped unless "Unmanaged attributes" is enabled. Fix: add `"attributes"` definitions to the realm user-profile config, or turn on unmanaged attributes (realm Settings > General > Unmanaged attributes = Enabled). (MEDIUM)

---

## 2. Mattermost (v12.0.1, Team Edition)

Latest tag: **v12.0.1** (the 11.x line ends at 11.11.3). Docker image `mattermost/mattermost-team-edition:<tag>`. **UNVERIFIED** that a 12.0.1 image exists on Docker Hub (mirrors only showed 11.x when we searched). Pin `11.11.3` if 12.x is missing. The endpoints below have been stable since v5, and the spec quotes are from the v12.0.1 tag (HIGH).

Common:
- Base: `{MATTERMOST_BASE_URL}/api/v4`.
- Auth: `Authorization: Bearer {personal_access_token}`.
- Paging: `page` (0-based) and `per_page` (default 60, **max 200**; larger values are silently truncated). Loop until a page returns fewer than `per_page`.
- Rate limit headers: `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`. 429 body is `limit exceeded`. Rate limiting is off by default on self-hosted servers.
- Error body: `{"id":"api.context.permissions.app_error","message":"...","detailed_error":"","request_id":"...","status_code":403}`.

### 2.1 Enable personal access tokens [HIGH]

Config key `ServiceSettings.EnableUserAccessTokens` (default `false`). Env override: `MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true`.

Other useful env vars:
- `MM_SERVICESETTINGS_ENABLELOCALMODE=true`, so `mmctl --local` can bootstrap the first admin from inside the container.
- `MM_SQLSETTINGS_DRIVERNAME=postgres`
- `MM_SQLSETTINGS_DATASOURCE=postgres://mmuser:pw@postgres:5432/mattermost?sslmode=disable`
- `MM_SERVICESETTINGS_SITEURL=https://chat.<host>`
- `MM_SERVICESETTINGS_ENABLEBOTACCOUNTCREATION=true` (default false)

`ServiceSettings.DisableBotsWhenOwnerIsDeactivated` defaults to **true**: deactivating the leaver also disables the bots they own. Show this on the review screen.

Bootstrap:
1. `docker exec mm mmctl --local user create --email admin@company.test --username admin --password ... --system-admin`
2. Log in: `POST /api/v4/users/login` with `{"login_id":"admin","password":"..."}`. The session token is in the `Token` response header.
3. `POST /api/v4/users/{admin_id}/tokens` with `{"description":"last-day"}` returns 201 `{"id","token","user_id","description"}`. `token` is shown only once.

### 2.2 List users [HIGH]

`GET /api/v4/users?page={n}&per_page=200` plus optional `active=true` **or** `inactive=true` (mutually exclusive). Other filters: `in_team`, `not_in_team`, `in_channel`, `without_team`, `role`, `roles`, `sort`.

Response 200, an array of User:

```json
[
  {
    "id": "8x7k...",
    "create_at": 1793700000000,
    "update_at": 1793700000000,
    "delete_at": 0,
    "username": "dkim",
    "auth_service": "",
    "email": "dana.kim.personal@example.com",
    "nickname": "dk",
    "first_name": "Dana",
    "last_name": "K",
    "position": "Data analyst",
    "roles": "system_user",
    "locale": "en",
    "is_bot": false,
    "last_activity_at": 1793711000000
  }
]
```

- With a system-admin token, `email` is always included. Other users only see it if `PrivacySettings.ShowEmailAddress` is on.
- `auth_service` is `""` for email/password, otherwise `gitlab`, `ldap`, `saml`, `openid` or `google`. Map it to `link_method` evidence.
- `last_activity_at` has `omitempty` on the struct and is only populated in some list contexts (UNVERIFIED for plain listing). Fallbacks: `GET /api/v4/users/{id}/status` returns `{user_id, status, manual, last_activity_at}`, or take the max `last_activity_at` from sessions (2.4).
- Bots also appear in `/users` with `is_bot: true`. To find bots and their owner, use `GET /api/v4/bots?page=&per_page=&include_deleted=true`, which returns `[{user_id, username, display_name, description, owner_id, create_at, update_at, delete_at}]`. A bot whose `owner_id` is the leaver is a finding.

### 2.3 Get user [HIGH]

`GET /api/v4/users/{user_id}` returns 200 with a User, or 404. Verify: `delete_at > 0`.

### 2.4 Revoke sessions [HIGH]

`POST /api/v4/users/{user_id}/sessions/revoke/all` (no body) returns 200 `{"status":"OK"}`. Needs `edit_other_users`.

`GET /api/v4/users/{user_id}/sessions` returns `[{id, create_at, expires_at, last_activity_at, user_id, device_id, roles, is_oauth, props}]`. Verify: empty. Note that personal-access-token sessions also show here.

### 2.5 Deactivate [HIGH]

`DELETE /api/v4/users/{user_id}` returns 200 `{"status":"OK"}`. It archives the user (`delete_at` = now) **and revokes all sessions**, so 2.4 first is belt and braces. Do not pass `permanent=true`: that is a hard delete, which is a non-goal, and it needs `EnableAPIUserDeletion`.

Alternative: `PUT /api/v4/users/{user_id}/active` with `{"active": false}`.

The leaver's own personal access tokens stop working while the account is inactive. To revoke them explicitly, list with `GET /api/v4/users/{user_id}/tokens` and call `POST /api/v4/users/tokens/revoke` with `{"token_id": "..."}` (HIGH for the path; optional for P0).

### 2.6 Create user (seed) [HIGH]

`POST /api/v4/users` with body `{"email","username","password","first_name","last_name","nickname","position"}`; returns 201 with a User. `EnableOpenServer` defaults to false, so use the admin token. Add the user to a team with `POST /api/v4/teams/{team_id}/members` and `{"team_id","user_id"}`.

---

## 3. GitHub REST (API version 2022-11-28)

Spec source: `github/rest-api-description` (2 Nov 2026) and `github/docs` permissions data. All HIGH unless noted.

Common headers:

```
Authorization: Bearer {fine-grained PAT}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
User-Agent: last-day
```

- **Pagination:** `per_page` (default 30, max 100) and `page`. Follow `Link: <...&page=2>; rel="next"` until there is no `rel="next"`.
- **Rate limit:** 5,000 requests per hour for a PAT. Read `x-ratelimit-remaining` and `x-ratelimit-reset`. Secondary limits return 403 or 429 with `retry-after`, and are triggered by content-creating calls such as invitations. Keep the executor serial, as the architecture already does.
- **Errors:** `{"message": "...", "documentation_url": "...", "status": "404"}`. 404 also covers "no permission" on private resources. 422 means validation failed.

### 3.1 Fine-grained token [HIGH]

Create the token with **resource owner = the org**. The org must allow fine-grained PATs and may require approval (Org settings > Personal access tokens). The token owner must be an **org owner** for invitations and membership removal.

| Endpoint | Permission |
|---|---|
| `GET /orgs/{org}/members`, `GET /orgs/{org}/invitations`, `GET /orgs/{org}/outside_collaborators`, `GET /orgs/{org}/memberships/{username}` | Organization **Members: read** |
| `POST /orgs/{org}/invitations`, `DELETE /orgs/{org}/invitations/{id}`, `DELETE /orgs/{org}/memberships/{username}`, `PUT /orgs/{org}/memberships/{username}`, `DELETE /orgs/{org}/outside_collaborators/{username}` | Organization **Members: read and write** |
| `GET /orgs/{org}/repos`, `GET /repos/{o}/{r}/collaborators` | Repository **Metadata: read** (always granted) |
| `GET /repos/{o}/{r}/invitations` | Repository **Administration: read** |
| `DELETE /repos/{o}/{r}/invitations/{id}`, `PUT /repos/{o}/{r}/collaborators/{username}` | Repository **Administration: read and write** |
| `GET /users/{username}` | none (public) |

Select "All repositories" (or the demo repos) under repository access.

### 3.2 Read endpoints

**List org members:** `GET /orgs/{org}/members?per_page=100&page=1` (also `role=all|admin|member`, `filter=all|2fa_disabled|2fa_insecure`). Returns 200 with an array of `simple-user`: `{login, id, node_id, avatar_url, html_url, type, site_admin, user_view_type}`. Members' emails are **not** returned.

**Membership state:** `GET /orgs/{org}/memberships/{username}` returns 200 `{state: "active"|"pending", role: "admin"|"member", user, organization, direct_membership}`, or 404 if the user is not a member. Use this for verify.

**Pending org invitations:** `GET /orgs/{org}/invitations?per_page=100`. `role` filter: `all, admin, direct_member, billing_manager, hiring_manager`. `invitation_source`: `all, member, scim`.

```json
[
  { "id": 123456, "node_id": "...", "login": null, "email": "dana.personal@example.com",
    "role": "direct_member", "created_at": "2026-11-03T10:00:00Z",
    "inviter": { "login": "builder" }, "team_count": 0,
    "invitation_teams_url": "...", "invitation_source": "member" }
]
```

`login` is null when the invitee has no GitHub account. Failed or expired invites: `GET /orgs/{org}/failed_invitations` adds `failed_at` and `failed_reason`.

**Outside collaborators:** `GET /orgs/{org}/outside_collaborators?per_page=100` returns an array of `simple-user`.

**Org repos:** `GET /orgs/{org}/repos?type=all&per_page=100` returns minimal-repository objects. We need `{id, name, full_name, private, owner.login, archived}`.

**Repo invitations (per repo):** `GET /repos/{owner}/{repo}/invitations?per_page=100`

```json
[
  { "id": 987654, "node_id": "...", "invitee": { "login": "dana-k" }, "inviter": { "login": "builder" },
    "permissions": "write", "created_at": "2026-11-03T10:00:00Z", "expired": false,
    "repository": { "full_name": "acme/api" }, "url": "...", "html_url": "..." }
]
```

**User profile:** `GET /users/{username}` returns 200 public-user:

```json
{ "login": "dana-k", "id": 1234567, "name": "Dana Kim", "company": "@acme", "blog": "",
  "location": "Berlin", "email": null, "bio": null, "twitter_username": null,
  "created_at": "2019-04-01T12:00:00Z", "updated_at": "2026-10-30T08:00:00Z",
  "public_repos": 12, "followers": 3, "following": 1, "type": "User" }
```

`email` is only the public email and is usually null. `created_at` and `name` are the useful AI-resolver signals.

### 3.3 Revoke endpoints

| Action | Call | Success | Notes |
|---|---|---|---|
| Remove member | `DELETE /orgs/{org}/memberships/{username}` | 204 | Also cancels a pending invite for that username. 403 if the token user is not an owner. 404 if not a member. Emails the user. |
| Cancel org invite | `DELETE /orgs/{org}/invitations/{invitation_id}` | 204 | 404 if already gone. Emails the user. |
| Remove outside collaborator | `DELETE /orgs/{org}/outside_collaborators/{username}` | 204 | Removes them from all org repos. 422 if the user is a member, not an outside collaborator. |
| Delete repo invite | `DELETE /repos/{owner}/{repo}/invitations/{invitation_id}` | 204 | |
| (alt) Remove member | `DELETE /orgs/{org}/members/{username}` | 204 | Same effect for active members. |
| (alt) Remove repo collaborator | `DELETE /repos/{owner}/{repo}/collaborators/{username}` | 204 | For direct collaborators who are org members. |

Treat 404 on a DELETE as "already revoked", then verify by re-listing.

### 3.4 Seeding the demo

- Org invite by email: `POST /orgs/{org}/invitations` with `{"email": "...", "role": "direct_member"}` (or `invitee_id`; `team_ids` optional). Returns 201 with an organization-invitation. **Limit: 50 per 24 hours** for orgs under one month old on a free plan, 500 otherwise.
- Repo invite: `PUT /repos/{owner}/{repo}/collaborators/{username}` with `{"permission": "push"}`. Returns 201 with a repository-invitation, or 204 if the user is already a collaborator. **Username only, no email.**

---

## 4. Vultr API v2

Base: `https://api.vultr.com/v2`. Auth: `Authorization: Bearer {VULTR_API_KEY}`. JSON bodies. HIGH.

Common:
- **Pagination:** `per_page` (default 100, max 500 on most routes; the IAM routes say default 20, max 100) and `cursor`. The response has `"meta": {"total": 31, "links": {"next": "<cursor>", "prev": ""}}`. Loop while `meta.links.next` is non-empty, passing it as `cursor`. The cursor is opaque.
- **Rate limit:** about 30 requests per second per source IP, then 429. govultr retries with backoff, and we should too.
- **Codes:** 200, 201, 202 (accepted, async), 204, 400, 401, 403 (`{"error":"Forbidden","message":"Not allowed to use IAM endpoints"}` on IAM routes without rights), 404, 429, 500. Every 4xx has an `{"error": "..."}` body.
- **API key IP allowlist:** account API keys can be restricted by IP in the portal (Settings > API > Access Control). Add VM 1's IP, or the calls fail with 401 or 403 (MEDIUM).

### 4.1 Account [HIGH]

`GET /v2/account` returns:

```json
{ "account": { "name": "...", "email": "...", "acls": ["manage_users", "subscriptions", "billing", "..."],
  "balance": -200.0, "pending_charges": 3.12, "last_payment_date": "...", "last_payment_amount": 0 } }
```

Use it for `test()`. Promo credit shows as a negative `balance`. `pending_charges` is useful in C7.

### 4.2 Users (account users, organization users, service users)

| Call | Method and path | Body | Response | Confidence |
|---|---|---|---|---|
| List users | `GET /v2/users?per_page=&cursor=` | | `{ "users": [User], "meta": {...} }` | HIGH (path), MEDIUM (that it lists org members) |
| Get user | `GET /v2/users/{user-id}` | | `{ "user": User }` | HIGH |
| Create user | `POST /v2/users` | `{ "email", "name", "password", "api_enabled": true, "acls": [...], "service_user": false }` | 201 `{ "user": User }` with `api_key` set once when `api_enabled` | HIGH |
| Update user | `PATCH /v2/users/{user-id}` | any of `email, name, password, api_enabled, acls` | 204 | HIGH |
| Delete user | `DELETE /v2/users/{user-id}` | | 204 | HIGH (not used: delete is a non-goal) |

User object (govultr, current):

```json
{ "user": { "id": "cb676a46-66fd-4dfb-b839-443f2e6c0b60", "name": "Dana CI", "email": "dana+ci@company.test",
  "api_enabled": true, "acls": ["subscriptions_view", "provisioning"], "service_user": true,
  "api_key": "ONLY-ON-CREATE" } }
```

- There are **no `date_created`, status or last-activity fields.** `createdAt` and `lastActiveAt` stay null for Vultr users. The docs mention a "status" in the List Users response (UNVERIFIED field name), so log `raw` on the first sweep.
- `acls` values: `abuse, alerts, billing, dns, firewall, loadbalancer, manage_users, objstore, provisioning, subscriptions, subscriptions_view, support, upgrade`.
- **Service user:** `POST /v2/users` with `"service_user": true, "api_enabled": true`. Send `email` and `password` as well (Terraform requires them). Docs say service users cannot log into the console. The response includes `api_key` once.
- **Cheapest revoke option** (documented, HIGH): `PATCH /v2/users/{id}` with `{"api_enabled": false}` disables every API key of that user. Use it as a fallback if key deletion fails.

### 4.3 User API keys [UNVERIFIED shapes, MEDIUM paths]

Paths are from docs.vultr.com pages ("Create / List / Delete API Key", "How to delete an API key for a user"), seen through search snippets only. They are not in govultr, Terraform or the Aug 2025 OpenAPI.

| Call | Method and path | Notes |
|---|---|---|
| List a user's keys | `GET /v2/users/{user-id}/apikeys` | Best guess: `{ "api_keys": [ { "id", "name", "api_key": "masked", "expire": false, "date_expire": null, "date_created"? } ], "meta": {...} }` |
| Create key for a user | `POST /v2/users/{user-id}/apikeys` | Body `{ "name": "dana-ci", "expire": false }` or `{ "name", "expire": true, "date_expire": "2026-12-01T00:00:00Z" }`. One page says **202 Accepted**. The response holds the plain key once, probably `{ "api_key": { "id", "name", "api_key": "...", ... } }`. |
| Get one key | `GET /v2/users/{user-id}/apikeys/{apikey-id}` | |
| Delete a user's key | `DELETE /v2/users/{user-id}/apikeys/{apikey-id}` | **204 No Content.** The key is invalid immediately. Needs root, or a user with Manage Users. |
| Current user's own keys | `GET/POST /v2/apikeys`, `DELETE /v2/apikeys/{apikey-id}` | Same body fields. |

The docs also reference a "Rotate API Key" operation for both the current and other users. Its path was not captured.

Connector rule: parse the list response defensively. Accept `api_keys`, `apikeys` or `keys`, and fall back to the first array in the body. Store `raw`. On any 404 or 405 from these paths, fall back to `PATCH api_enabled=false` and report it.

### 4.4 Organizations and suspension (IAM) [HIGH paths, from Vultr's IAM OpenAPI and govultr]

| Call | Method and path | Response |
|---|---|---|
| List orgs | `GET /v2/organizations?per_page=&cursor=` | `{ "orgs": [ { "id": "uuid", "name", "type": "Personal/Team" or "Business/Enterprise", "date_created" } ], "meta" }` |
| Get org | `GET /v2/organizations/{id}` | Organization |
| Create org | `POST /v2/organizations` with `{ "name", "type"? }` | 201 Organization |
| **Suspend user** | `PUT /v2/organizations/{id}/user/{user_id}/suspend` (no body) | **204**; 401, 403, 404 |
| Unsuspend | `PUT /v2/organizations/{id}/user/{user_id}/unsuspend` | 204 |
| **List suspended** | `GET /v2/organizations/{id}/suspended-users?per_page=&cursor=` | `{ "users": [ { "user_id", "name", "email", "date_suspended" } ], "meta" }` |
| Remove from org | `DELETE /v2/organizations/{id}/user/{user_id}` | 204 (not used) |
| Invite | `POST /v2/invitation` with `{ "email_invited": "...", "permissions": { "api_enabled": "yes" } }` | 201 `{ id, email_invited, email_registered, status, invite_status, org_id, expiration_date, ... }` |
| List invites | `GET /v2/invitation` | `{ "invites": [...], "meta" }` |
| Get or resend invite | `GET /v2/invitation/{id}`, `POST /v2/invitation/{id}/resend` | |
| User's groups, roles, policies | `GET /v2/users/{user-id}/groups`, `/roles`, `/policies` | `roles` and `policies` are `{all, direct, inherited}` |
| Assumed-role sessions | `GET /v2/assumed-roles/users/{user_id}/sessions`, `DELETE /v2/assumed-roles/{session_token}` | Temporary role sessions. Revoke them if any exist. |
| Audit logs (P1) | `GET /v2/logs/?start_time=&end_time=&log_level=&resource_type=&resource_id=` | `{ "logs": [ { resource_id, resource_type, log_level, message, timestamp, metadata } ], "meta" }`, last 30 days |

Notes:
- `user_id` type: the spec says integer, and docs and `/v2/users` say uuid (see section 0, finding 2). **UNVERIFIED.**
- Invitations expire after 3 days. Whether a new email needs its own Vultr account (and payment method) to accept is **UNVERIFIED**. This is C1.
- The IAM repo also defines SCIM routes (`/v2/organizations/{id}/scim/enable`, `/scim/v2/Users`). SCIM `active` could be another suspend path. Not needed for P0.
- `org_id` for suspend: take it from `GET /v2/organizations` and store it in `connections.config_json` (`VULTR_ORG_ID`).

### 4.5 Instances [HIGH]

`GET /v2/instances?per_page=500&cursor=` (filters: `tag`, `label`, `main_ip`, `region`) returns `{ "instances": [Instance], "meta" }`.

```json
{ "id": "cb676a46-...", "label": "dana-scratch", "hostname": "dana-scratch", "tags": ["owner:dana"],
  "plan": "vc2-1c-1gb", "region": "ewr", "main_ip": "203.0.113.10", "os": "Ubuntu 24.04 LTS x64",
  "date_created": "2026-11-03T09:00:00+00:00",
  "status": "active", "power_status": "running", "server_status": "ok",
  "vcpu_count": 1, "ram": 1024, "disk": 25, "allowed_bandwidth": 1000, "features": [] }
```

- `status`: `active | pending | suspended | resizing`.
- `power_status`: `running | stopped`.
- `server_status`: `none | locked | installingbooting | ok`.
- `tag` is deprecated; use `tags[]`.
- Vultr has no "created by user" field. Ownership comes from tags or label (rules), the AI resolver, or the IAM audit logs filtered by `resource_id` (P1).

| Action | Call | Success | Verify |
|---|---|---|---|
| Get | `GET /v2/instances/{id}` | 200 `{ "instance": {...} }`, 404 when gone | |
| Halt | `POST /v2/instances/{id}/halt` (no body) | **204** | Poll GET until `power_status == "stopped"` |
| Snapshot | `POST /v2/snapshots` with `{ "instance_id": "...", "description": "last-day run 42 dana-scratch" }` | **201** `{ "snapshot": { id, status: "pending", ... } }` | Poll `GET /v2/snapshots/{id}` until `status == "complete"` |
| Destroy | `DELETE /v2/instances/{id}` | **204** | GET returns 404 |
| Create (seed) | `POST /v2/instances` with `{ "region", "plan", "os_id", "label", "hostname", "tags": ["owner:dana"] }` | 202 `{ "instance": {...} }` | Get `os_id` from `GET /v2/os`. |

Halted instances **keep billing** until destroyed.

### 4.6 Snapshots [HIGH]

`GET /v2/snapshots/{id}`:

```json
{ "snapshot": { "id": "...", "date_created": "...", "description": "...", "size": 26843545600,
  "compressed_size": 3221225472, "status": "pending|complete|deleted", "os_id": 2284, "app_id": 0 } }
```

`size` and `compressed_size` are in **bytes**. Storage costs **$0.05 per GB per month, billed on the compressed size** (Vultr snapshot FAQ and billing doc, unchanged since 2021; MEDIUM). Card value: `compressed_size / 1e9 * 0.05` $/month. Show a "billing estimate" label.

### 4.7 Plans [HIGH, except hourly]

`GET /v2/plans?type=all&per_page=500` returns `{ "plans": [Plan], "meta" }`. Type filter values: `all, vc2, vdc, vhf, vhp, voc, voc-g, voc-c, voc-m, voc-s, vcg`. A newer "VX1" family may have its own type code (UNVERIFIED), so always use `type=all` and match by `plan` id.

```json
{ "id": "vc2-1c-1gb", "vcpu_count": 1, "ram": 1024, "disk": 25, "disk_count": 1, "bandwidth": 1024,
  "monthly_cost": 5, "type": "vc2", "locations": ["ewr", "ams"] }
```

- `monthly_cost` is a number in USD (float in govultr).
- **`hourly_cost` is not in any source** (govultr, Terraform, OpenAPI). UNVERIFIED. If it is present at runtime, use it. Otherwise estimate the hourly rate as `monthly_cost / 730` with the monthly price as a cap, and label it as an estimate.

### 4.8 Serverless Inference subscription management (v2 API) [HIGH]

`GET /v2/inference` returns `{subscriptions: [{id, date_created, label, api_key}]}`. `POST /v2/inference` with `{label}` creates one. `GET /v2/inference/{id}/usage` returns:

```json
{ "usage": { "chat_by_model": { "current_month": [ { "model", "tokens", "input_tokens", "input_price", "output_price" } ], "previous_month": [] }, "audio": {}, "image": {} } }
```

Use this for C7 reconciliation if `/v1/usage` is awkward.

---

## 5. Vultr Serverless Inference

Base: `https://api.vultrinference.com/v1`. OpenAI-compatible; "OpenRouter's chat completion, which is OpenAI's with more fields". Use the plain `openai` npm SDK with `baseURL`, or `fetch`.

### 5.1 Auth [MEDIUM: quoted from Vultr docs via a third-party capture dated 31 Oct 2026]

- `Authorization: Bearer {VULTR_INFERENCE_API_KEY}` (capital B). `x-api-key` also works; if both are sent, `Authorization` wins.
- The key comes from Console > Serverless > Inference > subscription > API Key, or from `GET /v2/inference`.
- 401 body: `{"error":{"code":401,"message":"Invalid API key","type":"auth_error","metadata":{"error_type":"authentication"}}}`. Do not retry.

### 5.2 Models [HIGH shape, MEDIUM for current values]

`GET /v1/models` is **public, no key needed**. It returns `{ "data": [ModelDocument] }` (OpenRouter provider Model Document, schema 2.4).

`GET /v1/models?format=openrouter&output_modalities=text` returns the flat OpenRouter shape, which is easier to parse and the one to use:

```json
{ "data": [ {
    "id": "glm-5.3-flash", "name": "GLM 5.3 Flash", "created": 1788837087, "context_length": 1048576,
    "architecture": { "input_modalities": ["text","image","file","video"], "output_modalities": ["text"] },
    "pricing": { "prompt": "0.0000001", "completion": "0.00000035" },
    "top_provider": { "context_length": 1048576, "max_completion_tokens": 1048576 },
    "supported_parameters": ["temperature","top_p","max_tokens","max_completion_tokens","seed",
      "response_format","structured_outputs","tools","tool_choice","reasoning","reasoning_effort"],
    "reasoning": { "mandatory": false, "supports_max_tokens": true,
      "supported_efforts": ["ultra","max","xhigh","high","medium","low","minimal"] },
    "rate_limits": { "text": { "requests_per_minute": 120, "concurrent_requests": 16 } }
} ], "total_count": 29, "links": { "next": null } }
```

Prices are **USD per token as decimal strings**. Per 1M tokens: `Number(price) * 1e6`, or shift the decimal point to avoid float error.

Current chat models (OpenRouter-format capture in `vultr/model-catalog-python` fixtures, late Oct 2026; matches the 31 Oct docs capture):

| id | $/1M in | $/1M out | ctx | RPM / concurrent | json_schema |
|---|---|---|---|---|---|
| **glm-5.3-flash** (PRD default) | 0.10 | 0.35 | 1,048,576 | 120 / 16 | yes |
| **glm-5.2** (escalation) | 0.75 | 3.00 | 1,048,576 | 30 / 8 | yes |
| glm-5.3 | 0.75 | 3.00 | 1,048,576 | 30 / 8 | yes |
| **deepseek-v4.1-flash-1017** (escalation, gateway default) | 0.15 | 0.60 | 1,048,576 | 120 / 16 | yes |
| qwen3.8-flash-next | 0.10 | 0.20 | 262,144 | 120 / 16 | yes |
| qwen3.8-27b | 0.15 | 1.00 | 262,144 | 120 / 16 | yes |
| mimo-v2.6-flash | 0.10 | 0.25 | 1,048,576 | 120 / 16 | yes |
| mimo-v2.6-pro | 0.40 | 0.80 | 1,048,576 | 120 / 16 | yes |
| minimax-m3.1-flash | 0.20 | 0.90 | 1,048,576 | 120 / 16 | yes |
| muse-glimmer-30b | 0.25 | 1.00 | 131,072 | 120 / 16 | yes |
| nemotron-3-nano-omni-30b-a3b-reasoning | 0.10 | 0.25 | 262,144 | 120 / 16 | yes |
| nemotron-3.5-content-safety (classifier) | 0.05 | 0.15 | 131,072 | 120 / 16 | yes |

The 31 Oct capture also lists `raon-1-mini-preview` ($0.10 / $0.30). Ids change between captures (for example `deepseek-v4.1-flash` became `deepseek-v4.1-flash-1017`, and `minimax-m3` became `minimax-m3.1-flash`), so **load the catalog at startup and price from it**. Cache the result and fall back to the last good copy.

Default limits for chat models: 120 requests per minute and 16 concurrent. A request beyond the concurrency limit waits up to 2 minutes, then gets 429 with `Retry-After: 5`. glm-5.2 and glm-5.3 have their own lower limits of 30 RPM and 8 concurrent. Limits are counted per model. Max request time is about 9 minutes.

### 5.3 Chat completions with json_schema [MEDIUM]

`POST /v1/chat/completions`

```json
{
  "model": "glm-5.3-flash",
  "messages": [
    { "role": "system", "content": "You link accounts to employees. Answer only with JSON." },
    { "role": "user", "content": "{...employee profile + candidate account...}" }
  ],
  "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "identity_match",
      "strict": true,
      "schema": {
        "type": "object",
        "additionalProperties": false,
        "required": ["employee_id", "confidence", "evidence", "reason_if_none"],
        "properties": {
          "employee_id": { "type": ["string", "null"] },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "evidence": { "type": "array", "items": { "type": "string" } },
          "reason_if_none": { "type": "string" }
        }
      }
    }
  },
  "reasoning_effort": "low",
  "max_completion_tokens": 2048,
  "temperature": 0,
  "seed": 7
}
```

- `response_format.type` accepts `text` (default), `json_object` or `json_schema`. "`json_schema` makes it answer with JSON that matches the schema." `strict` supports only a subset of JSON Schema: keep to `type`, `properties`, `required`, `enum`, `items`, `additionalProperties:false`, and nullable types. Avoid `minimum`/`maximum` if strict mode rejects them, and clamp in code instead.
- `max_tokens` is a deprecated alias of `max_completion_tokens`. The default is 32768 and **includes reasoning tokens**.
- Thinking text comes back in `message.reasoning`, never `reasoning_content`. Do not show it to users. Only parse `message.content`.
- A final `assistant` message is continued (prefill), so never end `messages` with an assistant turn.
- Fallback if `json_schema` returns 400: retry with `{"type":"json_object"}` plus the schema in the system prompt, then validate in code (zod). Record which mode was used in `ai_calls`.

Response:

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1793712000,
  "model": "glm-5.3-flash",
  "choices": [ { "index": 0, "finish_reason": "stop",
    "message": { "role": "assistant", "content": "{\"employee_id\":\"E042\",...}", "reasoning": "..." } } ],
  "usage": {
    "prompt_tokens": 812, "completion_tokens": 240, "total_tokens": 1052,
    "prompt_tokens_details": { "cached_tokens": 0 },
    "completion_tokens_details": { "reasoning_tokens": 180 }
  }
}
```

- `usage` always includes both detail objects. With `stream: true`, the last chunk always carries `usage`.
- `finish_reason` is one of `stop | length | tool_calls | content_filter | error`. Treat `length` as a failed parse and retry once with a higher cap or a lower effort.
- **Always compare `model` with the requested id.** A mismatch means silent fallback to `deepseek-v4.1-flash-1017`.
- Cost: `prompt_tokens * pricing.prompt + completion_tokens * pricing.completion`, with prices from the catalog for the **returned** `model`.

Errors (envelope `{"error":{"code","message","type","metadata":{"error_type"}}}`):

| Code | Meaning | Retry |
|---|---|---|
| 400 | Bad request, incl. `context_length_exceeded` | no |
| 401 | Bad key | no |
| 404 | No model by that name (non-chat routes) | no |
| 429 | `rate_limit_error`, has `Retry-After` | yes, after `Retry-After` |
| 500 | | once, after a pause |
| 502 / 503 / 504 | Model unreachable, unavailable or timed out | yes, start at 1-2 s and double |

### 5.4 Usage [MEDIUM path, UNVERIFIED shape]

`GET /v1/usage` (key required): "View usage information for the current and previous months." The shape was not captured. Expect something like the v2 subscription usage (`chat_by_model.current_month[]`). Log the raw response in C7. Alternative: `GET https://api.vultr.com/v2/inference/{id}/usage` (section 4.8).

### 5.5 Billing caveat [MEDIUM]

The product page and the support doc ("Updated 26 October 2026") say a flat **$0.55 per 1M input / $2.75 per 1M output**. The catalog says per-model prices. The cost meter uses the catalog, and the UI notes that the console Usage tab is authoritative. Whether the $200 promo credit covers Inference is still **UNVERIFIED** (C7).

---

## 6. Stack versions (npm registry, 3 Nov 2026)

| Package | Latest | Released | Recommendation |
|---|---|---|---|
| `@sveltejs/kit` | **3.1.1** | 29 Oct 2026 (3.0.0: 1 Oct) | Use 3.x. Peers: `vite ^8.0.12`, `svelte ^5.57.1`, `@sveltejs/vite-plugin-svelte ^7`, `typescript ^6` (optional). Engines: **node >= 22.17**. |
| `svelte` | 5.57.3 | 26 Oct 2026 | Runes only (`$state`, `$derived`, `$effect`, `$props`). `$app/stores` is removed in Kit 3, so use `$app/state`. |
| `@sveltejs/adapter-node` | 6.0.1 | 29 Oct 2026 | Requires Kit 3. |
| `vite` | 8.3.5 | 21 Oct 2026 | Rolldown-based. |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | | |
| `typescript` | 7.0.2 (latest), **6.0.3** | | **Pin `typescript@~6.0.3`**: Kit 3's peer range is `^6`. |
| `drizzle-orm` / `drizzle-kit` | 0.45.4 / 0.31.11 (1.0.0-beta.22 on `beta`) | 21 Oct 2026 | Use the stable 0.45 / 0.31, not the 1.0 beta. The `postgres` peer is `>=3`. |
| `postgres` (postgres.js) | 4.0.0 | 29 Oct 2026 | **Pin `3.4.9`** (see section 0, finding 12). v4 sends parameters untyped (`infer: false`) and removes `sql.array()`, so drizzle compatibility is unverified. |
| `@node-rs/argon2` | 2.2.2 | 6 Oct 2026 | **Recommended.** Prebuilt binaries (incl. `linux-x64-musl` for Alpine), no node-gyp. `hash(pw)` defaults to argon2id; `verify(hash, pw)`. |
| `argon2` | 0.45.2 | 3 Nov 2026 | Also fine (prebuilt), but heavier. |
| `vitest` | 5.1.0 | 2 Nov 2026 | Peers `vite ^6 \|\| ^7 \|\| ^8`; node `^22.12 \|\| ^24`. |
| `tailwindcss` / `@tailwindcss/vite` | 4.3.4 | 2 Nov 2026 | Optional. v4 has CSS-first config (`@import "tailwindcss";`) and no `tailwind.config.js`; the Vite plugin supports Vite 8. |
| `svelte-check` | 4.7.8 | | |
| `sv` (CLI) | 1.2.0 | | `npx sv create`, `npx sv migrate sveltekit-3` |

### SvelteKit 3 changes that affect our code

- **No `svelte.config.js`.** Configure in `vite.config.ts`:

  ```ts
  import { defineConfig } from 'vite';
  import { sveltekit } from '@sveltejs/kit/vite';
  import adapter from '@sveltejs/adapter-node';
  export default defineConfig({
    plugins: [sveltekit({ adapter: adapter(), paths: { origin: process.env.ORIGIN } })]
  });
  ```

- **`$lib` becomes `#lib`** through the `package.json` `imports` field (`"#lib": "./src/lib/index.js", "#lib/*": "./src/lib/*"`). Imports need file extensions: `import { db } from '#lib/server/db/index.js'`. Update the repo-layout paths in ARCHITECTURE accordingly.
- **Env:** `$env/*` is deprecated. Declare variables in `src/env.ts` with `defineEnvVars({ MASTER_KEY: {}, DATABASE_URL: {} })` from `@sveltejs/kit/env`, then `import { MASTER_KEY } from '$app/env/private'`. Server-only.
- **adapter-node:** the `ORIGIN` env var is removed; set `paths.origin` in the plugin config. Behind Caddy, either set `paths.origin` or use `PROTOCOL_HEADER=x-forwarded-proto HOST_HEADER=x-forwarded-host`. `PORT`, `HOST`, `BODY_SIZE_LIMIT` and `SHUTDOWN_TIMEOUT` are unchanged. Production does not load `.env`, so run `node --env-file=.env build`. adapter-node 6 "always bundles dev dependencies", so **put native modules (`@node-rs/argon2`) and `postgres` in `dependencies`** so they stay external.
- **Errors:** `handleError` now receives all errors, including `error(...)`. `fail(status)` status codes are now real HTTP statuses on enhanced forms. `json()` and `text()` helpers are deprecated in favour of `Response.json()`.
- **Navigation:** `invalidateAll` becomes `refreshAll`, and `goto` options changed (`replace`, `reset`, `refreshAll`).
- **Remote functions** (`query`, `form`, `command` in `$app/server`) are **still experimental** and need `experimental.remoteFunctions` plus Svelte `compilerOptions.experimental.async`. Use plain form actions and `+server.ts` routes for the hackathon.
- Long-running in-process timers (re-check `setTimeout`) work fine in adapter-node, because it is a plain Node server. Start them from `src/hooks.server.ts` `init`. Do not use a module top level, which also runs during `vite build` analysis.

---

## 7. Capability-check deltas (suggested edits to CAPABILITY_CHECKS.md)

- C1: add `GET /v2/organizations` to find the org id; `GET /v2/organizations/{id}/suspended-users` as the suspend verifier; `PATCH /v2/users/{id} {"api_enabled":false}` as fallback rung (c+); a probe of `user_id` format on suspend (uuid vs integer); the exact `/apikeys` response field names; service-user creation via `POST /v2/users {"service_user": true}`.
- C5: repo invitations need a GitHub username. Budget for the 50 per 24 hours org-invitation limit.
- C6: the misspelled-model case is documented as a silent fallback to `deepseek-v4.1-flash-1017` on chat routes. Also test `reasoning_effort: "low"` and record `completion_tokens_details.reasoning_tokens`.
- C7: compare per-model catalog pricing with the flat $0.55 / $2.75 rate using `GET /v1/usage` or `GET /v2/inference/{id}/usage`.

## 8. Sources

- Keycloak 26.8.1 source: `services/.../admin/UsersResource.java`, `UserResource.java`, `ModelToRepresentation.java`, `core/.../UserRepresentation.java`, `UserSessionRepresentation.java` (github.com/keycloak/keycloak, tag 26.8.1).
- Mattermost v12.0.1: `api/v4/source/users.yaml`, `bots.yaml`, `introduction.yaml`, `server/public/model/{user,config,session}.go` (github.com/mattermost/mattermost).
- GitHub: `github/rest-api-description` `descriptions/api.github.com/api.github.com.json` (2 Nov 2026); `github/docs` `src/github-apps/data/fpt-2022-11-28/fine-grained-pat-permissions.json`; `content/organizations/.../inviting-users-to-join-your-organization.md` (invitation limits).
- Vultr: `vultr/govultr` (`user.go`, `organization.go`, `instance.go`, `snapshot.go`, `plan.go`, `account.go`, `inference.go`, `meta.go`; 30 Oct 2026); `vultr/iam-management-api` `iam-management-api.yml` (1 Jun 2026); `vultr/vultr-python-client` `openapi-client/swagger.json` (Aug 2025); `vultr/terraform-provider-vultr` `resource_vultr_users.go`; docs.vultr.com pages "How to Create an API Key for a User", "List API Key", "Delete API Key", "How to Delete an API Key for a User", "How to Suspend and Unsuspend a User in an Organization", "How to List All Users in an Organization", "How to Create a Service User", snapshot billing FAQ (through search snippets).
- Vultr Inference: `vultr/model-catalog-python` (`docs/catalog.md`, `fixtures/vultr-catalog.json`, `fixtures/media/public-models.json`; v0.0.4, 30 Oct 2026); quotes of `api.vultrinference.com/docs/{get-started/quickstart,get-started/authentication,get-started/sdks,reference/create-chat-completion,concepts/limits,concepts/errors,concepts/streaming,reference/get-usage}.md` captured 31 Oct 2026 in `Gi-Tuu/yai-guard/research/02-inference-证据.md` (third party; verify in C6).
- Stack: npm registry metadata (3 Nov 2026); `sveltejs/kit` `documentation/docs/60-appendix/35-migrating-to-sveltekit-3.md`, `20-core-concepts/70-environment-variables.md`, `25-build-and-deploy/40-adapter-node.md`, `packages/adapter-node/CHANGELOG.md`; `porsager/postgres` `CHANGELOG.md`.
