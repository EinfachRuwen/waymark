(() => {
  /* ───────── Language ───────── */
  const nodes = [...document.querySelectorAll("[data-de], [data-de-html], [data-de-aria]")];
  const original = new Map(nodes.map((n) => [n, { text: n.textContent, html: n.innerHTML, aria: n.getAttribute("aria-label") }]));
  let lang = "en";

  function setLang(next, save = true) {
    lang = next;
    document.documentElement.lang = next;
    for (const n of nodes) {
      const o = original.get(n);
      if (n.dataset.deHtml !== undefined) n.innerHTML = next === "de" ? n.dataset.deHtml : o.html;
      else if (n.dataset.de !== undefined) n.textContent = next === "de" ? n.dataset.de : o.text;
      if (n.dataset.deAria !== undefined) n.setAttribute("aria-label", next === "de" ? n.dataset.deAria : o.aria);
    }
    document.querySelectorAll(".lang button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === next)));
    document.title = next === "de" ? "Waymark · Dein eigener Link-Kürzer" : "Waymark · Your own link shortener";
    showShot(currentShot);
    if (save) {
      try {
        localStorage.setItem("waymark-site-lang", next);
      } catch {
        /* ignore */
      }
    }
  }

  document.querySelectorAll(".lang button").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

  /* ───────── Screenshots ───────── */
  const shot = document.getElementById("shot");
  const ALT = {
    overview: ["Waymark overview with clicks over time and top links", "Waymark-Übersicht mit Klicks im Zeitverlauf und den meistbesuchten Links"],
    links: ["Link list with signposts, destinations, tags and clicks", "Linkliste mit Wegweisern, Zielen, Tags und Klicks"],
    "link-detail": ["One link with its route, analytics and QR code", "Ein Link mit Route, Statistik und QR-Code"],
    "editor-targeting": ["Editing routing rules for iPhone and Android", "Regeln für iPhone und Android bearbeiten"],
    "dark-overview": ["The overview in the dark theme", "Die Übersicht im dunklen Design"],
  };
  let currentShot = "overview";
  function showShot(name) {
    currentShot = name;
    const src = (lang === "de" ? "img/de/" : "img/") + name + ".png";
    if (shot.getAttribute("src") !== src) {
      shot.style.opacity = "0.2";
      const img = new Image();
      img.onload = () => {
        shot.src = src;
        shot.style.opacity = "1";
      };
      img.onerror = () => {
        shot.src = "img/" + name + ".png";
        shot.style.opacity = "1";
      };
      img.src = src;
    }
    shot.alt = ALT[name][lang === "de" ? 1 : 0];
    document.querySelectorAll("[data-shot]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.shot === name)));
  }
  document.querySelectorAll("[data-shot]").forEach((b) => b.addEventListener("click", () => showShot(b.dataset.shot)));

  /* ───────── Try it ───────── */
  const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";
  const form = document.getElementById("try");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let v = document.getElementById("try-url").value.trim();
    if (!v) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = "https://" + v;
    let display = v;
    try {
      const u = new URL(v);
      display = u.host.replace(/^www\./, "") + u.pathname.replace(/\/$/, "") + u.search + u.hash;
    } catch {
      /* show as typed */
    }
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const slug = [...bytes].map((b) => ALPHA[b % ALPHA.length]).join("");
    const sign = document.getElementById("try-sign");
    sign.innerHTML = '<span class="host">go.your-domain.com/</span>' + slug;
    sign.animate([{ transform: "translateX(-8px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, easing: "cubic-bezier(.16,1,.3,1)" });
    document.getElementById("try-long").textContent = display;
    const saved = v.length - ("go.your-domain.com/" + slug).length;
    document.getElementById("try-saved").textContent =
      saved > 0 ? (lang === "de" ? `${saved} Zeichen kürzer` : `${saved} characters shorter`) : "";
  });

  /* ───────── Contour lines behind the hero ───────── */
  const canvas = document.querySelector("canvas.contours");
  function drawContours() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = r.width * dpr;
    canvas.height = r.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#2c4035";
    const cx = r.width * 0.72;
    const cy = r.height * 0.62;
    for (let k = 1; k <= 22; k++) {
      const rad = k * Math.max(34, r.width / 34);
      ctx.lineWidth = k % 4 === 0 ? 1.6 : 1;
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        const w = 1 + 0.16 * Math.sin(a * 3 + k * 0.45) + 0.08 * Math.sin(a * 5 - k * 0.3) + 0.05 * Math.cos(a * 7 + k);
        const x = cx + Math.cos(a) * rad * w * 1.35;
        const y = cy + Math.sin(a) * rad * w * 0.8;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  drawContours();
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawContours, 150);
  });

  /* ───────── Reveal on scroll ───────── */
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      }),
    { rootMargin: "0px 0px -8% 0px" },
  );
  document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

  /* ───────── Start language ───────── */
  let start = "en";
  try {
    start = localStorage.getItem("waymark-site-lang") || "";
  } catch {
    start = "";
  }
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "de" || q === "en") start = q;
  if (!start) start = (navigator.language || "").toLowerCase().startsWith("de") ? "de" : "en";
  if (start !== "en") setLang(start, false);
})();
