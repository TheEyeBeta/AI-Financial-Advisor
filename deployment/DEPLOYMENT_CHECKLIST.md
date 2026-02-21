# Deployment Readiness Checklist

**Status**: ✅ **READY FOR DEPLOYMENT** (with pre-deployment steps)

---

## ✅ Completed Infrastructure

### Docker & Containerization
- [x] Backend Dockerfile (multi-stage, non-root user, health checks)
- [x] Frontend Dockerfile (multi-stage with Nginx)
- [x] docker-compose.yml for local development
- [x] .dockerignore files configured
- [x] nginx.conf for frontend serving

### CI/CD Pipelines
- [x] GitHub Actions CI workflow (`.github/workflows/ci.yml`)
- [x] GitHub Actions Deploy workflow (`.github/workflows/deploy.yml`)
- [x] Docker build workflow (`.github/workflows/docker-build.yml`)

### Platform Configurations
- [x] `railway.json` - Railway deployment config (root for auto-detection)
- [x] `render.yaml` - Render deployment config
- [x] `vercel.json` - Vercel frontend config (root for auto-detection)

### Documentation
- [x] `DEPLOYMENT.md` - Comprehensive deployment guide
- [x] `env.production.example` - Environment variable template
- [x] `RATE_LIMITING.md` - Rate limiting documentation

### Security & Production Features
- [x] Professional rate limiting system
- [x] CORS middleware configured
- [x] TrustedHost middleware (production)
- [x] Security headers (XSS, CSRF, etc.)
- [x] Health check endpoints (`/health`, `/health/live`, `/health/ready`)
- [x] Audit logging system
- [x] Non-root Docker user

### Testing
- [x] Frontend unit tests (Vitest)
- [x] Backend unit tests (Pytest)
- [x] E2E tests (Playwright)
- [x] Test coverage reports

---

## ⚠️ Pre-Deployment Steps Required

### 1. GitHub Secrets Configuration

Add these secrets in GitHub → Settings → Secrets and variables → Actions:

**Required Secrets:**
```bash
# Vercel
VERCEL_TOKEN=your_vercel_token

# Railway (if using Railway)
RAILWAY_TOKEN=your_railway_token
RAILWAY_PROJECT_ID=your_project_id  # Optional, can auto-detect

# Environment Variables (for build)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_PYTHON_API_URL=https://your-backend.railway.app  # Set after backend deploys
VITE_WEBSEARCH_API_URL=https://your-backend.railway.app
```

**How to get Vercel token:**
1. Go to https://vercel.com/account/tokens
2. Create new token
3. Copy token to GitHub secrets

**How to get Railway token:**
1. Go to Railway dashboard → Settings → Tokens
2. Create new token
3. Copy token to GitHub secrets

### 2. Backend Environment Variables (Railway/Render)

In Railway/Render dashboard → Environment Variables, add:

```bash
# Required
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ENVIRONMENT=production
PORT=8000

# Optional but Recommended
PERPLEXITY_API_KEY=pplx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # Fallback when OpenAI hits limits
TAVILY_API_KEY=tvly-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx  # For web search
APP_VERSION=0.1.0
LOG_LEVEL=info
WORKERS=2  # ⚠️ IMPORTANT: Set to 2 for $5/month Railway plan (defaults to 4)

# Security (Production)
CORS_ORIGINS=https://your-frontend.vercel.app,https://your-domain.com
TRUSTED_HOSTS=your-backend.railway.app,your-domain.com

# Audit Logging
AI_AUDIT_LOG_PATH=/app/logs/audit.jsonl
```

**⚠️ Critical: Worker Count**
- Railway $5/month plan: Use `WORKERS=2` (or leave default, Dockerfile uses 4)
- For cost optimization, update Dockerfile default to 2:
  ```dockerfile
  CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WORKERS:-2} --log-level ${LOG_LEVEL:-info}"]
  ```

### 3. Frontend Environment Variables (Vercel)

In Vercel dashboard → Project Settings → Environment Variables:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_PYTHON_API_URL=https://your-backend.railway.app  # ⚠️ Set AFTER backend deploys
VITE_WEBSEARCH_API_URL=https://your-backend.railway.app
```

**⚠️ Important:** Backend URL must be set AFTER backend deployment completes.

### 4. Railway Deployment Steps

1. **Connect GitHub Repository**
   - Go to Railway dashboard
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

2. **Configure Service**
   - Railway will auto-detect `railway.json` in root
   - Set root directory: `backend/websearch_service`
   - Add environment variables (see step 2 above)

3. **Deploy**
   - Railway will build and deploy automatically
   - Wait for deployment to complete
   - Copy the generated URL (e.g., `https://your-app.railway.app`)

