# TransferApp Setup Guide

This guide prepares a Debian-based workstation and your Cloudflare account for running the TransferApp MVP stack (Pages + Worker + Tunnel + Rust backend).

## 1) Prerequisites (accounts and access)
1. Cloudflare account with the `ejvr.xyz` zone added.
2. Cloudflare Zero Trust enabled (free plan is enough).
3. A custom subdomain available for the Worker/API (e.g., `api.ejvr.xyz`) and for Pages (e.g., `app.ejvr.xyz`).
4. Basic familiarity with the Cloudflare dashboard and Zero Trust console.

## 2) Local workstation prerequisites (Debian/Ubuntu)
1. Update packages and install build tooling:
   ```bash
   sudo apt update && sudo apt install -y curl wget unzip pkg-config libssl-dev build-essential
   ```
2. Install Rust (if not present):
   ```bash
   curl https://sh.rustup.rs -sSf | sh -s -- -y
   source "$HOME/.cargo/env"
   ```
3. Install `wrangler` (Cloudflare CLI):
   ```bash
   npm install -g wrangler
   ```
4. Install `cloudflared` (for tunnels):
   ```bash
   wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared-linux-amd64.deb
   ```
5. Install `node`/`npm` (if not already) for Pages/Worker tooling:
   ```bash
   sudo apt install -y nodejs npm
   ```
6. Clone this repository and enter it:
   ```bash
   git clone https://github.com/ejvrxyz/TransferApp.git
   cd TransferApp
   ```

## 3) Cloudflare resources to prepare
Follow these in the Cloudflare dashboard unless noted otherwise.

### A) Cloudflare Pages
1. Create a new Pages project pointing at the `frontend/` directory (or connect the repo if desired).
2. Configure the custom domain (e.g., `app.ejvr.xyz`).
3. Enable HTTPS and HSTS.

### B) D1 database (auth)
1. In **Workers & Pages → D1**, create a database named `transferapp-auth`.
2. Note the `Database ID` for binding in `wrangler.toml`.
3. You can also create via CLI later: `wrangler d1 create transferapp-auth`.

### C) Zero Trust Access service token (Worker → backend)
1. Go to **Zero Trust → Access → Service Auth → Service Tokens**.
2. Create a token named `transferapp-backend`.
3. Copy the `Client ID` and `Client Secret`; keep them secure for backend and Worker variables. These are the values you will export as `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` when running the backend and when setting Worker secrets.

### D) Secrets to generate and keep offline
- `JWT_SIGNING_KEY`: create a long random string locally (example: `openssl rand -hex 32`). This never leaves your machine except as a Wrangler secret and a backend environment variable.
- `SIGNUP_GATE_SECRET`: short phrase/code you hand to testers. Rotate easily with `wrangler secret put SIGNUP_GATE_SECRET`.

### E) Cloudflare Tunnel for backend
1. In **Zero Trust → Networks → Tunnels**, create a tunnel (e.g., `transferapp-backend`).
2. Download the generated `cloudflared` token/credentials file (usually `~/.cloudflared/<tunnel-id>.json`).
3. Add a public hostname pointing to your internal backend (later, map to `http://localhost:3000`). In the **Route traffic** form you saw after installing the tunnel token:
   - **Subdomain:** `api` (or whichever hostname you want to expose).
   - **Domain:** `ejvr.xyz` (the Cloudflare zone hosting your DNS).
   - **Path:** leave blank.
   - **Service → Type:** `HTTP`.
   - **Service → URL:** `http://localhost:3000` (the Rust backend that `cloudflared` reaches locally; no router port forwarding needed).
   This creates the route `api.ejvr.xyz` → `http://localhost:3000` through the tunnel.

### F) Wrangler authentication
1. Run `wrangler login` and complete the browser flow.
2. Verify access: `wrangler whoami`.
3. When running `wrangler` commands, either `cd workers/auth` first or pass `--config workers/auth/wrangler.toml` so the CLI can read the Worker name and bindings. Running from the repo root without pointing at this config will produce `Required Worker name missing`.

### G) Repository configuration placeholders (what they are and where to set them)
Use this checklist so you know exactly where each value lives before running `deployment.md`:

1. `account_id` (Cloudflare account identifier)
   - What it is: Your Cloudflare account UUID used by Wrangler to scope deployments.
   - Where to find it: Run `wrangler whoami` (shows `account_id`), or in the dashboard under **Workers & Pages → Overview → Account ID** in the right-hand sidebar.
   - Where to set it: Edit `workers/auth/wrangler.toml` and replace the placeholder `account_id` with your value.

2. `database_id` for D1
   - What it is: The UUID for the D1 database `transferapp-auth`.
   - Where to find it: Dashboard **Workers & Pages → D1 → transferapp-auth → Overview** or via CLI `wrangler d1 list`.
   - Where to set it: In `workers/auth/wrangler.toml` under `[d1_databases]`, set `database_id`.

3. Secrets (private values stored in Cloudflare; do **not** commit or hardcode)
   - `SIGNUP_GATE_SECRET`: The invite code you share with testers.
   - `JWT_SIGNING_KEY`: Random HMAC key (e.g., `openssl rand -hex 32`); must match the backend env var.
   - `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`: From the Zero Trust **Service Token** you created in step C.
   - Where to set them for the Worker: run inside `workers/auth/` (or pass `--config workers/auth/wrangler.toml` from elsewhere):
     ```bash
     wrangler secret put SIGNUP_GATE_SECRET
     wrangler secret put JWT_SIGNING_KEY
     wrangler secret put CF_ACCESS_CLIENT_ID
     wrangler secret put CF_ACCESS_CLIENT_SECRET
     ```
   - Where to set them for the backend locally: export them in your shell before running the Rust server (they stay on your machine):
     ```bash
     export JWT_SIGNING_KEY="<same-as-worker>"
     export CF_ACCESS_CLIENT_ID="<service-token-client-id>"
     export CF_ACCESS_CLIENT_SECRET="<service-token-client-secret>"
     ```

4. `BACKEND_URL` (public hostname for the tunnel)
   - What it is: The HTTPS URL the Worker uses to reach your tunneled backend (e.g., `https://api.ejvr.xyz`).
   - Where to set it: In `workers/auth/wrangler.toml` under `[vars]`, set `BACKEND_URL = "https://api.ejvr.xyz"`. Update this value if you change the tunnel hostname/route, then redeploy the Worker.

After you fill in these placeholders, proceed to `deployment.md` to apply migrations, set secrets, and deploy.

With these prerequisites in place, continue with `deployment.md` for the exact deployment sequence.
