// 監控段（02:00 → 02:14）節奏的瀏覽器量測（docs/pacing/spec.md §9.2）：headless Chromium + 自動駕駛玩家。
//   node scripts/pacing-run.mjs [--html dist/blind-spot.html] [--speed 3] [--persona typical] [--runs 3] [--seed 1]
//        [--size 960x540] [--query "lock=0&spm=17"] [--timeout-min 9] [--out test-output/pacing] [--no-assert] [--logs]
// persona：eager | typical | starer（從不按 CAM 鈕）| passive（慢、忽略 60% 的提示）（參數與 pacing 原型 pace-proto.mjs 相同）
//
// 自動駕駛（每 100 ms 真實時間 page.evaluate 一次；所有時間都用遊戲時間 BS.clock.time）：
//   坐姿 {x:0,z:-1.6,yaw:0,pitch:0.03,seated:true} 看著主 CRT（坐著卻沒被判定為注視主螢幕 → 中止並報錯）
//   新的 CAM-01/02/04 警示：反應時間後 setChannel(n)，確認（ack）後再看 look 秒，回到 CAM-03
//   CAM-03 警示：切回 CAM-03
//   flags.lockPending：走到防爆門 → bus 'blastDoor:lock' → 等 flags.blastLocked → 走回座位
//   flags.intercomRinging：走到對講機 → 接聽 → 等通話結束 → 走回座位
//   flags.ventFault：走到通風面板 → 拉下拉桿 → 走回座位
// 量測（遊戲時間）：
//   act 長度＝進入 STATE_MONITORING 到 STATE_BLACKOUT_CORRIDOR；
//   「新提示/事件」（alert、gate、knock、ventDying、vacuum、seenMove、callStart）之間的最長空檔（含/不含 02:12 真空）；
//   被提示的警示數、CAM-03 警示數、人影最終 index、盲區違規（顯示中的頻道被改階段）、console / page 錯誤。
// 事件來源：頁面內的記錄器（bus 事件＋旗標上升緣，與 director 無關），另外合併 window.__paceLog（若 director 有提供）。
import { createRequire } from 'node:module';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);
const html = path.resolve(root, opt('html', 'dist/blind-spot.html'));
const speed = Number(opt('speed', 3));
const personaName = opt('persona', 'typical');
const runs = Math.max(1, Number(opt('runs', 3)));
const seed0 = Number(opt('seed', 1));
const [VW, VH] = opt('size', '960x540').split('x').map(Number);
const extra = opt('query', '');
const timeoutMin = Number(opt('timeout-min', 9));
const outDir = path.resolve(root, opt('out', 'test-output/pacing'));
const doAssert = !flag('no-assert');
const showLogs = flag('logs');

// ---- persona（與 pace-proto.mjs 相同）------------------------------------------------------
const PERSONAS = {
  eager:   { react: [2, 3.5], look: [1.5, 2.5], walk: [3.5, 4.5], ans: [1, 2], sweep: 0.05, ignore: 0 },
  typical: { react: [3.5, 6], look: [2, 4], walk: [4.5, 6], ans: [2, 4], sweep: 0.12, ignore: 0 },
  starer:  { react: [3.5, 6], look: [2, 4], walk: [4.5, 6], ans: [2, 4], sweep: 0, ignore: 1 },
  passive: { react: [6, 10], look: [3, 5], walk: [5, 7], ans: [6, 12], sweep: 0, ignore: 0.6 },
};
const LIMITS = {
  eager:   { act: [225, 300], gap: 22, cues: 7 },
  typical: { act: [235, 300], gap: 22, cues: 7 },
  starer:  { act: [0, 360], gap: null, cues: 7 },
  passive: { act: [0, 360], gap: null, cues: null },
};
if (!PERSONAS[personaName]) { console.error(`unknown persona ${personaName}`); process.exit(2); }
const P = PERSONAS[personaName];
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const POSE = {
  seat: { x: 0, z: -1.6, yaw: 0, pitch: 0.03, seated: true },
  door: { x: -3.1, z: -0.4, yaw: Math.PI / 2, pitch: 0, seated: false },
  intercom: { x: -3.2, z: -1.55, yaw: Math.PI / 2, pitch: 0, seated: false },
  vent: { x: 3.2, z: -1.6, yaw: -Math.PI / 2, pitch: 0, seated: false },
};
const STIM = new Set(['alert', 'gate', 'knock', 'ventDying', 'vacuum', 'seenMove', 'callStart']);

