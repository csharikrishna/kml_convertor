# Cloudflare Keep-Alive Sentinel for CAD2KML Backend

## 1. Purpose & Architecture

The FastAPI CAD2KML backend is hosted on Render's container platform (`https://cad2kml-converter.onrender.com`). Render automatically spins down free-tier web services after 15 minutes of inactivity. When a subsequent conversion or health check request arrives, users experience a cold start latency of 30–60 seconds while the container and ODA File Converter libraries initialize.

This Cloudflare Worker operates as an automated health sentinel:
1. **Cloudflare Cron Trigger (`*/10 * * * *`):** Fires every 10 minutes to prevent the Render container from spinning down into cold sleep.
2. **HTTP GET `/health`:** Queries the lightweight health endpoint.
3. **Bounded Retries:** If transient network failure occurs, retries up to 3 times with exponential backoff (1s, 2s, 4s).
4. **Timeout Enforcement:** Enforces a 15-second AbortController timeout to prevent hung worker execution.
5. **No Secret Exposure:** Uses Cloudflare environment variables; zero credentials in git.

---

## 2. Realistic Hosting Limitations & Keep-Alive Policy Audit

> [!WARNING] **Important Hosting Provider Policy Disclaimer**
> A scheduled keep-alive ping is a best-effort availability optimization, **NOT** a guaranteed replacement for an always-on production instance.
>
> 1. **Render Free-Tier Quota:** Render allocates 750 free instance hours per calendar month across all free web services. Running a single service 24/7 consumes $24 \times 31 = 744$ hours. If another free service shares the account, both will suspend once the quota is exhausted.
> 2. **Render Active Spin-Down Detection:** Render may periodically restart free services regardless of inbound pings.
> 3. **Production Recommendation:** For guaranteed 99.99% availability, zero cold starts, and immediate DWG conversion, the backend should be deployed on Render's **Starter ($7/mo)** plan with always-on instances enabled in `render.yaml`.

---

## 3. Deployment Instructions

### Prerequisites
- Node.js 18+
- Cloudflare account (Free plan supports up to 3 cron triggers and 100,000 requests/day)
- Cloudflare Wrangler CLI (`npm install -g wrangler` or `npx wrangler`)

### Step 1: Login to Cloudflare
```bash
cd cloudflare-keepalive
npx wrangler login
```

### Step 2: Configure Environment Variables (Optional)
The default `wrangler.jsonc` targets `https://cad2kml-converter.onrender.com/health`.
To override with a custom backend:
```bash
npx wrangler secret put BACKEND_HEALTH_URL
```

### Step 3: Deploy Worker
```bash
npx wrangler deploy
```

### Step 4: Verify Live Execution
You can manually trigger the worker's HTTP endpoint:
```bash
curl https://cad2kml-keepalive.<your-subdomain>.workers.dev
```

Expected Response:
```json
{
  "url": "https://cad2kml-converter.onrender.com/health",
  "success": true,
  "statusCode": 200,
  "durationMs": 342,
  "attempt": 1,
  "timestamp": "2026-11-17T15:20:00.000Z",
  "backendVersion": "3.0.0",
  "dwgSupported": true
}
```
