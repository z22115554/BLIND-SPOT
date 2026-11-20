// =============================================================================
// EndingLoopState — 終幕：開門、濃煙、寫下最後一句、02:00
// 1. 解鎖鈕緩慢呼吸紅光，唯一關鍵互動（提示 SCRIPT.prompts.unlockButton）。
// 2. 按下 → 氣壓洩壓、低沉警報、視線轉向防爆門、門 4.5 秒滑開 → 黑煙湧入（粒子＋霧轉黑＋postfx.smoke）、
//    主控室轉為焦黑（setBurnt(1)）、心跳變慢。
// 3. 畫面轉黑前：三句獨白（style 'monologue'），警報 morphAlarmToHum() 變調為日光燈電流聲。
// 4. 全黑中重置世界 → 淡入：坐姿俯視桌面，熱咖啡回來了，桌上便利貼已寫好大半；
//    舞台指示 SCRIPT.endingWriting；筆寫下最後一句「鎖死防爆門。」（setEndingWriting 由 lastLineStart → 1）。
// 5. 電子鐘停在 02:14 → 無力趴倒（rig 補間回 SPAWN.slumped，看得到電子鐘）→ 電子鐘跳成 02:00 → 淡黑。
// 6. loopCount++（存檔）→ ui.showEndChoice：再次交接（PROLOGUE {loop:true}）／工作人員名單。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import { smoothstep, clamp } from '../core/util.js';
import {
  StoryState, T, applyPreset, resetWorld, audioQuiet, setBlastDoorFlag, setClock, setObjective, setCorruption,
  setCoffee, setLeftLog, setRight, points, slumpedPose, writingPose, placePlayer, snapAtmosphere, setLimits, AMB,
} from './common.js';
import { bindDoorThuds } from './RevelationState.js';

const DOOR_OPEN = 4.5;
const WRITE_DUR = 5.2;

export class EndingLoopState extends StoryState {
  async enter(data = {}) {
    const ctx = this.ctx, cr = ctx.controlRoom, f = ctx.flags;
    const direct = this.isDirect(data, STATES.REVELATION);
    if (direct) {
      applyPreset(ctx, STATES.ENDING_LOOP);
      this.fadeTo(0, 1.6);
    } else this.ensureVisible();
    // 1. 唯一的互動：防爆門緊急解鎖
    f.roomDecayed = true;
    f.unlockArmed = true;
    T(() => cr?.setUnlockGlow?.(true));
    setObjective(ctx, 'ending');
    ctx.player.enabled = true;
    T(() => ctx.feeds?.setHDAction?.(true));
    bindDoorThuds(this);
    await this.event('unlock:press');
    await this.openDoor();
    await this.monologue();
    await this.resetInBlack();
    await this.writeAndSlump();
    await this.endChoice();
  }

  // ---- 2. 開門、濃煙 ----------------------------------------------------------
  async openDoor() {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom, f = ctx.flags, p = ctx.player, P = points(ctx);
    f.unlockArmed = false;
    f.endingStarted = true;
    if (ctx.interact) ctx.interact.locked = true;
    p.enabled = false;
    T(() => ctx.ui?.setPrompt?.(null));
    T(() => ctx.ui?.setLetterbox?.(1, 2.5));
    T(() => a?.sfx?.('button', { position: P.unlock }));
    await this.guard(Promise.resolve(T(() => cr.pressUnlockButton()) || null));
    T(() => cr.setUnlockGlow(false));
    await this.wait(0.35);
    T(() => a?.sfx?.('pneumaticHiss', { position: P.blastDoor }));
    T(() => a?.setAlarm?.(true, { level: 0.25 }));
    await this.guard(Promise.resolve(T(() => p.lookAt(P.blastDoor, 2.4)) || null));
    // 門滑開（前 24% 轉動手輪、縮回鎖栓）
    T(() => a?.sfx?.('heavySlide', { duration: DOOR_OPEN, position: P.blastDoor }));
    const door = T(() => cr.openBlastDoor(DOOR_OPEN));
    setBlastDoorFlag(ctx, true);       // GazeSystem / Interaction 的結構遮蔽判定
    this._thuds = false;
    T(() => ctx.feeds?.setHDAction?.(false));
    await this.wait(DOOR_OPEN * 0.3);
    // 黑煙湧入：粒子＋霧＋後期濃煙，房間被吞沒、轉為焦黑
    T(() => cr.setSmoke(1, { duration: 10 }));
    T(() => a?.setSmokeRoar?.(0.7, 4));
    T(() => cr.setLighting('ending', { duration: 4 }));
    T(() => cr.setBurnt(1, { duration: 12 }));
    this.postTo('smoke', 1, 11, 'inOut');
    this.tween(9, (k) => { if (ctx.feeds) ctx.feeds.brightness = 1 - 0.9 * k; }, 'inOut');
    T(() => a?.setHeartbeat?.(52, 0.6, 5));
    if (door && typeof door.then === 'function') await this.guard(door);
  }

