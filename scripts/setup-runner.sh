#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-runner.sh  —  Install a GitHub Actions self-hosted runner on this server
#
# Usage:
#   1. Go to: https://github.com/OWNER/REPO/settings/actions/runners/new
#   2. Copy the token shown on that page
#   3. Run: bash scripts/setup-runner.sh <YOUR_TOKEN>
# ─────────────────────────────────────────────────────────────────────────────
set -e

TOKEN="${1:?Usage: $0 <RUNNER_TOKEN>}"
REPO="https://github.com/OWNER/REPO"
RUNNER_DIR="$HOME/actions-runner"
RUNNER_VERSION="2.315.0"

echo "==> Creating runner directory at $RUNNER_DIR"
mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

echo "==> Downloading GitHub Actions runner v${RUNNER_VERSION}"
curl -o actions-runner.tar.gz -L \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

echo "==> Extracting..."
tar xzf actions-runner.tar.gz
rm actions-runner.tar.gz

echo "==> Configuring runner for $REPO"
./config.sh \
  --url "$REPO" \
  --token "$TOKEN" \
  --name "$(hostname)-server" \
  --labels "self-hosted,linux,x64" \
  --work "_work" \
  --unattended

echo "==> Installing as a systemd service (runs on boot)"
sudo ./svc.sh install
sudo ./svc.sh start

echo ""
echo "✅ Runner installed and running!"
echo "   Check status : sudo $RUNNER_DIR/svc.sh status"
echo "   Stop runner  : sudo $RUNNER_DIR/svc.sh stop"
echo ""
echo "Next push to main will auto-deploy 🚀"
