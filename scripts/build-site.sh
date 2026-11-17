#!/usr/bin/env bash
# Assembles the GitHub Pages site into _site/ from site/, the app's fonts and
# the screenshots in docs/screenshots.
set -euo pipefail
out="${1:-_site}"
rm -rf "$out"
mkdir -p "$out/fonts" "$out/img/de"
cp site/index.html site/site.css site/site.js "$out/"
cp src/web/public/favicon.svg "$out/"
cp src/web/public/fonts/*.woff2 "$out/fonts/"
cp docs/screenshots/*.png "$out/img/"
if ls docs/screenshots/de/*.png > /dev/null 2>&1; then cp docs/screenshots/de/*.png "$out/img/de/"; fi
touch "$out/.nojekyll"
echo "Site built in $out"
