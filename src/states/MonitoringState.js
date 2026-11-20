// =============================================================================
// MonitoringState — 02:00 → 02:14 監看
// 時鐘：每 CLOCK.secondsPerMinute 遊戲秒 +1 分；遇到「閘門」分鐘時停住直到事件完成（冒號照常閃）。
//
// | 時間  | 事件                                   | 完成條件                       | figure {min,max} 之後 |
// | 02:00 | 開始                                   | –                              | {0,2} |
// | 02:03 | 對講機 1 響（stage 0）                 | 接聽並播完                     | {1,3} |
// | 02:05 | 通風轉速異常（琥珀燈、白噪音變調）     | 拉下通風拉桿                   | {2,4} |
// | 02:08 | 對講機 2 響（stage 1，金屬敲擊）       | 接聽並播完                     | {4,5} |
// | 02:10 | 通風開始衰弱（40 秒內音高下滑）        | 自動                           | –     |
// | 02:12 | 通風停止 → 聽覺真空、心跳出現          | 自動                           | {5,6} |
// | 02:13 | 對講機 3 響（stage 2）                 | 響起 {6,7}；接聽中 min = 7     | 播完 → BLACKOUT_CORRIDOR |
//
// 除錯：直接進入時可加 ?clock=02:08，從該分鐘開始（之前的節拍效果瞬間套用）。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import { clamp, lerp } from '../core/util.js';
import {
  StoryState, T, AMB, applyPreset, setClock, clockAt, minuteOf, setLeftLog, setRight, setObjective, setLimits,
  ringIntercom, playIntercom, points,
} from './common.js';

const GATE_LIMITS = { 0: [0, 2], 3: [1, 3], 5: [2, 4], 8: [4, 5], 12: [5, 6] };
const VENT_DYING_SECONDS = 40;

export class MonitoringState extends StoryState {
  async enter(data = {}) {
    const ctx = this.ctx;
    const direct = this.isDirect(data, STATES.PROLOGUE);
    let start = 0;
    this._dying = null;
    this._hbIdx = -1;
    if (direct) {
      applyPreset(ctx, STATES.MONITORING);
      const q = ctx.params?.get?.('clock');
      if (q && /^\d\d:\d\d$/.test(q)) start = clamp(minuteOf(q), 0, 13);
      if (start > 0) this.applySkipped(start);
      this.fadeTo(0, 1.6);
    } else this.ensureVisible();
    ctx.player.enabled = true;
    setObjective(ctx, 'monitor');
    this.on('vent:restart', () => this.onVentRestart());
    await this.run(start);
  }

  // ---------------------------------------------------------------------------
  async run(start) {
    const spm = this.ctx.CLOCK.secondsPerMinute;
    for (let m = start; m <= 13; m++) {
      if (m > start) await this.wait(spm);
      this.setMinute(m);
      await this.beat(m);
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
      case 0: this.limits(0); break;
      case 3: await this.intercomGate(0); this.limits(3); break;
      case 5: await this.ventGate(); this.limits(5); break;
      case 8: await this.intercomGate(1); this.limits(8); break;
      case 10: this.ventDying(); break;
      case 12: this.ventStop(); this.limits(12); break;
      case 13: {
        setLimits(ctx, 6, 7);
        ringIntercom(ctx, 'answer');
        this.nag(() => ctx.flags.intercomRinging, ctx.SCRIPT.objectives.answer);
        await this.event('intercom:answer');
        // 接聽中：人影一定會在玩家背對螢幕時抵達防爆門前
        setLimits(ctx, 7, 7);
        setObjective(ctx, null);
        await playIntercom(this, 2, { hold: 1.0 });
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
    this.nag(() => ctx.flags.intercomRinging, ctx.SCRIPT.objectives.answer);
    await this.event('intercom:answer');
    setObjective(ctx, null);
    await playIntercom(this, stageIndex);
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

  /** 直接從某分鐘開始時，瞬間套用之前所有節拍的結果。 */
  applySkipped(start) {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom;
    let lim = GATE_LIMITS[0];
    for (const m of Object.keys(GATE_LIMITS).map(Number)) if (m < start) lim = GATE_LIMITS[m];
    setLimits(ctx, lim[0], lim[1]);
    T(() => ctx.feeds.setFigureIndex(lim[0]));
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
  }

  exit(to) {
    const ctx = this.ctx;
    ctx.flags.ventRestarting = false;
    if (ctx.flags.intercomRinging && to !== STATES.BLACKOUT_CORRIDOR) {
      ctx.flags.intercomRinging = false;
      T(() => ctx.audio?.setIntercomRing?.(false));
      T(() => ctx.controlRoom?.setIntercomLed?.('off'));
    }
  }
}
