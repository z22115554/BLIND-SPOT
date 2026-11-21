// =============================================================================
// monitoringDirector.js — 第一幕監看（02:00 → 02:14）的節奏導演（純邏輯、零 import）
// -----------------------------------------------------------------------------
// 規格：docs/pacing/spec.md §2（節拍表）、§3.2–3.6（規則）、§4（時間模型，常數全部在這裡）、§7.4（介面）。
//
// 它只做三件事：
//   1. 「輕量注意力時鐘」：非保護分鐘（02:10 / 02:11 / 02:12 永不縮短）在玩家已經沒事可做時提早翻分鐘
//      （最少 DWELL_MIN 秒；OSD 秒數在 RUSH 秒內跑到 :59 再翻，秒數永不倒退）。最長仍是 SPM 秒（＝今天的行為）。
//   2. 依 SCHEDULE 在「盲區」套用監視器微事件（頻道沒有被顯示時才換），並以 VMD（動態偵測）提示：
//      io.raise（琥珀燈＋OSD）、io.tone（輕柔提示音）、io.log（SYS LOG）。每分鐘最多一次、間隔 ≥ MIN_GAP。
//   3. CAM-03 的延遲動態警示（只回報，不推動人影）、02:05 的敲門、一次性的動態偵測提示。
//
// 介面（§7.4，凍結）：
//   new MonitoringDirector({ sense, io, pace = PACE, schedule = SCHEDULE, rng, spm, early = true, lockGate = true })
//   onMinute(m, now) / onBeatDone(m, now) / canFlip(now) → bool / tick(dt, now)
//   onFigureMoved({ index, sub }, now) / onAlertAck({ channel }, now) / fastForward(start)
//   fire(id) / forceFlip() / dump() / get trace
// sense() → { held, inspectOpen, ventStopped, clockText, channel, shownChannel, observed(n), unobserved3,
//             seenSinceMove, anyAlert, alerted(n), playerDoorDist, atDesk }
//   atDesk：玩家坐著或站在座位旁（CAM-03 顯示中、玩家只是低頭按按鈕時，人影的變化就在畫面上，不另外發 CAM-03 警示）
// io      → apply(ch, stage, { force }) → bool, freeze(ch, { force }), raise(ch, { stamp }) → stamp, clockStamp(),
//           firstStamp(), tone(ch), knock(count, amp), knocked(), log(kind, { ch, hhmm }), minuteK(k), hint(), trace(entry)
//   io.log 的 kind：'motion' | 'knock' | 'lock' | 'vent'（後兩者只在 fastForward 補寫 SYS LOG 時使用）。
// 所有 io 方法都可以缺席（以可選呼叫處理）；io.apply 回傳 false 代表被 CameraFeeds 的防呆拒絕 → 稍後重試。
// 這個檔案不得 import 任何東西（scripts/pacing-sim.mjs 在 node 裡直接使用它）。
// =============================================================================

