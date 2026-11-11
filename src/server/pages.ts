/**
 * The few pages visitors of short links can see. Server-rendered, no JavaScript
 * except where noted, styled with the same tokens as the admin.
 */
export function esc(s: string | null | undefined) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const CSS = `
@font-face{font-family:Archivo;src:url(/_/fonts/archivo.woff2) format("woff2");font-weight:100 900;font-stretch:62% 125%;font-display:swap}
:root{--ground:#E9ECE4;--surface:#F7F8F3;--ink:#18211C;--ink2:#4A564E;--line:#CBD3C6;--blaze:#F2C230;--blaze-ink:#1B1A10;--red:#B83A27;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--ground:#111814;--surface:#18211C;--ink:#E3E9DE;--ink2:#A6B2A9;--line:#2E3C33;color-scheme:dark}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%}
body{background:var(--ground);color:var(--ink);font:400 16px/1.5 Archivo,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px 16px}
::selection{background:var(--blaze);color:var(--blaze-ink)}
main{width:100%;max-width:420px}
.sign{display:inline-flex;align-items:center;gap:10px;background:var(--blaze);color:var(--blaze-ink);font-weight:750;font-stretch:78%;letter-spacing:.01em;font-size:15px;padding:7px 30px 7px 14px;clip-path:polygon(0 0,calc(100% - 16px) 0,100% 50%,calc(100% - 16px) 100%,0 100%);margin-bottom:28px}
.sign svg{width:16px;height:16px}
h1{font-size:28px;line-height:1.15;font-weight:700;font-stretch:88%;letter-spacing:-.01em;margin:0 0 10px;text-wrap:balance}
p{margin:0 0 20px;color:var(--ink2)}
form{display:grid;gap:12px;margin-top:24px}
label{font-size:13px;font-weight:600;color:var(--ink2)}
input{font:inherit;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:11px 12px;width:100%;caret-color:var(--ink)}
input:focus{outline:2px solid var(--ink);outline-offset:1px;border-color:transparent}
button{font:inherit;font-weight:650;background:var(--ink);color:var(--ground);border:0;border-radius:6px;padding:11px 16px;cursor:pointer}
button:hover{opacity:.9}
button:focus-visible{outline:2px solid var(--blaze);outline-offset:2px}
.err{color:var(--red);font-size:14px;margin:0}
a{color:inherit;text-underline-offset:3px}
small{display:block;margin-top:40px;color:var(--ink2);font-size:12px}
`;

const PIN = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2v12M3 3h8l-2 3 2 3H3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

export function page(opts: { title: string; sign: string; heading: string; body: string; extra?: string; status?: number; noindex?: boolean }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(opts.title)}</title><link rel="icon" href="/_/favicon.svg"><style>${CSS}</style></head>
<body><main><div class="sign">${PIN}${esc(opts.sign)}</div><h1>${esc(opts.heading)}</h1>${opts.body}${opts.extra ?? ""}</main></body></html>`;
}

export const notFoundPage = (host: string, path: string) =>
  page({
    title: "Link not found",
    sign: `${host}/${path}`,
    heading: "This trail ends here.",
    body: `<p>There is no link at this address. It may have been mistyped, removed, or never existed.</p>`,
  });

export const expiredPage = (host: string, slug: string) =>
  page({
    title: "Link expired",
    sign: `${host}/${slug}`,
    heading: "This link has expired.",
    body: `<p>Its owner set it to stop working after a date or a number of visits. Ask them for a current link.</p>`,
  });

export const rootPage = (name: string) =>
  page({
    title: name,
    sign: name,
    heading: "A private link shortener.",
    body: `<p>Links on this domain are created by its owners. If you followed a short link and landed here, the link was incomplete.</p>`,
  });

export const passwordPage = (host: string, slug: string, error = false) =>
  page({
    title: "Protected link",
    sign: `${host}/${slug}`,
    heading: "This link is password protected.",
    body: `<p>Enter the password you were given to continue.</p>`,
    extra: `<form method="post" autocomplete="off"><label for="pw">Password</label><input id="pw" name="password" type="password" required autofocus>${
      error ? `<p class="err" role="alert">That password is not right. Check it and try again.</p>` : ""
    }<button type="submit">Continue</button></form>`,
  });

/** Serves Open Graph tags to link-preview bots, then forwards humans who land here. */
export function previewPage(target: string, og: { title?: string | null; description?: string | null; image?: string | null }) {
  const t = esc(target);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(og.title || "")}</title>
${og.title ? `<meta property="og:title" content="${esc(og.title)}"><meta name="twitter:title" content="${esc(og.title)}">` : ""}
${og.description ? `<meta property="og:description" content="${esc(og.description)}"><meta name="description" content="${esc(og.description)}"><meta name="twitter:description" content="${esc(og.description)}">` : ""}
${og.image ? `<meta property="og:image" content="${esc(og.image)}"><meta name="twitter:image" content="${esc(og.image)}"><meta name="twitter:card" content="summary_large_image">` : ""}
<meta property="og:url" content="${t}"><meta http-equiv="refresh" content="0;url=${t}"></head><body><a href="${t}">${t}</a></body></html>`;
}

/** Keeps the short URL in the address bar while showing the destination. */
export function cloakPage(target: string, title: string | null) {
  const t = esc(target);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title || "")}</title>
<style>html,body,iframe{margin:0;width:100%;height:100%;border:0;display:block;overflow:hidden}</style></head>
<body><iframe src="${t}" title="${esc(title || "Content")}" referrerpolicy="no-referrer-when-downgrade" allow="fullscreen; clipboard-write"></iframe></body></html>`;
}
