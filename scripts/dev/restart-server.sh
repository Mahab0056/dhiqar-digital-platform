#!/usr/bin/env bash
# restarts the local API server with the test env (dev helper)
cd "$(dirname "$0")/../.."
PID=$(lsof -ti tcp:8787 2>/dev/null || fuser 8787/tcp 2>/dev/null)
[ -n "$PID" ] && kill $PID 2>/dev/null && sleep 1
[ "$1" = "--fresh" ] && rm -f data/test.sqlite*
set -a; . ./.env.local.test; set +a
nohup node --no-warnings --import tsx server/index.ts > /tmp/server.log 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:8787/api/health >/dev/null && break; sleep 0.5; done
tail -3 /tmp/server.log
