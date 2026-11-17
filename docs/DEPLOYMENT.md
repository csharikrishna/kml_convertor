# Production Deployment & Infrastructure Runbook

## 1. Architecture Overview

The system utilizes an decoupled SaaS deployment topology:
- **Frontend:** Next.js 15 (Edge/Serverless on Vercel or Node.js container)
- **Backend:** FastAPI Docker container on Render / AWS ECS (runs ODA File Converter with X11/Qt6 dependencies)
- **Availability Sentinel:** Cloudflare Worker scheduled keep-alive

---

## 2. Deployment Procedures

### 2.1 Backend Deployment (Render Docker Web Service)

1. Connect Git repository to Render as a Blueprint or Web Service.
2. Ensure Docker runtime is configured:
   - **Environment:** `Docker`
   - **Dockerfile Path:** `./Dockerfile`
   - **Context:** `.`
   - **Health Check Path:** `/health`
3. Environment Variables:
   ```env
   PORT=8000
   MAX_UPLOAD_MB=25
   MAX_VERTICES=800000
   MAX_ENTITIES=500000
   MAX_CONCURRENT_CONVERSIONS=2
   CONVERSION_TIMEOUT_SECONDS=180
   ODA_TIMEOUT_SECONDS=120
   OUTPUT_TTL_SECONDS=3600
   LOG_JSON=1
   CORS_ORIGINS="*"
   ```
4. Verification:
   ```bash
   curl -I https://cad2kml-converter.onrender.com/health
   # Returns HTTP 200 with status="healthy", liveness=true, readiness=true
   ```

### 2.2 Cloudflare Keep-Alive Sentinel Deployment

1. Navigate to `cloudflare-keepalive/`:
   ```bash
   cd cloudflare-keepalive
   npm install
   npx wrangler login
   ```
2. Deploy to Cloudflare edge:
   ```bash
   npx wrangler deploy
   ```
3. Verify cron execution:
   ```bash
   npx wrangler tail
   ```

### 2.3 Next.js Frontend Deployment (Vercel)

1. Connect repository to Vercel.
2. Root directory: `frontend`
3. Framework preset: `Next.js`
4. Environment Variables:
   ```env
   NEXT_PUBLIC_API_URL=https://cad2kml-converter.onrender.com
   ```
5. Deploy. The Next.js build (`next build`) compiles static routes with zero lint warnings and zero type errors.

---

## 3. Rollback Procedures

### Frontend Rollback
- In Vercel Dashboard: Select previous instantaneous deployment -> "Instant Rollback".
- In Git: `git revert HEAD` and push.

### Backend Rollback
- In Render Dashboard: Select previous working Docker image digest -> "Deploy this commit".
- Zero database migrations are required (stateless scratch storage).
