/**
 * Fills a local Waymark with synthetic demo data (links + clicks) for screenshots
 * and trying things out. Usage:
 *   DATABASE_PATH=./data/demo.db npx tsx scripts/seed-demo.ts
 * Creates owner demo@waymark.local / demo-password if no user exists.
 */
import { nodeSqliteAdapter } from "../src/server/adapters/node-sqlite";
import { ensureMigrated } from "../src/server/migrations";
import { hashPassword, newId, randomString } from "../src/server/lib/crypto";
import { createLink } from "../src/server/links";
import { listDomains } from "../src/server/domains";
import { saveSettings, getSettings } from "../src/server/settings";

const db = nodeSqliteAdapter(process.env.DATABASE_PATH || "./data/demo.db");
await ensureMigrated(db);
const host = process.env.DEMO_HOST || "localhost:8787";

if (!(await db.first("SELECT 1 FROM users"))) {
  await db.run("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)", [
    newId("usr_"),
    "demo@waymark.local",
    "Mara Lindqvist",
    await hashPassword("demo-password"),
    Date.now(),
  ]);
  await db.run("INSERT OR IGNORE INTO domains (id, hostname, is_default, created_at) VALUES (?, ?, 1, ?)", [newId("dom_"), host, Date.now()]);
  await db.run("INSERT OR IGNORE INTO domains (id, hostname, is_default, created_at) VALUES (?, ?, 0, ?)", [newId("dom_"), "go.alpenrad.example", Date.now()]);
}
const s = await getSettings(db, true);
if (!s.secret) await saveSettings(db, { secret: randomString(48), instance_name: "Alpenrad" });

const domains = await listDomains(db, true);
const d = domains.find((x) => x.is_default)!;
const user = (await db.first<{ id: string }>("SELECT id FROM users LIMIT 1"))!;

const LINKS = [
  {
    slug: "fruehling",
    url: "https://alpenrad.example/kollektion/fruehling-2026?ref=shortlink",
    title: "Spring collection launch",
    tags: ["campaign", "spring"],
    weight: 9,
  },
  { slug: "newsletter", url: "https://alpenrad.example/newsletter/anmelden", title: "Newsletter sign-up", tags: ["newsletter"], weight: 5 },
  {
    slug: "app",
    url: "https://alpenrad.example/app",
    title: "Ride tracker app",
    tags: ["app"],
    weight: 6,
    rules: [
      { type: "os" as const, values: ["ios", "ipados"], url: "https://apps.apple.com/app/id000000" },
      { type: "os" as const, values: ["android"], url: "https://play.google.com/store/apps/details?id=example.ride" },
    ],
  },
  { slug: "werkstatt", url: "https://alpenrad.example/service/termin", title: "Book a workshop slot", tags: ["service"], weight: 3 },
  {
    slug: "gravel-test",
    url: "https://alpenrad.example/gravel/a",
    title: "Gravel landing A/B",
    tags: ["campaign", "test"],
    weight: 4,
    variants: [{ url: "https://alpenrad.example/gravel/b", weight: 50 }],
  },
  {
    slug: "messe",
    url: "https://alpenrad.example/events/eurobike",
    title: "Trade fair booth",
    tags: ["events"],
    weight: 2,
    expires_at: Date.now() - 864e5 * 3,
  },
  { slug: "jobs", url: "https://alpenrad.example/karriere", title: "Careers", tags: ["hr"], weight: 1.5 },
  { slug: "katalog-pdf", url: "https://alpenrad.example/downloads/katalog-2026.pdf", title: "Catalogue PDF", tags: ["print"], weight: 2.5 },
  { slug: "insta", url: "https://instagram.com/alpenrad.example", title: "Instagram profile", tags: ["social"], weight: 3.5 },
  { slug: "garantie", url: "https://alpenrad.example/garantie/registrieren", title: "Warranty registration", tags: ["service", "print"], weight: 1 },
];

