#!/usr/bin/env bash
# Replaces this repository's files with the latest Waymark release branch,
# keeping the files that belong to this installation. Used by
# .github/workflows/update.yml; can also be run by hand from the repo root.
set -euo pipefail

UPSTREAM="${UPSTREAM:-EinfachRuwen/waymark}"
BRANCH="${UPSTREAM_BRANCH:-main}"
# Files that belong to this installation and are never overwritten.
KEEP="${KEEP:-wrangler.jsonc} ${EXTRA_KEEP:-}"
# A push with the default GITHUB_TOKEN may not change workflow files, so they
# are kept unless a token with the "workflow" permission is configured.
if [ "${CAN_UPDATE_WORKFLOWS:-0}" != "1" ]; then KEEP="$KEEP .github/workflows"; fi

git fetch --quiet --depth 1 "${UPSTREAM_URL:-https://github.com/${UPSTREAM}.git}" "$BRANCH"
UP=$(git rev-parse FETCH_HEAD)

backup=$(mktemp -d)
for p in $KEEP; do
  if [ -e "$p" ]; then mkdir -p "$backup/$(dirname "$p")"; cp -a "$p" "$backup/$p"; fi
done

git rm -r -q --ignore-unmatch . > /dev/null
git checkout FETCH_HEAD -- .

for p in $KEEP; do
  if [ -e "$backup/$p" ]; then
    rm -rf "$p"
    mkdir -p "$(dirname "$p")"
    cp -a "$backup/$p" "$p"
  fi
done

git add -A
if git diff --cached --quiet; then
  echo "Already up to date with ${UPSTREAM}@${UP:0:7}."
  exit 0
fi

if ! git diff --quiet FETCH_HEAD -- wrangler.jsonc 2>/dev/null; then
  echo "::notice::wrangler.jsonc differs from upstream and was kept. Compare it with https://github.com/${UPSTREAM}/blob/${BRANCH}/wrangler.jsonc if a new version needs new settings."
fi

git -c user.name="waymark-updater" -c user.email="waymark-updater@users.noreply.github.com" \
  commit --quiet -m "Update Waymark to ${UPSTREAM}@${UP:0:7}"
echo "Updated to ${UPSTREAM}@${UP:0:7}."
