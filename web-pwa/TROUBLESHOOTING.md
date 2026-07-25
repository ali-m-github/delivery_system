# Troubleshooting Guide

## Quick Health Check

```bash
curl http://localhost:3005/api/health
```

Expected response:

```json
{
  "status": "healthy",
  "checks": {
    "database": { "status": "ok" },
    "env": { "status": "ok" },
    "middleware": { "status": "ok" }
  }
}
```

## Common Issues

### 1. Middleware not loading (routes unprotected)

**Symptom:** `/orders` or `/admin` accessible without login.

**Cause:** Next.js requires a file named exactly `middleware.ts` at the project root with `export async function middleware(request: NextRequest)`. Any other filename or function name will be ignored.

**Fix:**

```bash
# Ensure middleware.ts exists at web-pwa/middleware.ts
# Delete any old proxy.ts file
rm web-pwa/proxy.ts
```

**Verify:** Run `npm run build` and check for `ƒ Proxy (Middleware)` in the output.

### 2. Nginx returns 404 for all routes

**Symptom:** External access to `83.149.106.196` returns nginx 404.

**Cause:** No proxy configuration for the Next.js dev server in nginx.

**Fix:** Add proxy blocks to nginx server config (port 80 and 443):

```nginx
location / {
    proxy_pass http://127.0.0.1:3005;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Verify:**

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 3. Port 3000 in use

**Symptom:** `npm run dev` falls back to port 3001, 3002, etc.

**Cause:** Another service (e.g., OpenSpeedTest) occupies port 3000.

**Fix:** Next.js auto-selects the next available port. Update nginx proxy to target the actual port (check with `lsof -i :3000-3010`).

### 4. Database connection fails

**Symptom:** API routes return 500 errors, health check shows database failure.

**Fix:**

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection
psql -h localhost -U db_admin -d delivery_system -c "SELECT 1"

# Check .env has correct DATABASE_URL
cat web-pwa/.env | grep DATABASE_URL
```

### 5. Build succeeds but middleware missing from output

**Symptom:** `npm run build` succeeds but no `Proxy (Middleware)` line.

**Cause:** `middleware.ts` is missing or exports the wrong function name.

**Fix:** Run `npm run validate` to check configuration.

## Validation Script

Run before deploying or starting the server:

```bash
npm run validate
```

This checks:

- `middleware.ts` exists and exports correct function
- `.env` contains required variables (`DATABASE_URL`, `JWT_SECRET`)
- `next.config.ts` is present
- `prisma/schema.prisma` is present

## Architecture Overview

```
External Traffic → Nginx (port 80/443) → Next.js (port 3005) → PostgreSQL (port 5432)
```

- **Nginx**: Reverse proxy, handles SSL termination
- **Next.js**: App Router, Tailwind CSS, Prisma ORM
- **PostgreSQL**: Primary database on localhost:5432
- **Middleware**: JWT session validation via `middleware.ts`
