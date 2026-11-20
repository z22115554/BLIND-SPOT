// =============================================================================
// EndingLoopState — 終幕：開門、濃煙、焦黑、寫下最後一句、02:00
// 1. 解鎖鈕緩慢呼吸紅光，是唯一可互動的目標（registerCommonInteractables 在 flags.unlockArmed 時停用其他互動）。
// 2. 按下 → 氣壓洩壓、低沉警報、視線轉向防爆門、門 4.5 秒滑開。門開到約 30% 起，黑煙從開口上半部湧入、
//    先沿天花板分層翻滾、再一路往下沉（ControlRoom 的煙層＋煙團粒子，被終幕的紅橘色燈光照亮）。
//    門開始動約 1 秒後，主控室由防爆門向外、由天花板往下焦黑（約 6.5 秒；起泡的黑牆、龜裂透出的餘燼光、
//    裂開的 CRT、下垂/脫落的天花板）。這段時間煙還不濃（霧 ≈ 0.3、postfx 煙 ≤ 0.6），2–4 m 內看得見焦黑的房間。
// 3. 門全開 → 視線緩緩從門口掃過西牆、北牆，回到控制台。三句獨白（style 'monologue'）疊在越來越濃的煙上；
//    警報 morphAlarmToHum() 變調為日光燈電流聲。煙到最後一句才變得很濃，最後約 2.4 秒才淡到接近全黑（fade 0.95）。
// 4. 回到桌面：在接近全黑中重置世界，但保留焦黑／濃煙／終幕燈光當起點；畫面是桌上的咖啡杯。
//    淡入時焦黑一路退去、煙往上散開、燈光回到正常、熱咖啡冒出蒸氣（右下角是便利貼與筆）。
//    舞台指示 SCRIPT.endingWriting 先出現 → 鏡頭前傾低頭到便利貼 → 字幕淡出後筆才開始寫「鎖死防爆門。」
//    （setEndingWriting 由 lastLineStart → 1），所以最後一句書寫時不會被字幕遮住。
// 5. 電子鐘停在 02:14 → 無力趴倒（rig 補間回 SPAWN.slumped，看得到電子鐘）→ 電子鐘跳成 02:00 → 淡黑。
// 6. loopCount++（存檔）→ ui.showEndChoice：再次交接（PROLOGUE {loop:true}）／工作人員名單。
// 黃金規則：所有亮度變化 ≥ 0.4 秒（煙、焦黑、燈光、淡入淡出都是數秒的平滑補間）；餘燼光只做 ≤ 12% 的緩慢起伏。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import { smoothstep, clamp, lerp } from '../core/util.js';
import {
  StoryState, T, applyPreset, resetWorld, audioQuiet, setBlastDoorFlag, setClock, setObjective, setCorruption,
  setCoffee, setLeftLog, setRight, points, slumpedPose, writingPose, mugPose, placePlayer, snapAtmosphere, setLimits, AMB,
} from './common.js';
import { bindDoorThuds } from './RevelationState.js';

const DOOR_OPEN = 4.5;
const WRITE_DUR = 5.2;
const PAN_DUR = 7.5;          // 由門口掃回控制台
const FADE_OUT = 2.4;         // 最後淡到接近全黑
const FADE_FLOOR = 0.95;      // 「接近全黑」：回到桌面的鏡頭在這個亮度下切換
const RETURN_FADE = 3.4;      // 回到桌面時淡入
const BURN_RECEDE = 3.2;      // 焦黑退去

// ---- 煙／焦黑／後期的時間表（秒，從防爆門開始轉動手輪起算；[t, 值]，段間餘弦緩動） ----
// 門開到 30%（1.35 s）煙開始湧入 → 6.3 s 時天花板煙層成形 → 一路下沉 → 最後一句時才變得很濃。
const SMOKE_KEYS = [[0, 0], [1.35, 0], [3.4, 0.1], [6.3, 0.3], [12.8, 0.55], [17.8, 0.72], [22.3, 0.9], [25.2, 1]];
// 焦黑：門開始動約 1 秒後，由門口往房內、由上往下蔓延（門口附近約 4 秒內焦黑，遠端控制台在視線掃過時才燒到）
const BURN_KEYS = [[0, 0], [1.1, 0], [8.4, 1]];
// postfx 煙霾：最大 0.6（房間輪廓永遠透得出來；全黑交給 fade）
const POST_SMOKE_KEYS = [[0, 0], [1.8, 0], [7, 0.06], [13, 0.14], [18, 0.24], [21.5, 0.38], [24.5, 0.6]];
// 監視器亮度：煙與焦黑中慢慢暗下去
const FEED_KEYS = [[0, 1], [1.35, 1], [14, 0.12]];

