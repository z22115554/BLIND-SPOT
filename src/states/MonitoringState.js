// =============================================================================
// MonitoringState — 02:00 → 02:14 監看
// 時鐘：「輕量注意力時鐘」（docs/pacing/spec.md §4）。每一分鐘的節拍（閘門）完成後，最長 CLOCK.secondsPerMinute（17）
// 遊戲秒翻下一分鐘；非保護分鐘在玩家已經沒事可做時可提早翻（最少 11 秒；02:10 / 02:11 / 02:12 永不縮短）。
// 閘門分鐘時鐘停住直到事件完成（冒號照常閃）。節奏與監視器微事件由 monitoringDirector.js（純邏輯）決定。
//
// | 時間  | 事件                                                     | 完成條件                   | figure {min,max} 之後 |
// | 02:00 | 上鎖閘門：防爆門「未鎖定」，玩家親手轉氣壓閥手輪上鎖     | 上鎖完成（?lock=0 無此閘門）| {0,2} |
// | 02:01 | CAM-04 動態偵測（畫面沒變；偵測時間 01:58:41）           | –                          | –     |
// | 02:02 | CAM-01 車道號誌 ✕／隧道封閉                              | –                          | –     |
// | 02:03 | 對講機 1 響（stage 0）；之後 CAM-04 車門關上、車頂燈熄   | 接聽並播完                 | {1,3} |
// | 02:05 | 通風轉速異常 → 拉桿；之後防爆門傳來悶悶的敲門聲          | 拉下通風拉桿               | {2,4} |
// | 02:06 | CAM-02 遠處拱頂下的黑煙帶                                | –                          | –     |
// | 02:07 | CAM-04 牆上焦痕＋三角錐                                  | –                          | –     |
// | 02:08 | 對講機 2 響（stage 1，金屬敲擊）；之後 CAM-02 遠燈熄、殘骸剪影 | 接聽並播完            | {4,5} |
// | 02:09 | CAM-01 霧轉為煙、兩盞琥珀燈                              | –                          | –     |
// | 02:10 | 通風開始衰弱（40 秒內音高下滑）；CAM-04 時間停在 02:14:08（無提示） | 自動（保護分鐘）  | –     |
// | 02:11 | CAM-02 煙帶往北推進                                      | 自動（保護分鐘）           | –     |
// | 02:12 | 通風停止 → 聽覺真空、心跳出現；不再有任何提示            | 自動（保護分鐘）           | {5,6} |
// | 02:13 | 對講機 3 響（stage 2）                                   | 響起 {6,7}；接聽中 min = 7 | 播完 → BLACKOUT_CORRIDOR |
//
// 監視器微事件只在「該頻道沒有被顯示」時套用（導演＋CameraFeeds 的防呆），並以 VMD（動態偵測）提示：
// CAM 按鈕琥珀燈、輕柔提示音、OSD 標籤、SYS LOG 行。CAM-03 的人影規則（先看見再移開才會動）不變。
//
// 除錯：?clock=02:08 從該分鐘開始（之前的節拍效果與微事件瞬間套用）；?pace=0 改版前；?lock=0 無上鎖閘門；
//       ?subposes=0；?spm=N；?seed=N；?pacelog=1（每次翻分鐘一行 [pace]，停電時印摘要表）。
//       ?debug=1 時 BS.director = 導演（dump() / fire(id) / forceFlip() / trace），window.__paceLog = 事件紀錄。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import { clamp, lerp } from '../core/util.js';
import {
  StoryState, T, AMB, applyPreset, setClock, clockAt, minuteOf, setLeftLog, setRight, setObjective, setLimits,
  ringIntercom, playIntercom, points, paceFlags, pushLog, lockBlastDoorNow,
} from './common.js';
import { MonitoringDirector, GATE_LIMITS, mulberry32 } from './monitoringDirector.js';

const VENT_DYING_SECONDS = 40;
const LOCK_DUR = 2.4;        // cr.setBlastLocked：手輪 2.5 圈（0.7 × 2.4 ≈ 1.7 s）→ 鎖栓入位（0.7 s）
const LOCK_BOLTS_AT = 1.7;   // 鎖栓開始入位：unlatch ＋ pneumaticHiss
const PACE_LOG_KINDS = new Set(['alert', 'gate', 'knock', 'ventDying', 'vacuum', 'seenMove', 'callStart']);

