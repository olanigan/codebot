# Setup Guide

This guide covers two deployment paths and LLM provider configuration:

- **Cloudflare Pages** — deploy the web UI and API to Cloudflare's edge network
- **VPS (Docker Compose)** — deploy the full stack on a server you control, including the GitHub Actions self-hosted runner for Pi jobs
- **LLM providers** — configure the Event Handler and Pi agent to use OpenAI, Anthropic, Google, or OpenRouter

---

## Contents

1. [Prerequisites](#prerequisites)
2. [Initial Project Setup](#initial-project-setup)
3. [Cloudflare Pages Deployment](#cloudflare-pages-deployment)
4. [VPS Deployment (Docker Compose)](#vps-deployment-docker-compose)
5. [GitHub Runner for Pi Jobs](#github-runner-for-pi-jobs)
6. [LLM Provider Configuration](#llm-provider-configuration)
7. [GitHub Secrets and Variables Reference](#github-secrets-and-variables-reference)

---

## Prerequisites

Before starting either deployment path you need:

- **Node.js 18+** and npm
- **git** and **GitHub CLI** (`gh`) — [install gh](https://cli.github.com/)
- A **GitHub repository** (public or private) that will host your project
- A **GitHub Personal Access Token** with scopes: `repo`, `admin:repo_hook`, `workflow`

Authenticate the CLI:

```bash
gh auth login
```

---

## Initial Project Setup

Scaffold your project and run the setup wizard regardless of which deployment path you choose.

```bash
mkdir my-agent && cd my-agent
npx thepopebot@latest init
npm run setup
```

The setup wizard will prompt for:

1. **GitHub PAT** — validates `repo`, `admin:repo_hook`, `workflow` scopes
2. **Repository** — auto-detected from `git remote origin`
3. **LLM provider** — see [LLM Provider Configuration](#llm-provider-configuration)
4. **Telegram** — optional; skip with enter if not needed
5. **GitHub secrets/variables** — synced automatically at the end

After setup, your `.env` contains the Event Handler configuration and GitHub holds the runner secrets.

---

## Cloudflare Pages Deployment

Cloudflare Pages runs the Next.js app on Cloudflare's edge network (Workers runtime). This covers the web UI, chat, API routes, and cron/trigger orchestration.

> **Limitation**: The default SQLite (better-sqlite3) driver is a Node.js native module and cannot run in the Workers/Edge runtime. You must swap it for **Cloudflare D1** (Cloudflare's edge-native SQLite service) or point `DATABASE_PATH` at an external SQLite file accessible over a network mount. The Drizzle ORM used by thepopebot supports D1 — see the [D1 migration note](#d1-database-on-cloudflare) below.

> **Also note**: Cron jobs (`lib/cron.js`) use `node-cron` which relies on a persistent process. On Cloudflare Pages there is no persistent server process, so scheduled jobs must be replaced with **Cloudflare Cron Triggers** (Workers scheduled events) that POST to `/api/create-job`. The self-hosted GitHub runner for Pi jobs still needs to run on a separate server.

### 1. Install the Cloudflare adapter

```bash
npm install @cloudflare/next-on-pages
npm install --save-dev wrangler
```

Add to `package.json` scripts:

```json
"scripts": {
  "pages:build": "npx @cloudflare/next-on-pages",
  "preview": "npm run pages:build && wrangler pages dev .vercel/output/static",
  "deploy": "npm run pages:build && wrangler pages deploy .vercel/output/static"
}
```

### 2. Set the Edge runtime on API routes

The catch-all API route must opt into the Edge runtime. Edit `app/api/[...thepopebot]/route.js`:

```js
export const runtime = 'edge';
export { GET, POST } from 'thepopebot/api';
```

And the chat streaming route at `app/stream/chat/route.js`:

```js
export const runtime = 'edge';
export { POST } from 'thepopebot/chat/api';
```

### 3. Update `next.config.mjs`

```js
import { withThepopebot } from 'thepopebot/config';

export default withThepopebot({
  // Required for Cloudflare Pages
});
```

### 4. D1 database on Cloudflare

Create a D1 database:

```bash
wrangler d1 create thepopebot
```

Add to `wrangler.toml`:

```toml
name = "my-agent"
compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "thepopebot"
database_id = "<paste id from create output>"
```

The database schema migration (applying `drizzle/*.sql`) must be run manually against D1 after each thepopebot upgrade:

```bash
wrangler d1 execute thepopebot --file=node_modules/thepopebot/drizzle/<migration>.sql
```

> Code change required: `lib/db/index.js` uses `better-sqlite3`. To use D1 you need to replace it with the Drizzle D1 adapter (`drizzle-orm/d1`). Until thepopebot ships native D1 support, this requires a local fork or waiting for an upstream update.

### 5. Set environment variables in Cloudflare

In the Cloudflare dashboard under **Pages → Settings → Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `APP_URL` | `https://your-project.pages.dev` (or custom domain) |
| `AUTH_SECRET` | Copy from your `.env` (the auto-generated value) |
| `AUTH_TRUST_HOST` | `true` |
| `GH_TOKEN` | Your GitHub PAT |
| `GH_OWNER` | GitHub repository owner |
| `GH_REPO` | GitHub repository name |
| `GH_WEBHOOK_SECRET` | Random secret (must match GitHub secret of same name) |
| `LLM_PROVIDER` | See [LLM Provider Configuration](#llm-provider-configuration) |
| `LLM_MODEL` | Model name |
| Provider API key | e.g. `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` |

### 6. Deploy

```bash
npm run deploy
```

Or connect your GitHub repo to Cloudflare Pages for automatic deploys on push to `main`:

1. Cloudflare Dashboard → Pages → Create application → Connect to Git
2. Build command: `npx @cloudflare/next-on-pages`
3. Build output directory: `.vercel/output/static`

### 7. Register the Telegram webhook (if using Telegram)

After deploy, update your webhook URL:

```bash
APP_URL=https://your-project.pages.dev npm run setup-telegram
```

---

## VPS Deployment (Docker Compose)

Deploy the full stack on a Linux VPS. This is the simpler path — SQLite, cron, and all Node.js features work as-is.

### 1. Server prerequisites

Any VPS provider (Hetzner, DigitalOcean, AWS, etc.) with:

- Ubuntu 22.04 or Debian 12+
- Docker + Docker Compose
- Node.js 18+
- Git, GitHub CLI (`gh`)
- Ports 80 and 443 open

Point a domain A record at your server IP (e.g. `mybot.example.com`).

### 2. Scaffold and configure on the server

```bash
ssh user@your-server
mkdir my-agent && cd my-agent
npx thepopebot@latest init
npm run setup
```

When the wizard asks for `APP_URL`, enter `https://mybot.example.com`.

### 3. Set the self-hosted runner label

```bash
gh variable set RUNS_ON --body "self-hosted" --repo OWNER/REPO
```

This makes all GitHub Actions workflows use your server's Docker runner instead of GitHub-hosted runners — required for Pi jobs (see [GitHub Runner for Pi Jobs](#github-runner-for-pi-jobs)).

### 4. Enable HTTPS (Let's Encrypt)

Add to `.env`:

```
LETSENCRYPT_EMAIL=you@example.com
APP_HOSTNAME=mybot.example.com
```

In `docker-compose.yml`, uncomment the Let's Encrypt lines in the `traefik` service command and switch the event-handler labels from `web` to `websecure`:

```yaml
# traefik command — uncomment these:
- --entrypoints.web.http.redirections.entrypoint.to=websecure
- --entrypoints.web.http.redirections.entrypoint.scheme=https
- --certificatesresolvers.letsencrypt.acme.email=${LETSENCRYPT_EMAIL}
- --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
- --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web

# event-handler labels — comment web, uncomment websecure:
# - traefik.http.routers.event-handler.entrypoints=web
- traefik.http.routers.event-handler.entrypoints=websecure
- traefik.http.routers.event-handler.tls.certresolver=letsencrypt
```

### 5. Build and launch

```bash
npm run build
docker compose up -d
```

The stack starts three services:

| Service | Purpose |
|---------|---------|
| `traefik` | Reverse proxy, automatic HTTPS |
| `event-handler` | Next.js app (PM2, port 80) |
| `runner` | Self-hosted GitHub Actions runner |

Verify it's running:

```bash
curl https://mybot.example.com/api/ping
```

---

## GitHub Runner for Pi Jobs

Pi agent jobs run inside Docker containers on a **self-hosted GitHub Actions runner**. This is required for both the VPS and Cloudflare Pages paths — Cloudflare Pages hosts the UI but cannot run Docker containers.

### How it works

1. The Event Handler creates a `job/{uuid}` branch on GitHub with `logs/{uuid}/job.md` containing the task
2. GitHub Actions detects the branch and triggers `run-job.yml`
3. `run-job.yml` pulls the Docker image and runs the Pi agent container
4. Pi completes the task, commits results, and opens a PR
5. `auto-merge.yml` merges if the PR only touches allowed paths (default: `/logs`)
6. `notify-pr-complete.yml` POSTs a notification back to `/api/github/webhook`

### Runner on VPS (included in Docker Compose)

If you used the VPS path, the `runner` service in `docker-compose.yml` registers automatically on startup. No extra steps needed.

### Runner on a separate server (for Cloudflare Pages path)

If your UI is on Cloudflare Pages, you still need a server with Docker for the runner. The runner only needs to handle Pi jobs — it does not serve the web UI.

**Minimum spec**: 2 vCPU, 4 GB RAM, 20 GB disk.

On the runner server:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Pull and run the GitHub Actions runner container
docker run -d \
  --name github-runner \
  --restart unless-stopped \
  -e REPO_URL=https://github.com/OWNER/REPO \
  -e ACCESS_TOKEN=YOUR_GH_TOKEN \
  -e RUNNER_SCOPE=repo \
  -e LABELS=self-hosted \
  -v /var/run/docker.sock:/var/run/docker.sock \
  myoung34/github-runner:latest
```

Replace `OWNER/REPO` and `YOUR_GH_TOKEN` with your values. The runner registers itself with GitHub and starts polling for jobs.

Set the runner label in your GitHub repo:

```bash
gh variable set RUNS_ON --body "self-hosted" --repo OWNER/REPO
```

### Runner security notes

- The runner has Docker socket access — treat it as a privileged host
- Do not share the runner across untrusted repositories
- `AGENT_*` secrets are filtered from the Pi agent's LLM subprocess by the `env-sanitizer` extension
- `AGENT_LLM_*` secrets are intentionally accessible to the LLM (for skill API keys)

### Auto-merge and allowed paths

By default, Pi job PRs are auto-merged if they only modify files under `/logs`. To allow the agent to modify other paths:

```bash
gh variable set ALLOWED_PATHS --body "/logs,/src,/docs" --repo OWNER/REPO
```

To disable auto-merge entirely:

```bash
gh variable set AUTO_MERGE --body "false" --repo OWNER/REPO
```

---

## LLM Provider Configuration

There are **two independent LLM configurations**: the Event Handler (Next.js orchestration agent) and the Pi agent (Docker job runner). They can use different providers and models.

### Event Handler LLM

Set in `.env` on your server (VPS) or as environment variables in Cloudflare Pages settings.

#### OpenAI (default)

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

#### Anthropic

```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=sk-ant-...
```

#### Google Gemini

```env
LLM_PROVIDER=google
LLM_MODEL=gemini-2.5-pro
GOOGLE_API_KEY=AIza...
```

#### OpenRouter (any model via OpenAI-compatible API)

```env
LLM_PROVIDER=custom
LLM_MODEL=anthropic/claude-sonnet-4-6
OPENAI_BASE_URL=https://openrouter.ai/api/v1
CUSTOM_API_KEY=sk-or-...
```

Other OpenRouter model IDs: `google/gemini-2.5-pro`, `openai/gpt-4o`, `meta-llama/llama-3.3-70b-instruct`.

#### Ollama (local, OpenAI-compatible)

```env
LLM_PROVIDER=custom
LLM_MODEL=llama3.2
OPENAI_BASE_URL=http://localhost:11434/v1
# CUSTOM_API_KEY not needed for Ollama
```

---

### Pi Agent LLM

Configured via **GitHub repository variables and secrets**. These are injected into the Docker container at job runtime by `run-job.yml`.

#### OpenAI

```bash
gh variable set LLM_PROVIDER --body "openai" --repo OWNER/REPO
gh variable set LLM_MODEL --body "gpt-4o" --repo OWNER/REPO
gh secret set AGENT_OPENAI_API_KEY --body "sk-..." --repo OWNER/REPO
```

#### Anthropic

```bash
gh variable set LLM_PROVIDER --body "anthropic" --repo OWNER/REPO
gh variable set LLM_MODEL --body "claude-sonnet-4-6" --repo OWNER/REPO
gh secret set AGENT_ANTHROPIC_API_KEY --body "sk-ant-..." --repo OWNER/REPO
```

#### Google Gemini

```bash
gh variable set LLM_PROVIDER --body "google" --repo OWNER/REPO
gh variable set LLM_MODEL --body "gemini-2.5-pro" --repo OWNER/REPO
gh secret set AGENT_GOOGLE_API_KEY --body "AIza..." --repo OWNER/REPO
```

#### OpenRouter

```bash
gh variable set LLM_PROVIDER --body "custom" --repo OWNER/REPO
gh variable set LLM_MODEL --body "anthropic/claude-sonnet-4-6" --repo OWNER/REPO
gh secret set AGENT_OPENAI_BASE_URL --body "https://openrouter.ai/api/v1" --repo OWNER/REPO
gh secret set AGENT_CUSTOM_API_KEY --body "sk-or-..." --repo OWNER/REPO
```

The entrypoint script generates `~/.pi/agent/models.json` from these values automatically when `LLM_PROVIDER=custom`.

---

### Using different models for Event Handler vs Pi agent

You can mix providers freely. For example, use a fast/cheap model for the Event Handler's chat and a more capable model for Pi jobs:

**.env (Event Handler)**:
```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
```

**GitHub variables (Pi agent)**:
```bash
gh variable set LLM_PROVIDER --body "anthropic" --repo OWNER/REPO
gh variable set LLM_MODEL --body "claude-sonnet-4-6" --repo OWNER/REPO
gh secret set AGENT_ANTHROPIC_API_KEY --body "sk-ant-..." --repo OWNER/REPO
```

---

## GitHub Secrets and Variables Reference

### Secrets

Set with `gh secret set NAME --body "value" --repo OWNER/REPO` or via the GitHub UI under **Settings → Secrets and variables → Actions**.

| Secret | Required | Description |
|--------|----------|-------------|
| `AGENT_GH_TOKEN` | Yes | GitHub PAT for the Pi agent (clone repo, create PRs). Needs `repo` scope. |
| `AGENT_ANTHROPIC_API_KEY` | If using Anthropic | Anthropic API key for Pi agent |
| `AGENT_OPENAI_API_KEY` | If using OpenAI | OpenAI API key for Pi agent |
| `AGENT_GOOGLE_API_KEY` | If using Google | Google API key for Pi agent |
| `AGENT_OPENAI_BASE_URL` | If using custom provider | Base URL for OpenAI-compatible endpoint (e.g. OpenRouter) |
| `AGENT_CUSTOM_API_KEY` | If using custom provider | API key for custom OpenAI-compatible endpoint |
| `AGENT_LLM_BRAVE_API_KEY` | If using brave-search skill | Brave Search API key (accessible to LLM) |
| `GH_WEBHOOK_SECRET` | Yes | Shared secret for GitHub Actions → Event Handler notifications |

`AGENT_*` secrets are filtered from the Pi agent's bash subprocess (LLM cannot exfiltrate them). `AGENT_LLM_*` secrets are intentionally visible to the LLM for skill use.

### Variables

Set with `gh variable set NAME --body "value" --repo OWNER/REPO` or via the GitHub UI under **Settings → Secrets and variables → Actions → Variables**.

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | — | Public URL of your event handler (e.g. `https://mybot.example.com`) |
| `RUNS_ON` | `ubuntu-latest` | Runner label. Set to `self-hosted` for your own server. |
| `LLM_PROVIDER` | `openai` | LLM provider for Pi jobs: `openai`, `anthropic`, `google`, `custom` |
| `LLM_MODEL` | Provider default | Model name for Pi jobs (e.g. `claude-sonnet-4-6`, `gemini-2.5-pro`) |
| `AUTO_MERGE` | enabled | Set to `false` to disable auto-merge of job PRs |
| `ALLOWED_PATHS` | `/logs` | Comma-separated path prefixes Pi is allowed to modify (e.g. `/logs,/src`) |
| `JOB_IMAGE_URL` | `stephengpope/thepopebot:job-*` | Docker image for Pi job containers. GHCR URLs trigger automatic image builds. |
| `EVENT_HANDLER_IMAGE_URL` | `stephengpope/thepopebot:event-handler-latest` | Docker image for the event handler |
