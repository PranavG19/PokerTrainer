// Mock-only: renders every demo/vision page at the app's two documented sizes with the main checkout's Playwright.
// Usage: node demo/vision/capture.mjs [page ...]   (no installs; imports Playwright by absolute path)
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire('/Users/pranavgk/Documents/scratch/temp/Poker/package.json');
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const SIZES = [[1100, 760], [900, 640]];
const only = process.argv.slice(2);
const pages = readdirSync(here).filter((f) => f.endsWith('.html') && f !== 'index.html').map((f) => f.replace('.html', ''))
  .filter((p) => !only.length || only.includes(p));
// Pages with states: name -> list of query strings.
const STATES = { table: ['state=live', 'state=mistake', 'state=great'], onboarding: ['step=1', 'step=2', 'step=3', 'step=4'], 'dee-marks': ['', 'blind=1'] };
// The main checkout's Playwright expects an older browser build than the one cached; point it at the cached shell.
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const problems = [];
for (const p of pages) {
  for (const q of STATES[p] ?? ['']) {
    for (const [w, h] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`${p}?${q} ${w}x${h}: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`${p}?${q} ${w}x${h}: ${e.message}`));
      page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) problems.push(`network: ${r.url()}`); });
      await page.goto(pathToFileURL(join(here, `${p}.html`)).href + `?still=1${q ? '&' + q : ''}`);
      await page.waitForTimeout(1600);
      const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, iw: innerWidth, ih: innerHeight }));
      if (over.sw > over.iw || over.sh > over.ih) problems.push(`${p}?${q} ${w}x${h}: page scrolls ${over.sw}x${over.sh}`);
      const name = `${p}${q ? '-' + q.replace('=', '') .replace(/^step/, 'step').replace(/^state/, '').replace(/^blind1$/, 'blind') : ''}-${w}x${h}.png`;
      await page.screenshot({ path: join(here, 'screenshots', name) });
      await ctx.close();
      console.log('shot', name);
    }
  }
}
await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console errors, no network, no page scroll');
