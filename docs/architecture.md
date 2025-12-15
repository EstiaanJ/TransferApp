# TransferApp Detailed Architecture

This document expands the high-level architecture with concrete flows, component responsibilities, and configuration guidance tailored to Cloudflare's free tier and a self-hosted Rust/PostgreSQL backend.

## Components

### Frontend (Cloudflare Pages)
- Serves a static-built SPA or multi-page app.
- Interacts exclusively with the Worker API (never directly with the Rust backend).
- Stores only non-sensitive client state (e.g., theme, cached API responses) in the browser; rely on cookies/Authorization headers for auth.

### Edge/API Layer (Cloudflare Workers)
- **Routing**: public endpoints for auth (signup, login, password reset), user profile retrieval, account linkage, and transfer initiation.
- **Security**:
  - Issue and verify JWTs signed with a key stored as a Wrangler secret.
  - Enforce CORS, rate limiting (KV-backed token bucket), and bot mitigation with Turnstile.
  - Require a rotating **signup secret** (Wrangler secret) to allow test users to create accounts during development; reject signups without the correct secret to prevent unauthorized account creation.
  - Require **Zero Trust Access service tokens** when calling the backend.
- **Data**:
  - **D1** holds users, credentials (salted SHA-256 for MVP; upgrade to argon2id later), sessions, device metadata, and lightweight account profiles.
  - **KV** caches rate-limit counters, email verification nonces, and public-key rotation metadata.
  - Optional **Durable Object** for serialized operations that must not race (e.g., transfer idempotency coordination), but prefer backend enforcement first to stay within free-tier limits.
- **Backend calls**: use `fetch` to the tunnel hostname (e.g., `https://api.ejvr.xyz/internal`) with the service token in the `CF-Access-Client-Id`/`CF-Access-Client-Secret` headers.

### Backend (Rust + PostgreSQL)
- Suggested stack: `axum` + `tower` middleware, `sqlx` for DB access, `jsonwebtoken` for JWT verification (with Cloudflare Worker public key), and `rustls` for TLS termination if exposed directly.
- Responsibilities:
  - Idempotent transfer creation, ledger posting, and balance checks.
  - Strong audit logging (who/when/what) for compliance and reconciliation.
  - Replay protection via idempotency keys, request timestamps, and nonce verification.
  - Metrics and health checks exposed on a private path (`/healthz`) reachable through the tunnel.
- Database separation:
  - **PostgreSQL** stores accounts, balances, transactions, and audit trails.
  - Edge identity data stays in D1 to minimize PII in the self-hosted environment.

### Network & Zero Trust
- **Cloudflare Tunnel** exposes the Rust API without opening inbound firewall ports.
- **Zero Trust Access** service tokens restrict tunnel usage to authorized Workers; Access applications can also protect admin dashboards.
- **DNS**: CNAME `api.ejvr.xyz` to the tunnel endpoint; Pages uses `app.ejvr.xyz` or root.

## Request Flows

### Signup/Login
1. Client calls Worker `/auth/*` routes.
2. Worker validates Turnstile, verifies the provided signup secret against the stored hash, reads/writes D1 records, and issues JWT + refresh token cookies (HttpOnly/SameSite=Lax; Secure).
3. Worker stores session in D1; optional KV cache for session lookup.
4. No backend involvement.

### Transfer Initiation
1. Client submits transfer request to Worker API with JWT.
2. Worker validates JWT, applies rate limits, and ensures sender is verified/has MFA if required.
3. Worker forwards a signed, service-token-authenticated request to the Rust backend via the tunnel, including an idempotency key and user claims.
4. Backend posts ledger entries in PostgreSQL, persists audit, and returns a transfer receipt.
5. Worker responds to the client; optionally caches receipt metadata in KV for quick retrieval.

### Balance/Activity Fetch
- Served directly from the backend through the tunnel (after Worker auth) or via cached snapshots in KV; ensure responses are user-scoped and signed.

## Environment & Configuration

### Cloudflare (Wrangler `wrangler.toml` excerpts)
```toml
name = "transferapp-api"
main = "src/index.ts"
compatibility_date = "2024-04-05"

[vars]
JWT_ISSUER = "https://ejvr.xyz"
API_BASE = "https://api.ejvr.xyz"
SIGNUP_SECRET_HASH = "${SIGNUP_SECRET_HASH}"

[d1_databases]
[[d1_databases]]
binding = "AUTH_DB"
database_name = "transferapp-auth"

[kv_namespaces]
[[kv_namespaces]]
binding = "CACHE"
id = "<kv-namespace-id>"

[env.production.vars]
CF_ACCESS_CLIENT_ID = "${CF_ACCESS_CLIENT_ID}"
CF_ACCESS_CLIENT_SECRET = "${CF_ACCESS_CLIENT_SECRET}"
JWT_PRIVATE_KEY = "${JWT_PRIVATE_KEY}"
```

