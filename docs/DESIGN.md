# Waymark design

The admin is a working tool (Impeccable's "Operate" mode): familiar navigation and standard controls, with identity carried by type, palette, density and one signature move. The world comes from the product's name: a waymark is a trail marker, the painted blaze and the yellow signpost on a hiking path.

## Signature move: the signpost

Every short link is drawn as a yellow trail sign with a pointed end (`.sign`). It appears in the link list, the link header, the editor preview, the top-links list and the sign-in artwork. The destination follows the sign after an arrow, set in monospace because it is data. Inactive links get a grey sign.

Supporting moves from the same world:

- **Elevation profile.** Clicks over time are drawn as the ground of a trail profile: a filled area, contour lines at whole numbers, the summit marked with a red triangle and its date. Unique visitors are a dashed line.
- **Route.** A link's resolution order (short link → password → rules → variants → destination) is drawn as a dashed trail with blaze markers; the start marker is the red-white-red blaze.
- **Contours.** The sign-in screen uses generated topographic lines behind a signpost.

## Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--ground` | `#e8ebe3` | `#111814` | page background, cool lichen grey |
| `--surface` | `#f6f7f2` | `#172019` | panels |
| `--raised` | `#fcfdf9` | `#1c2620` | inputs, menus |
| `--ink` | `#17201b` | `#e2e9dd` | text, dark buttons |
| `--ink-2` / `--ink-3` | `#47534b` / `#5d6a61` | `#aab7ad` / `#8d9c91` | secondary and tertiary text, tinted, never neutral grey |
| `--rail` | `#1c2a22` | `#0c120e` | spruce navigation rail |
| `--blaze` | `#f2c230` | same | signposts, primary action, focus glow, selection |
| `--moss` | `#4f7a46` | `#8db57f` | success, bars, switches |
| `--sky` / `--ember` / `--heather` / `--slate` | | | info, danger, tag colors |

Color strategy: restrained ground with a committed shell. The spruce rail owns a whole region, yellow is reserved for the sign and the primary action, state colors appear only where they mean something.

## Type

- **Archivo** (variable weight and width, self-hosted). UI at 100% width; signs and headings at 78–88% width for the condensed signage voice.
- **JetBrains Mono** only for URLs, slugs, keys and code.
- Fixed rem-like scale, 1.125–1.2 ratio: 12 / 13 / 13.5 / 14 / 15 / 17 / 20 / 26 / 28 px. Tabular numerals everywhere numbers line up.

## Rules kept

- No gradient text, no glass, no hard offset shadows, no eyebrow labels, no hero-metric cards, no emoji as icons (Lucide, one stroke weight).
- Every control has hover, focus, disabled and loading states; tables have skeleton rows; empty states explain the next step.
- Browser surfaces are themed: selection, caret, scrollbars, focus rings, underline offset.
- Motion is short (140–260 ms, exponential ease-out) and only marks state changes; reduced motion is respected.
- Light or dark follows the system, with a manual toggle in the rail.
