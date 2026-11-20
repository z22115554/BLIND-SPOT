// =============================================================================
// feed-stages — 監視器 LD 微事件各階段的截圖＋亮度量測（docs/pacing/spec.md §9.3）
// 用法：
//   node scripts/feed-stages.mjs [--html dist/blind-spot.html] [--out test-output/feeds]
//        [--speed 2] [--frames 8] [--only 1,3] [--merge] [--write] [--no-crt] [--no-sheet]
// --merge：沿用同一輸出目錄 means.json 裡其他頻道的結果（可以分批跑：--only 1,2 → --only 3,4 --merge）。
// 每個頻道 n、每個階段 k（再加上 CAM-04 時間凍結、CAM-03 拖痕在人影 index 2 / 4 / 6）：
//   1. 開 ?debug=1&autostart=1&state=MONITORING&pace=0（坐在控制台、看著主 CRT）
//   2. BS.feeds.setChannel(n)、等 AGC 穩定；BS.feeds.setAnomalyStage(n, k, {force:true})
//      （CameraFeeds 尚未提供時退回 BS.feeds.channels[n].setStage(k)）
//   3. 存 (a) 800×450 的坐姿畫面 cam{n}_s{k}_room.png（＋主 CRT 區域放大 2× 的 _roomcrop.png）
//         (b) 960×720 的 BS.feeds.debugBlit(BS.renderer) → cam{n}_s{k}_crt.png
//   4. 在頁面內量 CRT 區域的平均線性亮度（多幀平均），印出 mean(k)/mean(0) 與 anomalies.js 的 MEAN_SCALE；
//      --write 時把量測值寫回 src/world/feeds/anomalies.js 的 MEAN_SCALE。
//   5. 產生 sheet.html（每列：第 0 階段＋各階段）並截圖成 sheet.png。
// 結束時列出所有 console error / pageerror，有錯誤時退出碼 1。
// =============================================================================
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const html = path.resolve(root, opt('html', 'dist/blind-spot.html'));
const outDir = path.resolve(root, opt('out', 'test-output/feeds'));
const speed = Number(opt('speed', 2));
const FRAMES = Number(opt('frames', 8));
const only = opt('only', '1,2,3,4').split(',').map(Number);
const MAX_STAGE = { 1: 2, 2: 4, 3: 1, 4: 2 };
mkdirSync(outDir, { recursive: true });

// ---- 頁面內：每幀渲染完（inspect.renderOverlay 之後）處理擷取請求 ----------------------------
const HOOK = `
(() => {
  const S = window.__cap = { req: null, lut: null };
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  let c2, g2;
  function region(ctx, W, H, inset) {
    const T = ctx.THREE, m = ctx.controlRoom.objects.mainScreen;
    m.updateMatrixWorld(true);
    const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) {
      const v = new T.Vector3(x, y, 0).applyMatrix4(m.matrixWorld).project(ctx.camera);
      const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    const ix = (x1 - x0) * inset, iy = (y1 - y0) * inset;
    return { full: [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)], inner: [Math.round(x0 + ix), Math.round(y0 + iy), Math.round(x1 - ix), Math.round(y1 - iy)] };
  }
  function service(ctx) {
    const r = S.req; if (!r) return;
    if (r.skip > 0) { r.skip--; return; }
    if (r.blit) ctx.feeds.debugBlit(ctx.renderer, { crt: !r.raw });
    const cv = ctx.renderer.domElement, W = cv.width, H = cv.height;
    if (!c2 || c2.width !== W || c2.height !== H) { c2 = document.createElement('canvas'); c2.width = W; c2.height = H; g2 = c2.getContext('2d', { willReadFrequently: true }); }
    g2.drawImage(cv, 0, 0);
    const reg = r.blit ? { full: [0, 0, W, H], inner: [Math.round(W * 0.06), Math.round(H * 0.06), Math.round(W * 0.94), Math.round(H * 0.94)] } : region(ctx, W, H, r.inset);
    const [x0, y0, x1, y1] = reg.inner;
    const d = g2.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * lut[d[i]] + 0.7152 * lut[d[i + 1]] + 0.0722 * lut[d[i + 2]];
    r.means.push(s / (d.length / 4));
    r.region = reg;
    r.info = { t: +ctx.clock.time.toFixed(2), clock: ctx.flags.clockText, ringing: !!ctx.flags.intercomRinging, obs: !!ctx.gaze.mainScreenObserved,
      shown: ctx.feeds._shownChannel, mode: ctx.feeds._shownMode, agc: +ctx.feeds._agc.toFixed(3), fig: ctx.feeds.figureIndex };
    if (r.png && r.means.length === r.frames) {
      r.url = cv.toDataURL('image/png');
      if (!r.blit) {
        const [fx0, fy0, fx1, fy1] = reg.full, w = fx1 - fx0, h = fy1 - fy0;
        const c3 = document.createElement('canvas'); c3.width = w * 2; c3.height = h * 2;
        const g3 = c3.getContext('2d'); g3.imageSmoothingEnabled = false;
        g3.drawImage(c2, fx0, fy0, w, h, 0, 0, w * 2, h * 2);
        r.crop = c3.toDataURL('image/png');
      }
    }
    if (r.means.length >= r.frames) { S.req = null; r.resolve({ means: r.means, region: r.region, info: r.info, url: r.url || null, crop: r.crop || null }); }
  }
  let _bs;
  Object.defineProperty(window, 'BS', { configurable: true, get() { return _bs; }, set(v) {
    _bs = v;
    const iv = v.inspect; const orig = iv.renderOverlay.bind(iv);
    iv.renderOverlay = (rr) => { const res = orig(rr); try { service(v); } catch (e) { S.err = String(e && e.stack || e); if (S.req) { const q = S.req; S.req = null; q.resolve({ error: S.err }); } } return res; };
  } });
})();
`;

