// =============================================================================
// PrologueState — 02:00 序幕：趴在控制台上醒來
// 1. 全黑、無聲 1 秒 → 日光燈啟動（lightsStartup 內含 'tubeStart'）＋淡入。
// 2. 日光燈嗡鳴、通風白噪音、房間底噪淡入；主 CRT 亮起 CAM-03（LD）：面壁的反光雨衣人影（index 0）。
// 3. 由 SPAWN.slumped（趴桌、側頭望向監視器與電子鐘 02:00）以 player.rig 補間抬頭坐起 → 可操作。
// 4. 檢視便利貼（關閉後）或 50 秒後 → MONITORING。
// data.loop = true：由終幕「再次交接」回來，完整重置世界（loopCount 保留，便利貼正字記號 +1）。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import { smoothstep } from '../core/util.js';
import { StoryState, T, applyPreset, slumpedPose, setObjective, setLimits, points, AMB } from './common.js';

const SIT_UP = 3.6;        // 抬頭坐起秒數
const NOTE_TIMEOUT = 50;   // 沒有檢視便利貼也會在 50 秒後進入監看

export class PrologueState extends StoryState {
  async enter(data = {}) {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom, fd = ctx.feeds, p = ctx.player;
    applyPreset(ctx, STATES.PROLOGUE, { loop: !!data.loop });
    this._control = false;

    // 1. 全黑、無聲 1 秒
    await this.wait(1.0);

    // 2. 日光燈啟動（緩慢、低振幅）＋淡入；環境音淡入
    T(() => cr?.lightsStartup?.(3.5), 'lightsStartup');
    this.fadeTo(0, 3.4, 'inOut');
    T(() => a?.setHum?.(AMB.hum, 3.0));
    T(() => a?.setRoomTone?.(AMB.room, 4.0));
    await this.wait(0.9);
    T(() => a?.setVent?.(AMB.vent, 4.5));
    await this.wait(0.7);
    // 主 CRT 亮起：CAM-03 低畫質
    T(() => fd?.setChannel?.(3));
    T(() => fd?.setFigureIndex?.(0));
    setLimits(ctx, 0, 0);
    T(() => fd?.setMode?.('LD'), 'feeds LD');

    // 3. 趴在桌上望著 02:00 與 CRT 片刻 → 抬頭坐起
    await this.wait(2.4);
    await this.sitUp(SIT_UP);
    p.enabled = true;
    this._control = true;
    T(() => ctx.ui?.hint?.(ctx.SCRIPT.hints.look, 4));
    setObjective(ctx, 'prologue');
    this.wait(4.4).then(() => T(() => ctx.ui?.hint?.(ctx.SCRIPT.hints.move, 6)));

    // 4. 讀完便利貼（檢視畫面關閉）或 50 秒
    await Promise.race([
      this.until(() => ctx.flags.noteRead && !ctx.inspect?.isOpen),
      this.wait(NOTE_TIMEOUT).then(() => this.until(() => !ctx.inspect?.isOpen)),
    ]);
    await this.wait(ctx.flags.noteRead ? 1.2 : 0.2);
    this.fsm.go(STATES.MONITORING, { natural: true });
  }

  /** rig 由趴桌姿勢補間回 0（坐姿面對主 CRT）。 */
  sitUp(duration) {
    const ctx = this.ctx, p = ctx.player, seat = ctx.LAYOUT.SPAWN.seated;
    const from = slumpedPose(ctx, seat);
    const r0 = { ...from.rig };
    const y0 = from.yaw, pi0 = from.pitch;
    let yawDelta = seat.yaw - y0;
    yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
    // 手臂從桌上的紙張滑開的細微摩擦聲
    this.wait(duration * 0.15).then(() => T(() => ctx.audio?.sfx?.('paper', { position: points(ctx).note, gain: 0.35 })));
    return this.tween(duration, (_e, k) => {
      // 先抬頭、扶正（高度與側傾），身體再往後靠回椅子（x/z），視線最後才從電子鐘移回螢幕中央
      const lift = smoothstep(0.0, 0.62, k);
      const level = smoothstep(0.05, 0.7, k);
      const back = smoothstep(0.18, 1.0, k);
      const look = smoothstep(0.3, 1.0, k);
      // 剛抬頭時微微前傾一下（還沒完全清醒）
      const sag = Math.sin(Math.PI * smoothstep(0.1, 0.75, k)) * 0.05;
      p.rig.height = r0.height * (1 - lift);
      p.rig.roll = r0.roll * (1 - level);
      p.rig.x = r0.x * (1 - back);
      p.rig.z = r0.z * (1 - back);
      p.rig.pitch = -sag;
      p.yaw = y0 + yawDelta * look;
      p.pitch = pi0 + (seat.pitch - pi0) * look;
    }, 'linear').then(() => {
      Object.assign(p.rig, { x: 0, z: 0, height: 0, pitch: 0, roll: 0 });
      p.yaw = seat.yaw; p.pitch = seat.pitch;
    });
  }

  exit() {
    // 若在起身中途被切走，確保玩家姿勢合法
    const p = this.ctx.player;
    if (p && !this._control) Object.assign(p.rig, { x: 0, z: 0, height: 0, pitch: 0, roll: 0 });
  }
}
