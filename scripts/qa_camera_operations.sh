#!/usr/bin/env bash
set -euo pipefail

base="${1:-http://127.0.0.1:8793}"
cookie_file="$(mktemp)"
trap 'rm -f "$cookie_file"' EXIT

health_status="$(curl -sS -o /tmp/dhiqar-camera-qa-health.json -w '%{http_code}' "$base/api/health")"
[ "$health_status" = "200" ]

login_payload='{"accessCode":"1234"}'
login_response="$(curl -sS -c "$cookie_file" -H 'content-type: application/json' -d "$login_payload" "$base/api/auth/operations")"
printf '%s' "$login_response" | grep -q '"role":"OPERATIONS"'

stats_status="$(curl -sS -b "$cookie_file" -o /tmp/dhiqar-camera-qa-stats.json -w '%{http_code}' "$base/api/dashboard/stats")"
[ "$stats_status" = "200" ]

identity_status="$(curl -sS -b "$cookie_file" -o /tmp/dhiqar-camera-qa-identity.json -w '%{http_code}' "$base/api/admin/identity-reviews")"
[ "$identity_status" = "401" ]

echo 'camera_operations_qa=pass'