  // ---- 3. 獨白（畫面轉黑前） --------------------------------------------------
  async monologue() {
    const ctx = this.ctx, a = ctx.audio, lines = ctx.SCRIPT.endingMonologue;
    await this.wait(0.8);
    for (let i = 0; i < lines.length; i++) {
      T(() => ctx.subtitles?.show?.(lines[i], { style: 'monologue' }));
      if (i === 0) {
        // 視線從門外的黑暗，緩緩移回控制台（他曾經在那裡看著「怪物」）
        this.wait(1.8).then(() => {
          const P = points(ctx);
          T(() => ctx.player.lookAt({ x: P.mainScreen.x - 0.25, y: P.mainScreen.y + 0.1, z: P.mainScreen.z }, 6.5));
        });
      }
      if (i === 1) {
        // 警報滑落、變成日光燈的電流聲；心跳越來越慢
        T(() => a?.morphAlarmToHum?.(7));
        T(() => a?.setHeartbeat?.(44, 0.45, 6));
      }
      await this.wait(i === lines.length - 1 ? 5.0 : 4.4);
      T(() => ctx.subtitles?.clear?.(1.0));
      await this.wait(1.1);
    }
    // 轉黑
    T(() => a?.setHeartbeat?.(40, 0, 3));
    T(() => a?.setSmokeRoar?.(0, 3.5));
    await this.fadeTo(1, 3.2, 'inOut');
  }

  // ---- 4. 全黑中重置世界 ------------------------------------------------------
  async resetInBlack() {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom, f = ctx.flags;
    const loop = f.loopCount || 0;
    // 主控室/監視器/廊道/玩家/旗標回到初始（loopCount 保留）；持續音層另外處理（嗡鳴要延續）
    resetWorld(ctx, { keepAudio: true });
    audioQuiet(ctx, 1.5, { keepHum: true });
    f.endingStarted = true;    // 這一段仍是過場：不可互動
    if (ctx.interact) ctx.interact.locked = true;
    T(() => cr?.setLighting?.('normal', { duration: 0 }));
    T(() => ctx.feeds?.setMode?.('LD'));
    setLimits(ctx, 0, 0);
    setClock(ctx, ctx.CLOCK.blackout);           // 02:14
    setLeftLog(ctx, ctx.CLOCK.start, 'normal');
    setRight(ctx, 'normal', 'normal');
    setCoffee(ctx, 0);                           // 熱咖啡回來了
    setCorruption(ctx, 0, 0);
    T(() => cr?.setNoteVisible?.('monitor', false));
    T(() => cr?.setNoteVisible?.('ending', true));
    T(() => cr?.setLoopTallies?.(loop));
    this._writeFrom = this.lastLineStart();
    T(() => cr?.setEndingWriting?.(this._writeFrom));
    placePlayer(ctx, ctx.LAYOUT.SPAWN.writing, writingPose(ctx), { enabled: false });
    if (ctx.postfx?.params) { ctx.postfx.params.fade = 1; ctx.postfx.params.smoke = 0; }
    T(() => ctx.ui?.setLetterbox?.(0, 0));
    snapAtmosphere(ctx);
    // 聲音：只剩日光燈的電流聲（由警報變形而來）與極淡的房間底噪
    T(() => a?.setAlarm?.(false));
    T(() => a?.setHum?.(0.5, 2));
    T(() => a?.setRoomTone?.(AMB.room * 0.55, 3));
    await this.wait(1.6);
  }

  lastLineStart() {
    const S = this.ctx.SCRIPT.stickyNote;
    const tex = this.ctx.controlRoom?.endingNoteTex;
    if (tex && Number.isFinite(tex.lastLineStart)) return tex.lastLineStart;
    const total = [...S.lines.join('')].length;
    return total ? (total - [...S.lastSentence].length) / total : 0.86;
  }

