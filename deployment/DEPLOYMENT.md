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
   - Or use GitHub Actions workflow (configured in `.github/workflows/deploy.yml`)

### Manual Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

## Backend Deployment

### Option 1: Railway (Recommended)

1. **Create Railway Project**
   ```bash
   # Install Railway CLI
   npm i -g @railway/cli
   
   # Login
   railway login
   
   # Initialize project
   cd backend/websearch_service
   railway init
   ```

2. **Configure Environment Variables**
   In Railway dashboard → Variables:
   ```
   OPENAI_API_KEY=sk-...
   PERPLEXITY_API_KEY=pplx-...  # Optional: Fallback when OpenAI hits limits
   TAVILY_API_KEY=tvly-...
   APP_VERSION=0.1.0
   ENVIRONMENT=production
   AI_AUDIT_LOG_PATH=/app/logs/audit.jsonl
   PORT=8000
   ```

3. **Deploy**
   ```bash
   railway up
   ```

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
5. `.github/workflows/deploy-staging.yml` deploys the Railway staging backend on `staging` pushes and runs the full E2E suite against the staging frontend URL.
6. PRs targeting `staging` reuse the same workflow and post the E2E result as a PR comment.
7. `.github/workflows/promote-to-prod.yml` merges `staging` into `main` after the production approval gate is satisfied, which then triggers the existing production deploy workflow.

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

2. **Deploy Pipeline** (`.github/workflows/deploy.yml`)
   - Runs on push to `main`
   - Builds and pushes Docker images
   - Deploys to Vercel (frontend)
   - Deploys to Railway/Render (backend)

3. **Staging / Promotion Pipelines**
   - `deploy-staging.yml` deploys Railway staging and runs the E2E suite against staging URLs
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

# Deployment
VERCEL_TOKEN
RAILWAY_TOKEN (optional)
RAILWAY_PROJECT_ID (optional)
RAILWAY_STAGING_SERVICE
STAGING_FRONTEND_URL
STAGING_BACKEND_URL
```

### Staging Secrets

Use separate values for staging:

- `RAILWAY_STAGING_SERVICE` points to the Railway staging service name or id.
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

```bash
# Via CLI
vercel rollback [deployment-url]

# Via Dashboard
# Go to Deployments → Select deployment → Rollback
```

### Backend

#### Railway
```bash
railway rollback
```

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
