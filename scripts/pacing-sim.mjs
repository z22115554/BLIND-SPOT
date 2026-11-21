#!/usr/bin/env node
// =============================================================================
// scripts/pacing-sim.mjs — 第一幕（02:00 → 02:14）節奏模擬（node，無瀏覽器）
// -----------------------------------------------------------------------------
// 規格：docs/pacing/spec.md §9.1。直接使用真正的 src/states/monitoringDirector.js（零 import）與
// src/data/script.js（對講機段落長度），以假的 sense / io 驅動它，並鏡像 MonitoringState.run 的分鐘迴圈、
// 三個閘門（02:00 上鎖、對講機、02:05 通風）、CameraFeeds._blindSpot（GATE_LIMITS ＋ 子姿勢）與警示確認。
//
//   node scripts/pacing-sim.mjs [--runs 200] [--persona all|eager|typical|starer|passive] [--table] [--seed N]
//                               [--spm 17] [--no-early] [--no-lock] [--no-subposes] [--quiet]
//                               [--dmin 11] [--calm 3.5] [--gap 11] [--literal-rush]   （調整旋鈕；不套用長度斷言）
//                               [--glance 0.7]   按 CAM 按鈕前低頭看控制台的秒數（滑鼠必須把準心移到按鈕上：
//                                                 控制台在 CRT 下方約 33°，超出 GazeSystem 的 34° 視錐 → 算「移開視線」）
// 斷言失敗時 exit 1。
// =============================================================================
import { MonitoringDirector, PACE, GATE_LIMITS, mulberry32 } from '../src/states/monitoringDirector.js';
import { SCRIPT } from '../src/data/script.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] != null && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const flag = (k) => args.includes(`--${k}`);

const DT = 0.05;
// §9.1 寫「max idle ≤ 21 s」；規格的原型數字是 eager ≈ 20 s、typical ≈ 18 s（p50/p90 等級，原型沒有 RUSH 也沒有逐局最大值）。
// 實測（真正的導演）：最長閒置永遠是 02:09 的尾巴 ＋ 受保護的 02:10（17 s，只有通風衰弱聲）＋ 02:11 的 LEAD 1.5 s，
// 結構下限約 20 s。這裡以「中位數那一局 ≤ 21.5 s」與「每一局 ≤ 24 s」檢查，數字照實印出。
const IDLE_TARGET = 21.5, IDLE_CAP = 24;
const FIGURE_TOP = 7;
const LD_SUBPOSE_MAX = 5;
const CALL_HOLD = [1.5, 1.5, 1.0];                 // MonitoringState: playIntercom(this, i) / (…, 2, { hold: 1.0 })
const CALL_DUR = SCRIPT.intercom.slice(0, 3).map((s, i) => s.segments.reduce((a, g) => a + (Number(g.dur) || 0), 0) + CALL_HOLD[i]);
const LOCK_DUR = 2.4;                               // cr.setBlastLocked(true, { duration: 2.4 })
const LEVER_DUR = 0.77, VENT_SETTLE = 0.6;          // pullVentLever + wait(0.6)
// 與防爆門的水平距離（m）：座位 / 西牆（對講機、門）/ 東牆（通風面板）/ 走動中
const DOOR_DIST = { seat: 4.18, west: 1.5, east: 7.9, walk: 3.0 };
const GLANCE = Number(opt('glance', 0.7));

// 玩家原型（秒）：react 看到警示後的反應、look 確認後多看幾秒、walk 走到牆邊、ans 響鈴後多久接、
// sweep 平常每 5 秒主動切看別的頻道的機率、ignore 不理會警示（1 = 永遠只看 CAM-03）
const PERSONAS = {
  eager:   { react: [2, 3.5], look: [1.5, 2.5], walk: [3.5, 4.5], ans: [1, 2], lock: [1, 2], sweep: 0.05, ignore: 0 },
  typical: { react: [3.5, 6], look: [2, 4], walk: [4.5, 6], ans: [2, 4], lock: [2.5, 5], sweep: 0.12, ignore: 0 },
  starer:  { react: [3.5, 6], look: [2, 4], walk: [4.5, 6], ans: [2, 4], lock: [2.5, 5], sweep: 0, ignore: 1 },
  passive: { react: [6, 10], look: [3, 5], walk: [5, 7], ans: [6, 12], lock: [6, 12], sweep: 0, ignore: 0.6, ignoreDelay: [3, 8] },
};