4. **Update Frontend**
   - Add backend URL to Vercel environment variables
   - Redeploy frontend (or wait for auto-deploy)

### 5. Vercel Deployment Steps

1. **Connect Repository**
   - Go to Vercel dashboard
   - Click "Add New Project"
   - Import GitHub repository
   - Vercel will auto-detect Vite config

2. **Configure Build Settings**
   - Framework Preset: Vite
   - Root Directory: `/` (root)
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm ci`

3. **Add Environment Variables**
   - Add all `VITE_*` variables (see step 3 above)
   - **Important:** Set backend URLs AFTER backend deploys

4. **Deploy**
   - Click "Deploy"
   - Or push to `main` branch (auto-deploy)

---

## 🔍 Post-Deployment Verification

### Backend Health Checks

```bash
# Check health endpoint
curl https://your-backend.railway.app/health

# Check liveness
curl https://your-backend.railway.app/health/live

# Check readiness
curl https://your-backend.railway.app/health/ready
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-02-13T...",
  "uptime_seconds": 123.45,
  "version": "0.1.0",
  "environment": "production"
}
```

### Frontend Verification

1. Visit your Vercel URL
2. Check browser console for errors
3. Test authentication flow
4. Test API calls to backend
5. Verify CORS headers in Network tab

### Rate Limiting Test

```bash
# Test rate limiting (should get 429 after limit)
for i in {1..25}; do
  curl -X POST https://your-backend.railway.app/api/chat \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"test"}]}'
  echo ""
done
```

---

## 🚨 Common Issues & Solutions

### Issue: Backend returns 503 (Not Ready)
**Solution:** Check that `OPENAI_API_KEY` is set correctly in Railway environment variables.

### Issue: CORS errors in browser
**Solution:** 
1. Verify `CORS_ORIGINS` includes your Vercel frontend URL
2. Check that frontend URL matches exactly (no trailing slash)
3. Restart backend service after changing CORS_ORIGINS

### Issue: Frontend can't connect to backend
**Solution:**
1. Verify `VITE_PYTHON_API_URL` is set in Vercel
2. Check backend URL is accessible (test with curl)
3. Ensure backend is deployed and healthy
4. Redeploy frontend after setting backend URL

### Issue: Railway deployment fails
**Solution:**
1. Check Railway logs: `railway logs`
2. Verify `requirements.txt` is in `backend/websearch_service/`
3. Check Dockerfile path matches `railway.json`
4. Verify Python version compatibility (3.12)

### Issue: High memory usage on Railway
**Solution:**
1. Reduce `WORKERS` to 2 (or 1 for minimal plan)
2. Update Dockerfile default: `WORKERS:-2`
3. Monitor Railway metrics dashboard

---

## 📊 Resource Requirements

### Backend (Railway)
- **Minimum Plan:** $5/month (512MB RAM, 1GB storage)
- **Recommended:** $5/month with `WORKERS=2`
- **For Production:** $10/month (1GB RAM) if experiencing memory issues

### Frontend (Vercel)
- **Free Tier:** Sufficient for most use cases
- **Pro Tier:** $20/month (if needed for custom domains, more bandwidth)

### Supabase
- **Free Tier:** Sufficient for development
- **Pro Tier:** $25/month (for production with higher limits)

---

## ✅ Final Checklist Before Going Live

- [ ] All GitHub secrets configured
- [ ] Backend environment variables set in Railway/Render
- [ ] Frontend environment variables set in Vercel
- [ ] Backend deployed and health checks passing
- [ ] Frontend deployed and accessible
- [ ] CORS configured correctly
- [ ] Rate limiting tested and working
- [ ] Authentication flow tested end-to-end
- [ ] API endpoints tested
- [ ] Error handling verified
- [ ] Logging and monitoring set up
- [ ] Backup strategy in place (Supabase backups)

---

## 🎯 Deployment Order

1. **Deploy Backend First**
   - Railway/Render deployment
   - Verify health checks
   - Copy backend URL

2. **Configure Frontend**
   - Add backend URL to Vercel env vars
   - Deploy frontend

3. **Test Integration**
   - Test API calls
   - Verify CORS
   - Test authentication

4. **Monitor**
   - Check Railway metrics
   - Monitor Vercel analytics
   - Review error logs

---

## 📝 Quick Commands Reference

```bash
# Railway CLI
railway login
railway init
railway up
railway logs
railway variables

# Vercel CLI
vercel login
vercel --prod
vercel env ls
vercel logs

# Docker (local testing)
docker-compose up -d
docker-compose logs -f backend
docker-compose down

# Test backend locally
cd backend/websearch_service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

---

**Status**: ✅ **READY** - Follow the pre-deployment steps above, then deploy!