const errors = [];
const launchArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: launchArgs });

async function openGame(W, H) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.addInitScript(HOOK);
  await page.goto(`${pathToFileURL(html).href}?debug=1&autostart=1&state=MONITORING&pace=0&speed=${speed}`, { timeout: 120000 });
  await page.waitForFunction(() => window.BS && BS.fsm && BS.fsm.currentName === 'STATE_MONITORING' && BS.feeds._shownMode === 'LD', null, { timeout: 120000 });
  await page.evaluate(() => BS.player.teleport({ x: 0, z: -1.6, yaw: 0, pitch: 0.03, seated: true }));
  return page;
}
const waitGame = (page, sec) => page.evaluate((sec) => new Promise((res) => {
  const t0 = BS.clock.time; const iv = setInterval(() => { if (BS.clock.time - t0 >= sec) { clearInterval(iv); res(); } }, 30);
}), sec);
const capture = (page, o) => page.evaluate((o) => new Promise((resolve) => {
  window.__cap.req = { blit: !!o.blit, frames: o.frames, png: !!o.png, inset: o.inset ?? 0.12, skip: 1, means: [], resolve };
}), o);
const setStage = (page, n, k) => page.evaluate(({ n, k }) => {
  const f = BS.feeds;
  if (typeof f.setAnomalyStage === 'function') return f.setAnomalyStage(n, k, { force: true });
  f.channels[n].setStage(k); f._needRender = true; return true;
}, { n, k });
const savePng = (url, file) => { if (url) writeFileSync(file, Buffer.from(url.split(',')[1], 'base64')); };
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2))); };

