// Drive the BUILT Offsuit app (dist/) through one real user path and screenshot it.
// Usage: npm run build && node .claude/skills/verify-app/drive.mjs [outdir]
import { _electron as electron } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-verify-'));
fs.mkdirSync(out, { recursive: true });
// An isolated profile so the run never reads or writes the developer's real save.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'offsuit-verify-data-'));
const app = await electron.launch({
  args: ['dist/main/main.js', '--seed=42', `--user-data-dir=${userData}`, '--no-sandbox'],
  // Hidden: never shown, never focused (see AGENTS.md "Tests"). Strip ELECTRON_RUN_AS_NODE or Electron runs as Node.
  env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')), OFFSUIT_E2E: '1', OFFSUIT_E2E_HIDDEN: '1' },
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Health: the right build answered — Home renders and the tab bar has its twelve tabs.
  await page.waitForSelector('[data-testid="home-screen"]');
  const tabs = await page.locator('nav.tabs button.tab').count();
  if (tabs !== 12) throw new Error(`expected 12 tabs, found ${tabs}`);
  const size = async (w, h) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h]);
    await page.waitForTimeout(350);
  };
  // Drive: Home -> New session -> call preflop -> the flop, at both documented sizes.
  for (const [w, h] of [[900, 640], [1100, 760]]) {
    await size(w, h);
    await page.screenshot({ path: path.join(out, `home-${w}x${h}.png`) });
  }
  await page.click('[data-testid="new-hand"]');
  await page.waitForSelector('[data-testid="table-screen"][data-awaiting="hero"]');
  await page.click('[data-testid="btn-call"]');
  await page.waitForTimeout(2500);
  for (const [w, h] of [[900, 640], [1100, 760]]) {
    await size(w, h);
    await page.screenshot({ path: path.join(out, `table-${w}x${h}.png`) });
  }
  const pot = await page.textContent('[data-testid="pot"]');
  console.log(JSON.stringify({ out, tabs, pot, errors }));
} finally {
  await app.close(); // closes only the instance this script launched
}
if (errors.length > 0) process.exit(1);