  // ---- 4–5. 寫下最後一句 → 趴倒 → 02:00 ---------------------------------------
  async writeAndSlump() {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom, p = ctx.player, P = points(ctx);
    this.fadeTo(0, 2.6, 'inOut');
    await this.wait(1.2);
    T(() => ctx.subtitles?.show?.(ctx.SCRIPT.endingWriting, { style: 'direction' }));
    await this.wait(1.6);
    // 筆寫下「鎖死防爆門。」
    T(() => a?.sfx?.('penScratch', { duration: WRITE_DUR, position: P.note, gain: 0.9 }));
    const from = this._writeFrom ?? this.lastLineStart();
    await this.tween(WRITE_DUR, (_e, k) => {
      // 一字一頓：每個字的筆畫在字的時段內完成
      const n = 6, s = k * n, i = Math.floor(s), fr = s - i;
      const kk = Math.min(1, (i + smoothstep(0.1, 0.85, fr)) / n);
      T(() => cr.setEndingWriting(from + (1 - from) * kk));
    }, 'linear');
    T(() => cr.setEndingWriting(1));
    await this.wait(1.0);
    T(() => ctx.subtitles?.clear?.(1.2));
    await this.wait(1.4);

    // 無力趴倒：rig 補間到 SPAWN.slumped（側頭望向監視器與電子鐘）
    const base = ctx.LAYOUT.SPAWN.writing;
    const to = slumpedPose(ctx, base);
    const r0 = { ...p.rig }, y0 = p.yaw, pi0 = p.pitch;
    let dy = to.yaw - y0; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    let thudPlayed = false;
    await this.tween(2.9, (_e, k) => {
      // 先慢慢抬起、往後垂（筆放開），接著整個人往前、往側邊倒在手臂上
      const fall = smoothstep(0.22, 0.92, k);
      const lift = Math.sin(Math.PI * smoothstep(0.0, 0.42, k)) * 0.06;
      const settle = Math.sin(Math.PI * smoothstep(0.86, 1.0, k)) * 0.008;
      p.rig.x = r0.x + (to.rig.x - r0.x) * fall;
      p.rig.z = r0.z + (to.rig.z - r0.z) * fall;
      p.rig.height = r0.height + (to.rig.height - r0.height) * fall + lift - settle;
      p.rig.roll = r0.roll + (to.rig.roll - r0.roll) * smoothstep(0.35, 0.98, k);
      p.rig.pitch = 0;
      p.yaw = y0 + dy * smoothstep(0.2, 0.95, k);
      p.pitch = pi0 + (to.pitch - pi0) * smoothstep(0.15, 0.9, k);
      if (!thudPlayed && k > 0.84) { thudPlayed = true; T(() => a?.sfx?.('bodySlump', { position: P.note, gain: 0.8 })); }
    }, 'linear');
    Object.assign(p.rig, to.rig);
    p.yaw = to.yaw; p.pitch = to.pitch;

    // 02:14 → 02:00
    await this.wait(2.8);
    setClock(ctx, ctx.CLOCK.start);
    await this.wait(3.4);
    T(() => a?.silenceAll?.(3.2));
    await this.fadeTo(1, 3.2, 'inOut');
    await this.wait(0.8);
  }

  // ---- 6. 循環計數 → 結局選擇 ------------------------------------------------
  async endChoice() {
    const ctx = this.ctx, f = ctx.flags;
    const n = (f.loopCount || 0) + 1;
    f.loopCount = n;
    T(() => ctx.settings?.set?.('loopCount', n));
    T(() => ctx.player?.unlock?.());
    const show = () => {
      if (!this.alive) return;
      T(() => ctx.ui?.showEndChoice?.({
        loop: n,
        onRestart: () => {
          if (!this.alive) return;
          T(() => ctx.ui?.hideEndChoice?.());
          T(() => ctx.player?.lock?.());
          ctx.fsm.go(STATES.PROLOGUE, { loop: true });
        },
        onCredits: () => {
          if (!this.alive) return;
          T(() => ctx.ui?.hideEndChoice?.());
          T(() => ctx.ui?.showCredits?.(ctx.SCRIPT.credits, { onDone: () => show() }));
        },
      }), 'showEndChoice');
    };
    this._choiceShown = true;
    show();
  }

  tick() {
    // 選擇畫面期間保持全黑
    if (this._choiceShown && this.ctx.postfx?.params) this.ctx.postfx.params.fade = 1;
  }

  exit() {
    const ctx = this.ctx;
    this._thuds = false;
    this._choiceShown = false;
    if (ctx.interact) ctx.interact.locked = false;
    setBlastDoorFlag(ctx, false);
  }
}