/** 一輪：對每個頻道、每個階段擷取（blit = false：坐姿畫面；true：CRT 全畫面） */
async function pass({ blit, W, H }) {
  const page = await openGame(W, H);
  const tag = blit ? 'crt' : 'room';
  const res = { base: null, ch: {} };
  await waitGame(page, 2.5);
  if (!blit) {
    // 玻璃反光底值：主 CRT 關機時的平均亮度
    await page.evaluate(() => BS.feeds.setMode('OFF'));
    await waitGame(page, 3.0);
    const b = await capture(page, { frames: 4 });
    res.base = avg(b.means);
    await page.evaluate(() => BS.feeds.setMode('LD'));
    await waitGame(page, 3.0);
  }
  for (const n of only) {
    await page.evaluate((n) => { BS.feeds.setChannel(n); if (n === 3) { BS.feeds.setFigureLimits({ min: 4, max: 4 }); BS.feeds.setFigureIndex(4); } }, n);
    await waitGame(page, 3.0);    // 0.25 s 切換＋2.0 s AGC
    const st = [];
    for (let k = 0; k <= MAX_STAGE[n]; k++) {
      await setStage(page, n, k);
      await waitGame(page, 0.4);
      const c = await capture(page, { blit, frames: FRAMES, png: true });
      if (c.error) throw new Error(c.error);
      savePng(c.url, path.join(outDir, `cam${n}_s${k}_${tag}.png`));
      if (c.crop) savePng(c.crop, path.join(outDir, `cam${n}_s${k}_roomcrop.png`));
      st.push({ k, mean: avg(c.means), sd: sd(c.means), info: c.info, region: c.region.full });
      console.log(`[${tag}] CAM-0${n} s${k}  mean ${avg(c.means).toFixed(5)} ±${sd(c.means).toFixed(5)}  ${JSON.stringify(c.info)}`);
    }
    await setStage(page, n, 0);
    const extra = [];
    if (n === 4) {
      const ok = await page.evaluate(() => { if (typeof BS.feeds.setFrozenTime !== 'function') return false; BS.feeds.setFrozenTime(4, BS.SCRIPT.feedUI?.frozenTime ?? '02:14:08'); return true; });
      if (ok) {
        await setStage(page, 4, 2);
        await waitGame(page, 1.2);
        const c = await capture(page, { blit, frames: 2, png: true });
        savePng(c.url, path.join(outDir, `cam4_freeze_${tag}.png`));
        if (c.crop) savePng(c.crop, path.join(outDir, `cam4_freeze_roomcrop.png`));
        extra.push({ id: 'freeze', file: `cam4_freeze_${tag}.png` });
        await page.evaluate(() => BS.feeds.setFrozenTime(4, null));
        await setStage(page, 4, 0);
      } else console.log('[note] feeds.setFrozenTime not available (WP-B) → freeze shot skipped');
    }
    if (n === 3) {
      for (const i of [2, 4, 6]) {
        await page.evaluate((i) => { BS.feeds.setFigureLimits({ min: i, max: i }); BS.feeds.setFigureIndex(i); }, i);
        await waitGame(page, 0.4);
        const c = await capture(page, { blit, frames: 2, png: true });
        savePng(c.url, path.join(outDir, `cam3_trail${i}_${tag}.png`));
        if (c.crop) savePng(c.crop, path.join(outDir, `cam3_trail${i}_roomcrop.png`));
        const tr = await page.evaluate(() => ({ count: BS.feeds.channels[3].trail?.count, visible: BS.feeds.channels[3].trail?.mesh.visible }));
        extra.push({ id: `trail${i}`, file: `cam3_trail${i}_${tag}.png`, trail: tr });
      }
      // 對照：同 index 4、拖痕隱藏
      await page.evaluate(() => { BS.feeds.setFigureIndex(4); BS.feeds.channels[3].trail.reach(null); BS.feeds._needRender = true; });
      await waitGame(page, 0.4);
      const c = await capture(page, { blit, frames: 2, png: true });
      savePng(c.url, path.join(outDir, `cam3_notrail4_${tag}.png`));
      if (c.crop) savePng(c.crop, path.join(outDir, `cam3_notrail4_roomcrop.png`));
      await page.evaluate(() => { const ch = BS.feeds.channels[3]; ch._trailIndex = null; ch.setFigurePose(BS.feeds.figureIndex); });
    }
    res.ch[n] = { stages: st, extra };
  }
  const cfg = await page.evaluate(() => Object.fromEntries([1, 2, 3, 4].map((n) => [n, { meanScales: BS.feeds.channels[n].meanScales, maxStage: BS.feeds.channels[n].maxStage }])));
  res.cfg = cfg;
  await page.close();
  return res;
}

const results = {};
try {
  results.room = await pass({ blit: false, W: 800, H: 450 });
  if (!flag('no-crt')) results.crt = await pass({ blit: true, W: 960, H: 720 });
} catch (e) {
  errors.push(`[harness] ${e.stack || e}`);
}
// 分批：合併先前跑過的其他頻道
const meansFile = path.join(outDir, 'means.json');
let chans = only;
if (flag('merge') && existsSync(meansFile)) {
  try {
    const old = JSON.parse(readFileSync(meansFile, 'utf8')).results || {};
    for (const k of ['room', 'crt']) {
      if (!old[k]) continue;
      if (!results[k]) { results[k] = old[k]; continue; }
      for (const n of Object.keys(old[k].ch || {})) if (!results[k].ch[n]) results[k].ch[n] = old[k].ch[n];
      if (results[k].base == null) results[k].base = old[k].base;
    }
    chans = [1, 2, 3, 4].filter((n) => results.room?.ch[n]);
  } catch (e) { console.log('[merge] skipped:', e.message); }
}