// 「新的提示/事件」：§9.2 的種類，加上閘門裡玩家動作的回饋（上鎖完成、拉下拉桿 — 等同對講機的 callStart）
const STIM = new Set(['alert', 'gate', 'knock', 'ventDying', 'vacuum', 'seenMove', 'callStart', 'lockDone', 'lever']);

// -----------------------------------------------------------------------------
export function simulate(personaName = 'typical', seed = 1, o = {}) {
  const P = PERSONAS[personaName];
  const R = mulberry32(seed * 7919 + 17);
  const U = ([a, b]) => a + (b - a) * R();
  const failures = [];
  const fail = (msg) => { if (failures.length < 20) failures.push(`[${personaName} seed ${seed} t=${w.t.toFixed(2)}] ${msg}`); };
  const lockGate = o.lock !== false, subPoses = o.subposes !== false;

  // ---- 世界 ----
  const w = {
    t: 0, minute: 0, clockText: '02:00', minuteK: null,
    f: {
      lockPending: false, blastLocking: false, blastLocked: !lockGate, intercomRinging: false, intercomTalking: false,
      ventFault: false, ventRestarting: false, ventCut: false, ventStopped: false, doorKnocked: false,
    },
    // feeds
    channel: 3, shown: 3, fig: 0, lim: { min: 0, max: 0 }, seenSinceMove: true, obsT: 0, unobsT: 0, figSub: false,
    alerts: new Map(), stages: { 1: 0, 2: 0, 3: 0, 4: 0 }, frozen: false,
    // player
    view: 'crt', pos: 'seat',
    answered: false,
    log: [],
  };
  const held = () => { const f = w.f; return !!(f.lockPending || f.blastLocking || f.intercomRinging || f.intercomTalking || f.ventFault || f.ventRestarting); };
  const observed = (n) => w.view === 'crt' && w.channel === n;
  const pad = (n) => String(n).padStart(2, '0');
  const clockStamp = () => `${w.clockText}:${pad(Math.floor(60 * (Number.isFinite(w.minuteK) ? w.minuteK : 0)))}`;
  const ev = (kind, extra = {}) => { w.log.push({ t: w.t, minute: w.minute, kind, ...extra }); };

  // 獨立於導演的 hold 追蹤（驗證「hold 中與 POST_HOLD 內不發提示」）
  let lastHeld = false, holdFreeAt = -Infinity;
  const noteHoldEdge = () => { const h = held(); if (lastHeld && !h) holdFreeAt = Math.max(holdFreeAt, w.t); lastHeld = h; };

  // ---- sense / io（假的 MonitoringState） ----
  const sense = () => ({
    held: held(), inspectOpen: false, ventStopped: w.f.ventStopped, clockText: w.clockText,
    channel: w.channel, shownChannel: w.shown, observed, unobserved3: w.unobsT, seenSinceMove: w.seenSinceMove,
    anyAlert: w.alerts.size > 0, alerted: (n) => w.alerts.has(n), playerDoorDist: DOOR_DIST[w.pos], atDesk: w.pos === 'seat',
  });
  let cued = 0, cam3Alarms = 0, lastCuedAt = -Infinity, toneCount = 0, knocks = 0, knockMinute = null, subCount = 0;
  let kPrev = -1, kMinute = -1;
  const io = {
    apply: (ch, stage, { force = false } = {}) => {
      if (!force) {
        const shown = ch === 3 ? observed(3) : (w.channel === ch || w.shown === ch);
        if (shown) { fail(`io.apply(${ch}, ${stage}) while channel ${ch} is shown`); throw new Error('apply on shown channel'); }
      }
      w.stages[ch] = stage;
      return true;
    },
    freeze: (ch) => { w.frozen = true; return true; },
    raise: (ch, { stamp } = {}) => {
      const s = stamp ?? clockStamp();
      if (held()) fail(`alert ${ch} raised while held`);
      if (w.t < holdFreeAt + PACE.POST_HOLD - 1e-6) fail(`alert ${ch} raised ${(w.t - holdFreeAt).toFixed(2)} s after a hold (< POST_HOLD)`);
      if (ch !== 3) {
        if (w.t - lastCuedAt < (o.pace || PACE).MIN_GAP - 1e-6) fail(`cued alerts ${(w.t - lastCuedAt).toFixed(2)} s apart (< MIN_GAP)`);
        lastCuedAt = w.t; cued++;
      } else cam3Alarms++;
      w.alerts.set(ch, { stamp: s, obs: 0, t0: w.t, ignoreUntil: null });
      ev('alert', { ch });
      return s;
    },
    clockStamp,
    firstStamp: () => SCRIPT.feedUI.firstStamp,
    tone: (ch) => { if (held()) fail('tone while held'); if (w.f.ventStopped) fail('tone after ventStopped'); toneCount++; },
    knock: (count) => { knocks++; if (knockMinute == null) knockMinute = w.minute; if (DOOR_DIST[w.pos] < PACE.KNOCK.minDoorDist) fail('knock with the player at the door'); ev('knock', { count }); },
    knocked: () => { w.f.doorKnocked = true; },
    log: () => {},
    minuteK: (k) => {
      if (!(k <= 0.999)) fail(`minuteK ${k} > 0.999`);
      if (w.minute === kMinute && k < kPrev - 1e-12) fail(`minuteK went backwards ${kPrev} → ${k}`);
      kMinute = w.minute; kPrev = k; w.minuteK = k;
    },
    hint: () => {},
    trace: (e) => { if (e.kind === 'seenMove') ev('seenMove'); },
  };
  const dir = new MonitoringDirector({ sense, io, pace: o.pace || PACE, rng: mulberry32(seed), spm: o.spm, early: o.early !== false, lockGate });

  // ---- 人影盲區規則（CameraFeeds._blindSpot ＋ §3.4 子姿勢） ----
  const blindSpot = (dt) => {
    if (observed(3)) {
      w.obsT += dt; w.unobsT = 0;
      if (w.obsT >= 0.8) w.seenSinceMove = true;
      return;
    }
    w.obsT = 0; w.unobsT += dt;
    if (w.unobsT >= 0.5 && (w.seenSinceMove || w.fig < w.lim.min) && w.fig < w.lim.max && w.fig < FIGURE_TOP) {
      w.fig++; w.figSub = false; w.seenSinceMove = false; w.unobsT = 0;
      ev('figMove', { index: w.fig });
      dir.onFigureMoved({ index: w.fig, sub: false }, w.t);
    } else if (subPoses && w.unobsT >= 0.5 && w.seenSinceMove && w.fig >= w.lim.max && !w.figSub && w.fig <= LD_SUBPOSE_MAX) {
      w.figSub = true; w.seenSinceMove = false; w.unobsT = 0; subCount++;
      ev('figMove', { index: w.fig, sub: true });
      dir.onFigureMoved({ index: w.fig, sub: true }, w.t);
    }
  };
  const ackTick = (dt) => {
    for (const [ch, a] of [...w.alerts]) {
      if (observed(ch)) {
        a.obs += dt;
        if (a.obs >= PACE.ACK) { w.alerts.delete(ch); ev('ack', { ch }); dir.onAlertAck({ channel: ch }, w.t); }
      } else a.obs = 0;
    }
  };
  const setLimits = (a, b) => { w.lim = { min: a, max: b }; };
  const limits = (m) => { const l = GATE_LIMITS[m]; if (l) setLimits(l[0], l[1]); };

  // ---- MonitoringState.run 的鏡像（generator：yield 一個條件，成立才繼續） ----
  const waitFor = (sec) => { const at = w.t + sec; return () => w.t >= at - 1e-9; };
  const minuteStart = [];
  function* intercom(i) {
    w.f.intercomRinging = true; w.answered = false; ev('gate', { what: `call${i + 1}` });
    yield () => w.answered;
    w.f.intercomRinging = false; w.f.intercomTalking = true; ev('callStart', { call: i + 1 });
    if (i === 2) setLimits(7, 7);
    yield waitFor(CALL_DUR[i]);
    w.f.intercomTalking = false;
  }
  function* beat(m) {
    switch (m) {
      case 0:
        limits(0);
        if (lockGate) { w.f.lockPending = true; ev('gate', { what: 'lock' }); yield () => w.f.blastLocked; }
        break;
      case 3: yield* intercom(0); limits(3); break;
      case 5:
        w.f.ventFault = true; ev('gate', { what: 'vent' });
        yield () => w.f.ventCut && !w.f.ventRestarting;
        limits(5);
        break;
      case 8: yield* intercom(1); limits(8); break;
      case 10: ev('ventDying'); break;
      case 12: w.f.ventStopped = true; ev('vacuum'); limits(12); break;
      case 13: setLimits(6, 7); yield* intercom(2); break;
      default: break;
    }
  }
  function* run() {
    for (let m = 0; m <= 13; m++) {
      if (m > 0) yield () => dir.canFlip(w.t);
      w.minute = m; w.clockText = `02:${pad(m)}`; minuteStart.push({ m, t: w.t });
      dir.onMinute(m, w.t);
      yield* beat(m);
      dir.onBeatDone(m, w.t);
    }
  }

  // ---- 玩家（簡單的腳本代理人） ----
  let task = null;   // { kind, until, ... }
  const busyTask = () => task != null;
  const startWalk = (to, then) => { w.view = 'away'; w.pos = 'walk'; task = { kind: 'walk', to, then, until: w.t + U(P.walk) }; };
  const gateAction = () => {
    const f = w.f;
    if (f.lockPending && !f.blastLocking && !f.blastLocked) return { where: 'west', delay: U(P.lock), act: 'lock' };
    if (f.intercomRinging) return { where: 'west', delay: U(P.ans), act: 'answer' };
    if (f.ventFault) return { where: 'east', delay: U(P.react), act: 'vent' };
    return null;
  };
  const agent = () => {
    if (task && w.t < task.until) return;
    if (task) {
      const k = task.kind;
      if (k === 'think') { startWalk(task.where, task.act); return; }
      if (k === 'walk') {
        if (task.to === 'seat') { w.pos = 'seat'; w.view = 'crt'; task = null; return; }
        w.pos = task.to;
        const act = task.then;
        if (act === 'lock') {
          w.f.blastLocking = true;
          task = { kind: 'act', until: w.t + LOCK_DUR, done: () => { w.f.blastLocked = true; w.f.lockPending = false; w.f.blastLocking = false; ev('lockDone'); } };
        } else if (act === 'answer') {
          w.answered = true;
          task = { kind: 'waitCall', until: w.t + DT };
        } else if (act === 'vent') {
          w.f.ventFault = false; w.f.ventRestarting = true; ev('lever');
          task = { kind: 'act', until: w.t + LEVER_DUR + VENT_SETTLE, done: () => { w.f.ventCut = true; w.f.ventRestarting = false; } };
        }
        return;
      }
      if (k === 'act') { task.done(); startWalk('seat'); return; }
      if (k === 'waitCall') { if (w.f.intercomTalking || w.f.intercomRinging) { task.until = w.t + DT; return; } startWalk('seat'); return; }
      // 切頻道＝先低頭看控制台按鈕 GLANCE 秒（視線離開 CRT），按下後抬頭
      if (k === 'react') { if (GLANCE > 0) { w.view = 'console'; task = { kind: 'press', ch: task.ch, until: w.t + GLANCE }; return; } task = { kind: 'press', ch: task.ch, until: w.t }; }
      if (task.kind === 'press') {
        w.view = 'crt'; w.channel = task.ch; w.shown = task.ch;
        task = task.ch === 3 ? null : { kind: 'look', until: w.t + PACE.ACK + U(P.look) };
        return;
      }
      if (k === 'look') { if (GLANCE > 0) { w.view = 'console'; task = { kind: 'press', ch: 3, until: w.t + GLANCE }; return; } w.channel = 3; w.shown = 3; task = null; return; }
    }
    // 沒有任務：閘門優先，其次是警示，再其次是偶爾主動看看別的頻道
    const g = gateAction();
    if (g) { task = { kind: 'think', until: w.t + g.delay, where: g.where, act: g.act }; return; }
    if (P.ignore < 1 && w.alerts.size) {
      const list = [...w.alerts.entries()].filter(([ch]) => !observed(ch)).sort((a, b) => a[1].t0 - b[1].t0);
      for (const [ch, a] of list) {
        if (a.ignoreUntil == null) a.ignoreUntil = P.ignore > 0 && R() < P.ignore ? a.t0 + U(P.ignoreDelay) : a.t0;
        if (w.t < a.ignoreUntil) continue;
        task = { kind: 'react', ch, until: w.t + U(P.react) };
        return;
      }
    }
    if (P.sweep > 0 && w.channel === 3 && w.view === 'crt' && R() < (P.sweep * DT) / 5) {
      task = { kind: 'react', ch: [1, 2, 4][Math.floor(R() * 3)], until: w.t + 0.5 };
    }
  };

  // ---- 主迴圈 ----
  const gen = run();
  let cond = gen.next().value, finished = false;
  let idleSince = 0, maxIdle = 0, maxIdleAt = null;
  const T_MAX = 900;
  while (!finished && w.t < T_MAX) {
    w.t = +(w.t + DT).toFixed(6);
    agent();
    noteHoldEdge();
    blindSpot(DT);
    ackTick(DT);
    try { dir.tick(DT, w.t); } catch (e) { fail(`director.tick threw: ${e.message}`); break; }
    noteHoldEdge();
    // 生成器（與 BaseState.until 一樣，每幀檢查一次；連續成立的步驟在同一幀內推進）
    for (let guard = 0; guard < 8 && cond; guard++) {
      let ok = false;
      try { ok = cond(); } catch (e) { fail(`condition threw: ${e.message}`); }
      if (!ok) break;
      const r = gen.next();
      if (r.done) { finished = true; cond = null; break; }
      cond = r.value;
    }
    // 閒置：沒有閘門、沒有任務、沒有待查看的警示（02:12 之後不算）
    const busy = held() || busyTask() || w.alerts.size > 0;
    if (busy || w.minute >= 12) idleSince = w.t;
    else if (w.t - idleSince > maxIdle) { maxIdle = w.t - idleSince; maxIdleAt = `02:${pad(w.minute)} @${w.t.toFixed(1)}s`; }
  }
  if (!finished) fail('act did not finish');

  // ---- 指標 ----
  const total = w.t;
  const minutes = minuteStart.map((m, i) => ({ m: m.m, t0: m.t, dur: (i + 1 < minuteStart.length ? minuteStart[i + 1].t : total) - m.t }));
  for (const mm of minutes) {
    if (PACE.PROTECTED.includes(mm.m)) {
      const target = o.spm || PACE.SPM;
      if (Math.abs(mm.dur - target) > DT + 1e-6) fail(`protected minute 02:${pad(mm.m)} lasted ${mm.dur.toFixed(2)} s (≠ ${target})`);
    }
  }
  if (w.fig !== FIGURE_TOP) fail(`figure index ${w.fig} at blackout`);
  // 最長「沒有新的提示/事件」：[02:12 真空, 第三通來電] 之間除外
  const stim = w.log.filter((l) => STIM.has(l.kind)).map((l) => ({ t: l.t, kind: l.kind }));
  const vacT = (w.log.find((l) => l.kind === 'vacuum') || {}).t ?? Infinity;
  const call3 = (w.log.filter((l) => l.kind === 'callStart').pop() || {}).t ?? Infinity;
  let maxGap = 0, maxGapAt = null, maxGapAll = 0;
  let prev = 0;
  for (const s of [...stim, { t: total, kind: 'end' }]) {
    const g = s.t - prev;
    if (g > maxGapAll) maxGapAll = g;
    const inVac = prev >= vacT - 1e-9 && s.t <= call3 + 1e-9;
    if (!inVac && g > maxGap) { maxGap = g; maxGapAt = `${prev.toFixed(1)}→${s.t.toFixed(1)}s (→ ${s.kind})`; }
    prev = s.t;
  }
  return {
    persona: personaName, seed, total, fig: w.fig, cued, cam3Alarms, tones: toneCount, knocks, knockMinute, subCount,
    maxIdle, maxIdleAt, maxGap, maxGapAt, maxGapAll, minutes, log: w.log, trace: dir.trace, failures,
  };
}

