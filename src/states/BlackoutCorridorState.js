// =============================================================================
// BlackoutCorridorState — 02:14 跳電 → 維修廊道 → 電閘室復電
// * 跳電：'relayTrip'；日光燈先因電壓下降變暗變黃，接著熄滅 → 紅色緊急照明（全程單調變暗，
//   每 0.25 秒亮度變化 < 30%）；所有監視器雪花、嗡鳴消失；時鐘 02:14；右螢幕「中段繼電器跳脫」。
// * 取下手電筒 → 手動解開側門（player.setPortal('sideDoor', true)）→ 進入廊道：
//   霧加濃（updateAtmosphere）、腳步延遲回音 0.45 秒（停下時多一步）、廊道環境音、遠處隆隆、心跳壓低。
// * 未復電前返回主控室：returnsFromCorridor++，controlRoom.setCorruption(min(0.45, 0.12 × 次數))。
// * 第一次越過 CORRIDOR.headlightTriggerX → corridor.triggerHeadlights()（車燈掃過、玩家影子投在牆上）＋心跳短暫加快。
// * 總開關 → 復電 → 目標「返回主控室」→ 進入 controlRoom 區域 → REVELATION。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import {
  StoryState, T, applyPreset, setClock, setLeftLog, setRight, setObjective, setCorruption, setCoffee, points,
} from './common.js';

const CORRIDOR_ZONES = ['corridor', 'switchRoom'];

const EMERGENCY_FADE = 2.0;   // 跳電後轉為紅色緊急照明的時間（光敏感模式 × 1.6）
const DIRECT_FADE_IN = 2.4;   // ?state=BLACKOUT_CORRIDOR 直接進入時的淡入

export class BlackoutCorridorState extends StoryState {
  async enter(data = {}) {
    const ctx = this.ctx;
    const direct = this.isDirect(data, STATES.MONITORING);
    this._wasInCorridor = false;
    this._zone = ctx.player?.zone || 'controlRoom';
    this._leaving = false;
    if (direct) {
      applyPreset(ctx, STATES.BLACKOUT_CORRIDOR);
      // 直接進入（除錯跳關）：由黑淡入 2.4 秒（原本 1.2 秒，0.25 秒內最多變化約 52%），淡入結束後才跳電
      this.fadeTo(0, DIRECT_FADE_IN);
    } else this.ensureVisible();
    this.on('flashlight:take', () => this.onFlashlight());
    this.on('sideDoor:open', () => this.onSideDoor());
    this.on('breaker:pull', () => this.onBreaker());
    this.on('player:zone', ({ to } = {}) => this.onZone(to));
    if (direct) await this.wait(DIRECT_FADE_IN + 0.4);
    await this.trip();
  }

  // ---- 跳電 -----------------------------------------------------------------
  async trip() {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom, fd = ctx.feeds;
    // 真空先解除（不能讓跳電的悶響被濾掉），然後繼電器跳脫
    T(() => a?.setSilence?.(0, 0.4));
    await this.wait(0.4);
    T(() => a?.sfx?.('relayTrip'));
    T(() => ctx.controlRoom?.setIntercomLed?.('off'));
    ctx.flags.intercomRinging = false;
    T(() => a?.setIntercomRing?.(false));
    ctx.flags.blackout = true;
    setClock(ctx, ctx.CLOCK.blackout);
    // 電壓下降：日光燈變暗、偏黃（0.7 秒），接著熄滅並切換為紅色緊急照明（2.0 秒：白光 1.0 秒內熄滅、紅光 1.0 秒亮起）；
    // 全程單調變暗。光敏感模式下再放慢 1.6 倍。
    // （原本 1.5 秒：白光 0.75 秒熄滅那一段整個畫面每 0.25 秒掉 29–32%，貼著上限；2.0 秒實測見 docs/pacing/STATUS.md）
    const slow = ctx.settings?.get?.('reduceFlicker') ? 1.6 : 1;
    T(() => cr?.setLighting?.('restored', { duration: 0.7 * slow }));
    T(() => a?.setHum?.(0.16, 0.6));
    await this.wait(0.5 * slow);
    T(() => cr?.setLighting?.('emergency', { duration: EMERGENCY_FADE * slow }));
    T(() => a?.setHum?.(0, 0.9));
    T(() => fd?.setMode?.('STATIC'));
    setLeftLog(ctx, ctx.CLOCK.blackout, 'warn');
    setRight(ctx, 'blackout', 'alert');
    T(() => a?.setVent?.({ level: 0, rate: 0.5, detune: 0.6 }, 1));
    T(() => a?.setRoomTone?.(0.26, 3));
    T(() => a?.setTunnelRumble?.(0.12, 5));
    T(() => a?.setHeartbeat?.(72, 0.6, 4));
    await this.wait(2.2);
    setObjective(ctx, 'blackout');
    // 主控室內的停電：遲遲沒有拿手電筒就提示
    this.nag(() => !ctx.flags.sideDoorOpen, ctx.SCRIPT.objectives.blackout, 45, 60);
  }

  // ---- 手電筒 / 側門 ----------------------------------------------------------
  onFlashlight() {
    const ctx = this.ctx;
    if (!ctx.flags.blackout || ctx.flags.hasFlashlight) return;
    ctx.flags.hasFlashlight = true;
    T(() => ctx.controlRoom.takeFlashlight());
    T(() => ctx.player.setFlashlight(true));
  }

