# Datenschutz: technische Dokumentation der Projektseite

Diese Datei hält fest, welche personenbezogenen Daten beim Besuch der Projektseite **waymark.fcrw.cc** (GitHub Pages, Quellen in `site/`) verarbeitet werden, wo das im Code passiert und wie es in der Datenschutzerklärung (`site/datenschutz.html`) beschrieben ist. Sie gilt nur für die Projektseite, nicht für die Waymark-App selbst: Wer Waymark betreibt, ist für seine Instanz selbst verantwortlich (zur App siehe „Privacy & security“ im README).

- **Stand:** 18. November 2026 (Analyse von Commit `4bd6535` auf `main` plus Branch `datenschutz`)
- **Verantwortlicher:** Ruwen Hohnholz, c/o Autorenglück #45094, Albert-Einstein-Str. 47, 02977 Hoyerswerda, info@focusonruwen.com. Übernommen aus dem Impressum unter https://fcrw.cc/imprint (302 → https://focusonruwen.com/impressum/) und der zentralen Erklärung https://focusonruwen.com/datenschutz/ (Stand dort: 15. November 2026).
- **Rechtliche Links:** Datenschutz intern (`datenschutz.html`), Impressum extern auf https://fcrw.cc/imprint.

## Wie geprüft wurde

1. Kompletter Quelltext der Seite gelesen: `site/index.html`, `site/datenschutz.html`, `site/site.css`, `site/site.js`, `scripts/build-site.sh`, `.github/workflows/pages.yml`.
2. Live-Seite mit Headless-Chromium geladen, ganz gescrollt, Sprache gewechselt und Screenshot-Tabs geklickt; alle Netzwerkanfragen, Cookies und Speicher erfasst. Ergebnis am 18.11.2026: 9 Anfragen, alle an `waymark.fcrw.cc`; keine Cookies; `localStorage` nur `waymark-site-lang` nach Klick auf die Sprachwahl; kein `sessionStorage`, kein Service Worker.
3. DNS über DNS-over-HTTPS abgefragt und Antwort-Header mit `curl -I` ausgewertet (siehe Hosting).
4. Live-HTML und `site.js` mit dem Repo verglichen: identisch mit `main` (Stand 17.11.2026).

## Verarbeitungen

| # | Verarbeitung | Fundstelle | Daten | Empfänger / Ort | Rechtsgrundlage | Speicherdauer | Beleg |
|---|---|---|---|---|---|---|---|
| 1 | Auslieferung der Seite (Hosting, Server-Logs) | `.github/workflows/pages.yml:20-33` (Deploy zu GitHub Pages), Custom Domain in den Pages-Einstellungen | IP-Adresse, Zeitpunkt, URL, Header (User-Agent, Accept-Language, Referer) | GitHub, Inc. (USA); CDN Fastly, Inc. (USA) als Unterauftragnehmer von GitHub | Art. 6 Abs. 1 lit. f DSGVO | von GitHub nicht beziffert | belegt, siehe unten |
| 2 | DNS-Auflösung `waymark.fcrw.cc` | außerhalb des Repos (DNS-Zone `fcrw.cc`) | DNS-Anfrage, in der Regel nur vom Resolver des Besuchers | Cloudflare, Inc. (USA), nur Nameserver | Art. 6 Abs. 1 lit. f DSGVO | unbekannt | belegt (Nameserver), Bewertung siehe unten |
| 3 | Sprachwahl im `localStorage` | `site/site.js:19-25` (schreiben, nur bei Klick), `site/site.js:136-145` (lesen) | Schlüssel `waymark-site-lang`, Wert `de`/`en` | nur im Browser, keine Übertragung | § 25 Abs. 2 Nr. 2 TDDDG | bis der Besucher die Websitedaten löscht | belegt (Code und Live-Test) |
| 4 | Browsersprache lokal auslesen | `site/site.js:144` (`navigator.language`) | Sprachcode | nur im Browser | § 25 Abs. 2 Nr. 2 TDDDG (Einschätzung, siehe unten) | keine Speicherung | belegt (Code) |
| 5 | Vorschau „Probier es aus“ | `site/index.html:89-99`, `site/site.js:62-85` (`preventDefault`, keine Netzwerkanfrage) | eingegebene URL | nur im Browser | keine Übertragung, daher keine Verarbeitung durch den Verantwortlichen | keine | belegt (Code und Live-Test) |
| 6 | E-Mail-Kontakt | `site/datenschutz.html` (mailto) | E-Mail-Adresse, Name, Inhalt | Postfach info@focusonruwen.com | Art. 6 Abs. 1 lit. f DSGVO | bis zur Erledigung | Angabe des Verantwortlichen |
| 7 | Externe Links (nur bei Klick) | `site/index.html:29, 47, 51, 324, 332, 339, 350-355`; `site/datenschutz.html` | Referrer (Standard des Browsers: nur Origin bei Cross-Origin) | GitHub, Cloudflare (Deploy-Seite), fcrw.cc/focusonruwen.com | keine Verarbeitung durch den Verantwortlichen | – | belegt (Code) |