export const PACE = {
  SPM: 17,          // = CLOCK.secondsPerMinute = DWELL_MAX（ctor 的 spm 可覆寫；?spm=N）
  DWELL_MIN: 9,     // 最早翻分鐘：自該分鐘 beatDoneAt 起算（非保護分鐘）。final 修正：11 → 9（spec 的「還嫌慢」旋鈕；
                    // 把按 CAM 鈕時低頭看控制台算進去後，11 / 3.5 的一般玩家這一幕和 ?pace=0 幾乎一樣長）
  DWELL0: 3,        // 02:00 上鎖閘門完成後最早翻分鐘（OSD 秒數通常早已停在 :59；不受 POST_HOLD 限制，m4a 仍受）
  CALM: 3,          // 距離上一個 mark 至少這麼多秒才可以提早翻（final 修正：3.5 → 3）
  RUSH: 1.0,        // 提早翻：OSD 秒數在這段時間內跑到 :59，然後翻
  RUSH_IN_DWELL: true, // true：衝刺可在 DWELL_MIN − RUSH 開始，翻分鐘最早正好落在 DWELL_MIN（＝「最早 11 秒翻」）；
                       // false：照 §4 偽碼字面，DWELL_MIN 之後才開始衝刺（最早 DWELL_MIN + RUSH 才翻，典型玩家約 +4 秒）
  LEAD: 1.5,        // 分鐘事件在翻分鐘後 LEAD 秒才可觸發
  POST_HOLD: 6,     // 任何 hold 結束後（上鎖、響鈴、通話、通風故障、重啟中）以及閘門完成後的緩衝
  MIN_GAP: 11,      // 兩個有提示（cued）事件之間的最短間隔
  ACK: 1.0,         // （CameraFeeds）注視多久算「已查看」
  REMIND: 12,       // 未查看的 cued 警示：12 秒後補一次提示音（只一次）
  HINT_AFTER: 20,   // 第一次警示 20 秒未查看 → 一次性提示
  CAM3_LAT: [3, 6], // CAM-03 動態警示的延遲（均勻分布）
  LATE: 2,          // 延後 ≥ 2 分鐘的事件改為無提示套用
  BASELINE: 1.5,    // needsBaseline：該頻道之前至少被看過 1.5 秒，否則無提示套用
  PROTECTED: [10, 11, 12],
  GATES: [0, 3, 5, 8, 13],   // 會等待玩家的分鐘（02:00 上鎖閘門可關閉：lockGate = false）
  KNOCK: { after: 3, watch: 1.0, force: 13, giveUp: 16.5, minDoorDist: 2.5, second: 2.4, logDelay: 1.0 },
};

// 人影推進上下限（各閘門分鐘之後的 {min,max}；與改版前完全相同 — MonitoringState 與 pacing-sim 共用這一份）。
export const GATE_LIMITS = { 0: [0, 2], 3: [1, 3], 5: [2, 4], 8: [4, 5], 12: [5, 6] };

// 分鐘錨定的微事件表。anchor：'flip' = 翻分鐘後 lead（預設 LEAD）秒；'post' = 該分鐘閘門完成後 POST_HOLD 秒。
// stage 是 CameraFeeds.setAnomalyStage 的絕對階段；kind 'freeze' = CAM-04 時間停在 02:14:08；'knock' 另外處理。
export const SCHEDULE = [
  { id: 'm4a', m: 1, ch: 4, stage: 0, cue: true, stamp: 'first', anchor: 'flip', tier: 0 },
  { id: 'm1b', m: 2, ch: 1, stage: 1, cue: true, anchor: 'flip', tier: 0 },
  { id: 'm4b', m: 3, ch: 4, stage: 1, cue: true, anchor: 'post', needsBaseline: true, tier: 0 },
  { id: 'knock', m: 5, kind: 'knock', anchor: 'beat', tier: 0 },
  { id: 'm2b', m: 6, ch: 2, stage: 1, cue: true, anchor: 'flip', tier: 0 },
  { id: 'm4c', m: 7, ch: 4, stage: 2, cue: true, anchor: 'flip', needsBaseline: true, tier: 1 },
  { id: 'm2c', m: 8, ch: 2, stage: 2, cue: true, anchor: 'post', tier: 1 },
  { id: 'm1c', m: 9, ch: 1, stage: 2, cue: true, anchor: 'flip', tier: 1 },
  { id: 'm4d', m: 10, ch: 4, kind: 'freeze', cue: false, anchor: 'flip', tier: 1 },
  { id: 'm3a', m: 10, ch: 3, stage: 1, cue: false, anchor: 'flip', lead: 4, tier: 2 },
  { id: 'm2d', m: 11, ch: 2, stage: 3, cue: true, anchor: 'flip', tier: 0 },
  { id: 'm2e', m: 12, ch: 2, stage: 4, cue: false, anchor: 'flip', lead: 6, tier: 2 },
];

