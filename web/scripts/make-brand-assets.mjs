// Regenerates the icons and share image in web/public from brand/rienda-mark.svg.
// Needs playwright-core and a local Chromium:  CHROME=/path/to/chrome node web/scripts/make-brand-assets.mjs
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pub = resolve(here, "../public");
const svg = readFileSync(resolve(here, "../../brand/rienda-mark.svg"), "utf8");
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const viewBox = /viewBox="([^"]+)"/.exec(svg)[1];
const mark = (px, color = "#111111") => `<svg width="${px}" height="${px}" viewBox="${viewBox}">${inner.replace(/fill="#111111"/gi, `fill="${color}"`)}</svg>`;
const font = resolve(here, "../src/fonts/Geist-Variable.woff2");

// favicon.svg: black mark, white in dark browser themes
writeFileSync(resolve(pub, "favicon.svg"), svg.replace(/(<svg[^>]*>)/, `$1<style>@media (prefers-color-scheme: dark){path{fill:#fff}}</style>`));

const page = (w, h, body) => `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url("file://${font}");font-weight:100 900}
html,body{margin:0;width:${w}px;height:${h}px;background:#fff;font-family:Geist,sans-serif;color:#0b0c0e;-webkit-font-smoothing:antialiased}
</style>${body}`;

const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });
const shot = async (w, h, body, out) => {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  const f = resolve(mkdtempSync(resolve(tmpdir(), "rienda-brand-")), "page.html"); // file:// so the local font loads
  writeFileSync(f, page(w, h, body));
  await p.goto("file://" + f);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: resolve(pub, out) });
  await p.close();
};
await shot(180, 180, `<div style="display:grid;place-items:center;width:180px;height:180px">${mark(136)}</div>`, "apple-touch-icon.png");
await shot(32, 32, `<div style="display:grid;place-items:center;width:32px;height:32px">${mark(30)}</div>`, "favicon-32.png");
await shot(1200, 630, `<div style="position:absolute;left:70px;top:72px;display:flex;align-items:center;gap:16px;font-size:44px;font-weight:500;letter-spacing:-.02em">${mark(84)}Rienda</div>
<div style="position:absolute;left:80px;bottom:76px;width:1000px;font-size:74px;line-height:1.02;font-weight:300;letter-spacing:-.028em">Give your AI agent a spending limit it can’t talk its way past.</div>`, "og.png");
await b.close();
console.log("wrote favicon.svg, favicon-32.png, apple-touch-icon.png, og.png");