/** 關鍵格插值（段間餘弦緩動）。 */
function curve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = (t - t0) / Math.max(1e-6, t1 - t0);
      return v0 + (v1 - v0) * (0.5 - 0.5 * Math.cos(Math.PI * k));
    }
  }
  return keys[keys.length - 1][1];
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

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
    T(() => ctx.ui?.setPrompt?.(null));
    setObjective(ctx, 'ending');
    ctx.player.enabled = true;
    T(() => ctx.feeds?.setHDAction?.(true));
    bindDoorThuds(this);
    await this.event('unlock:press');
    await this.openDoor();
    await this.monologue();
    await this.returnToDesk();
    await this.writeAndSlump();
    await this.endChoice();
  }

  // ---- 2. 開門、濃煙、焦黑 ---------------------------------------------------
  async openDoor() {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom, f = ctx.flags, p = ctx.player, P = points(ctx);
    f.unlockArmed = false;
    f.endingStarted = true;
    if (ctx.interact) ctx.interact.locked = true;
    p.enabled = false;
    T(() => ctx.ui?.setPrompt?.(null));
    setObjective(ctx, null);
    T(() => ctx.ui?.setLetterbox?.(1, 2.5));
    T(() => a?.sfx?.('button', { position: P.unlock }));
    await this.guard(Promise.resolve(T(() => cr.pressUnlockButton()) || null));
    T(() => cr.setUnlockGlow(false));
    await this.wait(0.35);
    T(() => a?.sfx?.('pneumaticHiss', { position: P.blastDoor }));
    T(() => a?.setAlarm?.(true, { level: 0.25 }));
    // 看向門洞上半部（煙會從那裡湧進來）
    const look = { x: P.blastDoor.x, y: 1.45, z: P.blastDoor.z };
    await this.guard(Promise.resolve(T(() => p.lookAt(look, 3.0)) || null));
    // 門滑開（前 24% 轉動手輪、縮回鎖栓）
    T(() => a?.sfx?.('heavySlide', { duration: DOOR_OPEN, position: P.blastDoor }));
    const door = T(() => cr.openBlastDoor(DOOR_OPEN));
    setBlastDoorFlag(ctx, true);       // GazeSystem / Interaction 的結構遮蔽判定
    this.hideCorridor(true);           // 終幕不會再看到廊道：省下牆後約 80 個 draw call
    this._thuds = false;
    T(() => ctx.feeds?.setHDAction?.(false));
    // 煙／焦黑／後期的時間表由 tick() 依遊戲時間推進
    this._tl = { t0: ctx.clock.time };
    // 視線跟著湧進來、往天花板翻滾的煙，慢慢抬起一點
    const pitch0 = p.pitch;
    this.tween(DOOR_OPEN + 0.8, (e) => { p.pitch = pitch0 + 0.12 * e; }, 'inOut');
    this.wait(DOOR_OPEN * 0.3).then(() => {
      if (!this.alive) return;
      T(() => a?.setSmokeRoar?.(0.7, 4));
      T(() => cr.setLighting('ending', { duration: 4 }));
      T(() => a?.setHeartbeat?.(52, 0.6, 5));
    });
    if (door && typeof door.then === 'function') await this.guard(door);
  }

  /** 視線由門口往右（順時針）緩緩掃過西牆、北牆，回到控制台與主 CRT。 */
  panToConsole() {
    const ctx = this.ctx, p = ctx.player, P = points(ctx);
    const eye = { x: p.position.x + p.rig.x, y: p.eyeHeight + p.rig.height, z: p.position.z + p.rig.z };
    const tgt = { x: P.mainScreen.x - 0.25, y: P.mainScreen.y - 0.05, z: P.mainScreen.z };
    const dx = tgt.x - eye.x, dz = tgt.z - eye.z;
    const toYaw = Math.atan2(-dx, -dz);
    const toPitch = Math.atan2(tgt.y - eye.y, Math.hypot(dx, dz));
    const y0 = p.yaw, pi0 = p.pitch;
    // 一定往右轉（yaw 遞減）：經過西牆、西北角、北牆（電子鐘）再到控制台
    let d = wrap(toYaw - y0);
    if (d > 0) d -= Math.PI * 2;
    return this.tween(PAN_DUR, (e) => {
      p.yaw = wrap(y0 + d * e);
      // 中段抬頭看一下天花板的煙層與下垂的天花板，最後落在控制台
      p.pitch = lerp(pi0, toPitch, smoothstep(0.35, 1, e)) + 0.1 * Math.sin(Math.PI * smoothstep(0, 0.8, e));
    }, 'inOut');
  }

  // ---- 3. 獨白（畫面轉黑前） --------------------------------------------------
  async monologue() {
    const ctx = this.ctx, a = ctx.audio, p = ctx.player, lines = ctx.SCRIPT.endingMonologue;
    await this.wait(0.8);
    // 掃視結束後：濃煙往下沉，身體也跟著慢慢蹲低、垮下來（眼睛留在煙層下方久一點），視線落向控制台
    this.panToConsole().then(() => {
      if (!this.alive || !this._tl) return;
      const h0 = p.rig.height, pi0 = p.pitch;
      this.tween(10, (e) => {
        if (!this._tl) return;
        p.rig.height = h0 - 0.32 * e;
        p.pitch = pi0 + 0.05 * Math.sin(Math.PI * e) - 0.04 * e;
      }, 'inOut');
    });
    for (let i = 0; i < lines.length; i++) {
      T(() => ctx.subtitles?.show?.(lines[i], { style: 'monologue' }));
      if (i === 1) {
        // 警報滑落、變成日光燈的電流聲；心跳越來越慢
        T(() => a?.morphAlarmToHum?.(7));
        T(() => a?.setHeartbeat?.(44, 0.45, 6));
      }
      await this.wait(i === lines.length - 1 ? 5.0 : 4.4);
      T(() => ctx.subtitles?.clear?.(1.0));
      await this.wait(1.1);
    }
    // 接近全黑（不是硬切；回到桌面的鏡頭在這個亮度下切換）
    T(() => a?.setHeartbeat?.(40, 0, 3));
    T(() => a?.setSmokeRoar?.(0, 3.5));
    await this.fadeTo(FADE_FLOOR, FADE_OUT, 'inOut');
  }

  // ---- 4. 回到桌面：焦黑退去、熱咖啡回來了 -------------------------------------
  async returnToDesk() {
    const ctx = this.ctx, a = ctx.audio, cr = ctx.controlRoom, f = ctx.flags, pp = ctx.postfx?.params;
    const loop = f.loopCount || 0;
    const fadeNow = pp ? clamp(pp.fade) : 1;
    const postSmoke = pp ? clamp(pp.smoke) : 0;
    this._tl = null;
    // 主控室/監視器/廊道/玩家/旗標回到初始（loopCount 保留）；持續音層另外處理（嗡鳴要延續）
    resetWorld(ctx, { keepAudio: true });
    audioQuiet(ctx, 1.5, { keepHum: true });
    f.endingStarted = true;    // 這一段仍是過場：不可互動
    if (ctx.interact) ctx.interact.locked = true;
    // 起點 = 剛才那個焦黑、煙霧瀰漫、終幕燈光的房間（同一幀內設回，畫面上不會跳）
    T(() => cr?.setLighting?.('ending', { duration: 0 }));
    T(() => cr?.setBurnt?.(1, { duration: 0 }));
    T(() => cr?.setSmoke?.(0.92, { duration: 0 }));
    T(() => ctx.feeds?.setMode?.('LD'));
    if (ctx.feeds) ctx.feeds.brightness = 0.12;
    setLimits(ctx, 0, 0);
    setClock(ctx, ctx.CLOCK.blackout);           // 02:14
    setLeftLog(ctx, ctx.CLOCK.start, 'normal');
    setRight(ctx, 'normal', 'normal');
    setCoffee(ctx, 0);                           // 熱咖啡（還在焦黑底下，退去時才看得到）
    setCorruption(ctx, 0, 0);
    T(() => cr?.setNoteVisible?.('monitor', false));
    T(() => cr?.setNoteVisible?.('ending', true));
    T(() => cr?.setLoopTallies?.(loop));
    this._writeFrom = this.lastLineStart();
    T(() => cr?.setEndingWriting?.(this._writeFrom));
    placePlayer(ctx, ctx.LAYOUT.SPAWN.writing, mugPose(ctx), { enabled: false });
    if (pp) { pp.fade = Math.max(FADE_FLOOR, fadeNow); pp.smoke = postSmoke; }
    T(() => ctx.ui?.setLetterbox?.(1, 0));
    snapAtmosphere(ctx);
    // 聲音：只剩日光燈的電流聲（由警報變形而來）與極淡的房間底噪
    T(() => a?.setAlarm?.(false));
    T(() => a?.setHum?.(0.5, 2));
    T(() => a?.setRoomTone?.(AMB.room * 0.55, 3));
    await this.wait(0.3);
    // 淡入（煙先往上散開）；畫面亮到一半以上時，焦黑才由遠處往防爆門的方向一路退去、燈光回到正常、
    // 監視器亮回來、熱咖啡冒出蒸氣 —— 這個過程要看得見
    this.fadeTo(0, RETURN_FADE, 'inOut');
    this.postTo('smoke', 0, 2.6, 'inOut');
    T(() => cr?.setSmoke?.(0, { duration: 3.4 }));
    this.wait(1.1).then(() => {
      if (!this.alive) return;
      T(() => cr?.setBurnt?.(0, { duration: BURN_RECEDE }));
      T(() => cr?.setLighting?.('normal', { duration: BURN_RECEDE + 0.4 }));
      this.tween(BURN_RECEDE + 0.4, (e) => { if (ctx.feeds) ctx.feeds.brightness = 0.12 + 0.88 * e; }, 'inOut');
    });
    await this.wait(3.4);
    // 舞台指示先出現（筆開始寫之前就淡出）
    T(() => ctx.subtitles?.show?.(ctx.SCRIPT.endingWriting, { style: 'direction' }));
    await this.wait(1.8);
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
    // 前傾、低頭看便利貼（mugPose → writingPose）
    T(() => ctx.ui?.setLetterbox?.(0, 2.4));
    {
      const r0 = { ...p.rig }, y0 = p.yaw, pi0 = p.pitch;
      const to = writingPose(ctx);
      const dy = wrap(to.yaw - y0);
      await this.tween(2.6, (e) => {
        p.rig.x = lerp(r0.x, to.rig.x, e);
        p.rig.z = lerp(r0.z, to.rig.z, e);
        p.rig.height = lerp(r0.height, to.rig.height, e);
        p.rig.roll = lerp(r0.roll, to.rig.roll, e);
        p.rig.pitch = 0;
        p.yaw = y0 + dy * e;
        p.pitch = lerp(pi0, to.pitch, e);
      }, 'inOut');
    }
    await this.wait(0.4);
    // 字幕先淡出，筆才開始寫（最後一句不會被字幕遮住）
    T(() => ctx.subtitles?.clear?.(0.6));
    await this.wait(0.75);
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
    await this.wait(2.2);

    // 無力趴倒：rig 補間到 SPAWN.slumped（側頭望向監視器與電子鐘）
    const base = ctx.LAYOUT.SPAWN.writing;
    const to = slumpedPose(ctx, base);
    const r0 = { ...p.rig }, y0 = p.yaw, pi0 = p.pitch;
    const dy = wrap(to.yaw - y0);
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
    const ctx = this.ctx;
    // 煙／焦黑／後期／監視器亮度的時間表（遊戲時間；暫停會凍結）
    if (this._tl) {
      const k = ctx.clock.time - this._tl.t0;
      const cr = ctx.controlRoom;
      T(() => cr?.setSmoke?.(curve(SMOKE_KEYS, k), { duration: 0 }));
      T(() => cr?.setBurnt?.(curve(BURN_KEYS, k), { duration: 0 }));
      if (ctx.postfx?.params) ctx.postfx.params.smoke = curve(POST_SMOKE_KEYS, k);
      if (ctx.feeds) ctx.feeds.brightness = curve(FEED_KEYS, k);
    }
    // 選擇畫面期間保持全黑
    if (this._choiceShown && ctx.postfx?.params) ctx.postfx.params.fade = 1;
  }

  /**
   * 終幕（開門之後）玩家不會離開主控室、也不會再望向側門：把廊道整組（牆後、仍在視錐內的合併幾何、線索物件、主車道）
   * 暫時不繪製。只隱藏「不含光源」的子樹 —— 場景中的光源數量不變（不會重新編譯著色器）。exit() 時還原。
   */
  hideCorridor(on) {
    const g = this.ctx.corridor?.group;
    if (on) {
      if (!g || this._coHidden) return;
      this._coHidden = [];
      for (const c of g.children) {
        let lit = false;
        c.traverse((o) => { if (o.isLight) lit = true; });
        if (!lit && c.visible) { c.visible = false; this._coHidden.push(c); }
      }
    } else if (this._coHidden) {
      for (const c of this._coHidden) c.visible = true;
      this._coHidden = null;
    }
  }

  exit() {
    const ctx = this.ctx;
    this.hideCorridor(false);
    this._thuds = false;
    this._tl = null;
    this._choiceShown = false;
    if (ctx.interact) ctx.interact.locked = false;
    setBlastDoorFlag(ctx, false);
  }
}
