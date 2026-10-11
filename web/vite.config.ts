import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SITE_META } from "./src/lib/routes";

const SITE = "https://rienda-production.up.railway.app";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** One HTML file per marketing route, with its own title, description and social tags, so link previews and crawlers see them without running JavaScript. */
function routeHtml(): Plugin {
  let outDir = "dist";
  return {
    name: "rienda-route-html",
    apply: "build",
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const base = readFileSync(resolve(outDir, "index.html"), "utf8");
      // unknown paths get the app shell with a 404 status (serve sends 404.html), so the app can show its own "not found"
      writeFileSync(resolve(outDir, "404.html"), base);
      for (const [path, m] of Object.entries(SITE_META)) {
        if (path === "/") continue;
        const html = base
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(m.description)}"`)
          .replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(m.title)}"`)
          .replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(m.description)}"`)
          .replace(/(<meta property="og:url" content=")[^"]*"/, `$1${SITE}${path}"`)
          .replace(/(<meta name="twitter:title" content=")[^"]*"/, `$1${esc(m.title)}"`)
          .replace(/(<meta name="twitter:description" content=")[^"]*"/, `$1${esc(m.description)}"`);
        mkdirSync(resolve(outDir, path.slice(1)), { recursive: true });
        writeFileSync(resolve(outDir, path.slice(1), "index.html"), html);
      }
    },
  };
}

// Env: only web/.env* is read (never the repo-root .env, which holds private keys).
export default defineConfig({
  plugins: [react(), routeHtml()],
  server: { port: 5173, strictPort: true },
});
