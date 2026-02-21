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

The repository includes two workflows:

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
```

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