### Was nicht stattfindet (geprüft)

- **Keine Cookies.** `site.js` setzt keine; Live-Test ohne Cookies. GitHub Pages hat in den Antwort-Headern kein `Set-Cookie` gesendet.
- **Keine Analyse/Tracker.** Kein Umami oder anderes Skript eingebunden (`site/index.html:17` ist nur `document.documentElement.classList.add("js")`, `site/index.html:361` lädt das eigene `site.js`). Das selbst betriebene Umami wird hier bewusst nicht verwendet.
- **Keine externen Ressourcen.** Schriften lokal (`site/site.css:3-14`, Dateien aus `src/web/public/fonts/`, kopiert in `scripts/build-site.sh:10`), Bilder lokal (`site/index.html:155`, `site/site.js:42`, kopiert in `scripts/build-site.sh:11-12`), Favicon lokal. Keine iframes, Embeds, CDNs.
- **Keine API-/fetch-Aufrufe.** `site.js` enthält kein `fetch`, `XMLHttpRequest`, `WebSocket` oder `sendBeacon`. `new Image()` in `site/site.js:45` lädt nur die eigenen Screenshots.
- **Kein Service Worker, kein sessionStorage, kein IndexedDB.**
- **Formular sendet nichts.** `site/site.js:65` verhindert das Absenden.
- **`og:image`** (`site/index.html:11`) wird nur von Link-Vorschau-Diensten (Messenger, soziale Netzwerke) abgerufen, wenn jemand die Seite teilt, nicht vom Browser des Besuchers. Die URL zeigt auf `einfachruwen.github.io/waymark/…`, das per 301 auf `waymark.fcrw.cc` weiterleitet.
- **Build und Deploy** (`scripts/build-site.sh`, `.github/workflows/pages.yml`) kopieren nur Dateien; es werden keine npm-Pakete in die Seite gebündelt. Die Actions laufen bei GitHub und betreffen keine Besucherdaten.
- **Kein Zusammenspiel mit `EinfachRuwen/waymark-selfhosted`.** Das private Repo ist eine Kopie der App (Unterschiede nur in `wrangler.jsonc` und den Workflows; dort gibt es kein `pages.yml`). Die Projektseite ruft keine Waymark-Instanz auf, bindet keine Demo ein und lädt keine Downloads von dort.

### Hosting im Detail (Nachweise vom 18.11.2026)

