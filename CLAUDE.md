# Project instructions

## Privacy (Datenschutz)

The project site in `site/` is published on GitHub Pages at waymark.fcrw.cc. Its privacy policy is `site/datenschutz.html` (German) and the technical record behind it is `docs/PRIVACY-TECHNICAL.md`.

Whenever a change can affect visitors' data, check both files and update them in the same change. This includes:

- new or changed external resources (fonts, scripts, styles, images, iframes, embeds, CDNs)
- new services, APIs or network requests (`fetch`, beacons, WebSockets, forms that submit anywhere)
- cookies, `localStorage`, `sessionStorage`, IndexedDB, service workers, or reading device information
- analytics, tracking, error reporting, A/B tests
- forms, contact options, comments
- hosting, domain, DNS, proxy or CDN changes, and changes to `scripts/build-site.sh` or `.github/workflows/pages.yml`

When you update them: keep the file and line references in `docs/PRIVACY-TECHNICAL.md` accurate, name the legal basis and storage period, list anything unverified under "Offene Punkte" instead of stating it as fact, and move the "Stand" date in both files. Keep the legal links (Datenschutz internal, Impressum at https://fcrw.cc/imprint) in the footer of every page.

The self-hosted Waymark app has no privacy policy of its own here: each operator is responsible for their instance. The site must keep making no requests to other hosts unless the privacy policy says so.
