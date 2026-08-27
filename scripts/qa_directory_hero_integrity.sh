#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
directory="$root/src/government-directory.ts"
forms="$root/src/service-forms.ts"
app="$root/src/App.tsx"

missing=0
while IFS= read -r key; do
  if ! grep -Fq "key: '$key'" "$forms"; then
    echo "missing_service_definition=$key"
    missing=1
  fi
done < <(grep -o "serviceKey: '[^']*'" "$directory" | sed "s/serviceKey: '//;s/'//")

while IFS= read -r image; do
  if [ ! -f "$root/public$image" ]; then
    echo "missing_hero_image=$image"
    missing=1
  fi
done < <(grep -o "image: '/[^']*'" "$app" | sed "s/image: '//;s/'//")

[ "$missing" -eq 0 ]
printf 'directory_hero_integrity=pass\n'
