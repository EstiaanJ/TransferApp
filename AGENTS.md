# Agent Guidelines for TransferApp

Welcome! This repository documents and prototypes **TransferApp**, a Cloudflare-first payments MVP. Review these guardrails before making changes.

## Repository map & intent
- **frontend/**: Static Pages site for signup/login/echo smoke tests. Keep it buildless and point it at the Worker with `window.__WORKER_BASE__` (no trailing slash).【F:README.md†L21-L74】【F:docs/architecture.md†L80-L114】
- **workers/auth/**: Cloudflare Worker that handles signup/login, stores users in D1, and proxies echo calls to the Rust backend. It expects env vars/secrets set via Wrangler and enforces CORS against `FRONTEND_ORIGIN`.【F:README.md†L37-L74】【F:workers/auth/src/index.js†L1-L123】
- **backend/**: Minimal Rust API (`/healthz`, `/echo`) used to validate tunnel + Zero Trust connectivity. It verifies Worker-issued HMAC tokens using `JWT_SIGNING_KEY`.【F:README.md†L37-L74】【F:backend/src/main.rs†L1-L85】
- **docs/**, **setup.md**, **deployment.md**: Expanded architecture and stepwise setup/deploy guides—read before altering flows or config defaults.【F:setup.md†L1-L68】【F:deployment.md†L1-L94】【F:docs/architecture.md†L1-L163】

## Security & secrets
- Never commit secrets (JWT keys, signup gate secrets, Access service tokens). They live in Wrangler secrets or local env vars per the guides.【F:deployment.md†L17-L66】【F:docs/architecture.md†L137-L163】
- Keep CORS strict to the Pages origin and preserve the gated-signup flow; do not loosen auth without explicit approval.【F:workers/auth/src/index.js†L6-L49】【F:docs/architecture.md†L12-L44】
- When adding backend calls, include Zero Trust service tokens on tunnel traffic and enforce token validation server-side.【F:README.md†L12-L38】【F:docs/architecture.md†L44-L78】

## Coding practices
- Maintain the current stack choices: vanilla JS in `frontend/`, Worker JavaScript with D1/KV patterns, and Rust 2021 with Axum for the backend.【F:README.md†L1-L38】【F:backend/Cargo.toml†L1-L14】
- Prefer small, composable functions; return JSON with `jsonResponse` helper in the Worker and keep responses cache-free (`Cache-Control: no-store`).【F:workers/auth/src/index.js†L1-L133】
- For authentication flows, continue using salted SHA-256 hashing in D1 for the MVP and compact HMAC tokens; if you upgrade crypto, migrate schema and verification together.【F:workers/auth/src/index.js†L55-L123】
- In Rust, validate bearer tokens with the existing HMAC scheme before trusting payload fields; keep `/healthz` lightweight and `/echo` for connectivity tests.【F:backend/src/main.rs†L33-L85】

## Configuration & environment
- Ensure `workers/auth/wrangler.toml` stays updated with the correct `account_id`, `database_id`, `BACKEND_URL`, and `FRONTEND_ORIGIN` values; never hardcode secrets here.【F:workers/auth/wrangler.toml†L1-L17】
- Backend expects `JWT_SIGNING_KEY` and optional `PORT`; keep default listener on 0.0.0.0:3000 for parity with docs and tunnel commands.【F:backend/src/main.rs†L43-L77】【F:deployment.md†L11-L66】
- Follow `setup.md` then `deployment.md` for prerequisite tooling, tunnel setup, and Pages/Worker deployment order when testing changes end-to-end.【F:setup.md†L1-L68】【F:deployment.md†L1-L94】

## Testing & validation
- For frontend/Worker changes, exercise signup → login → `/proxy/echo` against a deployed Worker + backend tunnel to confirm JWT issuance and validation succeed.【F:README.md†L63-L103】【F:docs/architecture.md†L114-L163】
- For backend changes, run the server locally (`cargo build --release` then `PORT=3000 JWT_SIGNING_KEY=… ./target/release/transferapp-backend`) and post to `/echo` with and without a Bearer token to verify validation paths.【F:deployment.md†L11-L39】【F:backend/src/main.rs†L33-L85】

## Documentation expectations
- Keep architecture/deployment guidance in sync with behavior changes. Update the relevant Markdown guide if flows, routes, required secrets, or environment variables change.【F:README.md†L1-L74】【F:docs/architecture.md†L1-L163】【F:deployment.md†L1-L94】

Thanks for keeping the free-tier-friendly, tunnel-protected flow intact while you iterate.