export class MonitoringState extends StoryState {
  async enter(data = {}) {
    const ctx = this.ctx;
    const pf = (this.pf = paceFlags(ctx));
    const direct = this.isDirect(data, STATES.PROLOGUE);
    let start = 0;
    this._dying = null;
    this._hbIdx = -1;
    this._dirErr = false;
    this._minutes = [];
    this._actT0 = ctx.clock.time;
    this.director = null;
    if (ctx.debug || pf.log) globalThis.__paceLog = [];   // 每一幕（每一輪）重新開始記錄
    if (direct) {
      applyPreset(ctx, STATES.MONITORING);
      const q = ctx.params?.get?.('clock');
      if (q && /^\d\d:\d\d$/.test(q)) start = clamp(minuteOf(q), 0, 13);
    }
    if (ctx.feeds) ctx.feeds.subPoses = pf.subposes;
    if (pf.pace) this.director = this.makeDirector();
    if (direct) {
      if (start > 0) this.applySkipped(start);
      this.fadeTo(0, 1.6);
    } else this.ensureVisible();
    if (ctx.debug && this.director) ctx.director = this.director;
    ctx.player.enabled = true;
    setObjective(ctx, 'monitor');
    this.on('vent:restart', () => this.onVentRestart());
    this.on('blastDoor:lock', () => this.onLock());
    this.on('feeds:figureMoved', (p) => this.director?.onFigureMoved(p || {}, ctx.clock.time));
    this.on('feeds:alertAck', (p) => this.director?.onAlertAck(p || {}, ctx.clock.time));
    await this.run(start);
  }

  // ---------------------------------------------------------------------------
  async run(start) {
    const ctx = this.ctx;
    const spm = this.pf.spm ?? ctx.CLOCK.secondsPerMinute;
    for (let m = start; m <= 13; m++) {
      if (m > start) await (this.director ? this.until(() => this.director?.canFlip(ctx.clock.time) ?? true) : this.wait(spm));
      this.setMinute(m);
      this.director?.onMinute(m, ctx.clock.time);
      await this.beat(m);
      this.director?.onBeatDone(m, ctx.clock.time);
    }
  }

  setMinute(m) {
    const text = clockAt(m);
    setClock(this.ctx, text);
    setLeftLog(this.ctx, text, m >= 12 ? 'warn' : 'normal');
  }

  async beat(m) {
    const ctx = this.ctx;
    switch (m) {
      case 0:
        this.limits(0);   // 先設上下限：第一次轉身就會讓人影走一步
        if (this.pf.lock && !ctx.flags.blastLocked) await this.lockGate();
        break;
      case 3: await this.intercomGate(0); this.limits(3); break;
      case 5: await this.ventGate(); this.limits(5); break;
      case 8: await this.intercomGate(1); this.limits(8); break;
      case 10: this.ventDying(); this.plog('ventDying'); break;
      case 12: this.ventStop(); this.limits(12); this.plog('vacuum'); break;
      case 13: {
        setLimits(ctx, 6, 7);
        ringIntercom(ctx, 'answer');
        this.plog('gate', { id: 'call3' });
        this.nag(() => ctx.flags.intercomRinging, ctx.SCRIPT.objectives.answer);
        await this.event('intercom:answer');
        this.plog('callStart', { id: 'call3' });
        // 接聽中：人影一定會在玩家背對螢幕時抵達防爆門前
        setLimits(ctx, 7, 7);
        setObjective(ctx, null);
        await playIntercom(this, 2, { hold: 1.0 });
        if (this.pf.log) this.printSummary();
        this.fsm.go(STATES.BLACKOUT_CORRIDOR, { natural: true });
        break;
      }
      default: break;
    }
  }

  limits(m) { const l = GATE_LIMITS[m]; if (l) setLimits(this.ctx, l[0], l[1]); }

  async intercomGate(stageIndex) {
    const ctx = this.ctx;
    ringIntercom(ctx, 'answer');
    this.plog('gate', { id: `call${stageIndex + 1}` });
    this.nag(() => ctx.flags.intercomRinging, ctx.SCRIPT.objectives.answer);
    await this.event('intercom:answer');
    this.plog('callStart', { id: `call${stageIndex + 1}` });
    setObjective(ctx, null);
    await playIntercom(this, stageIndex);
    setObjective(ctx, 'monitor');
  }

