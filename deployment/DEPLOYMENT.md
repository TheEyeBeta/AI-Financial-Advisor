# Professional Deployment Guide

This guide covers professional deployment strategies for the AI Financial Advisor application.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         Production                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐         ┌──────────────┐                  │
│  │   Frontend   │         │   Backend    │                  │
│  │   (Vercel)   │────────▶│  (Railway/   │                  │
│  │              │  HTTPS  │   Render)    │                  │
│  └──────────────┘         └──────────────┘                  │
│         │                        │                            │
│         │                        │                            │
│         ▼                        ▼                            │
│  ┌──────────────┐         ┌──────────────┐                  │
│  │   Supabase   │         │  OpenAI API  │                  │
│  │  (Database)  │         │              │                  │
│  └──────────────┘         └──────────────┘                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

- GitHub account with repository access
- Vercel account (for frontend)
- Railway/Render account (for backend)
- Supabase project
- OpenAI API key
- Tavily API key (optional, for web search)

## Frontend Deployment (Vercel)

### Automatic Deployment

1. **Connect Repository to Vercel**
   - Go to [Vercel Dashboard](https://vercel.com/dashboard)
   - Click "Add New Project"
   - Import your GitHub repository
   - Vercel will auto-detect Vite configuration

2. **Configure Environment Variables**
   In Vercel project settings → Environment Variables, add:
   ```
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_PYTHON_API_URL=https://your-backend-url.com
   VITE_WEBSEARCH_API_URL=https://your-backend-url.com
   ```

3. **Deploy**
   - Push to `main` branch triggers automatic deployment
   - Production deploys are handled by Vercel's native GitHub integration

### Manual Deployment

Use the Vercel dashboard to redeploy a previous commit or manually promote a deployment. This repository does not use Vercel CLI for production deploys.

## Backend Deployment

### Option 1: Railway (Recommended)

1. **Create Railway Project**
   - Go to the Railway dashboard.
   - Create a project from the GitHub repository.
   - Select `backend/websearch_service` as the service root when configuring the backend service.
   - Railway should use `railway.json` and `backend/websearch_service/Dockerfile` from the repository.

2. **Configure Environment Variables**
   In Railway dashboard → Variables:
   ```
   # REQUIRED — production refuses to start without these (#210, app/config.py)
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   SUPABASE_JWT_SECRET=...
   OPENAI_API_KEY=sk-...
   ENVIRONMENT=production
   CORS_ORIGINS=https://your-frontend.vercel.app   # exact origins, comma-separated, no wildcard
   TRUSTED_HOSTS=your-backend.up.railway.app        # bare hostnames, comma-separated, no wildcard

   # Recommended / optional
   PERPLEXITY_API_KEY=pplx-...  # Optional: Fallback when OpenAI hits limits
   TAVILY_API_KEY=tvly-...
   APP_VERSION=<git SHA of the deploy>
   AI_AUDIT_LOG_PATH=/app/logs/audit.jsonl
   PORT=8000
   WORKERS=1
   REDIS_URL=redis://...            # Required for multi-worker rate limits + WebSocket tickets
   ALLOW_IN_MEMORY_RATE_LIMIT=true  # Only when WORKERS=1 and Redis intentionally omitted
   SCHEDULER_ENABLED=false          # Web service — do NOT enable on API replicas
   ```

   **Process topology (beta):**
   - **Web service** (`uvicorn app.main:app`): `WORKERS=1`, `SCHEDULER_ENABLED=false`, health check `/health/ready`.
   - **Scheduler service** (second Railway service, single replica): `SCHEDULER_ENABLED=true`, start command `python run_scheduler.py`, no HTTP traffic.
   - Do not run APScheduler in every web worker — only the dedicated scheduler process.

3. **Deploy**
   Push to the configured branch and let Railway's native GitHub integration deploy the backend.

### Option 2: Render

1. **Create Web Service**
   - Go to [Render Dashboard](https://dashboard.render.com)
   - Click "New +" → "Web Service"
   - Connect your GitHub repository

2. **Configure Service**
   - **Name**: `ai-financial-advisor-backend`
   - **Root Directory**: `backend/websearch_service`
   - **Environment**: `Docker`
   - **Dockerfile Path**: `backend/websearch_service/Dockerfile`
   - **Port**: `8000`

3. **Environment Variables**
   ```
   OPENAI_API_KEY=sk-...
   TAVILY_API_KEY=tvly-...
   APP_VERSION=0.1.0
   ENVIRONMENT=production
   ```

### Option 3: Docker Deployment

#### Using Docker Compose

```bash
# Copy environment file
cp .env.example .env

# Edit .env with your values
nano .env

# Start services
docker-compose up -d

# View logs
docker-compose logs -f backend
```

#### Using Docker Swarm/Kubernetes

See `k8s/` directory for Kubernetes manifests (create if needed).

### Option 4: AWS/GCP/Azure

See cloud-specific deployment guides in `docs/deployment/` directory.

## Docker Deployment

### Build Images

```bash
# Build backend
docker build -t ai-financial-advisor-backend:latest \
  --build-arg APP_VERSION=0.1.0 \
  --build-arg ENVIRONMENT=production \
  ./backend/websearch_service

# Build frontend
docker build -t ai-financial-advisor-frontend:latest \
  --build-arg VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
  --build-arg VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
  -f deployment/Dockerfile.frontend .
```

### Run with Docker Compose

```bash
# Production mode
docker-compose -f deployment/docker-compose.yml up -d

# View logs
docker-compose -f deployment/docker-compose.yml logs -f

# Stop services
docker-compose -f deployment/docker-compose.yml down
```

## CI/CD Pipeline

### GitHub Actions

### Staging Flow

The staging branch is `staging`.

1. Pushes to `staging` are the pre-production integration path.
2. Vercel should be configured to create preview deployments for `staging` pushes and pull requests.
3. Railway should use a separate staging service with its own environment variables.
4. Supabase should use a separate staging project so schema changes and test data stay isolated from production.
5. Railway and Vercel native GitHub integrations deploy staging from `staging` pushes; `.github/workflows/deploy-staging.yml` waits for the configured staging backend URL and runs the full E2E suite against the staging frontend URL.
6. PRs targeting `staging` reuse the same workflow and post the E2E result as a PR comment.
7. `.github/workflows/promote-to-prod.yml` merges `staging` into `main` after the production approval gate is satisfied, which then triggers native Vercel and Railway production deploys.

### Branch Conventions

- `main` is production.
- `staging` is the pre-production branch.
- Feature branches should merge into `staging` first unless the change is a hotfix.
- Production promotions should happen from the manual promotion workflow, not by direct commits to `main`.

### CODEOWNERS and Approval

Add reviewer ownership in `.github/CODEOWNERS` and configure the GitHub `production` environment to require approval from that reviewer before `promote-to-prod.yml` can continue.

The repository uses:

```text
* @TheEyeBeta
```

The repository includes three workflows:

1. **CI Pipeline** (`.github/workflows/ci.yml`)
   - Runs on every push/PR
   - Tests frontend and backend
   - Builds Docker images
   - Security scanning

2. **Native Production Deploys**
   - Vercel deploys the frontend from GitHub pushes to `main`
   - Railway deploys the backend from GitHub pushes to `main`

3. **Staging / Promotion Pipelines**
   - `deploy-staging.yml` verifies staging health and runs the E2E suite against staging URLs
   - `promote-to-prod.yml` merges `staging` into `main` after environment approval

### Required Secrets

Add these to GitHub repository → Settings → Secrets:

```
# Frontend
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_PYTHON_API_URL
VITE_WEBSEARCH_API_URL

# Backend
OPENAI_API_KEY
TAVILY_API_KEY

STAGING_FRONTEND_URL
STAGING_BACKEND_URL
```

### Staging Secrets

Use separate values for staging:

- `STAGING_FRONTEND_URL` points to the Vercel preview or staging frontend URL used by E2E.
- `STAGING_BACKEND_URL` points to the Railway staging backend URL used for health checks.
- Supabase staging credentials should live in the staging project and should not be reused from production.

## Health Checks

### Frontend Health Check

```bash
curl https://your-frontend-url.vercel.app/health
```

### Backend Health Checks

```bash
# Liveness check
curl https://your-backend-url.com/health/live

# Readiness check
curl https://your-backend-url.com/health/ready

# Full health check
curl https://your-backend-url.com/health
```

## Monitoring

### Application Monitoring

- **Vercel Analytics**: Built-in for frontend
- **Railway Metrics**: Built-in for backend
- **Custom**: Add Sentry, Datadog, or New Relic

### Logging

- **Frontend**: Vercel function logs
- **Backend**: Application logs in `/app/logs/audit.jsonl`
- **Docker**: `docker-compose logs -f backend`

## Scaling

### Frontend Scaling

Vercel automatically scales based on traffic. No configuration needed.

### Backend Scaling

#### Railway
- Auto-scaling based on CPU/memory
- Configure in Railway dashboard → Settings → Scaling

#### Render
- Set instance type and count in service settings
- Auto-scaling available on paid plans

#### Docker Swarm/Kubernetes
- Configure replicas in deployment manifests
- Use horizontal pod autoscaling

## Security Best Practices

1. **Environment Variables**
   - Never commit secrets to repository
   - Use platform secret management
   - Rotate keys regularly

2. **HTTPS Only**
   - All services should use HTTPS
   - Configure SSL certificates

3. **Rate Limiting**
   - Already implemented in backend
   - Monitor rate limit violations

4. **Security Headers**
   - Frontend includes security headers in nginx config
   - Backend uses FastAPI security middleware

5. **Dependencies**
   - Regularly update dependencies
   - Use `npm audit` and `pip-audit`

## Rollback Procedures

### Frontend (Vercel)

Use the Vercel dashboard: go to Deployments, select the previous deployment, and roll back or promote it.

### Backend

#### Railway
Use the Railway dashboard: open the backend service deployments, select a previous successful deployment, and redeploy or roll back it.

#### Render
- Go to Deployments → Select previous deployment → Rollback

#### Docker
```bash
# Tag previous image
docker tag ai-financial-advisor-backend:previous ai-financial-advisor-backend:latest

# Redeploy
docker-compose up -d
```

## Troubleshooting

### Common Issues

1. **Backend not starting**
   - Check environment variables
   - Verify port availability
   - Check logs: `docker-compose logs backend`

2. **Frontend build fails**
   - Verify all environment variables are set
   - Check Node.js version (requires 20+)
   - Review build logs in Vercel

3. **CORS errors**
   - Ensure backend CORS is configured
   - Check frontend API URLs

4. **Rate limiting issues**
   - Check rate limit headers in responses
   - Review audit logs
   - Adjust limits if needed

## Production Checklist

- [ ] All environment variables configured
- [ ] `staging` branch exists and is protected
- [ ] `production` environment requires CODEOWNERS approval
- [ ] HTTPS enabled for all services
- [ ] Health checks configured
- [ ] Monitoring set up
- [ ] Logging configured
- [ ] Rate limiting tested
- [ ] Security headers verified
- [ ] Backup strategy in place
- [ ] Rollback procedure tested
- [ ] Documentation updated

## Support

For deployment issues:
1. Check logs first
2. Review this documentation
3. Check GitHub Issues
4. Contact team lead