const COUNTRIES = [
  ["DE", 46, ["Munich", "Berlin", "Hamburg", "Stuttgart", "Cologne"]],
  ["AT", 18, ["Vienna", "Innsbruck", "Graz"]],
  ["CH", 14, ["Zurich", "Bern", "Basel"]],
  ["NL", 6, ["Amsterdam"]],
  ["IT", 5, ["Bolzano", "Milan"]],
  ["US", 5, ["New York"]],
  ["FR", 3, ["Lyon"]],
  ["GB", 3, ["London"]],
] as const;
const REFS = [
  [null, 38],
  ["instagram.com", 20],
  ["google.com", 12],
  ["newsletter.alpenrad.example", 14],
  ["linkedin.com", 6],
  ["facebook.com", 5],
  ["t.co", 5],
] as const;
const DEVICES = [
  ["mobile", "iOS", "Safari", 34],
  ["mobile", "Android", "Chrome", 26],
  ["desktop", "Windows", "Chrome", 16],
  ["desktop", "macOS", "Safari", 12],
  ["desktop", "macOS", "Chrome", 6],
  ["tablet", "iPadOS", "Safari", 4],
  ["desktop", "Linux", "Firefox", 2],
] as const;
const pick = <T extends readonly unknown[]>(arr: readonly T[], wIdx: number): T => {
  const total = arr.reduce((s, x) => s + (x[wIdx] as number), 0);
  let r = Math.random() * total;
  for (const x of arr) {
    r -= x[wIdx] as number;
    if (r <= 0) return x;
  }
  return arr[0];
};

for (const l of LINKS) {
  const { row } = await createLink(
    db,
    { url: l.url, slug: l.slug, title: l.title, tags: l.tags, rules: l.rules ?? null, variants: l.variants ?? null, expires_at: l.expires_at ?? null },
    { domain: d, userId: user.id, via: "app", onConflict: "skip", createdAt: Date.now() - 864e5 * (20 + Math.random() * 60) },
  );
  const existing = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM clicks WHERE link_id = ?", [row.id]);
  if (existing?.n) continue;
  const stmts = [];
  const days = 90;
  let total = 0;
  for (let day = days; day >= 0; day--) {
    const launch = l.slug === "fruehling" && day < 30 ? 2.6 * Math.exp(-((30 - day - 4) ** 2) / 40) + 0.6 : 1;
    const weekday = new Date(Date.now() - day * 864e5).getDay();
    const base = l.weight * (weekday === 0 || weekday === 6 ? 0.7 : 1) * launch * (1 + day / -200);
    const n = Math.max(0, Math.round(base * (0.6 + Math.random() * 0.8)));
    for (let i = 0; i < n; i++) {
      const [cc, , cities] = pick(COUNTRIES, 1);
      const [ref] = pick(REFS, 1);
      const [device, os, browser] = pick(DEVICES, 3);
      const hour = Math.floor(Math.max(0, Math.min(23, 7 + Math.random() * 15 + (Math.random() < 0.3 ? -4 : 0))));
      const ts = new Date(Date.now() - day * 864e5).setHours(hour, Math.floor(Math.random() * 60));
      if (ts > Date.now()) continue;
      const target = l.variants
        ? Math.random() < 0.5
          ? "main"
          : "variant:0"
        : l.rules
          ? os === "iOS" || os === "iPadOS"
            ? "rule:0"
            : os === "Android"
              ? "rule:1"
              : "main"
          : "main";
      stmts.push({
        sql: "INSERT INTO clicks (link_id, ts, visitor, country, city, referrer, browser, os, device, language, is_bot, is_qr, target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
        params: [
          row.id,
          ts,
          `v${new Date(ts).toISOString().slice(0, 10)}-${Math.floor(Math.random() * Math.max(2, n * 0.75))}`,
          cc,
          cities[Math.floor(Math.random() * cities.length)],
          ref,
          browser,
          os,
          device,
          cc === "DE" || cc === "AT" || cc === "CH" ? "de" : cc === "IT" ? "it" : cc === "FR" ? "fr" : cc === "NL" ? "nl" : "en",
          Math.random() < 0.08 ? 1 : 0,
          target,
        ],
      });
      total++;
    }
  }
  await db.batch(stmts);
  await db.run("UPDATE links SET clicks = ?, last_click_at = (SELECT MAX(ts) FROM clicks WHERE link_id = ?) WHERE id = ?", [total, row.id, row.id]);
  console.log(`${l.slug}: ${total} clicks`);
}
await db.run("INSERT OR REPLACE INTO tags (name, color) VALUES ('campaign','blaze'),('service','sky'),('social','heather'),('print','slate'),('test','ember')");
console.log("Demo data ready. Sign in as demo@waymark.local / demo-password");