  // ---- 02:00 上鎖閘門（docs/pacing/spec.md §3.5） ------------------------------
  async lockGate() {
    const ctx = this.ctx, f = ctx.flags;
    f.lockPending = true;
    setObjective(ctx, 'lockDoor');
    this.plog('gate', { id: 'lock' });
    // nag() 只有一個 token：上鎖閘門結束前不會有其他 nag 開始
    this.nag(() => f.lockPending, ctx.SCRIPT.hints.lockDoor, 20, 30);
    await this.until(() => f.blastLocked);
    setObjective(ctx, 'monitor');
  }

  /** 'blastDoor:lock'（防爆門互動，只在 lockPending 時出現）：手輪轉 2.5 圈、鎖栓入位、門燈轉紅。 */
  async onLock() {
    const ctx = this.ctx, f = ctx.flags, a = ctx.audio, P = points(ctx);
    if (!f.lockPending || f.blastLocking || f.blastLocked) return;
    f.blastLocking = true;
    T(() => a?.sfx?.('lever', { position: P.blastDoor }));
    this.wait(LOCK_BOLTS_AT).then(() => {
      T(() => a?.sfx?.('unlatch', { position: P.blastDoor }));
      T(() => a?.sfx?.('pneumaticHiss', { position: P.blastDoor, gain: 0.5 }));
    });
    const anim = T(() => ctx.controlRoom?.setBlastLocked?.(true, { duration: LOCK_DUR }), 'setBlastLocked');
    await Promise.all([this.guard(Promise.resolve(anim)), this.wait(LOCK_DUR)]);
    f.blastLocked = true;
    f.lockPending = false;
    f.blastLocking = false;
    T(() => pushLog(ctx, ctx.SCRIPT.status.lockLog(f.clockText)), 'lockLog');
    setRight(ctx, 'normal', 'normal');
    setObjective(ctx, 'monitor');
  }

  // ---- 02:05 通風轉速異常 ----------------------------------------------------
  async ventGate() {
    const ctx = this.ctx;
    ctx.flags.ventFault = true;
    T(() => ctx.controlRoom.setVentLed('fault'));
    T(() => ctx.controlRoom.setVentGauge(null));
    T(() => ctx.audio?.setVent?.(AMB.ventFault, 3));
    setRight(ctx, 'ventFault', 'warn');
    setObjective(ctx, 'vent');
    this.plog('gate', { id: 'vent' });
    this.nag(() => ctx.flags.ventFault, ctx.SCRIPT.objectives.vent);
    await this.until(() => ctx.flags.ventCut && !ctx.flags.ventRestarting);
    setObjective(ctx, 'monitor');
  }

  async onVentRestart() {
    const ctx = this.ctx, a = ctx.audio, P = points(ctx);
    if (!ctx.flags.ventFault || ctx.flags.ventRestarting) return;
    ctx.flags.ventFault = false;
    ctx.flags.ventRestarting = true;
    T(() => a?.sfx?.('lever', { position: P.vent }));
    await this.guard(Promise.resolve(T(() => ctx.controlRoom.pullVentLever()) || null));
    ctx.flags.ventCut = true;
    // 【補充文案】SYS LOG：02:05 主排風 手動操作（第三幕揭露：其實是手動切斷）
    if (this.pf.pace) T(() => pushLog(ctx, ctx.SCRIPT.status.ventManualLog(ctx.flags.clockText)), 'ventManualLog');
    T(() => a?.sfx?.('fanSpinUp', { position: P.vent, gain: 0.8 }));
    T(() => a?.setVent?.(AMB.ventSick, 3.5));
    T(() => ctx.controlRoom.setVentLed('ok'));
    setRight(ctx, 'normal', 'normal');
    await this.wait(0.6);
    ctx.flags.ventRestarting = false;
  }

  // ---- 02:10 通風衰弱 / 02:12 停止 ------------------------------------------
  ventDying() {
    const ctx = this.ctx;
    ctx.flags.ventDying = true;
    this._dying = { t0: ctx.clock.time };
    T(() => ctx.audio?.setVent?.(AMB.ventDying, VENT_DYING_SECONDS));
    T(() => ctx.controlRoom.setVentLed('fault'));
    setRight(ctx, 'ventDying', 'warn');
  }