// -----------------------------------------------------------------------------
const pc = (a, q) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(q * (b.length - 1))]; };
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// 導演的其他路徑（?clock= 跳關、除錯 fire / forceFlip / dump）：快速自我檢查
function selfTest(assert) {
  const logs = [], applied = [];
  const sense = () => ({ held: false, inspectOpen: false, ventStopped: false, clockText: '02:09', channel: 3, shownChannel: 3,
    observed: (n) => n === 3, unobserved3: 0, seenSinceMove: true, anyAlert: false, alerted: () => false, playerDoorDist: 4 });
  const io = {
    apply: (ch, stage, o) => { applied.push([ch, stage, !!o?.force]); return true; },
    freeze: (ch, o) => { applied.push([ch, 'freeze', !!o?.force]); return true; },
    log: (kind, o) => logs.push(`${kind}:${o.hhmm}${o.ch ? `:${o.ch}` : ''}`), knocked: () => logs.push('knocked'),
    firstStamp: () => SCRIPT.feedUI.firstStamp, clockStamp: () => '02:09:30', raise: (ch, { stamp }) => stamp,
  };
  const d = new MonitoringDirector({ sense, io, rng: mulberry32(1) });
  d.fastForward(9);
  const want = ['lock:02:00', 'motion:01:58:4', 'motion:02:02:1', 'motion:02:03:4', 'motion:02:06:2', 'motion:02:07:4', 'motion:02:08:2', 'vent:02:05', 'knock:02:05', 'knocked'];
  assert(JSON.stringify(logs) === JSON.stringify(want), `fastForward(9) logs ${JSON.stringify(logs)}`);
  assert(applied.every((a) => a[2]) && applied.length === 6, `fastForward(9) applies ${JSON.stringify(applied)}`);
  assert(d.knock.state === 'done' && d.fired.size === 6, 'fastForward(9) state');
  d.onMinute(9, 0); d.onBeatDone(9, 0);
  assert(d.canFlip(1) === false, 'canFlip right after the flip');
  d.forceFlip();
  assert(d.canFlip(1.05) === true, 'forceFlip');
  assert(d.fire('m1c') === true && d.fired.has('m1c') && d.cues === 1, 'fire(m1c)');
  assert(d.dump().fired.includes('m1c'), 'dump');
  const d2 = new MonitoringDirector({ sense, io: {}, lockGate: false });
  d2.onMinute(0, 0); d2.onBeatDone(0, 0);
  assert(d2.holdUntil === -Infinity, 'no POST_HOLD after 02:00 without the lock gate');
}

