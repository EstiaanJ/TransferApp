# TransferApp Setup Guide

This guide prepares a Debian-based workstation and your Cloudflare account for running the TransferApp MVP stack (Pages + Worker + Tunnel + Rust backend). It focuses on prerequisites; the linear deployment steps live in `deployment.md`.

## 1) Prerequisites (accounts and access)
1. Cloudflare account with the `ejvr.xyz` zone added.
2. Cloudflare Zero Trust enabled (free plan is enough).
3. Two custom subdomains reserved: one for the Worker/API (e.g., `api.ejvr.xyz`) and one for Pages (e.g., `app.ejvr.xyz`). You will bind them during deployment; no need to create DNS records yet.
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

### A) Cloudflare Pages (prep only)
- Decide the Pages hostname (e.g., `app.ejvr.xyz`) and ensure it is available in your zone. The project itself is created during deployment.

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
3. Add a public hostname pointing to your internal backend (later, map to `http://localhost:3000`). Example hostname: `api.ejvr.xyz` → HTTP → `http://localhost:3000`.

### F) Wrangler authentication
1. Run `wrangler login` and complete the browser flow.
2. Verify access: `wrangler whoami`.

### G) Repository configuration placeholders
Review these values for later steps:
- `workers/auth/wrangler.toml` needs `account_id` and `database_id`.
- Secrets to set: `SIGNUP_GATE_SECRET`, `JWT_SIGNING_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`.
- Vars to set: `BACKEND_URL` (the tunnel hostname for the backend).

With these prerequisites in place, continue with `deployment.md` for the exact deployment sequence.