// ---- 頁面內記錄器（在 window.BS 被指定的瞬間安裝）------------------------------------------
const RECORDER = `(() => {
  const R = window.__pr = { ev: [], t0: null, t1: null, figAtBlackout: null, figMax: 0, stage: [], flags: {}, pace: [] };
  const push = (kind, o = {}) => { try { R.ev.push(Object.assign({ t: +window.BS.clock.time.toFixed(3), clk: window.BS.flags.clockText, kind }, o)); } catch (e) {} };
  const FLAGS = { lockPending: 'gate:lock', intercomRinging: 'gate:call', ventFault: 'gate:vent', intercomTalking: 'callStart', ventDying: 'ventDying', ventStopped: 'vacuum', doorKnocked: 'knock' };
  function install(B) {
    B.bus.on('state:change', ({ to }) => {
      if (to === 'STATE_MONITORING' && R.t0 == null) { R.t0 = B.clock.time; push('actStart'); }
      if (to === 'STATE_BLACKOUT_CORRIDOR' && R.t1 == null) { R.t1 = B.clock.time; R.figAtBlackout = B.feeds?.figureIndex; push('actEnd', { fig: R.figAtBlackout }); }
    });
    B.bus.on('feeds:alert', (d) => push('alert', { ch: d.channel, stamp: d.stamp }));
    B.bus.on('feeds:alertAck', (d) => push('ack', { ch: d.channel }));
    B.bus.on('feeds:figureMoved', (d) => { push(d.sub ? 'figSub' : 'figMove', { index: d.index }); R.figMax = Math.max(R.figMax, d.index); });
    let lastClk = null, lastSeen = false, wrapped = false;
    const poll = () => {
      try {
        if (!wrapped && B.feeds?.channels) {
          wrapped = true;
          // 盲區守門檢查：每一次頻道階段改變都記下當時是否正在顯示
          for (const [n, ch] of Object.entries(B.feeds.channels)) {
            if (typeof ch.setStage !== 'function') continue;
            const orig = ch.setStage.bind(ch);
            ch.setStage = (k) => {
              const fd = B.feeds; const nn = Number(n);
              const shown = nn === fd.channel || nn === fd.shownChannel;
              const obs = !!B.gaze?.mainScreenObserved;
              R.stage.push({ t: +B.clock.time.toFixed(3), clk: B.flags.clockText, ch: nn, k, mode: fd.mode, shown, obs, force: !!R._force, inAct: R.t0 != null && R.t1 == null });
              return orig(k);
            };
          }
          if (typeof B.feeds.setAnomalyStage === 'function') {
            const o2 = B.feeds.setAnomalyStage.bind(B.feeds);
            B.feeds.setAnomalyStage = (n, k, opts = {}) => { R._force = !!opts.force; try { const r = o2(n, k, opts); if (!r) push('stageRefused', { ch: n, k }); return r; } finally { R._force = false; } };
          }
        }
        const f = B.flags || {};
        for (const [k, kind] of Object.entries(FLAGS)) {
          const v = !!f[k];
          if (v && !R.flags[k]) { const [a, b] = kind.split(':'); push(a, b ? { gate: b } : {}); }
          R.flags[k] = v;
        }
        if (f.clockText !== lastClk) { if (lastClk != null && R.t0 != null) push('flip', { from: lastClk }); lastClk = f.clockText; }
        const seen = !!B.feeds?.seenSinceMove;
        if (seen && !lastSeen && R.t0 != null) push('seenMove', { index: B.feeds.figureIndex });
        lastSeen = seen;
      } catch (e) { R.err = String(e); }
    };
    // 每一幀（inspect.renderOverlay 在主迴圈最後呼叫）
    const iv = B.inspect; const orig = iv.renderOverlay.bind(iv);
    iv.renderOverlay = (r) => { const res = orig(r); poll(); return res; };
  }
  let _bs;
  Object.defineProperty(window, 'BS', { configurable: true, get() { return _bs; }, set(v) { _bs = v; try { install(v); } catch (e) { console.warn('[pacing-run] recorder', e); } } });
})();`;

