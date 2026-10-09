#!/usr/bin/env bash
# Starts a throwaway local API (+ built SPA from dist/) for the 2026-10-09 platform QA.
# Never points at production: every path lives in a fresh temp directory.
#   QA_PORT=4100 scripts/qa/start-local.sh   (run `pnpm exec vite build` first to serve the UI)
set -euo pipefail
cd "$(dirname "$0")/../.."
QA_DIR="${QA_DIR:-$(mktemp -d /tmp/dq-qa-run-XXXXXX)}"
mkdir -p "$QA_DIR"
export NODE_ENV=development
export PORT="${QA_PORT:-4100}"
export DATABASE_PATH="$QA_DIR/qa.sqlite"
export MEDIA_STORAGE_PATH="$QA_DIR/media"
export BACKUP_DIR="$QA_DIR/backups"
export SESSION_SECRET="qa-local-session-secret-$(date +%s)-abcdefghijklmnop"
export MEDIA_ENCRYPTION_KEY="qa-local-media-key-0123456789abcdef"
export OTP_HASH_SECRET="qa-local-otp-secret"
export OTP_DEV_MODE=true
export OTP_DEV_CODE=246810
export PAYMENT_PROVIDER=sandbox
export STAFF_BOOTSTRAP_USERNAME=admin
export STAFF_BOOTSTRAP_PASSWORD='QA-Bootstrap-Admin-2026!'
export STAFF_BOOTSTRAP_FULL_NAME='مدير النظام (QA)'
export PUBLIC_BASE_URL="http://localhost:$PORT"
unset OTPIQ_API_KEY ZAINCASH_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY RAILWAY_ENVIRONMENT || true
echo "QA_DIR=$QA_DIR"
exec node_modules/.bin/tsx server/index.ts
