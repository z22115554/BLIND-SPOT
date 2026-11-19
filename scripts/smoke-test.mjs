// 煙霧測試：以 headless Chromium（SwiftShader WebGL）逐一直接進入每一幕，
// 截圖到 test-output/，並在任何 console error / pageerror 時以退出碼 1 結束。
//   node scripts/smoke-test.mjs [--html dist/blind-spot.html] [--wait 6]
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const html = path.resolve(root, opt('html', 'dist/blind-spot.html'));
const wait = Number(opt('wait', 6));
const outDir = path.join(root, 'test-output');
mkdirSync(outDir, { recursive: true });

const STATES = ['TITLE', 'PROLOGUE', 'MONITORING', 'BLACKOUT_CORRIDOR', 'REVELATION', 'ENDING_LOOP'];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
let failed = 0;
for (const s of STATES) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`${e.message}`));
  const q = s === 'TITLE' ? '?debug=1' : `?debug=1&autostart=1&state=${s}`;
  await page.goto(pathToFileURL(html).href + q);
  await page.waitForTimeout(wait * 1000);
  const state = await page.evaluate(() => window.BS?.fsm?.currentName ?? null).catch(() => null);
  const file = path.join(outDir, `${s.toLowerCase()}.png`);
  await page.screenshot({ path: file });
  const ok = errors.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.padEnd(18)} fsm=${state}  → ${path.relative(root, file)}`);
  for (const e of errors) console.log('    ' + e.split('\n')[0]);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
