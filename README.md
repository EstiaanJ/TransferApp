# TransferApp Architecture Overview

This repository documents the proposed architecture for **TransferApp**, a person-to-person payment service that stays within Cloudflare's free tier wherever possible while using a self-hosted Rust backend and PostgreSQL database.

The design maps each component to Cloudflare features (Pages, Workers, Zero Trust, Tunnels) and shows how they interconnect with the self-hosted backend to deliver login, authentication, account management, and payment transfer flows.

## Goals

- Deliver a responsive web experience via Cloudflare Pages with Workers-powered APIs close to users.
- Keep authentication, session management, and account metadata on Cloudflare-managed, free-tier services.
- Expose a self-hosted Rust + PostgreSQL backend securely through Cloudflare Tunnels/Zero Trust, minimizing public attack surface.
- Keep the MVP simple: Pages + Worker (auth/API) + D1 for users/credentials, with a minimal Rust backend reachable through the tunnel for end-to-end verification.

## Topology at a Glance

- **Client** → Cloudflare **Pages** (static assets) → Cloudflare **Workers** (API/auth edge layer).
- Workers use **D1 (Cloudflare SQL)** for identity data, sessions, and lightweight account metadata.
- Workers call the self-hosted **Rust API** through a **Cloudflare Tunnel** protected by **Zero Trust Access** for service-to-service auth.
- Rust API uses internal **PostgreSQL** for ledgered balances, payment instructions, and auditing.
- Optional **Cloudflare Access** policy protects admin routes; **Turnstile** mitigates bot signups.

## Recommended Stack

- **Frontend**: Cloudflare Pages + vanilla JS or a static-built framework (React/Vite/Svelte) compiled to static assets.
- **Edge/API**: Cloudflare Workers (TypeScript) using `Hono`/`itty-router` for routing and `jsonwebtoken` for JWT handling.
- **Edge Data**: Cloudflare D1 (SQL), Workers KV for ephemeral cache, Durable Objects only if strict serialization is needed.
- **Backend**: Rust (e.g., `axum` or `actix-web`) with PostgreSQL; `sqlx` for DB access; `rustls`/`hyper` for HTTPS.

## Deployment Flow

1. **Static site** is built and deployed to **Pages** (e.g., `main` branch auto-deploy).
2. **Workers** are deployed via `wrangler` and bound to:
   - `D1` database for auth/session data.
   - `KV` namespace for rate-limit tokens and cached feature flags.
   - **Tunnel hostname** (e.g., `api.ejvr.xyz`) pointing to the Rust API.
3. **Zero Trust Access** enforces service tokens on tunnel requests; Workers include the token when calling the backend.
4. **Rust API** validates the Access service token and processes business logic against PostgreSQL.

## Key Data Boundaries

- **Cloudflare D1**: users, credentials (hashed), session tokens, device fingerprints, lightweight account profiles.
- **PostgreSQL**: ledger entries, account balances, transfer instructions, compliance/audit trails, idempotency keys.

## Current Repository Layout

```
.
├── frontend/                 # Cloudflare Pages static site for smoke-testing end-to-end
│   └── index.html
├── workers/
│   └── auth/                 # Cloudflare Worker for signup/login + backend proxy
│       ├── migrations/       # D1 schema for users
│       ├── src/index.js      # Worker logic (signup, login, echo proxy)
│       └── wrangler.toml
├── backend/                  # Minimal Rust API to validate tunnels/Zero Trust
│   ├── Cargo.toml
│   └── src/main.rs
├── README.md
└── docs/
    └── architecture.md
```

## Hands-on MVP flow (what to configure now)

1. **Cloudflare D1** (in dash or `wrangler d1 create transferapp-auth`)
   - Bind it in `workers/auth/wrangler.toml` (`database_id`) and run migrations: `cd workers/auth && wrangler d1 migrations apply transferapp-auth`.
2. **Secrets** (Wrangler dashboard or CLI)
   - `SIGNUP_GATE_SECRET`: rotating code you give testers for account creation.
   - `JWT_SIGNING_KEY`: shared key between Worker and Rust backend for the lightweight token.
3. **Vars**
   - `BACKEND_URL` in `wrangler.toml` pointing at the tunneled Rust API host (e.g., `https://api.internal.ejvr.xyz`).
4. **Deploy the Worker**
   - `cd workers/auth && wrangler deploy` (or attach it to Pages Functions if preferred).
5. **Pages site**
   - Publish `frontend/` to Cloudflare Pages. Set `window.__WORKER_BASE__` in a small inline script or Page rule if the Worker is on a separate hostname.
6. **Rust backend** (self-hosted behind tunnel)
   - Build: `cd backend && cargo build --release`.
   - Run with env vars: `JWT_SIGNING_KEY=<same-as-worker> PORT=3000 ./target/release/transferapp-backend`.
   - Expose via `cloudflared tunnel run …` mapped to `/echo` and `/healthz`.

## Next Steps

- Point Pages at the Worker (route or Pages Functions) so `/signup`, `/login`, and `/proxy/echo` are reachable from the static site.
- Wire the Rust backend into your tunnel and Zero Trust policy; ensure the Worker is allowed to reach it.
- Start end-to-end smoke tests from `frontend/index.html` to confirm account creation, login, and `/proxy/echo` round-trips through the tunnel.
- Extend docs with production hardening (rate limits, bot protection, log sinks) as you iterate.

## Staying in the Free Tier

- **Workers**: keep under the free-request cap; avoid heavy CPU; cache with KV where possible.
- **D1**: start with the free tier; move high-volume transaction data to PostgreSQL only.
- **Tunnels/Zero Trust**: use service tokens (free); Access apps for admin-only paths.
- **Pages**: free tier covers static hosting and limited bandwidth.

## Security Highlights

- Use **Zero Trust Access Service Tokens** for Worker → backend calls.
- Encrypt secrets with **Wrangler** secrets and environment variables; never commit them.
- Apply strict CORS and rate limiting at the Worker edge layer.
- Sign JWTs at the edge; verify in Workers and backend; rotate keys regularly.
- Ensure Rust backend enforces idempotency and replay protection on transfers.

## Observability

- Log structured events in Workers (KV-backed sampling) and ship backend logs to a central sink (e.g., Vector/Fluent Bit).
- Expose Prometheus metrics from the Rust API; scrape locally and forward through the tunnel if needed.

Refer to [`docs/architecture.md`](docs/architecture.md) for deeper component-by-component details.
