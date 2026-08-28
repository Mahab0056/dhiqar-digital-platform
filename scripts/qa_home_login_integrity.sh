#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
app="$root/src/App.tsx"
css="$root/src/App.css"
server="$root/server/index.ts"

for target in '/#services' '/citizen' '/directory' '/verify' '/onboarding' '/employee' '/operations/login' '/super-admin/login' '/login'; do
  grep -Fq "href=\"$target\"" "$app" || grep -Fq "href: '$target'" "$app" || { echo "missing_route=$target"; exit 1; }
done

for service_key in 'building-permit' 'store-license' 'national-id' 'passport-application'; do
  grep -Fq "key: '$service_key'" "$app" || { echo "missing_service_shortcut=$service_key"; exit 1; }
done

for marker in 'submitServiceSearch' 'matchingServices' 'civic-home' 'civic-hero' 'civic-search' 'civic-quick-grid' 'civic-facts' 'reference-category-grid' 'reference-directory-band' 'login-v3-choices'; do
  grep -Fq "$marker" "$app" || { echo "missing_app_marker=$marker"; exit 1; }
done

for marker in 'civic-home' 'civic-hero' 'civic-search' 'civic-quick-grid' 'civic-facts' 'reference-category-grid' 'reference-benefits' '@media (max-width: 760px)' 'login-v3-option'; do
  grep -Fq "$marker" "$css" || { echo "missing_css_marker=$marker"; exit 1; }
done

grep -Fq 'isLocalPreviewOrigin' "$server" || { echo 'missing_local_preview_origin_guard'; exit 1; }
grep -Fq 'secureHostedRuntime' "$server" || { echo 'missing_hosted_runtime_guard'; exit 1; }

echo 'home_login_integrity=pass'
