import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/** Security headers for static files served directly by Cloudflare Workers Static Assets. */
const headers = (): Plugin => ({
  name: "waymark-headers",
  apply: "build",
  closeBundle() {
    writeFileSync(
      resolve(__dirname, "dist/client/_headers"),
      [
        "/_/*",
        "  X-Content-Type-Options: nosniff",
        "  X-Frame-Options: DENY",
        "  Referrer-Policy: same-origin",
        "  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        "/_/assets/*",
        "  Cache-Control: public, max-age=31536000, immutable",
        "",
      ].join("\n"),
    );
  },
});

export default defineConfig({
  root: "src/web",
  base: "/_/",
  publicDir: "public",
  plugins: [react(), headers()],
  build: {
    outDir: "../../dist/client/_",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: false },
    },
  },
});
