# Company stack (Vultr VM 2)

The fictional company's systems: Keycloak (SSO) and Mattermost Team Edition (chat), with Postgres, behind Caddy on two public `sslip.io` hostnames. Last Day (VM 1) governs these through their real admin APIs. Keep this VM separate from the app VM.

Everything the seed puts in these systems (Northwind Labs, its people, their handles and addresses) is invented for the demo. The systems and the API calls are real.

## 1. Prepare the VM

1. Create a Vultr VM (Ubuntu 24.04, 2 vCPU / 4 GB is comfortable for Keycloak + Mattermost) and note its public IPv4, for example `203.0.113.10`.
2. Open ports 80 and 443 (Vultr firewall group and `ufw` if enabled). Caddy needs 80 for the certificate challenge.
3. Install Docker with the compose plugin.

## 2. Configure

```bash
cd deploy/company-stack
cp .env.example .env
```

Edit `.env`:

- `KEYCLOAK_HOST` and `MATTERMOST_HOST`: `sso.<ip-with-dashes>.sslip.io` and `chat.<ip-with-dashes>.sslip.io`, for example `sso.203-0-113-10.sslip.io`. sslip.io resolves them to the IP with no DNS setup.
- All passwords, and `LASTDAY_CLIENT_SECRET` (use `openssl rand -hex 24`). You will paste that secret into Last Day.
- `MATTERMOST_VERSION`: leave `11.11.3`. The reference lists 12.0.1, but whether that image exists on Docker Hub is unverified.

## 3. Start

```bash
docker compose up -d
docker compose ps          # postgres healthy, keycloak/mattermost up, caddy up
docker compose logs -f keycloak   # wait for "Listening on", the first start imports the realm
```

Caddy obtains the Let's Encrypt certificates on the first request to each hostname (a few seconds).

## 4. Keycloak

- Console: `https://$KEYCLOAK_HOST/admin` (user `admin`, password `KC_ADMIN_PASSWORD`).
- The realm `company` is imported from `keycloak/import/company-realm.json`. It contains:
  - confidential client `last-day` with client secret `LASTDAY_CLIENT_SECRET`, service account enabled, holding `realm-management` roles `view-users`, `query-users` and `manage-users`;
  - public client `demo-login` with direct access grants, used to create real user sessions for the demo;
  - "Unmanaged attributes" enabled, so the seed's custom attributes (`department`, `title`, `personalEmail`, `lastday-demo`) are kept.
- The import runs only when the realm does not exist. To start over: delete the realm in the console (or `docker compose down -v`) and bring the stack up again.
- Check the token the way Last Day will:

```bash
curl -s -X POST "https://$KEYCLOAK_HOST/realms/company/protocol/openid-connect/token" \
  -d grant_type=client_credentials -d client_id=last-day -d client_secret="$LASTDAY_CLIENT_SECRET"
```

Last Day connection: Base URL `https://$KEYCLOAK_HOST`, Realm `company`, Client ID `last-day`, Client secret `LASTDAY_CLIENT_SECRET`.

## 5. Mattermost: admin and personal access token

Personal access tokens are enabled by the compose file (`MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS`). Create the first admin and a token for Last Day:

```bash
# 1. First system admin, created inside the container (local mode is enabled)
docker compose exec mattermost mmctl --local user create \
  --email admin@northwind.example --username lastday-admin --password 'ChangeMe-Admin-1' --system-admin

# 2. Log in; the session token is in the `Token` response header
curl -si -X POST "https://$MATTERMOST_HOST/api/v4/users/login" \
  -H 'Content-Type: application/json' \
  -d '{"login_id":"lastday-admin","password":"ChangeMe-Admin-1"}' | grep -i '^token:'
# also note the "id" in the JSON body: that is ADMIN_ID

# 3. Create the personal access token (shown only once)
curl -s -X POST "https://$MATTERMOST_HOST/api/v4/users/$ADMIN_ID/tokens" \
  -H "Authorization: Bearer $SESSION_TOKEN" -H 'Content-Type: application/json' \
  -d '{"description":"last-day"}'
```

The `token` field of the response is the admin PAT. Alternatively, in the web UI: sign in as the admin, Profile, Security, Personal Access Tokens, Create Token.

Create a team once (the seed creates users, not teams): `docker compose exec mattermost mmctl --local team create --name northwind --display-name "Northwind Labs"`.

Last Day connection: Base URL `https://$MATTERMOST_HOST`, Admin access token = the PAT.

Notes:
- `EnableBotAccountCreation` is on, so the seed can create the shared `ops-bot` bot.
- `DisableBotsWhenOwnerIsDeactivated` defaults to true: deactivating the leaver also disables bots they own.

## 6. Seed the demo company

From the Last Day repo (with the connections saved in Last Day, or `DATABASE_URL`/`MASTER_KEY` pointing at its database):

```bash
MASTER_KEY=... pnpm seed
```

It creates the 30 Northwind users in Keycloak and Mattermost (plus the contractor and the bot), and is safe to re-run: it re-enables or reactivates previously offboarded demo users. Users created this way get the password from `DEMO_USER_PASSWORD` (default `Northwind-demo-1`).

Set `DEMO_VULTR_CREATE_INSTANCE=1`, `DEMO_GITHUB_DANA_LOGIN` and `DEMO_GITHUB_INVITE_EMAILS` for the Vultr server and GitHub parts (see the repo `.env.example`).

## 7. Operations

- Update: `docker compose pull && docker compose up -d`.
- Logs: `docker compose logs -f <service>`.
- Full reset: `docker compose down -v` (deletes users, chat history, certificates; the next start re-imports the realm).
