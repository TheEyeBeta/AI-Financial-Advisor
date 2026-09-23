# AWS deployment (replaces Railway) — LIVE

Moves only the `backend/websearch_service` container off Railway onto AWS
EC2. Supabase (prod and staging, both cloud) is unchanged. The
Vercel-hosted frontend is unchanged except for the API URL it calls.

**Status: prod is live** at `https://afa-api.theeyebeta.store`, reached via
a **Cloudflare Tunnel** (not Nginx/certbot — see "Ingress" below for why).
Railway is left running, untouched, as a rollback path until AWS has been
observed under real traffic for a while.

## What's already provisioned (account 005185643725, us-east-1)

| Resource | ID / value |
|---|---|
| Prod instance | `i-091397a3f0e899b3d` (t4g.micro, ARM, runs 24/7) |
| Prod public IP | `54.152.217.162` (Elastic IP — static, survives reboots) |
| Staging instance | `i-09cb8ab036f055e7e` (t4g.micro, **stopped by default**) |
| Security group | `sg-0c81a063d376b31d0` — 22 (from provisioning IP only). 80/443 deliberately **not** opened — the tunnel needs no inbound port. |
| SSH key pair | `afa-aws-backend` — private key at `~/.ssh/afa-aws-backend.pem` |
| AMI used | `ami-0246d714afcc1d494` (Ubuntu 24.04 ARM64) |
| Prod domain | `afa-api.theeyebeta.store` (Cloudflare CNAME → tunnel) |
| Cloudflare Tunnel | `afa-prod-backend` (id `19b2d994-4d4f-4951-bc9a-93733f1a0ef7`), ingress → `http://localhost:8001` |

Both instances use a 20GB gp3 root volume (within the 30GB/month free-tier
EBS allowance combined).

## Ingress: Cloudflare Tunnel, not Nginx+certbot

The `nginx/` configs and certbot steps further down are kept as a
documented alternative but are **not what prod actually uses**. Once DNS
turned out to be on Cloudflare, with `cloudflared` tunnels already in use
for other TheEyeBeta services (`api`/`admin`/`dataapi.theeyebeta.store`),
it made more sense to match that pattern: `cloudflared` runs on the EC2
box as a systemd service (`systemctl status cloudflared`) and makes an
*outbound-only* connection to Cloudflare — no inbound port 80/443 needs to
be open on the security group at all, and Cloudflare terminates TLS.

Tunnel ingress rules live in Cloudflare (`config_src: cloudflare`, set via
the API, not a local `~/.cloudflared/config.yml`) — to change what
hostname routes to what local port, use the Cloudflare API/dashboard
(Zero Trust → Networks → Tunnels → `afa-prod-backend`), not a file on the
box.

### Prod vs staging cost model

- **Prod** runs continuously — this is the 750 free hours/month use case
  (one instance × 730 hrs/month ≈ covered). Has a static Elastic IP for
  DNS/TLS.
- **Staging** is stopped by default and only billed for compute while
  running. No Elastic IP on purpose (an *unattached* EIP is billed hourly
  — pointless for an instance that's mostly off). Its public IP changes
  every time it's started. Use `staging-start.sh` / `staging-stop.sh` in
  this directory.
- Running prod + staging simultaneously 24/7 would exceed the combined
  750 free hours/month across the account — keep staging stopped when not
  actively testing.

### SSH access note

Security group port 22 is locked to the IP that provisioned it
(`102.88.169.82/32`). If you SSH from a different network later, update
it:

```bash
aws ec2 authorize-security-group-ingress --group-id sg-0c81a063d376b31d0 \
  --protocol tcp --port 22 --cidr <your-new-ip>/32
aws ec2 revoke-security-group-ingress --group-id sg-0c81a063d376b31d0 \
  --protocol tcp --port 22 --cidr 102.88.169.82/32
```

`deploy-prod.yml`/`deploy-staging.yml` do this automatically for
GitHub-hosted runners (whose egress IP changes every run): each authorizes
its own runner's current IP before the SSH step and revokes it again
afterward (`if: always()`), so no manual step is needed there.

The AWS CLI on this machine was installed via `pip install --user awscli`
(no admin rights available) — invoke it as `python -m awscli ...` unless
you've since added `%APPDATA%\Roaming\Python\Python310\Scripts` to PATH.

## 1. Base setup on the prod instance (already done)

```bash
ssh -i ~/.ssh/afa-aws-backend.pem ubuntu@54.152.217.162

sudo apt-get update && sudo apt-get upgrade -y

# Docker + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# log out/in for the group change to take effect

# cloudflared, via Cloudflare's apt repo
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared noble main' | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

Repeat the Docker install step on staging (`staging-start.sh` first, then
SSH in) when you're ready to deploy there — staging has no tunnel/domain,
so `cloudflared` isn't needed there.

## 2. Deploy the backend stack

```bash
git clone <this-repo-url> ~/ai-financial-advisor
cd ~/ai-financial-advisor/deployment/aws

cp .env.production.example .env.production   # fill in real prod values
docker compose -p afa-prod --env-file .env.production -f docker-compose.aws.yml up -d --build

curl -s http://127.0.0.1:8001/health/live
```

On staging (after `staging-start.sh` and SSH'ing in), same idea with
`.env.staging.example` → `.env.staging`, but nothing fronts it — just hit
`http://<staging-ip>:8002` directly for testing (its `BACKEND_BIND_ADDR`
would need to be `0.0.0.0` for that, and the security group opened on
8002, which is a deliberate exposure tradeoff — see the git history for
the discussion before doing that on prod).