/** 可重現的亂數（mulberry32）。 */
export function mulberry32(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth01 = (x) => { const k = x < 0 ? 0 : x > 1 ? 1 : x; return k * k * (3 - 2 * k); };
const pad2 = (n) => String(n).padStart(2, '0');
/** 分鐘序號 → 'HH:MM'（第一幕從 02:00 開始）。 */
export const hhmmOf = (m) => `02:${pad2(m)}`;

export class MonitoringDirector {
  constructor({ sense, io, pace = PACE, schedule = SCHEDULE, rng, spm, early = true, lockGate = true, maxTier = 2 } = {}) {
    this.sense = typeof sense === 'function' ? sense : () => ({});
    this.io = io || {};
    const SPM = Number.isFinite(spm) && spm > 0 ? spm : pace.SPM;
    // ?spm=N：SPM = N，DWELL_MIN 依 N/17 等比例縮放
    this.P = { ...pace, SPM, DWELL_MIN: pace.DWELL_MIN * (SPM / pace.SPM), KNOCK: { ...pace.KNOCK } };
    this.protectedMinutes = new Set(pace.PROTECTED);
    this.gates = new Set((pace.GATES || []).filter((m) => lockGate || m !== 0));
    this.schedule = schedule.filter((e) => (e.tier ?? 0) <= maxTier);
    this.rng = typeof rng === 'function' ? rng : mulberry32(1);
    this.early = !!early;

    this.now = 0;
    this.minute = -1;
    this.minuteT0 = 0;
    this.beatDoneAt = null;
    this.rushT0 = null;
    this.k0 = 0;
    this.k = 0;
    this.lastMark = -Infinity;
    this.lastCueAt = -Infinity;
    this.holdUntil = -Infinity;
    this._held = false;
    this._forceFlip = false;
    this.fired = new Set();
    this.seen = { 1: 0, 2: 0, 3: 0, 4: 0 };   // 各頻道被注視的累計秒數（needsBaseline）
    this.obs3 = 0;                             // CAM-03 連續被注視秒數（敲門）
    this._seenSinceMove = false;
    this.cam3 = null;                          // { due, stamp } 待發的 CAM-03 動態警示
    this.reminders = new Map();                // ch → 補一次提示音的時間
    this.firstAlert = null;
    this.hintDone = false;
    this.knock = { state: 'idle', t0: null, at: null, step: 0, hhmm: null };
    this.cues = 0;
    this.cam3Alarms = 0;
    this._cam3LogHHMM = null;
    this._trace = [];
  }

  get trace() { return this._trace; }

  // ---------------------------------------------------------------------------
  // 分鐘迴圈（MonitoringState.run）
  // ---------------------------------------------------------------------------
  /** 翻到第 m 分鐘（setMinute 之後立刻呼叫）。 */
  onMinute(m, now) {
    this.now = now;
    const prev = this.minute;
    const entry = { m, prev, dur: prev >= 0 ? now - this.minuteT0 : null, early: this.rushT0 != null, pend: prev >= 0 ? this._pendingIds(prev) : [], cues: this.cues };
    this.minute = m;
    this.minuteT0 = now;
    this.beatDoneAt = null;
    this.rushT0 = null;
    this.k0 = 0;
    this.k = 0;
    this._forceFlip = false;
    this._mark(now);
    this.io.minuteK?.(0);
    this._t('flip', entry);
  }

  /** 第 m 分鐘的節拍（閘門）完成。 */
  onBeatDone(m, now) {
    this.now = now;
    this.beatDoneAt = now;
    const gate = this.gates.has(m);
    if (gate) this.holdUntil = Math.max(this.holdUntil, now + this.P.POST_HOLD);
    if (m === 5 && this.knock.state === 'idle') { this.knock.state = 'armed'; this.knock.t0 = now; }
    this._mark(now);
    this._t('beat', { m, gate, wait: now - this.minuteT0 });
  }

  /** 每幀由 MonitoringState.run 的 until() 輪詢：這一分鐘可以翻了嗎？ */
  canFlip(now) {
    this.now = now;
    if (this.beatDoneAt == null) return false;            // 閘門還在進行
    if (this._forceFlip) return true;
    const P = this.P;
    const e = now - this.beatDoneAt;
    if (e >= P.SPM) return true;                          // 最長 = 今天的行為
    if (this.rushT0 != null) return now - this.rushT0 >= P.RUSH;
    if (!this.early || this.protectedMinutes.has(this.minute) || this.minute >= 13) return false;
    // 02:00（上鎖閘門）：鎖好之後很快就翻到 02:01（玩家已經在這一分鐘裡走過去上鎖；OSD 秒數多半早已停在 :59）
    const m0 = this.minute === 0 && this.gates.has(0);
    if (e < (m0 ? P.DWELL0 : P.DWELL_MIN) - (P.RUSH_IN_DWELL ? P.RUSH : 0)) return false;
    const s = this.sense();
    // CAM-03 的警示只是回報（不需要玩家處理）：不擋提早翻分鐘
    const anyCue = typeof s.alerted === 'function' ? !!(s.alerted(1) || s.alerted(2) || s.alerted(4)) : !!s.anyAlert;
    if (s.held || s.inspectOpen || (!m0 && now < this.holdUntil) || anyCue) return false;
    if (now - this.lastMark < P.CALM) return false;
    if (this._minutePending(s)) return false;
    this.rushT0 = now;
    this.k0 = this.k;
    this._t('rush', { e });
    return false;
  }

  /** 每幀（MonitoringState.tick）。 */
  tick(dt, now) {
    this.now = now;
    const s = this.sense(), P = this.P;
    for (let n = 1; n <= 4; n++) if (s.observed?.(n)) this.seen[n] += dt;
    this.obs3 = s.observed?.(3) ? this.obs3 + dt : 0;
    // 人影推進後第一次被看見（只記錄，給 ?pacelog / 量測用）
    const ssm = !!s.seenSinceMove;
    if (ssm && !this._seenSinceMove) this._t('seenMove', { ch: 3 });
    this._seenSinceMove = ssm;
    // hold → 非 hold 的邊緣：POST_HOLD 緩衝
    if (this._held && !s.held) this.holdUntil = Math.max(this.holdUntil, now + P.POST_HOLD);
    this._held = !!s.held;
    // OSD 秒數（單調、≤ 0.999、翻分鐘時歸零）
    if (this.minute >= 0) {
      let k = Math.min(0.999, (now - this.minuteT0) / P.SPM);
      if (this.rushT0 != null) k = this.k0 + (0.999 - this.k0) * smooth01((now - this.rushT0) / P.RUSH);
      k = Math.max(this.k, Math.min(0.999, k));
      this.k = k;
      this.io.minuteK?.(k);
    }
    this._tickCam3(s, now);
    this._tickReminders(s, now);
    this._tickHint(s, now);
    this._tickKnock(s, now);
    this._tickFire(s, now);
  }

  // ---------------------------------------------------------------------------
  // 事件回呼
  // ---------------------------------------------------------------------------
  /** feeds:figureMoved { index, sub }：記一個 mark，並（若 CAM-03 沒被看著）排一個 3–6 秒後的 CAM-03 警示。 */
  onFigureMoved({ index, sub = false } = {}, now = this.now) {
    this.now = now;
    this._mark(now);
    this._t('figure', { ch: 3, index, sub: !!sub });
    const s = this.sense();
    if (s.observed?.(3) || s.ventStopped) return;
    // CAM-03 正顯示在主螢幕、玩家人在座位（只是低頭按 CAM 按鈕、看一眼時鐘或側螢幕）：變化就在畫面上等他回來看，
    // 不另外發警示（否則每次查看別的頻道之後幾秒都會固定跳出「▲ CAM-03」，變成機械式的規律）
    if (this._shown(s, 3) && s.atDesk !== false) { this._t('cam3Skip', { ch: 3, reason: 'onScreen' }); return; }
    const [a, b] = this.P.CAM3_LAT;
    this.cam3 = { due: now + a + (b - a) * this.rng(), stamp: this.io.clockStamp?.() ?? null, index, sub: !!sub };
  }

  /** feeds:alertAck { channel } */
  onAlertAck({ channel } = {}, now = this.now) {
    this.now = now;
    this._mark(now);
    this.reminders.delete(channel);
    if (this.firstAlert && this.firstAlert.ch === channel) this.hintDone = true;
    this._t('ack', { ch: channel });
  }

  /**
   * ?clock= 直接從第 start 分鐘開始：之前的所有階段強制套用（畫面此時全黑）、不發警示/聲音，
   * 補寫這一輪本來會產生的 SYS LOG 行。
   */
  fastForward(start) {
    const io = this.io;
    if (!(start > 0)) return;
    if (this.gates.has(0)) io.log?.('lock', { hhmm: hhmmOf(0) });
    for (const ev of this.schedule) {
      if (ev.m >= start || ev.kind === 'knock') continue;
      if (ev.kind === 'freeze') io.freeze?.(ev.ch, { force: true });
      else io.apply?.(ev.ch, ev.stage, { force: true });
      this.fired.add(ev.id);
      if (ev.cue) {
        const hhmm = ev.stamp === 'first' ? String(io.firstStamp?.() ?? '01:58').slice(0, 5) : hhmmOf(ev.m);
        io.log?.('motion', { ch: ev.ch, hhmm });
      }
    }
    if (start > 5) {
      io.log?.('vent', { hhmm: hhmmOf(5) });
      io.log?.('knock', { hhmm: hhmmOf(5) });
      io.knocked?.();
      this.knock.state = 'done';
    }
    // 跳關時視為玩家已經看過各頻道（否則之後 needsBaseline 的事件都會變成無提示）
    for (const n of [1, 2, 4]) this.seen[n] = Math.max(this.seen[n], this.P.BASELINE);
    this._t('fastForward', { m: start, fired: [...this.fired] });
  }

  // ---------------------------------------------------------------------------
  // 除錯
  // ---------------------------------------------------------------------------
  /** 立刻觸發某個排程事件（仍受 CameraFeeds 的盲區防呆約束）。回傳是否成功。 */
  fire(id) {
    const now = this.now;
    if (id === 'knock') {
      if (this.knock.state === 'playing' || this.knock.state === 'done') return false;
      this._startKnock(this.sense(), now, true);
      return true;
    }
    const ev = this.schedule.find((e) => e.id === id);
    if (!ev) return false;
    const s = this.sense();
    const ok = ev.kind === 'freeze' ? this.io.freeze?.(ev.ch, {}) : this.io.apply?.(ev.ch, ev.stage, {});
    if (ok === false) { this._t('refused', { id, ch: ev.ch, debug: true }); return false; }
    this.fired.add(ev.id);
    this._t('apply', { id, ch: ev.ch, stage: ev.stage, cue: !!ev.cue, debug: true, channel: s.channel, shown: s.shownChannel });
    if (ev.cue) this._raise(ev, s, now);
    return true;
  }
  /** 下一次 canFlip 立刻回傳 true（閘門進行中無效）。 */
  forceFlip() { this._forceFlip = true; }
  dump() {
    const s = this.sense(), now = this.now;
    const next = this.schedule.find((e) => !this.fired.has(e.id) && e.kind !== 'knock');
    return {
      minute: this.minute,
      e: this.beatDoneAt == null ? null : +(now - this.beatDoneAt).toFixed(2),
      k: +this.k.toFixed(3),
      rush: this.rushT0 != null,
      held: !!s.held,
      holdUntil: this.holdUntil,
      lastMark: this.lastMark,
      lastCueAt: this.lastCueAt,
      next: next ? next.id : null,
      fired: [...this.fired],
      alerts: [1, 2, 3, 4].filter((n) => s.alerted?.(n)),
      knock: this.knock.state,
      cues: this.cues,
      cam3Alarms: this.cam3Alarms,
      seen: { ...this.seen },
      now,
    };
  }

  // ---------------------------------------------------------------------------
  // 內部
  // ---------------------------------------------------------------------------
  _mark(now) { this.lastMark = now; }

  _t(kind, extra = {}) {
    const entry = { t: +this.now.toFixed(3), minute: this.minute, kind, ...extra };
    this._trace.push(entry);
    try { this.io.trace?.(entry); } catch (e) { /* 追蹤失敗不得影響劇情 */ }
    return entry;
  }

  _shown(s, ch) { return s.channel === ch || s.shownChannel === ch; }

  /** 這個事件現在是否因為「頻道正被顯示/注視」而延後。 */
  _deferredByView(s, ev) {
    if (ev.ch === 3) return !!s.observed?.(3) || !((s.unobserved3 ?? 0) >= 0.5);
    return this._shown(s, ev.ch);
  }

  _eligible(ev, now) {
    if (ev.m < this.minute) return true;
    if (ev.m > this.minute) return false;
    if (ev.anchor === 'post') return this.beatDoneAt != null && now >= this.beatDoneAt + this.P.POST_HOLD;
    return now >= this.minuteT0 + (ev.lead ?? this.P.LEAD);
  }

  _pendingIds(minute) {
    return this.schedule.filter((e) => e.kind !== 'knock' && e.m <= minute && !this.fired.has(e.id)).map((e) => e.id);
  }

  /** 這一分鐘還有該發生的事：未觸發且不是因為頻道正被顯示而延後的事件；或 02:05 的敲門還沒結束。 */
  _minutePending(s) {
    for (const ev of this.schedule) {
      if (ev.kind === 'knock' || ev.m > this.minute || this.fired.has(ev.id)) continue;
      if (this._deferredByView(s, ev)) continue;
      return true;
    }
    const kn = this.knock.state;
    if (kn === 'armed' || kn === 'playing') return true;
    if (this.minute === 5 && kn === 'idle' && this.gates.has(5)) return true;
    return false;
  }

  _tickFire(s, now) {
    if (this.minute < 0) return;
    if (s.held || s.inspectOpen || now < this.holdUntil) return;
    const P = this.P;
    const blocked = new Set();      // 同一頻道的事件保持順序
    for (const ev of this.schedule) {
      if (ev.kind === 'knock' || this.fired.has(ev.id)) continue;
      if (!this._eligible(ev, now)) continue;
      if (blocked.has(ev.ch)) continue;
      if (this._deferredByView(s, ev)) { blocked.add(ev.ch); continue; }
      const late = this.minute - ev.m >= P.LATE;
      const cue = !!ev.cue && !late && !s.ventStopped && (!ev.needsBaseline || this.seen[ev.ch] >= P.BASELINE);
      if (cue && now - this.lastCueAt < P.MIN_GAP) break;      // 保持順序：這一幀不再觸發
      let ok;
      try {
        ok = ev.kind === 'freeze' ? this.io.freeze?.(ev.ch, {}) : this.io.apply?.(ev.ch, ev.stage, {});
      } catch (e) { ok = true; }
      if (ok === false) { blocked.add(ev.ch); this._t('refused', { id: ev.id, ch: ev.ch }); continue; }
      this.fired.add(ev.id);
      this._t('apply', { id: ev.id, ch: ev.ch, stage: ev.stage, cue, late, channel: s.channel, shown: s.shownChannel });
      if (cue) this._raise(ev, s, now);
      break;                                                   // 每幀最多觸發一個
    }
  }

  _raise(ev, s, now) {
    const io = this.io;
    const stamp0 = ev.stamp === 'first' ? io.firstStamp?.() : io.clockStamp?.();
    const r = io.raise?.(ev.ch, { stamp: stamp0 });
    const stamp = r ?? stamp0 ?? `${s.clockText || hhmmOf(Math.max(0, this.minute))}:00`;
    io.tone?.(ev.ch);
    io.log?.('motion', { ch: ev.ch, hhmm: String(stamp).slice(0, 5) });
    this.lastCueAt = now;
    this.cues++;
    this._mark(now);
    this.reminders.set(ev.ch, now + this.P.REMIND);
    if (!this.firstAlert) this.firstAlert = { ch: ev.ch, t: now };
    this._t('alert', { id: ev.id, ch: ev.ch, cue: true, stamp });
  }

  _tickCam3(s, now) {
    const c = this.cam3;
    if (!c || now < c.due) return;
    this.cam3 = null;
    let reason = null;
    if (s.seenSinceMove || s.observed?.(3)) reason = 'seen';
    else if (s.held || now < this.holdUntil) reason = 'held';
    else if (s.ventStopped) reason = 'vacuum';
    if (reason) { this._t('cam3Cancel', { ch: 3, reason }); return; }
    const r = this.io.raise?.(3, { stamp: c.stamp });
    const stamp = r ?? c.stamp ?? `${s.clockText}:00`;
    this.cam3Alarms++;
    const hhmm = String(stamp).slice(0, 5);
    if (this._cam3LogHHMM !== hhmm) {        // CAM-03：每個時鐘分鐘最多一行
      this._cam3LogHHMM = hhmm;
      this.io.log?.('motion', { ch: 3, hhmm });
    }
    this._mark(now);
    this._t('alert', { id: 'cam3', ch: 3, cue: false, stamp });
  }

  _tickReminders(s, now) {
    if (!this.reminders.size) return;
    for (const [ch, due] of [...this.reminders]) {
      if (now < due) continue;
      if (s.held || s.inspectOpen || now < this.holdUntil) continue;    // 響鈴/通話中不響，之後再補
      this.reminders.delete(ch);
      if (s.alerted?.(ch) && !s.observed?.(ch) && !s.ventStopped) {
        this.io.tone?.(ch);
        this._t('remind', { ch });
      }
    }
  }

  _tickHint(s, now) {
    if (this.hintDone || !this.firstAlert) return;
    if (now - this.firstAlert.t < this.P.HINT_AFTER) return;
    if (s.held || s.inspectOpen) return;
    this.hintDone = true;
    if (s.alerted?.(this.firstAlert.ch)) { this.io.hint?.(); this._t('hint', { ch: this.firstAlert.ch }); }
  }

  _startKnock(s, now, forced) {
    const kn = this.knock;
    kn.state = 'playing'; kn.at = now; kn.step = 1; kn.hhmm = s.clockText || hhmmOf(5);
    this.io.knock?.(3, 1);
    this._mark(now);
    this._t('knock', { count: 3, forced: !!forced, dist: s.playerDoorDist });
  }

  _tickKnock(s, now) {
    const K = this.P.KNOCK, kn = this.knock;
    if (kn.state === 'armed') {
      const e = now - kn.t0;
      if (e > K.giveUp) { kn.state = 'skipped'; this._t('knockSkip', {}); return; }
      if (e < K.after || s.held || s.inspectOpen) return;
      if (!((s.playerDoorDist ?? Infinity) >= K.minDoorDist)) return;
      if (!(this.obs3 >= K.watch || e >= K.force)) return;
      this._startKnock(s, now, this.obs3 < K.watch);
    } else if (kn.state === 'playing') {
      if (kn.step === 1 && now >= kn.at + K.second) {
        // 檢視／hold 中不敲（§3.6、§8）：最多延後 1 秒，之後就略過第二組
        const busy = s.held || s.inspectOpen;
        if (busy && now < kn.at + K.second + 1.0) return;
        kn.step = 2;
        if (busy) { this._t('knockQuiet', { reason: s.held ? 'held' : 'inspect' }); return; }
        // 玩家已經走到門邊就不再敲（絕不在 2.5 m 內出聲）
        if ((s.playerDoorDist ?? Infinity) >= K.minDoorDist) {
          this.io.knock?.(2, 0.8);
          this._mark(now);
          this._t('knock', { count: 2, dist: s.playerDoorDist });
        } else this._t('knockQuiet', { dist: s.playerDoorDist });
      } else if (kn.step === 2 && now >= kn.at + K.second + K.logDelay) {
        kn.state = 'done';
        this.io.log?.('knock', { hhmm: kn.hhmm });
        this.io.knocked?.();
        this._t('knockLog', { hhmm: kn.hhmm });
      }
    }
  }
}