  ventStop() {
    const ctx = this.ctx, a = ctx.audio;
    ctx.flags.ventStopped = true;
    ctx.flags.ventDying = true;
    this._dying = null;
    // 40 秒的變調衰弱之後，最後是「突然」停下：0.6 秒內轉速掉光（短促的停機聲），0.8 秒內耳朵被抽成真空——
    // 環境音的消失要被感覺成一個洞，而不是慢慢淡掉（仍是平滑 ramp，沒有任何突發巨響）。
    T(() => a?.setVent?.({ level: 0, rate: AMB.ventDying.rate, detune: AMB.ventDying.detune }, 0.6));
    T(() => a?.sfx?.('fanSpinDown', { position: points(ctx).vent, gain: 0.6, duration: 0.7 }));
    T(() => ctx.controlRoom.setVentGauge(null));
    T(() => ctx.controlRoom.setVentLed('off'));
    // 聽覺真空 + 心跳出現
    T(() => a?.setSilence?.(0.6, 0.8));
    ctx.flags.heartbeat = true;
    this._hbIdx = -1;
    setRight(ctx, 'ventDying', 'warn');
  }

  /** 直接從某分鐘開始時，瞬間套用之前所有節拍的結果（防爆門已上鎖、微事件階段、SYS LOG）。 */
  applySkipped(start) {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom;
    let lim = GATE_LIMITS[0];
    for (const m of Object.keys(GATE_LIMITS).map(Number)) if (m < start) lim = GATE_LIMITS[m];
    setLimits(ctx, lim[0], lim[1]);
    T(() => ctx.feeds.setFigureIndex(lim[0]));
    if (this.pf.lock) {
      lockBlastDoorNow(ctx);
      setRight(ctx, 'normal', 'normal');
    }
    if (start > 5) {
      ctx.flags.ventCut = true;
      T(() => cr.setVentLever(true));
      T(() => a?.setVent?.(AMB.ventSick, 0.5));
    }
    if (start > 10) {
      ctx.flags.ventDying = true;
      T(() => a?.setVent?.(AMB.ventDying, 0.5));
      T(() => cr.setVentLed('fault'));
      T(() => cr.setVentGauge(0.22));
      setRight(ctx, 'ventDying', 'warn');
    }
    if (start > 12) {
      ctx.flags.ventStopped = true; ctx.flags.heartbeat = true;
      T(() => a?.setVent?.({ level: 0, rate: 0.5, detune: 0.6 }, 0.5));
      T(() => cr.setVentGauge(null));
      T(() => cr.setVentLed('off'));
      T(() => a?.setSilence?.(0.6, 0.5));
    }
    T(() => this.director?.fastForward(start), 'fastForward');
  }

  // ---------------------------------------------------------------------------
  // 導演（docs/pacing/spec.md §7.4）：sense() 讀世界、io 改世界
  // ---------------------------------------------------------------------------
  makeDirector() {
    const ctx = this.ctx, pf = this.pf;
    this.seed = pf.seed ?? ((Math.random() * 0x7fffffff) >>> 0);
    return new MonitoringDirector({
      sense: () => this.sense(),
      io: this.makeIO(),
      rng: mulberry32(this.seed),
      spm: pf.spm ?? ctx.CLOCK.secondsPerMinute,
      lockGate: pf.lock,
    });
  }

  sense() {
    const ctx = this.ctx, f = ctx.flags, fd = ctx.feeds, pos = ctx.player?.position, door = points(ctx).blastDoor;
    const observed = (n) => !!fd?.isChannelObserved?.(n);
    const alerted = (n) => !!fd?.isAlerted?.(n);
    return {
      held: !!(f.lockPending || f.blastLocking || f.intercomRinging || f.intercomTalking || f.ventFault || f.ventRestarting),
      inspectOpen: !!ctx.inspect?.isOpen,
      ventStopped: !!f.ventStopped,
      clockText: f.clockText,
      channel: fd?.channel,
      shownChannel: fd ? (fd.shownChannel ?? fd._shownChannel) : undefined,
      observed,
      unobserved3: fd?.unobservedTime ?? 0,
      seenSinceMove: !!fd?.seenSinceMove,
      anyAlert: alerted(1) || alerted(2) || alerted(3) || alerted(4),
      alerted,
      playerDoorDist: pos ? Math.hypot(pos.x - door.x, pos.z - door.z) : Infinity,
    };
  }