## 3. Cloudflare Tunnel (already done for prod)

Creating a new tunnel end to end, for reference:

```bash
# Create the tunnel (needs a Cloudflare API token with Account →
# Cloudflare Tunnel: Edit, and Zone → DNS: Edit for the zone)
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  --data '{"name":"afa-prod-backend","config_src":"cloudflare"}'

# Point it at the backend port
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  --data '{"config":{"ingress":[{"hostname":"afa-api.theeyebeta.store","service":"http://localhost:8001"},{"service":"http_status:404"}]}}'

# DNS: CNAME afa-api -> <tunnel_id>.cfargotunnel.com, proxied
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
  --data "{\"type\":\"CNAME\",\"name\":\"afa-api\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true}"

# On the EC2 box: get a run token and install as a service
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/token" \
  -H "Authorization: Bearer $CF_TOKEN"
sudo cloudflared service install <token>
```

## 4. Point the frontend at the new backend (already done)

Vercel's prod `VITE_PYTHON_API_URL` was updated (`vercel env rm` +
`vercel env add`, then `vercel redeploy --target production`) from
`https://ai-financial-advisor-backend-production.up.railway.app` to
`https://afa-api.theeyebeta.store`. Verified by grepping the deployed JS
bundle for the new hostname and confirming the Railway one is gone.

For staging: `deploy-staging.yml`'s `run_e2e: true` path now automates
this — it points a fresh Vercel preview deployment at whatever IP that
run's staging instance got, so no manual `vercel env` step is needed
before running E2E.

Also check `vercel.json`'s CSP `connect-src` includes
`https://afa-api.theeyebeta.store` if it's still listing the Railway
domain — Railway's is harmless to leave until decommissioned, but the new
one must be present or the browser will block the requests.

## 6. Auto-start after reboot

`restart: unless-stopped` in the compose file brings containers back once
Docker's daemon starts after a reboot — no extra systemd unit needed. To
deploy a new version:

```bash
cd ~/ai-financial-advisor && git pull
docker compose -p afa-prod --env-file deployment/aws/.env.production \
  -f deployment/aws/docker-compose.aws.yml up -d --build
```

## 7. Decommission Railway

Only after prod has run stable on AWS for a real observation window
(recommend 1-2 weeks including a deploy or two) and logs/Sentry look
normal: delete the Railway services and cancel the plan.

## What did NOT change

- Supabase: same prod/staging projects, same RLS, same Alembic flow.
- Frontend hosting: still Vercel.
- Application code: nothing in `backend/websearch_service/app/` changed.

## GitHub Actions secrets required

| Secret | Used by | Notes |
|---|---|---|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | deploy-prod.yml, deploy-staging.yml | Authorizes/revokes the runner's IP for SSH, and starts/stops the staging instance |
| `AWS_PROD_HOST` | deploy-prod.yml | The prod Elastic IP |
| `AWS_PROD_DOMAIN` | deploy-prod.yml | `afa-api.theeyebeta.store` |
| `AWS_PROD_SSH_KEY` | deploy-prod.yml | Contents of `~/.ssh/afa-aws-backend.pem` |
| `AWS_STAGING_SSH_KEY` | deploy-staging.yml | Same key pair, reused |
| `VERCEL_TOKEN` | deploy-staging.yml (`run_e2e: true` path only) | Used to update the Preview environment's `VITE_PYTHON_API_URL` and deploy a fresh preview from `staging`, pointed at the freshly-discovered backend IP |

Environments referenced (`aws-production`, `main-staging`) must exist
under Settings → Environments with matching secrets/protection rules.
`aws-production` (not bare `production`) because GitHub Environment
names collide case-insensitively and a bare `Production` already exists
(Vercel's own, auto-created for its deployment status reporting).

## Security follow-ups

- **Rotate the `laptop-cli` IAM access key and console password** used to
  provision this — they were shared in plaintext during setup and should
  be treated as exposed. IAM → Users → laptop-cli → Security credentials.
- `laptop-cli` currently has `AdministratorAccess`. Once the migration is
  done, scope it down to an EC2/VPC-only policy so a leaked key can't
  touch billing, IAM, or other services.