// ---- 亮度比 ----------------------------------------------------------------
const table = [];
const measured = {};
if (results.room) {
  const base = results.room.base ?? 0.004;
  console.log(`\nglass base (CRT off, room view): ${base.toFixed(5)}`);
  console.log('ch  k   room mean   ratio(room−base)   ratio(crt)   MEAN_SCALE   |Δ|');
  for (const n of chans) {
    const R = results.room.ch[n]?.stages; if (!R) continue;
    const Cc = results.crt?.ch[n]?.stages;
    const ms = results.room.cfg[n].meanScales;
    measured[n] = [];
    for (const s of R) {
      const rr = (s.mean - base) / (R[0].mean - base);
      const rc = Cc ? Cc[s.k].mean / Cc[0].mean : null;
      measured[n].push(+rr.toFixed(2));
      const row = { n, k: s.k, room: s.mean, ratioRoom: rr, ratioCrt: rc, meanScale: ms[s.k], delta: Math.abs(rr - ms[s.k]) };
      table.push(row);
      console.log(`${n}   ${s.k}   ${s.mean.toFixed(5)}     ${rr.toFixed(3)}              ${rc == null ? '  –  ' : rc.toFixed(3)}        ${ms[s.k].toFixed(2)}        ${row.delta.toFixed(3)}${row.delta >= 0.05 ? '  ← off' : ''}`);
    }
    measured[n][0] = 1;
  }
  writeFileSync(meansFile, JSON.stringify({ base, table, measured, results }, null, 1));
}

if (flag('write') && Object.keys(measured).length) {
  const file = path.join(root, 'src/world/feeds/anomalies.js');
  let src = readFileSync(file, 'utf8');
  for (const n of Object.keys(measured)) {
    const re = new RegExp(`(\\n  ${n}: \\[)[^\\]]*(\\],)`);
    src = src.replace(re, `$1${measured[n].map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(2))).join(', ')}$2`);
  }
  writeFileSync(file, src);
  console.log('MEAN_SCALE written →', path.relative(root, file), JSON.stringify(measured));
}

// ---- 對照表 sheet.html / sheet.png -----------------------------------------
if (results.room && !flag('no-sheet')) {
  const cell = (file, label, w) => `<figure><img src="${file}" style="width:${w}px" onerror="this.style.display='none'"><figcaption>${label}</figcaption></figure>`;
  let body = '';
  for (const n of chans) {
    const R = results.room.ch[n]; if (!R) continue;
    const row1 = R.stages.map((s) => cell(`cam${n}_s${s.k}_roomcrop.png`, `CAM-0${n} s${s.k} (room crop 2×) ×${table.find((t) => t.n === n && t.k === s.k)?.ratioRoom.toFixed(2)}`, 300));
    const row2 = R.stages.map((s) => cell(`cam${n}_s${s.k}_crt.png`, `CAM-0${n} s${s.k} (CRT blit)`, 300));
    const ex1 = R.extra.map((e) => cell(e.file.replace('_room.png', '_roomcrop.png'), `CAM-0${n} ${e.id}`, 300));
    const ex2 = (results.crt?.ch[n]?.extra || []).map((e) => cell(e.file, `CAM-0${n} ${e.id} (CRT)`, 300));
    if (n === 3) { ex1.push(cell('cam3_notrail4_roomcrop.png', 'CAM-03 index 4, trail hidden', 300)); ex2.push(cell('cam3_notrail4_crt.png', 'CAM-03 index 4, trail hidden (CRT)', 300)); }
    body += `<h2>CAM-0${n}</h2><div class="row">${row1.join('')}</div>${results.crt ? `<div class="row">${row2.join('')}</div>` : ''}`;
    if (ex1.length) body += `<div class="row">${ex1.join('')}</div>${results.crt ? `<div class="row">${ex2.join('')}</div>` : ''}`;
  }
  const doc = `<!doctype html><meta charset="utf-8"><style>body{background:#111;color:#ccc;font:13px sans-serif;margin:12px}h2{margin:14px 0 4px;font-size:15px}.row{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0}figcaption{font-size:11px;color:#999}img{display:block;image-rendering:pixelated}</style><body>${body}</body>`;
  writeFileSync(path.join(outDir, 'sheet.html'), doc);
  try {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    await p.goto(pathToFileURL(path.join(outDir, 'sheet.html')).href, { timeout: 120000 });
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(outDir, 'sheet.png'), fullPage: true, timeout: 120000 });
    await p.close();
    console.log('sheet →', path.join(outDir, 'sheet.png'));
  } catch (e) { errors.push(`[sheet] ${e.message}`); }
}

await browser.close();
if (errors.length) { console.log(`\n${errors.length} ERROR(S):\n` + errors.join('\n')); process.exit(1); }
console.log('no console errors');