  makeIO() {
    const ctx = this.ctx, S = ctx.SCRIPT, St = S.status;
    const fd = () => ctx.feeds;
    const pad = (n) => String(n).padStart(2, '0');
    // CameraFeeds.clockStamp() 不存在時的備援：時鐘 + minuteK 秒數
    const stampNow = () => {
      const k = ctx.flags.minuteK;
      return `${ctx.flags.clockText}:${pad(Math.min(59, Math.floor(60 * (Number.isFinite(k) ? k : 0))))}`;
    };
    return {
      apply: (ch, stage, o = {}) => {
        const f = fd();
        if (typeof f?.setAnomalyStage !== 'function') return true;   // 尚無微事件階段（WP-A/B 未合併）：視為完成
        return T(() => f.setAnomalyStage(ch, stage, o), 'setAnomalyStage') !== false;
      },
      freeze: (ch) => { T(() => fd()?.setFrozenTime?.(ch, S.feedUI.frozenTime), 'setFrozenTime'); return true; },
      raise: (ch, { stamp } = {}) => T(() => fd()?.raiseAlert?.(ch, { stamp }), 'raiseAlert') ?? stamp,
      clockStamp: () => {
        const f = fd();
        return (typeof f?.clockStamp === 'function' ? T(() => f.clockStamp(), 'clockStamp') : null) || stampNow();
      },
      firstStamp: () => S.feedUI.firstStamp,
      tone: (ch) => {
        const p = points(ctx).camButtons?.[ch - 1];
        T(() => ctx.audio?.sfx?.('vmdTone', p ? { position: p } : {}), 'vmdTone');
      },
      knock: (count, amp) => T(() => ctx.audio?.sfx?.('doorKnock', { position: points(ctx).blastDoor, count, amp }), 'doorKnock'),
      knocked: () => { ctx.flags.doorKnocked = true; },
      log: (kind, { ch, hhmm } = {}) => {
        const t = hhmm || ctx.flags.clockText;
        let text = null;
        if (kind === 'motion') text = St.motionLog?.(t, ch);
        else if (kind === 'knock') text = St.knockLog?.(t);
        else if (kind === 'lock') text = St.lockLog?.(t);
        else if (kind === 'vent') text = St.ventManualLog?.(t);
        if (text) T(() => pushLog(ctx, text), 'pushLog');
      },
      minuteK: (k) => { ctx.flags.minuteK = k; },
      // 一次性（每一輪）提示；不用 nag()（nag 只有一個 token，會取消其他 nag）
      hint: () => {
        if (ctx.flags.motionHintShown) return;
        ctx.flags.motionHintShown = true;
        T(() => ctx.ui?.hint?.(S.hints.motion, 5), 'hint');
      },
      trace: (e) => this.onTrace(e),
    };
  }

  // ---- ?pacelog / window.__paceLog ------------------------------------------
  plog(kind, extra = {}) {
    const ctx = this.ctx;
    if (!(ctx.debug || this.pf.log)) return;
    const L = (globalThis.__paceLog = globalThis.__paceLog || []);
    L.push({ t: +ctx.clock.time.toFixed(3), minute: minuteOf(ctx.flags.clockText || '02:00'), kind, ...extra });
  }

  onTrace(e) {
    const ctx = this.ctx;
    if (ctx.debug || this.pf.log) (globalThis.__paceLog = globalThis.__paceLog || []).push({ ...e });
    if (e.kind === 'flip' && e.prev >= 0 && e.dur != null) {
      const row = { clock: clockAt(e.prev), start: +(e.t - e.dur - this._actT0).toFixed(1), dur: +e.dur.toFixed(1), early: !!e.early, pend: e.pend, cues: e.cues };
      this._minutes.push(row);
      if (this.pf.log) console.info(`[pace] ${row.clock} +${row.start}s dur=${row.dur}${row.early ? ' early' : ''} pend=[${(row.pend || []).join(',')}] cues=${row.cues}`);
    }
  }

