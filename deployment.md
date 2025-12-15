# TransferApp Deployment Guide (MVP)

This document walks through an end-to-end deployment on Debian: build/run the Rust backend, start the Cloudflare tunnel, configure the Worker/D1, and publish the Pages UI.

## Overview of the flow
1. Build and run the Rust backend locally on port 3000.
2. Run `cloudflared` tunnel to expose the backend at `https://api.ejvr.xyz` (or your chosen host) without any port forwarding on your router.
3. Configure Wrangler with your account and D1 binding, set secrets/vars, and deploy the Worker.
4. Publish the Pages site and point it at the Worker base URL.
5. Smoke-test signup/login/echo from the Pages UI.

## 1) Backend: build and run locally
1. Install Rust (see `setup.md`).
2. From the repo root:
   ```bash
   cd backend
   cargo build --release
   ```
3. Prepare and export the shared secrets (match the Worker values):
   - `JWT_SIGNING_KEY`: generate locally, e.g., `openssl rand -hex 32`.
   - `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`: copy from the **Zero Trust → Access → Service Auth → Service Tokens** entry you created (`transferapp-backend`).
   These values stay local; do not commit them.
   ```bash
   export JWT_SIGNING_KEY="<your-hmac-key>"
   export CF_ACCESS_CLIENT_ID="<service-token-client-id>"
   export CF_ACCESS_CLIENT_SECRET="<service-token-client-secret>"
   export PORT=3000
   ```
4. Run the backend:
   ```bash
   ./target/release/transferapp-backend
   ```
   The service will listen on `http://localhost:3000` with `/healthz` and `/echo` endpoints.

## 2) Cloudflare Tunnel: expose the backend
1. Authenticate `cloudflared` (first time only):
   ```bash
   cloudflared tunnel login
   ```
2. Create (or reuse) the tunnel:
   ```bash
   cloudflared tunnel create transferapp-backend
   ```
   This writes credentials to `~/.cloudflared/<tunnel-id>.json`.
3. Add a DNS route for the hostname (one-time). If you use the dashboard **Route traffic** form, set **Subdomain** `api`, **Domain** `ejvr.xyz`, **Path** blank, **Type** `HTTP`, and **URL** `http://localhost:3000`. The CLI equivalent:
   ```bash
   cloudflared tunnel route dns transferapp-backend api.ejvr.xyz
   ```
4. Run the tunnel mapping to your local backend (no router port forwarding needed because the tunnel makes the outbound connection):
   ```bash
   cloudflared tunnel --url http://localhost:3000 --hostname api.ejvr.xyz run transferapp-backend
   ```
   Leave this running while testing. Optional: create a systemd service for persistence.

## 3) Worker: configure and deploy
1. Set Wrangler context (run from `workers/auth` so Wrangler can read the config, or pass `--config workers/auth/wrangler.toml`):
   ```bash
   cd workers/auth
   wrangler login
   wrangler whoami  # confirm account_id
   ```
2. Update `wrangler.toml`:
   - Set `account_id` to your Cloudflare account ID.
   - Under `[d1_databases]`, set `database_id` to the `transferapp-auth` D1 ID.
   - Under `[vars]`, set `BACKEND_URL = "https://api.ejvr.xyz"` (tunnel hostname).
3. Apply D1 migrations:
   ```bash
   wrangler d1 migrations apply transferapp-auth
   ```
4. Set Worker secrets (these stay out of git):
   ```bash
   wrangler secret put SIGNUP_GATE_SECRET
   wrangler secret put JWT_SIGNING_KEY
   wrangler secret put CF_ACCESS_CLIENT_ID
   wrangler secret put CF_ACCESS_CLIENT_SECRET
   ```
   - `SIGNUP_GATE_SECRET`: code you hand to testers for signup.
   - `JWT_SIGNING_KEY`: shared HMAC key also used by the backend.
   - `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`: service token values from Zero Trust.
5. Deploy the Worker:
   ```bash
   wrangler deploy
   ```
6. Note the deployed Worker route/URL; you’ll point the frontend to this base (e.g., `https://auth.ejvr.xyz`).

## 4) Pages: publish the smoke-test UI
1. From repo root, ensure `frontend/index.html` is ready (no build step needed).
2. In the Cloudflare dashboard → **Workers & Pages → Pages**, create or redeploy the project using `frontend/`.
3. Set the custom domain (e.g., `app.ejvr.xyz`) and ensure HTTPS is active.
4. If the Worker runs on a different host, set `window.__WORKER_BASE__` in Pages via an inline script or modify `frontend/index.html` before deploy to point to the Worker origin (e.g., `https://auth.ejvr.xyz`).

## 5) End-to-end smoke test
1. Open the Pages URL (e.g., `https://app.ejvr.xyz`).
2. In the signup panel, enter email/password plus the `SIGNUP_GATE_SECRET` you set; confirm success.
3. Log in with the same credentials; note the returned token.
4. In the echo panel, submit a test payload; verify the response comes back via Worker → tunnel → backend.
5. Check backend logs and `cloudflared` output for any errors.

## 6) Operating notes
- Rotate the signup secret regularly with `wrangler secret put SIGNUP_GATE_SECRET` and share new value with testers.
- Keep `cloudflared` running whenever the backend should be reachable; automate with systemd for reliability.
- Use `wrangler tail` to watch Worker logs during testing.
- When changing the backend host/port, update both the tunnel command and the Worker `BACKEND_URL` variable, then redeploy.

Following these steps gives you a functional MVP path: Pages → Worker (D1 auth + gating) → tunneled Rust backend.
