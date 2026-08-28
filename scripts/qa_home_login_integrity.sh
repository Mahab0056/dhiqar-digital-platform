#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/src/App.tsx"
css="$root/src/App.css"

for target in '/#services' '/citizen' '/service/online-appointment' '/directory' '/verify' '/onboarding' '/employee' '/operations/login' '/super-admin/login'; do
  grep -Fq "href=\"$target\"" "$app" || grep -Fq "href: '$target'" "$app" || { echo "missing_route=$target"; exit 1; }
done

grep -Fq 'submitServiceSearch' "$app"
grep -Fq 'matchedServices' "$app"
grep -Fq 'government-hero' "$app"
grep -Fq 'government-search' "$app"
grep -Fq 'government-quick-actions' "$app"
grep -Fq 'government-service-list' "$app"
grep -Fq 'login-v3-choices' "$app"
grep -Fq '@media (max-width: 600px)' "$css"
grep -Fq 'government-hero' "$css"
grep -Fq 'login-v3-option' "$css"

echo 'home_login_integrity=pass'