  /** ?pacelog=1：停電前印出每分鐘表＋整幕摘要（可直接貼給 owner）。 */
  printSummary() {
    const ctx = this.ctx, d = this.director, now = ctx.clock.time;
    const last = d ? { clock: clockAt(d.minute), start: +(d.minuteT0 - this._actT0).toFixed(1), dur: +(now - d.minuteT0).toFixed(1), early: false, pend: [], cues: d.cues } : null;
    const rows = last ? [...this._minutes, last] : this._minutes;
    const log = (globalThis.__paceLog || []).filter((x) => x.t >= this._actT0 - 1e-6);
    for (const r of rows) {
      const m = minuteOf(r.clock);
      r.events = log.filter((x) => x.minute === m && PACE_LOG_KINDS.has(x.kind)).map((x) => `${x.kind}${x.ch ? `:${x.ch}` : ''}${x.id && x.kind !== 'alert' ? `:${x.id}` : ''}`).join(' ');
    }
    // 最長「沒有新的提示/事件」：[02:12 真空, 第三通來電] 之間另計
    const stim = log.filter((x) => PACE_LOG_KINDS.has(x.kind)).map((x) => ({ t: x.t, kind: x.kind }));
    const vac = (stim.find((x) => x.kind === 'vacuum') || {}).t ?? Infinity;
    const call3 = (log.filter((x) => x.kind === 'callStart').pop() || {}).t ?? Infinity;
    let prev = this._actT0, maxGap = 0, maxAll = 0, at = '';
    for (const s of [...stim, { t: now, kind: 'end' }]) {
      const g = s.t - prev;
      maxAll = Math.max(maxAll, g);
      if (!(prev >= vac - 1e-6 && s.t <= call3 + 1e-6) && g > maxGap) { maxGap = g; at = `${(prev - this._actT0).toFixed(1)}→${(s.t - this._actT0).toFixed(1)}s`; }
      prev = s.t;
    }
    const act = now - this._actT0;
    try { console.table(rows.map(({ clock, start, dur, early, cues, events }) => ({ clock, start, dur, early, cues, events }))); } catch (e) { /* console.table 不存在 */ }
    console.info(`[pace] summary: act ${Math.floor(act / 60)}:${String(Math.round(act % 60)).padStart(2, '0')} (${act.toFixed(1)} s) · cued alerts ${d?.cues ?? 0} · CAM-03 alarms ${d?.cam3Alarms ?? 0}` +
      ` · longest no-new-event ${maxGap.toFixed(1)} s (${at}; incl. vacuum ${maxAll.toFixed(1)} s) · figure ${ctx.feeds?.figureIndex} · seed ${this.seed}`);
  }

  // ---------------------------------------------------------------------------
  tick(dt, t) {
    const ctx = this.ctx;
    // 通風衰弱：轉速表在 40 秒內緩慢下滑
    if (this._dying && !ctx.flags.ventStopped) {
      const k = clamp((ctx.clock.time - this._dying.t0) / VENT_DYING_SECONDS);
      T(() => ctx.controlRoom.setVentGauge(lerp(0.5, 0.2, k)));
    }
    // 心跳（02:12 起）：人影越靠近，心跳越快、越重（非常細微）
    if (ctx.flags.heartbeat) {
      const idx = ctx.feeds?.figureIndex ?? 5;
      if (idx !== this._hbIdx) {
        const first = this._hbIdx < 0;
        this._hbIdx = idx;
        const d = Math.max(0, idx - 5);
        T(() => ctx.audio?.setHeartbeat?.(70 + 3 * d, 0.62 + 0.07 * d, first ? 5 : 3));
      }
    }
    // 節奏導演（只記錄第一次錯誤，不中斷劇情）
    if (this.director) {
      try { this.director.tick(dt, ctx.clock.time); } catch (e) {
        if (!this._dirErr) { this._dirErr = true; console.error('[monitoring] director tick failed', e); }
      }
    }
  }

  exit(to) {
    const ctx = this.ctx, f = ctx.flags;
    f.ventRestarting = false;
    f.lockPending = false;
    f.blastLocking = false;
    if (f.intercomRinging && to !== STATES.BLACKOUT_CORRIDOR) {
      f.intercomRinging = false;
      T(() => ctx.audio?.setIntercomRing?.(false));
      T(() => ctx.controlRoom?.setIntercomLed?.('off'));
    }
    if (ctx.director && ctx.director === this.director) delete ctx.director;
    this.director = null;
    f.minuteK = null;
    // 停電時 CameraFeeds 切到 STATIC 會自己清除警示；其他去處（除錯跳關）在這裡清
    if (to !== STATES.BLACKOUT_CORRIDOR) T(() => ctx.feeds?.clearAlerts?.(), 'clearAlerts');
  }
}
