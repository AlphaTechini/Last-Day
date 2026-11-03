# Mock company sandbox (DEV / TEST ONLY)

`server.ts` is a single in-memory HTTP server that emulates the subset of the Keycloak, Mattermost, GitHub and Vultr admin APIs that Last Day's connectors use, plus an OpenAI-compatible inference endpoint. It exists so the whole workflow can be developed and tested without real accounts, costs or rate limits. **It is not part of the product and never runs in production.** The real demo, and the evidence, use the real systems.

```bash
pnpm mock                                   # listens on :4010 (MOCK_PORT), latency 120-700 ms per call
pnpm connect:mock                           # points the four connections at it, status 'untested'
MASTER_KEY=dev-master-key-change-me pnpm seed   # creates the Northwind Labs company in it, through its API
```

State is in memory: restarting the server (or `POST /__admin/reset`) empties it, then run `pnpm seed` again.

## Prefixes and credentials

| Prefix | Emulates | Credentials |
|---|---|---|
| `/keycloak` | realm `company`: token, users, logout, sessions | client `last-day`, secret `mock-keycloak-secret` |
| `/mattermost/api/v4` | users (paging, active/inactive), bots, sessions | token `mock-mattermost-admin-token` |
| `/github` | org `northwind-labs`: members, outside collaborators, org and repo invitations (Link-header paging) | token `mock-github-token` |
| `/vultr/v2` | users, API keys, organizations + suspend, instances, plans, snapshots | key `mock-vultr-api-key` |
| `/inference/v1` | `GET /models`, `POST /chat/completions` | key `mock-inference-key` |

Wrong credentials answer 401 in each system's own error shape. Shapes follow `docs/API_REFERENCE.md`.

## Behaviour worth knowing

- Latency: `MOCK_LATENCY` unset = 120-700 ms jitter, `0` = none (tests), `N` = fixed N ms.
- Every new Keycloak/Mattermost user starts with one live session, so "end all sessions" does something.
- Vultr snapshots stay `pending` for `MOCK_SNAPSHOT_MS` (default 3000) and then become `complete` with a size.
- Inference: the answer is computed deterministically from string similarity between the candidate employees and the account in the prompt, and honours `response_format: json_schema` by always answering `{employee_id, confidence, evidence[], reason_if_none}`. `usage` has realistic token counts and `model` echoes the request (an unknown id falls back to `deepseek-v4.1-flash-1017`, like the real gateway). Flash models hedge on indirect evidence and `glm-5.2` commits more, so the demo's indirect match (GitHub `dok-dev`, about 0.73 on `glm-5.3-flash`, about 0.93 on `glm-5.2`) exercises the escalation path, and `dana-ci` stays a probable match (about 0.6 to 0.68).
- GitHub accounts cannot be created through any API, so `POST /__admin/github/seed` registers profiles, members and outside collaborators directly. The seed uses it only when it detects the sandbox.

## Admin endpoints (POST, JSON body)

| Path | Effect |
|---|---|
| `/__admin/reset` | Empty all state. |
| `/__admin/tamper` | Undo a revocation so a re-check regresses. `{ "system": "keycloak" }` re-enables `dana.okafor` and adds a session. Also `mattermost` (`username`, default `dok`), `github` (`login`, default `dok-dev`), `vultr` (`label` powers a server on; `username` unsuspends a user and restores a key). |
| `/__admin/expire-tokens` | Invalidate Keycloak tokens (forces a 401 and a refresh). |
| `/__admin/fail` | `{ "status": 503, "count": 2, "retryAfter": 1 }`: the next N API requests fail. |
| `/__admin/vultr/features` | `{ "suspend": false, "apikeys": false }` makes those endpoints unavailable (tests the fallbacks). |
| `GET /__admin/ping`, `GET /__admin/state` | Liveness and counts. |
