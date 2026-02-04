#!/bin/bash
set -e

# Extract job ID from branch name (job/uuid -> uuid), fallback to random UUID
if [[ "$BRANCH" == job/* ]]; then
    JOB_ID="${BRANCH#job/}"
else
    JOB_ID=$(cat /proc/sys/kernel/random/uuid)
fi
echo "Job ID: ${JOB_ID}"

# Start Chrome (using Playwright's chromium)
CHROME_BIN=$(find /root/.cache/ms-playwright -name "chrome" -path "*/chrome-linux/*" | head -1)
$CHROME_BIN --headless --no-sandbox --disable-gpu --remote-debugging-port=9222 2>/dev/null &
CHROME_PID=$!
sleep 2

# Git setup
git config --global user.name "thepopebot"
git config --global user.email "thepopebot@example.com"

# Configure git to use gh CLI for authentication (GH_TOKEN env var required)
gh auth setup-git

# Clone branch
if [ -n "$REPO_URL" ]; then
    git clone --single-branch --branch "$BRANCH" --depth 1 "$REPO_URL" /job
else
    echo "No REPO_URL provided"
fi

cd /job

# Write credentials to Pi's default location (~/.pi/agent/)
echo "$PI_AUTH" | base64 -d > /root/.pi/agent/auth.json

# Write SECRETS env var to secrets.json (base64 encoded)
if [ -n "$SECRETS" ]; then
    echo "$SECRETS" | base64 -d > /root/.pi/agent/secrets.json
fi

# Clean workspace/tmp
rm -rf ./workspace/tmp/*

# Setup logs
LOG_DIR="/job/workspace/logs/${JOB_ID}"
mkdir -p "${LOG_DIR}"

# 1. Run job (THEPOPEBOT.md provides behavior rules, SOUL.md provides personality, job.md provides the task)
PROMPT="You're Alive!

$(cat /job/operating_system/THEPOPEBOT.md)

---

# Your Soul

$(cat /job/operating_system/SOUL.md)

---

# Your Job

$(cat /job/workspace/job.md)"

pi -p "$PROMPT" --session-dir "${LOG_DIR}"

# 2. Commit changes + logs
git add -A
git add -f "${LOG_DIR}"
git commit -m "thepopebot: job ${JOB_ID}" || true
git push origin

# 3. Merge (pi has memory of job via session)
#if [ -n "$REPO_URL" ] && [ -f "/job/MERGE_JOB.md" ]; then
#    echo "MERGED"
#    pi -p "$(cat /job/MERGE_JOB.md)" --session-dir "${LOG_DIR}" --continue
#fi

# 5. Create PR and auto-merge to main
gh pr create --title "thepopebot: job ${JOB_ID}" --body "Automated job" --base main || true
gh pr merge --squash || true

# Cleanup
kill $CHROME_PID 2>/dev/null || true
echo "Done. Job ID: ${JOB_ID}"