async function runOnce(browser, runIdx) {
  const seed = seed0 + runIdx;
  const R = mulberry32(seed * 7919 + 17);
  const U = ([a, b]) => a + (b - a) * R();
  const wall0 = Date.now();
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  const errors = [], paceLines = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errors.push(`[console] ${t}`);
    if (t.startsWith('[pace]')) paceLines.push(t);
    if (showLogs) console.log(`  [${m.type()}] ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.addInitScript(RECORDER);
  const url = `${pathToFileURL(html).href}?debug=1&autostart=1&state=MONITORING&speed=${speed}&pacelog=1&seed=${seed}${extra ? '&' + extra : ''}`;
  await page.goto(url, { timeout: 120000 });
  await page.waitForFunction(() => window.BS && window.__pr && window.__pr.t0 != null, null, { timeout: 180000, polling: 200 });

  const ev = (fn, arg) => page.evaluate(fn, arg);
  const snap = () => ev(() => {
    const B = window.BS, f = B.flags;
    return {
      t: B.clock.time, st: B.fsm.currentName, ch: B.feeds.channel, obs: !!B.gaze.mainScreenObserved, seated: !!B.player.seated,
      alerts: Object.keys(B.feeds.alerts || {}).map(Number), fig: B.feeds.figureIndex, inspect: !!B.inspect?.isOpen,
      lockPending: !!f.lockPending, blastLocked: !!f.blastLocked, blastLocking: !!f.blastLocking,
      ringing: !!f.intercomRinging, talking: !!f.intercomTalking, ventFault: !!f.ventFault, ventRestarting: !!f.ventRestarting,
    };
  });
  const teleport = (pose) => ev((p) => window.BS.player.teleport(p), pose);
  const setCh = (n) => ev((n) => { window.BS.feeds.setChannel(n); window.BS.controlRoom?.pressCamButton?.(n - 1); }, n);

  let task = null;                 // { kind, until, ... }
  let seatedSince = null;          // 坐回座位的遊戲時間（注視判定給 0.6 秒緩衝）
  const ignored = new Set();       // passive 忽略的警示（ch:t0）
  const known = new Set();
  let abort = null;
  const tEnd = Date.now() + timeoutMin * 60000;
  let lastSweep = 0, notObsSince = null;
  await teleport(POSE.seat); seatedSince = 0;

  while (Date.now() < tEnd) {
    const s = await snap();
    if (s.st !== 'STATE_MONITORING') break;
    const t = s.t;
    if (s.inspect) await ev(() => window.BS.inspect.close?.());
    // 坐著卻沒有被判定為注視主螢幕 → 自動駕駛的姿勢錯了，量測無效
    if (s.seated && seatedSince != null && t - seatedSince > 0.6 && !s.obs) {
      if (notObsSince == null) notObsSince = t;
      else if (t - notObsSince > 2) { abort = `seated but BS.gaze.mainScreenObserved is false since t=${notObsSince.toFixed(1)}`; break; }
    } else notObsSince = null;

    if (task && task.kind === 'wait' && t >= task.until) { const next = task.next; task = null; if (next) await next(s); continue; }
    if (task && task.kind === 'until' && task.cond(s)) { const next = task.next; task = null; if (next) await next(s); continue; }
    if (task && task.kind === 'until' && t > task.giveUp) { abort = `stuck waiting for ${task.what} at t=${t.toFixed(1)}`; break; }
    if (task && task.gate !== true) {
      // 新的閘門優先：中斷查看警示的動作（頻道保持原樣，跟真人一樣）
      if ((s.lockPending && !s.blastLocked && !s.blastLocking) || s.ringing || s.ventFault) task = null;
    }
    if (!task) {
      const walkBack = (s2) => { task = { kind: 'wait', gate: true, until: s2.t + U(P.walk), next: async () => { await teleport(POSE.seat); seatedSince = (await snap()).t; } }; };
      if (s.lockPending && !s.blastLocked && !s.blastLocking) {
        task = { kind: 'wait', gate: true, until: t + U(P.react) + 1, next: async (s1) => {
          await teleport(POSE.door); seatedSince = null;
          task = { kind: 'wait', gate: true, until: s1.t + U(P.walk), next: async () => {
            await ev(() => window.BS.bus.emit('blastDoor:lock', {}));
            task = { kind: 'until', gate: true, what: 'blastLocked', giveUp: (await snap()).t + 20, cond: (x) => x.blastLocked, next: async (s3) => walkBack(s3) };
          } };
        } };
      } else if (s.ringing) {
        task = { kind: 'wait', gate: true, until: t + U(P.ans), next: async (s1) => {
          await teleport(POSE.intercom); seatedSince = null;
          task = { kind: 'wait', gate: true, until: s1.t + U(P.walk), next: async () => {
            await ev(() => window.BS.interact.trigger('intercom'));
            task = { kind: 'until', gate: true, what: 'call end', giveUp: (await snap()).t + 120, cond: (x) => !x.talking && !x.ringing || x.st !== 'STATE_MONITORING', next: async (s3) => walkBack(s3) };
          } };
        } };
      } else if (s.ventFault && !s.ventRestarting) {
        task = { kind: 'wait', gate: true, until: t + U(P.react), next: async (s1) => {
          await teleport(POSE.vent); seatedSince = null;
          task = { kind: 'wait', gate: true, until: s1.t + U(P.walk), next: async () => {
            await ev(() => window.BS.interact.trigger('vent'));
            task = { kind: 'until', gate: true, what: 'vent lever', giveUp: (await snap()).t + 20, cond: (x) => !x.ventFault && !x.ventRestarting, next: async (s3) => walkBack(s3) };
          } };
        } };
      } else if (s.seated && seatedSince != null) {
        // 警示：最舊的未查看警示（CAM-03 → 切回 CAM-03）
        for (const n of s.alerts) if (!known.has(n)) { known.add(n); if (P.ignore > 0 && R() < P.ignore) ignored.add(n); }
        for (const n of [...known]) if (!s.alerts.includes(n)) { known.delete(n); ignored.delete(n); }
        const todo = s.alerts.filter((n) => !ignored.has(n) && n !== s.ch);
        if (todo.length) {
          const n = todo[0];
          task = { kind: 'wait', until: t + (n === 3 ? U(P.react) * 0.5 : U(P.react)), next: async () => {
            await setCh(n);
            if (n === 3) return;
            task = { kind: 'until', what: `ack CAM-0${n}`, giveUp: (await snap()).t + 60, cond: (x) => !x.alerts.includes(n) || x.ch !== n, next: async (s2) => {
              task = { kind: 'wait', until: s2.t + U(P.look), next: async () => { await setCh(3); } };
            } };
          } };
        } else if (s.ch !== 3) {
          await setCh(3);
        } else if (P.sweep > 0 && t - lastSweep > 5) {
          lastSweep = t;
          if (R() < P.sweep) {
            const n = [1, 2, 4][Math.floor(R() * 3)];
            await setCh(n);
            task = { kind: 'wait', until: t + U(P.look), next: async () => { await setCh(3); } };
          }
        }
      }
    }
    await page.waitForTimeout(100);
  }
  // 收尾：等狀態切到 BLACKOUT（最多 3 秒），然後收集
  await page.waitForFunction(() => window.__pr.t1 != null, null, { timeout: 3000, polling: 200 }).catch(() => {});
  const rec = await ev(() => ({ ...window.__pr, pace: (window.__paceLog || []).slice(), dump: window.BS.director?.dump?.() ?? null }));
  await page.close();
  return { seed, rec, errors, paceLines, abort, timedOut: Date.now() >= tEnd, wallS: (Date.now() - wall0) / 1000 };
}

function analyse(r) {
  const { rec } = r;
  const t0 = rec.t0, t1 = rec.t1;
  const ev = rec.ev.filter((e) => t0 == null || e.t >= t0);
  const act = t0 != null && t1 != null ? t1 - t0 : null;
  // 刺激事件（新提示/事件）
  const stim = ev.filter((e) => STIM.has(e.kind)).map((e) => ({ t: e.t, kind: e.kind === 'gate' ? `gate:${e.gate}` : e.kind, ch: e.ch }));
  // 真空區間：通風停止（vacuum）→ 第 3 通對講機開始響（vacuum 之後的第一個 gate:call）
  const vac = stim.find((e) => e.kind === 'vacuum');
  const call3 = vac ? stim.find((e) => e.kind === 'gate:call' && e.t >= vac.t) : null;
  const gaps = (exclVac) => {
    const pts = [t0, ...stim.map((e) => e.t), t1 ?? ev[ev.length - 1]?.t].filter((x) => x != null).sort((a, b) => a - b);
    let best = { gap: 0 };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (exclVac && vac && a >= vac.t - 1e-6 && b <= (call3 ? call3.t : Infinity) + 1e-6) continue;
      if (b - a > best.gap) best = { gap: b - a, from: a - t0, to: b - t0 };
    }
    return best;
  };
  const alerts = ev.filter((e) => e.kind === 'alert');
  const cued = alerts.filter((e) => e.ch !== 3).length;
  const cam3 = alerts.filter((e) => e.ch === 3).length;
  const violations = (rec.stage || []).filter((s) => s.inAct && !s.force && s.mode === 'LD' && (s.ch === 3 ? s.shown && s.obs : s.shown));
  // 每分鐘表
  const flips = ev.filter((e) => (e.kind === 'flip' || e.kind === 'actStart') && (t1 == null || e.t < t1));
  const minutes = [];
  for (let i = 0; i < flips.length; i++) {
    const a = flips[i].t, b = i + 1 < flips.length ? flips[i + 1].t : (t1 ?? a);
    const inM = ev.filter((e) => e.t >= a && e.t < b);
    minutes.push({
      clk: flips[i].clk, start: a - t0, dur: b - a,
      alerts: inM.filter((e) => e.kind === 'alert' && e.ch !== 3).map((e) => e.ch),
      cam3: inM.filter((e) => e.kind === 'alert' && e.ch === 3).length,
      steps: inM.filter((e) => e.kind === 'figMove').map((e) => e.index), subs: inM.filter((e) => e.kind === 'figSub').map((e) => e.index),
      events: [...new Set(inM.filter((e) => ['gate', 'knock', 'ventDying', 'vacuum', 'callStart'].includes(e.kind)).map((e) => (e.kind === 'gate' ? `gate:${e.gate}` : e.kind)))],
    });
  }
  return { act, gapAll: gaps(false), gapNoVac: gaps(true), cued, cam3, violations, minutes, fig: rec.figAtBlackout, figMax: rec.figMax, refused: ev.filter((e) => e.kind === 'stageRefused').length,
    knock: ev.some((e) => e.kind === 'knock'), paceKinds: Object.entries((rec.pace || []).reduce((m, e) => ((m[e.kind] = (m[e.kind] || 0) + 1), m), {})) };
}

const f1 = (v) => (v == null ? '   -  ' : v.toFixed(1).padStart(6));
function printRun(r, a) {
  console.log(`\n=== run seed=${r.seed} persona=${personaName} speed=${speed} (${r.wallS.toFixed(0)} s wall) ${r.abort ? 'ABORT: ' + r.abort : ''}${r.timedOut ? ' (timed out)' : ''}`);
  console.log(' clock  start    dur  cued alerts  cam3  fig steps  subs  events');
  for (const m of a.minutes) {
    console.log(` ${String(m.clk).padEnd(5)} ${f1(m.start)} ${f1(m.dur)}  ${(m.alerts.map((n) => `CAM-0${n}`).join(',') || '-').padEnd(11)} ${String(m.cam3).padStart(4)}  ${(m.steps.join(',') || '-').padEnd(9)} ${(m.subs.join(',') || '-').padEnd(5)} ${m.events.join(' ')}`);
  }
  console.log(` act length ${f1(a.act)} s | max gap ${f1(a.gapAll.gap)} s (excl. 02:12 vacuum ${f1(a.gapNoVac.gap)} s @ +${f1(a.gapNoVac.from)}…+${f1(a.gapNoVac.to)}) | cued alerts ${a.cued} | CAM-03 alarms ${a.cam3} | knock ${a.knock ? 'yes' : 'no'} | figure at blackout ${a.fig} | on-screen stage changes ${a.violations.length} (refused ${a.refused}) | errors ${r.errors.length}`);
  if (a.paceKinds.length) console.log(` __paceLog kinds: ${a.paceKinds.map(([k, n]) => `${k}×${n}`).join(' ')}`);
  if (r.paceLines.length) console.log(' [pace] console:\n' + r.paceLines.map((l) => '   ' + l).join('\n'));
}
function check(r, a) {
  const L = LIMITS[personaName], fails = [];
  if (r.abort) fails.push(`aborted: ${r.abort}`);
  if (a.act == null) fails.push('act did not finish (no STATE_BLACKOUT_CORRIDOR)');
  else if (a.act < L.act[0] || a.act > L.act[1]) fails.push(`act length ${a.act.toFixed(1)} s ∉ [${L.act[0]}, ${L.act[1]}]`);
  if (L.gap != null && a.gapNoVac.gap > L.gap) fails.push(`max gap excl. vacuum ${a.gapNoVac.gap.toFixed(1)} s > ${L.gap}`);
  if (L.cues != null && a.cued < L.cues) fails.push(`cued alerts ${a.cued} < ${L.cues}`);
  if (a.violations.length) fails.push(`stage changed on a displayed channel: ${JSON.stringify(a.violations.slice(0, 3))}`);
  if (a.act != null && a.fig !== 7) fails.push(`figure index at blackout ${a.fig} ≠ 7`);
  if (r.errors.length) fails.push(`${r.errors.length} console/page error(s): ${r.errors.slice(0, 3).join(' | ')}`);
  return fails;
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'] });
mkdirSync(outDir, { recursive: true });
const results = [];
let failed = 0;
try {
  for (let i = 0; i < runs; i++) {
    const r = await runOnce(browser, i);
    const a = analyse(r);
    printRun(r, a);
    const fails = check(r, a);
    if (fails.length) { console.log(` ${doAssert ? 'FAIL' : 'note'}: ` + fails.join('\n       ')); if (doAssert) failed++; }
    else console.log(doAssert ? ' PASS' : ' (no notes)');
    results.push({ seed: r.seed, analysis: a, abort: r.abort, errors: r.errors, paceLines: r.paceLines, events: r.rec.ev, stage: r.rec.stage, pace: r.rec.pace, dump: r.rec.dump });
  }
} finally {
  await browser.close();
}
const acts = results.map((x) => x.analysis.act).filter((v) => v != null).sort((a, b) => a - b);
const gapsNV = results.map((x) => x.analysis.gapNoVac.gap).sort((a, b) => a - b);
console.log(`\n=== summary persona=${personaName} runs=${runs} speed=${speed}: act ${acts.map((v) => v.toFixed(1)).join(' / ') || '-'} s | max gap excl. vacuum ${gapsNV.map((v) => v.toFixed(1)).join(' / ')} s | ${!doAssert ? 'assertions off (--no-assert)' : failed ? `${failed} FAILED` : 'all passed'}`);
const file = path.join(outDir, `pacing-${personaName}-${Date.now()}.json`);
writeFileSync(file, JSON.stringify({ persona: personaName, speed, size: `${VW}x${VH}`, query: extra, results }, null, 1));
console.log(`details → ${path.relative(root, file)}`);
process.exit(failed ? 1 : 0);