function main() {
  const runs = Number(opt('runs', 200));
  const which = opt('persona', 'all');
  const personas = which === 'all' ? Object.keys(PERSONAS) : [which];
  // 調整旋鈕（§4 Tuning knobs）：--dmin / --calm / --gap / --rush-in-dwell 只影響這次模擬
  const pace = { ...PACE };
  if (opt('dmin')) pace.DWELL_MIN = Number(opt('dmin'));
  if (opt('calm')) pace.CALM = Number(opt('calm'));
  if (opt('gap')) pace.MIN_GAP = Number(opt('gap'));
  if (flag('literal-rush')) pace.RUSH_IN_DWELL = false;
  const tuned = ['dmin', 'calm', 'gap'].some((k) => opt(k)) || flag('literal-rush');
  const simOpts = { pace, spm: opt('spm') ? Number(opt('spm')) : undefined, early: !flag('no-early'), lock: !flag('no-lock'), subposes: !flag('no-subposes') };
  const strict = !simOpts.spm && simOpts.early && simOpts.lock && !tuned;   // 只有預設設定才套用長度斷言
  const failures = [];
  const assert = (ok, msg) => { if (!ok) failures.push(msg); };
  selfTest(assert);
  console.log(`pacing-sim: ${runs} runs/persona · DT ${DT}s · SPM ${simOpts.spm || PACE.SPM} · DWELL_MIN ${pace.DWELL_MIN} · CALM ${pace.CALM} · MIN_GAP ${pace.MIN_GAP}${pace.RUSH_IN_DWELL ? '' : ' · literal rush (after DWELL_MIN)'}` +
    ` · lock ${simOpts.lock ? 'on' : 'off'} · early ${simOpts.early ? 'on' : 'off'} · subposes ${simOpts.subposes ? 'on' : 'off'}`);
  console.log('persona   act p10 / p50 / p90   | max idle p50 / p90 / max | longest no-new-event (excl. 02:12 vacuum) p50 / p90 / max | cued p50 [min–max] | CAM-03 alarms max | sub-poses p50 | knock in 02:05 | fig@end');
  for (const p of personas) {
    const rs = [];
    for (let s = 1; s <= runs; s++) rs.push(simulate(p, s, simOpts));
    for (const r of rs) for (const f of r.failures) failures.push(f);
    const tot = rs.map((r) => r.total), idle = rs.map((r) => r.maxIdle), gap = rs.map((r) => r.maxGap), cues = rs.map((r) => r.cued);
    const knock5 = rs.filter((r) => r.knockMinute === 5).length;
    console.log(`${p.padEnd(8)}  ${fmt(pc(tot, 0.1))} / ${fmt(pc(tot, 0.5))} / ${fmt(pc(tot, 0.9))} (${pc(tot, 0.5).toFixed(0)} s)` +
      ` | ${pc(idle, 0.5).toFixed(1)} / ${pc(idle, 0.9).toFixed(1)} / ${Math.max(...idle).toFixed(1)}` +
      ` | ${pc(gap, 0.5).toFixed(1)} / ${pc(gap, 0.9).toFixed(1)} / ${Math.max(...gap).toFixed(1)}` +
      ` | ${pc(cues, 0.5)} [${Math.min(...cues)}–${Math.max(...cues)}]` +
      ` | ${Math.max(...rs.map((r) => r.cam3Alarms))}` +
      ` | ${pc(rs.map((r) => r.subCount), 0.5)}` +
      ` | ${knock5}/${runs}` +
      ` | ${Math.min(...rs.map((r) => r.fig))}`);
    if (!flag('quiet')) {
      const worst = rs.reduce((a, b) => (b.maxIdle > a.maxIdle ? b : a));
      const worstGap = rs.reduce((a, b) => (b.maxGap > a.maxGap ? b : a));
      console.log(`          worst idle ${worst.maxIdle.toFixed(1)} s at ${worst.maxIdleAt} (seed ${worst.seed}); worst gap ${worstGap.maxGap.toFixed(1)} s ${worstGap.maxGapAt} (seed ${worstGap.seed})`);
    }
    // ---- §9.1 斷言 ----
    assert(Math.max(...tot) <= 360, `${p}: an act lasted ${Math.max(...tot).toFixed(1)} s (> 360)`);
    assert(rs.every((r) => r.fig === 7), `${p}: figure index ≠ 7 at blackout`);
    assert(Math.max(...rs.map((r) => r.cam3Alarms)) <= 4, `${p}: more than 4 CAM-03 alarms`);
    if (strict && p === 'typical') { const m = pc(tot, 0.5); assert(m >= 250 && m <= 285, `typical p50 ${m.toFixed(1)} s ∉ [250, 285]`); }
    if (strict && p === 'eager') assert(pc(tot, 0.1) >= 225, `eager p10 ${pc(tot, 0.1).toFixed(1)} s < 225`);
    if (p === 'eager' || p === 'typical') {
      // §9.1「max idle ≤ 21 s」：以中位數那一局檢查（規格的數字來自原型的 p50/p90）；每一局另有 24 s 的硬上限。
      // 最長的閒置永遠是 02:09 的尾巴＋受保護、只有通風衰弱聲的 02:10（17 s）＋ 02:11 的 LEAD。
      assert(pc(idle, 0.5) <= IDLE_TARGET, `${p}: median max-idle ${pc(idle, 0.5).toFixed(1)} s > ${IDLE_TARGET}`);
      assert(Math.max(...idle) <= IDLE_CAP, `${p}: worst max-idle ${Math.max(...idle).toFixed(1)} s > ${IDLE_CAP}`);
      assert(Math.min(...cues) >= 7 && Math.max(...cues) <= 8, `${p}: cued alerts ∉ [7, 8] (${Math.min(...cues)}–${Math.max(...cues)})`);
    }
    if (p !== 'passive') assert(knock5 === runs, `${p}: knock not in minute 5 in ${runs - knock5} runs`);
  }
  if (flag('table')) {
    const p = which === 'all' ? 'typical' : which;
    const r = simulate(p, Number(opt('seed', 3)), simOpts);
    console.log(`\n${p} seed ${r.seed}: act ${fmt(r.total)} (${r.total.toFixed(1)} s), cued ${r.cued}, CAM-03 alarms ${r.cam3Alarms}, sub-poses ${r.subCount}, max idle ${r.maxIdle.toFixed(1)} s (${r.maxIdleAt}), longest no-new-event ${r.maxGap.toFixed(1)} s ${r.maxGapAt}`);
    console.log('clock   start    dur   events');
    for (const mm of r.minutes) {
      const evs = r.log.filter((l) => l.minute === mm.m && !['figMove'].includes(l.kind))
        .map((l) => `${l.kind}${l.ch ? `:${l.ch}` : ''}${l.what ? `:${l.what}` : ''}${l.count ? `×${l.count}` : ''}@${(l.t - mm.t0).toFixed(1)}`);
      const figs = r.log.filter((l) => l.minute === mm.m && l.kind === 'figMove').map((l) => (l.sub ? `sub(${l.index})` : `→${l.index}`));
      console.log(`02:${String(mm.m).padStart(2, '0')}  ${mm.t0.toFixed(1).padStart(6)}  ${mm.dur.toFixed(1).padStart(5)}   ${evs.join(' ')}${figs.length ? `  fig ${figs.join(' ')}` : ''}`);
    }
    console.log(`end    ${r.total.toFixed(1).padStart(6)}`);
  }
  if (failures.length) {
    console.log(`\nFAIL (${failures.length})`);
    for (const f of failures.slice(0, 40)) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log('\nall assertions passed');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