  async onSideDoor() {
    const ctx = this.ctx, a = ctx.audio, P = points(ctx);
    if (!ctx.flags.blackout || !ctx.flags.hasFlashlight || ctx.flags.sideDoorOpen) return;
    ctx.flags.sideDoorOpen = true;
    T(() => a?.sfx?.('unlatch', { position: P.sideDoor }));
    await this.wait(0.45);
    T(() => a?.sfx?.('doorCreak', { position: P.sideDoor }));
    T(() => ctx.controlRoom.openSideDoor(2.6));
    await this.wait(1.1);
    T(() => ctx.player.setPortal('sideDoor', true));
    setObjective(ctx, 'corridor');
  }

  // ---- 區域 ------------------------------------------------------------------
  onZone(to) {
    const ctx = this.ctx, a = ctx.audio, f = ctx.flags;
    if (!to || to === this._zone) return;
    this._zone = to;
    if (CORRIDOR_ZONES.includes(to)) {
      this._wasInCorridor = true;
      f.inCorridor = true;
      T(() => a?.setFootstepEcho?.({ enabled: true, delay: 0.45, extraStep: true }));
      T(() => a?.setCorridorAmbience?.(0.5, 2.5));
      T(() => a?.setTunnelRumble?.(0.3, 4));
      T(() => a?.setRoomTone?.(0.12, 3));
      if (!this._hbRaised) T(() => a?.setHeartbeat?.(f.powerRestored ? 56 : 62, f.powerRestored ? 0.22 : 0.36, 4));
    } else if (to === 'doorway') {
      // 門口：聽得到廊道，但腳步回音只在廊道裡
      T(() => a?.setFootstepEcho?.({ enabled: false }));
      T(() => a?.setCorridorAmbience?.(0.3, 2));
      T(() => a?.setTunnelRumble?.(0.2, 3));
    } else if (to === 'controlRoom') {
      f.inCorridor = false;
      T(() => a?.setFootstepEcho?.({ enabled: false }));
      T(() => a?.setCorridorAmbience?.(0.12, 2.5));
      T(() => a?.setTunnelRumble?.(0.12, 3));
      T(() => a?.setRoomTone?.(0.26, 3));
      if (f.powerRestored) { this.toRevelation(); return; }
      if (this._wasInCorridor) {
        this._wasInCorridor = false;
        f.returnsFromCorridor = (f.returnsFromCorridor || 0) + 1;
        setCorruption(ctx, Math.min(0.45, 0.12 * f.returnsFromCorridor), 3.5);
        T(() => a?.setHeartbeat?.(70, 0.55, 4));
      }
    }
  }

  // ---- 總開關 ------------------------------------------------------------------
  async onBreaker() {
    const ctx = this.ctx, a = ctx.audio, f = ctx.flags, cr = ctx.controlRoom;
    if (f.powerRestored || f.breakerPulling) return;
    f.breakerPulling = true;
    await this.guard(Promise.resolve(T(() => ctx.corridor.pullBreaker()) || null));
    T(() => a?.sfx?.('powerUp', { position: points(ctx).breaker }));
    T(() => ctx.corridor.setPower(true, { duration: 2.6 }));
    f.powerRestored = true;
    f.blackout = false;
    f.breakerPulling = false;
    T(() => a?.setHum?.(0.2, 3.5));          // 電流聲微弱地回來
    T(() => a?.setHeartbeat?.(56, 0.22, 6));
    // 主控室也復電了（玩家此刻在 40 公尺外，看不見）：昏暗暖色、明顯陳舊、咖啡冷掉
    T(() => cr?.setLighting?.('restored', { duration: 3 }));
    setCorruption(ctx, Math.max(0.62, f.corruption || 0), 3);
    setCoffee(ctx, 1);
    f.roomDecayed = true;
    await this.wait(2.0);
    setObjective(ctx, 'returnRoom');
  }

  toRevelation() {
    if (this._leaving) return;
    this._leaving = true;
    this.fsm.go(STATES.REVELATION, { natural: true });
  }

  // ---------------------------------------------------------------------------
  tick() {
    const ctx = this.ctx, f = ctx.flags, p = ctx.player;
    if (!p) return;
    // 車燈幻影：第一次越過觸發線
    if (!f.headlightsSeen && f.sideDoorOpen && p.position.x > ctx.LAYOUT.CORRIDOR.headlightTriggerX) {
      f.headlightsSeen = true;
      this._hbRaised = true;
      T(() => ctx.corridor.triggerHeadlights());
      T(() => ctx.audio?.setHeartbeat?.(86, 0.72, 1.2));
      this.wait(7).then(() => {
        this._hbRaised = false;
        // 依玩家「現在」所在的區域回到該區的心跳（7 秒內可能已經走回主控室：不能用廊道的值蓋掉主控室的）
        const inCorr = CORRIDOR_ZONES.includes(this._zone);
        const [bpm, lvl] = f.powerRestored ? [56, 0.22] : inCorr ? [62, 0.38] : [70, 0.55];
        T(() => ctx.audio?.setHeartbeat?.(bpm, lvl, 6));
      });
    }
    // 保險：區域事件可能在進入本狀態前就已發生
    if (f.powerRestored && p.zone === 'controlRoom' && this._wasInCorridorEver()) this.toRevelation();
  }
  _wasInCorridorEver() { return this.ctx.flags.sideDoorOpen; }

  exit() {
    // 腳步回音只屬於廊道
    T(() => this.ctx.audio?.setFootstepEcho?.({ enabled: false }));
  }
}
