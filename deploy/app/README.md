# Deploy the Last Day app on a Vultr VM

This runs Caddy (TLS and reverse proxy), the SvelteKit app and Postgres 17 on one VM with Docker Compose.

Target: Vultr VX1 General Purpose, 2 vCPU / 8 GB, Ubuntu 24.04.

## 1. Create the VM and firewall

1. In Vultr, deploy a VX1 2 vCPU / 8 GB instance with Ubuntu 24.04. Note its public IPv4 address, for example `203.0.113.10`.
2. Create a Firewall Group and attach it to the instance:
   - TCP 80 from anywhere
   - TCP 443 from anywhere
   - UDP 443 from anywhere (HTTP/3, optional)
   - TCP 22 from your IP only
3. Postgres (5432) is not exposed. Keep it that way.

## 2. Install Docker

```bash
ssh root@203.0.113.10
apt-get update
apt-get install -y docker.io docker-compose-v2 git
systemctl enable --now docker
```

## 3. Clone the repo and configure

```bash
git clone <repo-url> last-day
cd last-day
cp .env.example .env
nano .env
```

Fill in the values in `.env`:

- `APP_DOMAIN`: the public IP with dashes plus `.sslip.io`, for example `203-0-113-10.sslip.io`. Caddy issues the Let's Encrypt certificate for this name, so DNS must resolve (sslip.io does this automatically).
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`: use letters and digits only for the password, because it is embedded in `DATABASE_URL`.
- The remaining application variables listed in `.env.example`.

Compose reads variables from `.env` in the directory you run it from, so run every command below from the repo root and pass `--env-file .env`.

## 4. Start the stack

```bash
docker compose --env-file .env -f deploy/app/docker-compose.yml up -d --build
```

The app container runs `pnpm db:migrate` before it starts the server, so the schema is applied on every start. The first build takes a few minutes.

Check that everything is up:

```bash
docker compose --env-file .env -f deploy/app/docker-compose.yml ps
curl -sI https://203-0-113-10.sslip.io | head -n 1
```

Open `https://<APP_DOMAIN>` in a browser.

## 5. Logs

```bash
# All services, following
docker compose --env-file .env -f deploy/app/docker-compose.yml logs -f

# One service, last 200 lines
docker compose --env-file .env -f deploy/app/docker-compose.yml logs --tail=200 app
docker compose --env-file .env -f deploy/app/docker-compose.yml logs --tail=200 caddy
```

## 6. Run migrations manually

Migrations run at each app start. To run them on demand, for example after pulling new migration files without restarting:

```bash
docker compose --env-file .env -f deploy/app/docker-compose.yml exec app pnpm db:migrate
```

## 7. Update the app

```bash
cd last-day
git pull
docker compose --env-file .env -f deploy/app/docker-compose.yml up -d --build
```

## 8. Stop and reset

```bash
# Stop, keep data
docker compose --env-file .env -f deploy/app/docker-compose.yml down

# Stop and delete the database volume (destructive)
docker compose --env-file .env -f deploy/app/docker-compose.yml down -v
```