### Rust Backend (environment variables)
- `DATABASE_URL` → PostgreSQL connection string.
- `PUBLIC_JWKS` → JWKS URL or inline key set for verifying Worker-issued JWTs.
- `ACCESS_CLIENT_ID` / `ACCESS_CLIENT_SECRET` → expected Zero Trust service token values.
- `ALLOWED_ORIGINS` → comma-separated list for CORS when serving directly (mostly tunnel-only).

### Implemented MVP connectivity testbed

- **Frontend (Pages)**: `frontend/index.html` offers three panels — gated signup, login, and an echo call that flows through the Worker to the backend. Set `window.__WORKER_BASE__` if the Worker is on a different hostname.
- **Worker**: `workers/auth/src/index.js` with routes:
  - `POST /signup` — checks `SIGNUP_GATE_SECRET`, salts+hashes password with SHA-256, stores in D1.
  - `POST /login` — validates credentials, issues compact HMAC token signed with `JWT_SIGNING_KEY` (1h expiry).
  - `POST /proxy/echo` — forwards JSON payload + `Authorization` header to the Rust backend at `BACKEND_URL`.
  - `GET /healthz` — liveness.
- **D1 schema**: `workers/auth/migrations/0001_init.sql` creates `users` with `email`, `password_hash`, `password_salt`, `created_at`.
- **Backend (Rust)**: `backend/src/main.rs` exposes `GET /healthz` and `POST /echo` (validates the Worker token with the shared `JWT_SIGNING_KEY` and echoes payload).

This scaffold is intentionally minimal to confirm Cloudflare Pages → Worker → D1 → tunneled Rust backend end to end before layering in ledger features.

## Security Hardening Checklist
- Enforce HTTPS everywhere; HSTS on Pages domain.
- Use HttpOnly/Secure/SameSite cookies for refresh tokens; store access tokens in memory.
- Rotate JWT signing keys; publish JWKS for backend verification.
- Store the signup secret hash as a Wrangler secret and rotate by updating the secret + hash pair; compare with constant-time checks in the Worker.
- Apply per-IP and per-account rate limits at the Worker level.
- Require MFA and email verification before enabling transfers.
- Implement idempotency keys and replay detection in the backend.
- Log all auth events and money movement with consistent trace IDs across Worker and backend.

## Observability & Operations
- **Metrics**: expose Prometheus metrics from Rust API; optionally push counters to Workers Analytics Engine when available.
- **Tracing**: propagate `traceparent` headers from Worker to backend; sample at the edge.
- **Logging**: structured JSON logs; redact PII; ship to a log sink (Vector/Fluent Bit) behind the tunnel.
- **Backups**: enable automatic PostgreSQL backups; export D1 snapshots regularly.

## Free-Tier Considerations
- Keep Worker CPU time low; offload heavy crypto to the backend when possible.
- Prefer KV for rate-limit counters over Durable Objects to avoid concurrency costs.
- Batch or debounce balance refreshes to reduce tunnel traffic.
- Monitor Cloudflare usage dashboards to avoid exceeding free-tier limits (Workers/D1/Pages bandwidth).

## Initial Implementation Milestones
1. Create Pages site with placeholder UI and connect custom domain (`app.ejvr.xyz`).
2. Set up D1 schema for users/sessions and deploy Worker auth routes.
3. Configure Zero Trust Access service tokens and Cloudflare Tunnel to the Rust API; verify with a health-check endpoint.
4. Implement minimal Rust API for connectivity tests (`/healthz`, `/echo`) and validate JWT + Access tokens.
5. Add transfer idempotency and audit logging; integrate observability and PostgreSQL-backed ledger once connectivity is proven.

## DNS & Zero Trust Diagram (textual)
```
User Browser --HTTPS--> Cloudflare Pages (app.ejvr.xyz)
                        |
                        v
                 Cloudflare Worker (api.app.ejvr.xyz)
                        |
          (Zero Trust service token via Tunnel)
                        v
                Rust API (self-hosted) -- PostgreSQL
```

This plan keeps authentication and lightweight identity at the edge while reserving the self-hosted stack for monetary state that requires stronger consistency and control.