- DNS: `waymark.fcrw.cc` ist `CNAME einfachruwen.github.io.` → A `185.199.108-111.153`, AAAA `2606:50c0:8000-8003::153` (GitHub Pages). Nameserver von `fcrw.cc`: `adaline.ns.cloudflare.com`, `chip.ns.cloudflare.com`. Der Eintrag ist **nicht** über Cloudflare geproxied (die IPs sind die von GitHub, kein `cf-ray`-Header).
- Header: `server: GitHub.com`, `via: 1.1 varnish`, `x-fastly-request-id`, `x-served-by: cache-…` → Auslieferung über Fastly. `http://` antwortet mit 301 auf `https://` (HTTPS erzwungen).
- GitHub-Doku: „When a GitHub Pages site is visited, the visitor's IP address is logged and stored for security purposes, regardless of whether the visitor has signed into GitHub or not.“ (https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection)
- GitHub Privacy Statement, Effective date 27. April 2026: Datenübermittlung auf Basis von SCC (Durchführungsbeschluss 2021/914) und zusätzlich DPF (https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- DPF-Liste: GitHub, EU-U.S. DPF **Active**, UK Extension Active, Swiss-U.S. DPF Active, nächste Rezertifizierung 03.08.2027 (https://www.dataprivacyframework.gov/participant/6174, gerendert am 18.11.2026).
- GitHub Subprocessors: Fastly, „Content delivery service“, USA (https://docs.github.com/en/site-policy/privacy-policies/github-subprocessors).

## Einschätzungen (keine gesicherten Fakten)

- **Rolle von GitHub.** Für ein kostenloses Konto gibt es keinen gesonderten Auftragsverarbeitungsvertrag; GitHub verarbeitet die Pages-Logs nach eigener Erklärung zu eigenen Sicherheitszwecken. Die Erklärung beschreibt deshalb neutral, dass GitHub die Daten verarbeitet, und verweist auf GitHubs Erklärung, statt eine Auftragsverarbeitung zu behaupten.
- **`navigator.language` und § 25 TDDDG.** Das Auslesen dient nur dazu, die Seite in der passenden Sprache anzuzeigen, bleibt im Browser und entspricht dem ohnehin gesendeten `Accept-Language`-Header. Eingeordnet als unbedingt erforderlich (§ 25 Abs. 2 Nr. 2). Wer es strenger sieht, könnte die automatische Erkennung entfernen und standardmäßig Englisch zeigen.
- **Cloudflare-DNS.** Rekursive Resolver fragen die Nameserver an, nicht der Browser selbst; Cloudflare sieht die Seitenaufrufe nicht. Trotzdem kurz in der Erklärung erwähnt, der Transparenz halber.

## Offene Punkte

1. **Zuständige Aufsichtsbehörde.** Nicht belegt. Die veröffentlichte Anschrift ist eine c/o-Adresse in Sachsen; die zentrale Erklärung auf focusonruwen.com nennt beispielhaft die LfD Niedersachsen; ein Wohnsitz in NRW (dann LDI NRW) ist nur vermutet. Die Erklärung nennt deshalb keine bestimmte Behörde, sondern das allgemeine Beschwerderecht (Art. 77 DSGVO) und die Behördenliste der BfDI. Bei Klärung des Wohnsitzes die zuständige Behörde ergänzen und mit focusonruwen.com abgleichen.
2. **Speicherdauer der GitHub-Pages-Logs.** GitHub nennt keine Frist.
3. **Zentrale Erklärung auf focusonruwen.com** führt Waymark bisher nicht auf. Optional dort einen Verweis auf `waymark.fcrw.cc/datenschutz.html` ergänzen (liegt außerhalb dieses Repos).
4. **Kein Dark Mode** auf der Projektseite (`site/site.css`: `color-scheme: light`); nichts zu prüfen.

## Pflege

Bei jeder Änderung an `site/`, `scripts/build-site.sh`, `.github/workflows/pages.yml`, an der Domain oder am Hosting diese Datei und `site/datenschutz.html` prüfen (siehe `CLAUDE.md`). Bei inhaltlichen Änderungen das Stand-Datum in beiden Dateien anpassen und die Fundstellen oben aktualisieren.
