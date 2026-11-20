// =============================================================================
// RevelationState — 復電後的主控室：真相
// * 主控室明顯陳舊（corruption ≥ 0.6、昏暗暖色）、咖啡 stage 1（冷掉浮灰）、手電筒關閉、通風仍停（被手動切斷）。
// * feeds.boot() → HD 彩色：CAM-04 沒有車、CAM-03 是消防員在劈門（setHDAction(true)；'feeds:axeHit' → 隔門悶響）。
// * 右螢幕：SCRIPT.status.restored（主排風 手動切斷）；左螢幕：SCRIPT.incidentReport（事故調查摘要）。
// * CAM-03 於 HD 被看過（≥ 1.5 秒）且（CAM-04 也看過或已過 40 秒）→ 約 3 秒 → 對講機響 → 接聽 → stage 3 清晰錄音。
// * 播完 → 咖啡 stage 2、corruption 0.85 → ENDING_LOOP。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import {
  StoryState, T, applyPreset, setClock, setLeftIncident, setRight, setObjective, setCorruption, setCoffee,
  ringIntercom, playIntercom, points,
} from './common.js';

/** 'feeds:axeHit' → 隔著厚鋼門的悶響（REVELATION / ENDING 共用）。 */
export function bindDoorThuds(state, { gain = 0.5 } = {}) {
  const ctx = state.ctx;
  state._thuds = true;
  state.on('feeds:axeHit', () => {
    if (!state._thuds) return;
    T(() => ctx.audio?.sfx?.('doorThud', { position: points(ctx).blastDoor, gain }));
  });
}

export class RevelationState extends StoryState {
  async enter(data = {}) {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom, fd = ctx.feeds, f = ctx.flags;
    const direct = this.isDirect(data, STATES.BLACKOUT_CORRIDOR);
    if (direct) {
      applyPreset(ctx, STATES.REVELATION);
      this.fadeTo(0, 1.6);
    } else this.ensureVisible();
    // ---- 世界：恢復供電、陳舊 ----
    f.blackout = false;
    f.powerRestored = true;
    f.roomDecayed = true;
    T(() => cr?.setLighting?.('restored', { duration: 2.5 }));
    setCorruption(ctx, Math.max(0.62, f.corruption || 0), 2.5);
    setCoffee(ctx, 1);
    T(() => cr?.setVentLed?.('off'));
    T(() => cr?.setVentGauge?.(null));
    T(() => ctx.player?.setFlashlight?.(false, 0.6));
    setClock(ctx, ctx.CLOCK.blackout);
    T(() => a?.setFootstepEcho?.({ enabled: false }));
    T(() => a?.setCorridorAmbience?.(0, 3));
    T(() => a?.setTunnelRumble?.(0.1, 4));
    T(() => a?.setHum?.(0.32, 3));
    T(() => a?.setRoomTone?.(0.35, 3));
    T(() => a?.setVent?.({ level: 0, rate: 0.5, detune: 0.6 }, 1));
    T(() => a?.setSilence?.(0, 1));
    T(() => a?.setHeartbeat?.(58, 0.3, 4));
    ctx.player.enabled = true;
    bindDoorThuds(this);

    // ---- 監視器開機：頻寬限制解除 → HD ----
    T(() => fd?.setHDAction?.(true));
    await this.wait(direct ? 1.6 : 0.9);
    T(() => fd?.setChannel?.(3));
    setObjective(ctx, 'revelation');
    const boot = T(() => fd?.boot?.(3.2), 'feeds.boot');
    await this.wait(1.6);
    setRight(ctx, 'restored', 'warn');
    setLeftIncident(ctx);
    if (boot && typeof boot.then === 'function') await this.guard(boot);

    // ---- 看見真相 ----
    await this.until(() => fd?.hdSeen?.has?.(3));
    const t3 = ctx.clock.time;
    await this.until(() => fd?.hdSeen?.has?.(4) || ctx.clock.time - t3 >= 40);
    await this.wait(3);

    // ---- 清晰錄音 ----
    ringIntercom(ctx, 'answerClean');
    this.nag(() => ctx.flags.intercomRinging, ctx.SCRIPT.objectives.answerClean, 35, 50);
    await this.event('intercom:answer');
    setObjective(ctx, null);
    await playIntercom(this, 3, { hold: 1.8 });
    setCoffee(ctx, 2);
    setCorruption(ctx, 0.85, 5);
    await this.wait(2.2);
    this.fsm.go(STATES.ENDING_LOOP, { natural: true });
  }

  exit() {
    this._thuds = false;
    const ctx = this.ctx;
    if (ctx.flags.intercomRinging) {
      ctx.flags.intercomRinging = false;
      T(() => ctx.audio?.setIntercomRing?.(false));
      T(() => ctx.controlRoom?.setIntercomLed?.('off'));
    }
  }
}
