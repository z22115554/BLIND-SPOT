// 截圖／煙霧測試工具（headless Chromium + SwiftShader WebGL）
// 用法：
//   node scripts/shot.mjs --state MONITORING --wait 4 --out /tmp/x.png
//        [--html dist/blind-spot.html] [--size 1280x720] [--speed 1]
//        [--eval "BS.player.teleport({x:0,z:-1.6,yaw:0,pitch:0})"] [--after 1.5]
//        [--steps steps.json]   // [{ "eval": "...", "wait": 2, "shot": "/tmp/a.png" }, ...]
// 會自動加上 ?debug=1&autostart=1&state=STATE。結束時列出所有 console error / pageerror，並以退出碼 1 表示有錯誤。
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const html = path.resolve(root, opt('html', 'dist/blind-spot.html'));
const state = opt('state', 'PROLOGUE');
const wait = Number(opt('wait', 3));
const after = Number(opt('after', 1));
const out = opt('out', null);
const [W, H] = opt('size', '1280x720').split('x').map(Number);
const speed = opt('speed', '1');
const evalStr = opt('eval', null);
const stepsFile = opt('steps', null);
const extra = opt('query', '');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const errors = [];
const logs = [];
page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === 'error') errors.push(t); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
const url = `${pathToFileURL(html).href}?debug=1&autostart=1&state=${state}&speed=${speed}${extra ? '&' + extra : ''}`;
await page.goto(url);
await page.waitForTimeout(wait * 1000);
const run = async (code) => {
  try { const r = await page.evaluate(code); if (r !== undefined) console.log('eval →', typeof r === 'string' ? r : JSON.stringify(r)); }
  catch (e) { errors.push(`[eval] ${e.message}`); }
};
if (evalStr) { await run(evalStr); await page.waitForTimeout(after * 1000); }
if (out) { await page.screenshot({ path: out }); console.log('screenshot →', out); }
if (stepsFile) {
  const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
  for (const s of steps) {
    if (s.eval) await run(s.eval);
    if (s.wait) await page.waitForTimeout(s.wait * 1000);
    if (s.shot) { await page.screenshot({ path: s.shot }); console.log('screenshot →', s.shot); }
  }
}
const showLogs = args.includes('--logs');
if (showLogs) console.log(logs.join('\n'));
await browser.close();
if (errors.length) { console.log(`\n${errors.length} ERROR(S):\n` + errors.join('\n')); process.exit(1); }
console.log('no console errors');
