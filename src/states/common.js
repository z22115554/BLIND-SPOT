// =============================================================================
// states/common.js — 劇情狀態共用工具
// -----------------------------------------------------------------------------
//   * StoryState：所有劇情狀態的共同基底（extends BaseState）。每幀呼叫 updateAtmosphere，
//     提供 fadeTo / postTo（受 epoch 保護的 postfx 補間）、on（自動清理的 bus 監聽）、isDirect（直接跳關判定）。
//   * applyPreset(ctx, stateName)：直接進入（?state=NAME 或除錯跳關）時，把世界瞬間設成該狀態開頭應有的樣子。
//   * registerCommonInteractables(ctx)：所有可互動物件（只註冊一次；label / verb / enabled 皆為依劇情求值的函式）。
//   * playIntercom(state, stageIndex)：對講機語音＋逐段累加字幕（最終字串 = SCRIPT.intercom[i].full）。
//   * updateAtmosphere(ctx, dt)：唯一擁有 scene.fog 的地方（依相機位置的區域、復電後的陳舊感、濃煙）。
//   * setClock(ctx, text)：LED 電子鐘＋ctx.flags.clockText。
//   * paceFlags(ctx)：監看節奏改版的 URL 開關（?pace=0 / ?lock=0 / ?subposes=0 / ?spm= / ?seed= / ?pacelog=1）。
//   * pushLog(ctx, text)：SYS LOG 動態行（與 SCRIPT.status.logLines 依 HH:MM 合併、保留最後 8 行）。
// 黃金規則：任何亮度變化 ≥ 0.4 秒、沒有突發巨響；所有劇情計時使用遊戲時間（BaseState.wait/tween）。
// =============================================================================
import * as THREE from 'three';
import { BaseState, STATES } from '../core/StateMachine.js';
import { clamp, damp, lerp, smoothstep, addMinutes, minutesBetween } from '../core/util.js';

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------
/** 執行 fn；模組呼叫失敗時記錄錯誤但不中斷劇情腳本。 */
export function T(fn, label = '') {
  try { return fn(); } catch (e) { console.error(`[states] ${label || 'call'} failed`, e); return undefined; }
}
const inState = (ctx, ...names) => names.includes(ctx.fsm?.currentName);
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };

/**
 * 監看節奏改版（docs/pacing/spec.md §10）的 URL 開關；結果快取在 ctx 上（網址參數不會變）。
 *   pace      ?pace=0 → 改版前的行為（沒有導演、輕量時鐘、上鎖閘門、敲門、子姿勢）
 *   lock      ?lock=0 → 沒有 02:00 上鎖閘門（防爆門一開始就鎖著）
 *   subposes  ?subposes=0 → CAM-03 不使用子姿勢
 *   spm       ?spm=N → 每分鐘秒數（除錯；DWELL_MIN 等比例縮放）
 *   seed      ?seed=N → 導演亂數種子
 *   log       ?pacelog=1 → 每次翻分鐘印一行 [pace]，進入停電時印摘要表
 */
export function paceFlags(ctx) {
  if (ctx._paceFlags) return ctx._paceFlags;
  const get = (k) => { try { return ctx.params?.get?.(k) ?? null; } catch (e) { return null; } };
  const num = (k) => { const v = Number(get(k)); return get(k) != null && Number.isFinite(v) && v > 0 ? v : null; };
  const pace = get('pace') !== '0';
  ctx._paceFlags = {
    pace,
    lock: pace && get('lock') !== '0',
    subposes: pace && get('subposes') !== '0',
    spm: num('spm'),
    seed: num('seed'),
    log: get('pacelog') === '1',
  };
  return ctx._paceFlags;
}

// 環境音層的標準值（可調）
export const AMB = {
  hum: 0.5,
  room: 0.45,
  vent: { level: 0.42, rate: 1, detune: 0 },
  ventFault: { level: 0.38, rate: 1.3, detune: 0.4 },   // 02:05 轉速異常（超速 ▲、變調）
  ventSick: { level: 0.4, rate: 0.9, detune: 0.15 },    // 重啟後：病懨懨地轉
  ventDying: { level: 0.34, rate: 0.5, detune: 0.6 },   // 02:10 起 40 秒內衰弱
};

/** 依劇情常用的世界座標點（由 LAYOUT 計算、快取）。 */
export function points(ctx) {
  if (ctx._statePoints) return ctx._statePoints;
  const L = ctx.LAYOUT.CONTROL_ROOM, C = ctx.LAYOUT.CORRIDOR, SW = ctx.LAYOUT.SWITCH_ROOM;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const offZ = ctx.controlRoom?.endingNoteOffsetZ ?? 0.045;
  ctx._statePoints = {
    intercom: V(L.intercom.x, L.intercom.y, L.intercom.z),
    vent: V(L.ventPanel.x, L.ventPanel.y, L.ventPanel.z),
    blastDoor: V(L.blastDoor.x + 0.06, L.blastDoor.height * 0.5, L.blastDoor.z),
    sideDoor: V(L.sideDoor.x, 1.05, L.sideDoor.z),
    flashlight: V(L.flashlightBox.x, L.flashlightBox.y, L.flashlightBox.z),
    unlock: V(L.unlockButton.x, L.unlockButton.y, L.unlockButton.z),
    mainScreen: V(L.mainScreen.x, L.mainScreen.y, L.mainScreen.z),
    note: V(L.endingNote.x, L.endingNote.y, L.endingNote.z + offZ),
    breaker: V(SW.breaker.x, SW.breaker.y, SW.breaker.z),
    fireDoor: V(C.fireDoor.x, C.fireDoor.glass.y, C.fireDoor.z),
    camButtons: (L.camButtons?.xs || []).map((x) => V(x, L.camButtons.y, L.camButtons.z)),   // CAM-01..04（vmdTone 聲源）
  };
  return ctx._statePoints;
}

/** 由相機位置與注視點求 yaw / pitch（yaw 0 = 面向 -Z；+PI/2 = 面向 -X）。 */
export function lookAngles(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.max(1e-5, Math.hypot(dx, dz))) };
}

/** 相機姿勢 → 玩家基準位置 base（腳底 x/z，坐姿眼高）上的 rig 偏移與 yaw/pitch。 */
export function rigPose(ctx, base, cam, look, roll = 0) {
  const EYE = ctx.LAYOUT.EYE;
  const { yaw, pitch } = lookAngles(cam, look);
  return { yaw, pitch, rig: { x: cam.x - base.x, z: cam.z - base.z, height: cam.y - EYE.seated, pitch: 0, roll } };
}

/** 序幕/終幕的趴桌姿勢（以 SPAWN.seated 為基準位置；或指定 base）。 */
export function slumpedPose(ctx, base = ctx.LAYOUT.SPAWN.seated) {
  const sp = ctx.LAYOUT.SPAWN.slumped;
  return rigPose(ctx, base, sp, sp.lookAt, sp.roll);
}

/**
 * 終幕寫字的相機姿勢：坐在 SPAWN.writing，上身前傾、低頭俯視桌上的便利貼，
 * 讓便利貼與筆佔畫面相當比例、「鎖死防爆門。」清晰可讀。（可調：WRITE_CAM）
 */
// 便利貼在畫面正中央、夠大（800×450 也讀得到「鎖死防爆門。」）；右上角只帶到 CAM 按鈕座的邊角（大字在畫面外）。
export const WRITE_CAM = { back: 0.055, up: 0.172, side: 0.02, lookAhead: -0.004, lookSide: 0.008, roll: 0.03 };
export function writingPose(ctx) {
  const W = ctx.LAYOUT.SPAWN.writing;
  const n = points(ctx).note;
  const look = { x: n.x + WRITE_CAM.lookSide, y: n.y, z: n.z + WRITE_CAM.lookAhead };
  const cam = { x: n.x + WRITE_CAM.side, y: n.y + WRITE_CAM.up, z: n.z + WRITE_CAM.back };
  return rigPose(ctx, W, cam, look, WRITE_CAM.roll);
}

/**
 * 終幕「回到桌面」的第一個鏡頭：坐在 SPAWN.writing，微微前傾、望向桌上的咖啡杯
 * （焦黑由這個畫面退去、熱咖啡冒出蒸氣；右下角是便利貼與筆）。之後再前傾低頭到 writingPose。（可調：MUG_CAM）
 */
export const MUG_CAM = { cam: { dx: 0.08, y: 1.13, dz: -0.26 }, lookUp: 0.07, roll: -0.02 };
export function mugPose(ctx) {
  const W = ctx.LAYOUT.SPAWN.writing;
  const c = ctx.LAYOUT.CONTROL_ROOM.coffee;
  const cam = { x: W.x + MUG_CAM.cam.dx, y: MUG_CAM.cam.y, z: W.z + MUG_CAM.cam.dz };
  const look = { x: c.x, y: c.y + MUG_CAM.lookUp, z: c.z };
  return rigPose(ctx, W, cam, look, MUG_CAM.roll);
}

/** 把玩家放進某個姿勢（坐姿、停用輸入）。 */
export function placePlayer(ctx, base, pose, { enabled = false } = {}) {
  const p = ctx.player;
  if (!p) return;
  T(() => p.teleport({ x: base.x, z: base.z, yaw: pose.yaw, pitch: pose.pitch, seated: true }), 'teleport');
  Object.assign(p.rig, { x: 0, z: 0, height: 0, pitch: 0, roll: 0 }, pose.rig || {});
  p.enabled = enabled;
}

/** 坐在控制台前（SPAWN.seated），rig 歸零。 */
export function placeSeated(ctx, { enabled = true } = {}) {
  const s = ctx.LAYOUT.SPAWN.seated;
  placePlayer(ctx, s, { yaw: s.yaw, pitch: s.pitch, rig: {} }, { enabled });
}

/** 站在某處（rig 歸零）。 */
export function placeStanding(ctx, { x, z, yaw = 0, pitch = 0 }, { enabled = true } = {}) {
  const p = ctx.player;
  if (!p) return;
  T(() => p.teleport({ x, z, yaw, pitch, seated: false }), 'teleport');
  Object.assign(p.rig, { x: 0, z: 0, height: 0, pitch: 0, roll: 0 });
  p.enabled = enabled;
}

// ---------------------------------------------------------------------------
// 時鐘、側邊螢幕、目標
// ---------------------------------------------------------------------------
export function setClock(ctx, text) {
  ctx.flags.clockText = text;
  T(() => ctx.controlRoom?.setClock?.(text), 'setClock');
}
export function clockAt(minutesFromStart) { return addMinutes('02:00', minutesFromStart); }
export function minuteOf(text) { return minutesBetween('02:00', text); }

/** SYS LOG：SCRIPT.status.logLines 中時間 ≤ clockText 的行。 */
export function logLinesUpTo(ctx, clockText) {
  const now = toMin(clockText || '02:00');
  return ctx.SCRIPT.status.logLines.filter((l) => toMin(l.slice(0, 5)) <= now);
}
const LOG_KEEP = 8;   // SYS LOG 只顯示最後 8 行
/**
 * 左螢幕 SYS LOG：靜態行（logLines 中 ≤ clockText 的行）與動態行（flags.logExtra，pushLog 加入）依 HH:MM 穩定排序合併
 * （同一分鐘：靜態行在前，動態行依加入順序），保留最後 8 行。內容沒變就不重畫。
 */
export function setLeftLog(ctx, clockText = ctx.flags.clockText, tone = 'normal') {
  const S = ctx.SCRIPT.status;
  const f = ctx.flags;
  const items = logLinesUpTo(ctx, clockText).map((l, i) => ({ l, k: toMin(l.slice(0, 5)), o: 0, i }));
  (Array.isArray(f.logExtra) ? f.logExtra : []).forEach((l, i) => items.push({ l, k: toMin(l.slice(0, 5)), o: 1, i }));
  items.sort((a, b) => a.k - b.k || a.o - b.o || a.i - b.i);
  const lines = items.slice(-LOG_KEEP).map((x) => x.l);
  f._leftClock = clockText;
  f._leftTone = tone;
  const key = `${tone}|${lines.join('\n')}`;
  if (f._leftKey === key) return;
  f._leftKey = key;
  T(() => ctx.feeds?.setStatus?.('left', { title: S.leftTitle, lines, tone }), 'setStatus');
}
/** SYS LOG 加一行動態紀錄（text 以 'HH:MM ' 開頭）並立刻重畫（沿用目前的時鐘與色調）。 */
export function pushLog(ctx, text) {
  const f = ctx.flags;
  if (!text) return;
  if (!Array.isArray(f.logExtra)) f.logExtra = [];
  f.logExtra.push(String(text));
  setLeftLog(ctx, f._leftClock || f.clockText, f._leftTone || 'normal');
}
export function setLeftIncident(ctx) {
  const R = ctx.SCRIPT.incidentReport;
  ctx.flags._leftKey = 'incident';
  T(() => ctx.feeds?.setStatus?.('left', { title: R.title, lines: R.lines, tone: 'alert' }), 'setStatus');
}
/**
 * 右螢幕：key ∈ normal | normalUnlocked | ventFault | ventDying | blackout | restored
 * 上鎖閘門開啟時，'normal' 會依防爆門實際狀態顯示（尚未上鎖 → normalUnlocked「防爆門：未鎖定」）。
 */
export function setRight(ctx, key, tone = 'normal') {
  const S = ctx.SCRIPT.status;
  if (key === 'normal' && S.normalUnlocked && !ctx.flags.blastLocked && paceFlags(ctx).lock) key = 'normalUnlocked';
  ctx.flags.rightStatus = key;
  T(() => ctx.feeds?.setStatus?.('right', { title: S.rightTitle, lines: S[key] || S.normal, tone }), 'setStatus');
}

export function setObjective(ctx, key) {
  const text = key ? ctx.SCRIPT.objectives[key] ?? key : null;
  if (ctx.flags.objective === key) return;
  ctx.flags.objective = key;
  T(() => ctx.ui?.setObjective?.(text), 'setObjective');
}

export function setLimits(ctx, min, max) {
  T(() => ctx.feeds?.setFigureLimits?.({ min, max }), 'setFigureLimits');
}

export function setCorruption(ctx, c, duration = 2) {
  ctx.flags.corruption = c;
  T(() => ctx.controlRoom?.setCorruption?.(c, { duration }), 'setCorruption');
}
export function setCoffee(ctx, stage) {
  ctx.flags.coffeeStage = stage;
  T(() => ctx.controlRoom?.setCoffeeStage?.(stage), 'setCoffeeStage');
}

// ---------------------------------------------------------------------------
// 氛圍：scene.fog（FogExp2）——唯一擁有者
// ---------------------------------------------------------------------------
const FOG = {
  room: { density: 0.028, color: new THREE.Color('#050506') },
  roomRestored: { density: 0.04, color: new THREE.Color('#0b0806') },
  corridor: { density: 0.12, color: new THREE.Color('#06070a') },
  switchRoom: { density: 0.07, color: new THREE.Color('#06070a') },
  // 終幕濃煙：大部分時間維持中等濃度（2–4 m 內的焦黑房間仍看得見），只有最後（smokeLevel → 1）才變得很濃。
  // 霧色 = 被室內光照亮的煙霾色（controlRoom.hazeColor），隨終幕燈光變化。
  smoke: { density: 0.15, colorK: 0.5, color: new THREE.Color('#0a0806') },
  smokeThick: { density: 0.5 },
};
const _fogCol = new THREE.Color();
const _fogTmp = new THREE.Color();
const _smokeCol = new THREE.Color();

function fogTarget(ctx, out) {
  const cam = ctx.camera.position;
  const restored = !!(ctx.flags.powerRestored || ctx.flags.roomDecayed);
  const room = restored ? FOG.roomRestored : FOG.room;
  // 主控室 → 門口 → 廊道（以相機 x 連續混合，避免區域切換時霧突然變化）
  const wCorr = smoothstep(3.3, 4.9, cam.x);
  // 廊道 → 轉角 → 電閘室
  const wSw = cam.x > 35.5 ? smoothstep(7.2, 8.8, cam.z) : 0;
  let d = lerp(room.density, FOG.corridor.density, wCorr);
  out.copy(room.color).lerp(FOG.corridor.color, wCorr);
  d = lerp(d, FOG.switchRoom.density, wSw);
  out.lerp(FOG.switchRoom.color, wSw);
  // 濃煙（終幕）：煙團先沿天花板翻滾進來（煙層由 ControlRoom 處理），霧只隨著煙量慢慢增加到中等濃度，
  // 最後一段（smokeLevel 0.8 → 1）才變得很濃。霧色跟著被照亮的煙色走。
  const s = clamp(ctx.controlRoom?.smokeLevel ?? 0);
  if (s > 0) {
    const k = smoothstep(0.04, 0.62, s);
    d = lerp(d, FOG.smoke.density, k);
    d = lerp(d, FOG.smokeThick.density, smoothstep(0.8, 1, s));
    out.lerp(smokeFogColor(ctx, _smokeCol), k);
  }
  return d;
}

/** 濃煙的霧色：被室內光照亮的煙霾色（ControlRoom.hazeColor；舊版退回 smokeColor × colorK），都沒有時用預設的深褐。 */
function smokeFogColor(ctx, out) {
  const cr = ctx.controlRoom;
  if (cr?.hazeColor?.isColor) return out.copy(cr.hazeColor);
  if (cr?.smokeColor?.isColor) return out.copy(cr.smokeColor).multiplyScalar(FOG.smoke.colorK);
  return out.copy(FOG.smoke.color);
}

function ensureFog(ctx) {
  if (!ctx.scene.fog || !ctx.scene.fog.isFogExp2) ctx.scene.fog = new THREE.FogExp2(0x050506, 0.028);
  return ctx.scene.fog;
}

/** 每幀：霧的密度與顏色平滑趨近區域目標。 */
export function updateAtmosphere(ctx, dt) {
  const fog = ensureFog(ctx);
  const d = fogTarget(ctx, _fogCol);
  // 濃煙時跟得比較快（煙本身已經是 7 秒的緩慢變化），其餘時間慢慢過渡
  const smoke = ctx.controlRoom?.smokeLevel ?? 0;
  const lambda = smoke > 0.01 ? 4 : 2.2;
  fog.density = damp(fog.density, d, lambda, dt);
  fog.color.lerp(_fogCol, 1 - Math.exp(-lambda * dt));
  // postfx 的煙霾也用被照亮的煙色（只在有煙時更新；平常保持 PostFX 的預設）
  const pf = ctx.postfx;
  if (smoke > 0.001 && pf?.smokeColor?.isColor) pf.smokeColor.copy(smokeFogColor(ctx, _smokeCol));
}
/** 直接設定（跳關/重置時，畫面全黑中使用）。 */
export function snapAtmosphere(ctx) {
  const fog = ensureFog(ctx);
  fog.density = fogTarget(ctx, _fogTmp);
  fog.color.copy(_fogTmp);
}

// ---------------------------------------------------------------------------
// StoryState：劇情狀態基底
// ---------------------------------------------------------------------------
export class StoryState extends BaseState {
  get S() { return this.ctx.SCRIPT; }
  get flags() { return this.ctx.flags; }
  update(dt, t) {
    updateAtmosphere(this.ctx, dt);
    if (this.tick) {
      try { this.tick(dt, t); } catch (e) { console.error(`[${this.name}] tick error`, e); }
    }
  }
  /** postfx 參數補間（受 epoch 保護：離開狀態即停止）。 */
  postTo(param, value, duration = 1, ease = 'inOut') {
    const p = this.ctx.postfx?.params;
    if (!p) return this.wait(duration);
    const from = typeof p[param] === 'number' ? p[param] : 0;
    if (duration <= 0) { p[param] = value; return Promise.resolve(); }
    return this.tween(duration, (k) => { p[param] = from + (value - from) * k; }, ease);
  }
  fadeTo(value, duration = 1, ease = 'inOut') { return this.postTo('fade', value, duration, ease); }
  /** bus.on 並在離開狀態時自動解除。 */
  on(type, fn) {
    return this.own(this.ctx.bus.on(type, (p) => {
      if (!this.alive) return;
      try {
        const r = fn(p);
        if (r && typeof r.catch === 'function') r.catch((e) => console.error(`[${this.name}] ${type} handler rejected`, e));
      } catch (e) { console.error(`[${this.name}] ${type} handler`, e); }
    }));
  }
  /**
   * 這次進入是否需要套用世界預設：只有前一幕「演完」後以 { natural: true } 接過來時才沿用現有世界；
   * ?state= 直接進入、除錯跳關（BS.fsm.go(name)）一律套用預設。
   */
  isDirect(data, naturalPrev) {
    if (data && data.preset === true) return true;
    if (!(data && data.natural)) return true;
    const h = this.fsm.history;
    const prev = h.length >= 2 ? h[h.length - 2] : null;
    return prev !== naturalPrev;
  }
  /** 自然銜接時的保險：若畫面仍未完全淡入，平滑淡入。 */
  ensureVisible(duration = 1.2) {
    const p = this.ctx.postfx?.params;
    if (p && p.fade > 0.01) this.fadeTo(0, duration);
  }
  /** 延遲重複提示（例如玩家遲遲沒有接聽對講機）。pred() 為 false 即停止。 */
  async nag(pred, text, first = 40, every = 55) {
    const tok = (this._nagTok = (this._nagTok || 0) + 1);
    await this.wait(first);
    while (pred() && this._nagTok === tok) {
      T(() => this.ctx.ui?.hint?.(text, 5), 'hint');
      await this.wait(every);
    }
  }
}

// ---------------------------------------------------------------------------
// 對講機
// ---------------------------------------------------------------------------
/** 響鈴（琥珀燈脈動＋柔和蜂鳴）＋目標「接聽」。 */
export function ringIntercom(ctx, objectiveKey = 'answer') {
  ctx.flags.intercomRinging = true;
  T(() => ctx.controlRoom?.setIntercomLed?.('ringing'), 'intercomLed');
  T(() => ctx.audio?.setIntercomRing?.(true), 'ring');
  setObjective(ctx, objectiveKey);
}
export function stopRinging(ctx) {
  ctx.flags.intercomRinging = false;
  T(() => ctx.audio?.setIntercomRing?.(false), 'ring');
}

/**
 * 播放對講機第 stageIndex 段（0..3）：通話燈 → 字幕說話者 → 逐段 append(text) 並等待 dur
 * → 等待音訊 done → 保留全文約 1.5 秒 → 清除、熄燈。最終畫面字串 = SCRIPT.intercom[i].full。
 * 若狀態在通話中被切走：自動中止語音、清字幕、熄燈。
 */
export async function playIntercom(state, stageIndex, { hold = 1.5 } = {}) {
  const ctx = state.ctx;
  const S = ctx.SCRIPT;
  const stage = S.intercom[stageIndex];
  if (!stage) return;
  stopRinging(ctx);
  ctx.flags.intercomTalking = true;
  T(() => ctx.controlRoom?.setIntercomLed?.('talking'), 'intercomLed');
  T(() => ctx.subtitles?.show?.('', { speaker: stage.clean ? S.intercomSpeakerClean : S.intercomSpeaker }), 'subtitles');
  let done = null;
  const res = T(() => ctx.audio?.playIntercom?.(stageIndex), 'playIntercom');
  done = res?.done || null;
  let finished = false;
  state.own(() => {
    if (finished) return;
    ctx.flags.intercomTalking = false;
    T(() => ctx.audio?.stopIntercom?.(0.4));
    T(() => ctx.subtitles?.clear?.(0.4));
    T(() => ctx.controlRoom?.setIntercomLed?.('off'));
  });
  // 字幕與語音同步：語音在 AudioContext 時鐘上播放，遊戲時鐘在低幀率時（每幀 dt 上限 0.1 秒）會比真實時間慢，
  // 所以每一段字幕在「遊戲時間到了」或「語音時間到了」兩者較早的那一刻出現（暫停時兩個時鐘都停）。
  // 以語音開始時間為基準累加（不會逐段累積誤差）；沒有音訊時只看遊戲時間。
  const audio = ctx.audio;
  const a0 = Number.isFinite(res?.startAt) ? res.startAt : null;
  const audioAt = () => {
    try { return a0 != null && audio?.ready && audio.ac?.state === 'running' ? audio.now() - a0 : -Infinity; } catch (e) { return -Infinity; }
  };
  const g0 = ctx.clock.time;
  const until = (cum) => state.until(() => ctx.clock.time - g0 >= cum - 1e-6 || audioAt() >= cum);
  let cum = 0;
  for (const seg of stage.segments) {
    T(() => ctx.subtitles?.append?.(seg.text), 'subtitles');
    cum += Number(seg.dur) || 0;
    await until(cum);
  }
  if (done) await state.guard(Promise.race([done, ctx.clock.wait(2), until(cum)]));
  await until(cum + hold);
  finished = true;
  T(() => ctx.subtitles?.clear?.(0.8), 'subtitles');
  T(() => ctx.controlRoom?.setIntercomLed?.('off'), 'intercomLed');
  ctx.flags.intercomTalking = false;
}

// ---------------------------------------------------------------------------
// 世界預設（直接進入用）
// ---------------------------------------------------------------------------
/** 劇情旗標的初始值（loopCount 保留）。 */
export function resetFlags(ctx) {
  const f = ctx.flags;
  const keep = { loopCount: f.loopCount || 0 };
  for (const k of Object.keys(f)) delete f[k];
  Object.assign(f, {
    clockText: ctx.CLOCK.start,
    corruption: 0,
    returnsFromCorridor: 0,
    hasFlashlight: false,
    powerRestored: false,
    itemsFound: { watch: false, logbook: false, coat: false },
    coffeeStage: 0,
    loopCount: keep.loopCount,
    // ---- 狀態自行增加 ----
    noteRead: false,
    intercomRinging: false,
    intercomTalking: false,
    ventFault: false,
    ventDying: false,
    ventStopped: false,
    ventCut: false,           // 拉桿已拉下（第三幕揭露：其實是手動切斷）
    heartbeat: false,
    blackout: false,
    sideDoorOpen: false,
    headlightsSeen: false,
    inCorridor: false,
    breakerPulling: false,
    ventRestarting: false,
    roomDecayed: false,
    unlockArmed: false,
    endingStarted: false,
    objective: null,
    rightStatus: 'normal',
    _leftKey: null,
    // ---- 監看節奏改版（docs/pacing/spec.md） ----
    blastLocked: !paceFlags(ctx).lock,   // 上鎖閘門開啟時，序幕/循環開始時防爆門「未鎖定」
    lockPending: false,                  // 02:00 等待玩家上鎖
    blastLocking: false,                 // 上鎖動畫進行中
    doorKnocked: false,                  // 02:05 敲門已發生（防爆門檢視附加「鋼板摸起來是溫的。」）
    logExtra: [],                        // SYS LOG 動態行（pushLog）
    minuteK: null,                       // 導演發布的「這一分鐘進行到哪」0..0.999（CameraFeeds 的 OSD 秒數）；null = 舊公式
    motionHintShown: false,              // 動態偵測的一次性提示
  });
}

export function audioQuiet(ctx, ramp = 0.3, { keepHum = false } = {}) {
  const a = ctx.audio;
  if (!a) return;
  T(() => a.stopIntercom?.(ramp));
  T(() => a.setIntercomRing?.(false));
  T(() => a.setFootstepEcho?.({ enabled: false }));
  T(() => a.setSilence?.(0, ramp));
  T(() => a.setAlarm?.(false));
  T(() => a.setSmokeRoar?.(0, ramp));
  T(() => a.setCorridorAmbience?.(0, ramp));
  T(() => a.setTunnelRumble?.(0, ramp));
  T(() => a.setHeartbeat?.(60, 0, ramp));
  if (!keepHum) T(() => a.setHum?.(0, ramp));
  T(() => a.setVent?.({ level: 0, rate: 1, detune: 0 }, ramp));
  T(() => a.setRoomTone?.(0, ramp));
}
export function audioRoomNormal(ctx, ramp = 2) {
  const a = ctx.audio;
  T(() => a?.setHum?.(AMB.hum, ramp));
  T(() => a?.setVent?.(AMB.vent, ramp));
  T(() => a?.setRoomTone?.(AMB.room, ramp));
}

/** 設定 ControlRoom 的 blastDoorOpen 旗標（GazeSystem / Interaction 的結構遮蔽會讀它）；若對方已定義唯讀屬性則略過。 */
export function setBlastDoorFlag(ctx, open) {
  const cr = ctx.controlRoom;
  if (!cr) return;
  const own = Object.getOwnPropertyDescriptor(cr, 'blastDoorOpen');
  if (own ? own.writable : !('blastDoorOpen' in cr)) cr.blastDoorOpen = !!open;
}

/**
 * 回到 02:00 序幕初始世界（全部瞬間完成；應在畫面全黑時呼叫）。
 * opts.keepAudio = true：不動持續音層（終幕用：警報變形成的日光燈嗡鳴要延續到寫字的畫面）。
 */
export function resetWorld(ctx, opts = {}) {
  const cr = ctx.controlRoom, fd = ctx.feeds, co = ctx.corridor, p = ctx.player;
  if (ctx.inspect?.isOpen) T(() => ctx.inspect.close(), 'inspect.close');
  T(() => ctx.subtitles?.clear?.(0), 'subtitles');
  T(() => ctx.ui?.setPrompt?.(null));
  T(() => ctx.ui?.setLetterbox?.(0, 0));
  T(() => ctx.ui?.hideEndChoice?.());
  resetFlags(ctx);
  T(() => ctx.ui?.setObjective?.(null));
  if (ctx.interact) ctx.interact.locked = false;

  // ---- 主控室 ----
  T(() => cr?.reset?.(), 'controlRoom.reset');
  T(() => cr?.setCorruption?.(0, { duration: 0 }));
  T(() => cr?.setBurnt?.(0, { duration: 0 }));
  T(() => cr?.setSmoke?.(0, { duration: 0 }));
  T(() => cr?.setUnlockGlow?.(false));
  T(() => cr?.setNoteVisible?.('monitor', true));
  T(() => cr?.setNoteVisible?.('ending', false));
  T(() => cr?.setLoopTallies?.(ctx.flags.loopCount || 0));
  T(() => cr?.setIntercomLed?.('off'));
  T(() => cr?.setVentLed?.('ok'));
  T(() => cr?.setVentGauge?.(null));
  setBlastDoorFlag(ctx, false);
  // 上鎖閘門：循環開始時防爆門未上鎖（鎖栓縮回、門燈綠），由玩家在 02:00 親手鎖上；?lock=0 / ?pace=0 時維持鎖定
  if (paceFlags(ctx).lock) T(() => cr?.setBlastLocked?.(false, { duration: 0 }), 'setBlastLocked');
  setClock(ctx, ctx.CLOCK.start);
  setCoffee(ctx, 0);

  // ---- 廊道 ----
  T(() => co?.reset?.(), 'corridor.reset');

  // ---- 監視器 ----
  T(() => fd?.reset?.(), 'feeds.reset');
  T(() => fd?.setHDAction?.(false));
  setLimits(ctx, 0, 0);
  if (fd) { fd.brightness = 1; fd.subPoses = paceFlags(ctx).subposes; fd.trailOn = paceFlags(ctx).pace; }
  setLeftLog(ctx, ctx.CLOCK.start, 'normal');
  setRight(ctx, 'normal', 'normal');

  // ---- 玩家 ----
  if (p) {
    T(() => p.setFlashlight?.(false, 0));
    p.hasFlashlight = false;
    T(() => p.setPortal?.('sideDoor', false));
    T(() => p.refreshObstacles?.());
  }
  placeSeated(ctx, { enabled: false });

  // ---- 後期與聲音 ----
  const pp = ctx.postfx?.params;
  if (pp) { pp.fade = 1; pp.smoke = 0; pp.dim = 0; pp.desaturate = 0; }
  if (!opts.keepAudio) audioQuiet(ctx, 0.3);
  snapAtmosphere(ctx);
}

/** 防爆門瞬間上鎖（跳關/直接進入後期狀態用；畫面全黑中）。 */
export function lockBlastDoorNow(ctx) {
  ctx.flags.blastLocked = true;
  ctx.flags.lockPending = false;
  ctx.flags.blastLocking = false;
  T(() => ctx.controlRoom?.setBlastLocked?.(true, { duration: 0 }), 'setBlastLocked');
}

/** 第一幕末（02:12 之後）的世界：通風已停、聽覺真空、心跳、人影在門前。 */
function lateMonitoringWorld(ctx) {
  const cr = ctx.controlRoom, fd = ctx.feeds;
  T(() => cr?.setVentLever?.(true));
  T(() => cr?.setVentLed?.('off'));
  lockBlastDoorNow(ctx);
  ctx.flags.ventCut = true; ctx.flags.ventDying = true; ctx.flags.ventStopped = true; ctx.flags.heartbeat = true;
  setClock(ctx, '02:13');
  T(() => fd?.setFigureIndex?.(7));
  setLimits(ctx, 7, 7);
  setLeftLog(ctx, '02:13', 'warn');
  setRight(ctx, 'ventDying', 'warn');
  const a = ctx.audio;
  T(() => a?.setHum?.(AMB.hum, 0.4));
  T(() => a?.setRoomTone?.(AMB.room * 0.7, 0.4));
  T(() => a?.setSilence?.(0.6, 0.4));
  T(() => a?.setHeartbeat?.(76, 0.75, 0.6));
}

/** 復電後（第三幕）的世界：昏暗暖色、陳舊、側門開著、手電筒已取下、通風被手動切斷。 */
function restoredWorld(ctx) {
  const cr = ctx.controlRoom, fd = ctx.feeds, co = ctx.corridor, p = ctx.player, f = ctx.flags;
  T(() => cr?.setLighting?.('restored', { duration: 0 }));
  setCorruption(ctx, 0.62, 0);
  setCoffee(ctx, 1);
  T(() => cr?.openSideDoor?.(0));
  T(() => p?.setPortal?.('sideDoor', true));
  T(() => cr?.takeFlashlight?.());
  T(() => cr?.setVentLever?.(true));
  T(() => cr?.setVentLed?.('off'));
  lockBlastDoorNow(ctx);
  T(() => co?.setPower?.(true, { duration: 0 }));
  const lever = co?.objects?.breakerLever;
  if (lever) lever.rotation.x = -0.5; // LEVER_ON（已復歸）
  if (p) p.hasFlashlight = true;
  Object.assign(f, {
    hasFlashlight: true, sideDoorOpen: true, powerRestored: true, roomDecayed: true, blackout: false,
    ventCut: true, ventDying: true, ventStopped: true, headlightsSeen: true, returnsFromCorridor: 1,
  });
  f.itemsFound = { watch: true, logbook: true, coat: true };
  setClock(ctx, '02:14');
  T(() => fd?.setFigureIndex?.(7));          // LD 的他早已到門前（HD 畫面裡他一直都在門口）
  T(() => fd?.setMode?.('STATIC'));
  setLeftLog(ctx, '02:14', 'warn');
  setRight(ctx, 'blackout', 'alert');
  const a = ctx.audio;
  T(() => a?.setHum?.(0.32, 0.4));
  T(() => a?.setRoomTone?.(0.35, 0.4));
  T(() => a?.setTunnelRumble?.(0.1, 0.4));
  T(() => a?.setHeartbeat?.(58, 0.3, 0.6));
}

/**
 * 直接進入某狀態時套用的世界預設（燈光、腐化、咖啡、門、手電筒、監視器、時鐘、霧、聲音、玩家、淡出、目標、旗標）。
 * 都是瞬間設定：畫面會停在全黑（postfx.fade = 1），由狀態自行淡入。
 */
export function applyPreset(ctx, stateName, opts = {}) {
  const cr = ctx.controlRoom, fd = ctx.feeds, L = ctx.LAYOUT;
  resetWorld(ctx);
  switch (stateName) {
    case STATES.TITLE:
    case STATES.PROLOGUE: {
      // 全黑、無聲；日光燈未亮、CRT 未開；玩家趴在桌上
      T(() => cr?.setLighting?.('off', { duration: 0 }));
      T(() => fd?.setMode?.('OFF'));
      placePlayer(ctx, L.SPAWN.seated, slumpedPose(ctx), { enabled: false });
      break;
    }
    case STATES.MONITORING: {
      T(() => cr?.setLighting?.('normal', { duration: 0 }));
      T(() => fd?.setMode?.('LD'));
      T(() => fd?.setChannel?.(3));
      setLimits(ctx, 0, 2);
      audioRoomNormal(ctx, 0.5);
      ctx.flags.noteRead = true;
      placeSeated(ctx, { enabled: true });
      setObjective(ctx, 'monitor');
      break;
    }
    case STATES.BLACKOUT_CORRIDOR: {
      T(() => cr?.setLighting?.('normal', { duration: 0 }));
      T(() => fd?.setMode?.('LD'));
      ctx.flags.noteRead = true;
      lateMonitoringWorld(ctx);
      // 剛接完 02:13 的對講機：站在西牆對講機前
      placeStanding(ctx, { x: L.CONTROL_ROOM.intercom.x + 0.75, z: L.CONTROL_ROOM.intercom.z, yaw: Math.PI / 2, pitch: -0.05 }, { enabled: true });
      break;
    }
    case STATES.REVELATION: {
      ctx.flags.noteRead = true;
      restoredWorld(ctx);
      // 剛從側門走回主控室，望向控制台
      const from = { x: 3.3, z: 1.85 };
      const { yaw } = lookAngles({ x: from.x, y: 1.62, z: from.z }, points(ctx).mainScreen);
      placeStanding(ctx, { ...from, yaw, pitch: -0.08 }, { enabled: true });
      break;
    }
    case STATES.ENDING_LOOP: {
      ctx.flags.noteRead = true;
      restoredWorld(ctx);
      setCorruption(ctx, 0.85, 0);
      setCoffee(ctx, 2);
      T(() => fd?.setMode?.('HD'));
      T(() => fd?.setChannel?.(3));
      T(() => fd?.setHDAction?.(true));
      setLeftIncident(ctx);
      setRight(ctx, 'restored', 'warn');
      // 站在控制台左翼、解鎖鈕前
      const u = L.CONTROL_ROOM.unlockButton;
      const from = { x: u.x + 0.05, z: -1.62 };
      const { yaw, pitch } = lookAngles({ x: from.x, y: L.EYE.standing, z: from.z }, { x: u.x, y: u.y, z: u.z });
      placeStanding(ctx, { ...from, yaw, pitch }, { enabled: true });
      break;
    }
    default: break;
  }
  if (opts.fade != null && ctx.postfx?.params) ctx.postfx.params.fade = opts.fade;
  snapAtmosphere(ctx);
}

// ---------------------------------------------------------------------------
// 可互動物件
// ---------------------------------------------------------------------------
const _cloneCache = new WeakMap();
/** InspectView 用的 3D 物件複本（位置/旋轉歸零；共用幾何與材質）。fresh = false 時每個來源只複製一次。 */
function inspectClone(obj, fresh = false) {
  if (!obj) return undefined;
  let c = fresh ? null : _cloneCache.get(obj);
  if (!c) {
    try {
      c = obj.clone(true);
    } catch (e) {
      console.warn('[states] inspect clone failed', e);
      return undefined;
    }
    c.position.set(0, 0, 0);
    c.rotation.set(0, 0, 0);
    c.visible = true;
    _cloneCache.set(obj, c);
  }
  return c;
}

function openInspect(ctx, o) {
  const iv = ctx.inspect;
  if (!iv || iv.isOpen) return Promise.resolve();
  try {
    const r = iv.open(o);
    return r && typeof r.then === 'function' ? r : Promise.resolve();
  } catch (e) {
    console.error('[states] inspect.open failed', e);
    return Promise.resolve();
  }
}

/** 只有描述文字的短檢視（電子鐘、側門電磁鎖、對講機待機、通風正常）。 */
function shortInspect(ctx, id, title, text) {
  return openInspect(ctx, { id, title, body: [text] });
}

/**
 * 註冊全部可互動物件（只呼叫一次）。label / verb / enabled 皆依 ctx.flags 與目前狀態求值；
 * 劇情動作只發出 bus 事件，由當下的狀態處理。
 */
export function registerCommonInteractables(ctx) {
  const it = ctx.interact;
  if (!it || ctx._interactablesRegistered) return;
  ctx._interactablesRegistered = true;
  const S = ctx.SCRIPT, V = S.verbs, I = S.interact, D = S.descriptions, f = () => ctx.flags;
  const cr = ctx.controlRoom?.objects || {}, co = ctx.corridor?.objects || {};
  const playing = () => !inState(ctx, STATES.TITLE) && !f().endingStarted;
  // 終幕：防爆門緊急解鎖亮起後，它是唯一可互動的目標（沒有其他提示、不能切 CAM、不能檢視）
  const allowed = (id) => !f().unlockArmed || id === 'unlock';
  const add = (o) => {
    if (!o.object) { console.warn('[states] interactable without object:', o.id); return; }
    const enabled = o.enabled || (() => true);
    const ok = () => playing() && allowed(o.id) && !!enabled();
    const wrapped = {
      ...o,
      enabled: ok,
      // Interaction.trigger() 不檢查 enabled：onUse 自己再確認一次
      onUse: () => { if (ok()) o.onUse(); },
    };
    it.add(wrapped);
  };
  const emit = (type, payload = {}) => ctx.bus.emit(type, payload);

  // ---- 便利貼 ----
  add({
    id: 'stickyNote', object: cr.stickyNote, distance: 2.0,
    label: I.stickyNote, verb: V.inspect,
    enabled: () => cr.stickyNote?.visible !== false,
    onUse: () => {
      T(() => ctx.audio?.sfx?.('paper', { position: cr.stickyNote.getWorldPosition(new THREE.Vector3()), gain: 0.7 }));
      openInspect(ctx, { id: 'stickyNote', title: S.stickyNote.title, body: [S.stickyNote.text], object: inspectClone(cr.stickyNote) })
        .then(() => { ctx.flags.noteRead = true; });
    },
  });

  // ---- 咖啡 ----
  add({
    id: 'coffee', object: cr.coffee, distance: 2.0,
    label: () => S.items.coffee.title, verb: V.inspect,
    onUse: () => {
      const st = clamp(ctx.flags.coffeeStage | 0, 0, 2);
      let body = S.items.coffee.stages[st];
      // 【補充文案】T2：02:08 起，咖啡一點都沒有變涼（時間不對勁）
      if (st === 0 && D.coffeeStill && paceFlags(ctx).pace && inState(ctx, STATES.MONITORING) && toMin(f().clockText || '02:00') >= toMin('02:08')) {
        body = [...body, D.coffeeStill];
      }
      openInspect(ctx, { id: 'coffee', title: S.items.coffee.title, body, object: inspectClone(cr.coffee, true) })
        .then(() => { if (st === 0) T(() => ctx.audio?.sfx?.('mug', { position: cr.coffee.getWorldPosition(new THREE.Vector3()), gain: 0.6 })); });
    },
  });

  // ---- CAM-01..04 按鈕 ----
  const camOk = () => ['LD', 'HD', 'STATIC'].includes(ctx.feeds?.mode);
  (cr.camButtons || []).forEach((btn, i) => {
    const n = i + 1;
    add({
      id: `cam${n}`, object: btn, distance: 1.7,
      // 該頻道有未查看的動態偵測：提示改為「切換至 CAM-0n（動態偵測）」（色弱玩家也看得出琥珀燈的意思）
      label: () => (I.camButtonAlert && ctx.feeds?.isAlerted?.(n) ? I.camButtonAlert(n) : I.camButton(n)), verb: V.press,
      enabled: camOk,
      onUse: () => {
        // 觸控：玩家直接點按鈕、看不到準心提示 → 點到有動態偵測的頻道時，把同一句提示淡入 1.6 秒（色弱玩家的文字線索）
        if (ctx.input?.touch && I.camButtonAlert && ctx.feeds?.isAlerted?.(n) && !ctx.ui?.hintVisible?.()) {
          T(() => ctx.ui.hint(I.camButtonAlert(n), 1.6), 'camAlertHint');
        }
        T(() => ctx.feeds.setChannel(n), 'setChannel');
        T(() => ctx.controlRoom.pressCamButton(i), 'pressCamButton');
        T(() => ctx.audio?.sfx?.('camSwitch', { position: btn.getWorldPosition(new THREE.Vector3()) }));
      },
    });
  });

  // ---- 電子鐘 ----
  add({
    id: 'clock', object: cr.clock, distance: 3.2,
    label: I.clock, verb: V.inspect,
    onUse: () => shortInspect(ctx, 'clock', I.clock, D.clock),
  });

  // ---- 防爆門 ----
  // 02:00 上鎖閘門（監看中、等待上鎖）：「上鎖　防爆門氣壓閥手輪」→ emit 'blastDoor:lock'（MonitoringState.onLock）。
  // 其餘時候是檢視：上鎖前「氣壓閥沒有加壓……」；上鎖後原企劃「防爆門已從內部反鎖……」，02:05 敲門後（復電前）附加「鋼板摸起來是溫的。」
  const lockable = () => inState(ctx, STATES.MONITORING) && !!f().lockPending && !f().blastLocked;
  const blastDoorBody = () => {
    if (!f().blastLocked && D.blastDoorUnlocked) return [D.blastDoorUnlocked];
    const body = [S.prompts.blastDoorLocked];
    if (f().doorKnocked && !f().powerRestored && D.blastDoorWarm) body.push(D.blastDoorWarm);
    return body;
  };
  add({
    id: 'blastDoor', object: cr.blastDoor, distance: 2.6,
    label: () => (lockable() ? I.blastDoorWheel : I.blastDoor),
    verb: () => (lockable() ? V.lock : V.inspect),
    enabled: () => !f().endingStarted && !f().blastLocking,
    onUse: () => {
      if (lockable()) emit('blastDoor:lock', {});
      else openInspect(ctx, { id: 'blastDoor', title: I.blastDoor, body: blastDoorBody() });
    },
  });

  // ---- 緊急對講機 ----
  add({
    id: 'intercom', object: cr.intercom, distance: 2.2,
    label: () => (f().intercomRinging ? I.intercomRinging : I.intercomIdle),
    verb: () => (f().intercomRinging ? V.answer : V.inspect),
    enabled: () => !f().intercomTalking,
    onUse: () => {
      if (f().intercomRinging) {
        T(() => ctx.audio?.sfx?.('button', { position: points(ctx).intercom, gain: 0.8 }));
        emit('intercom:answer', {});
      } else shortInspect(ctx, 'intercom', I.intercomIdle, D.intercomIdle);
    },
  });

  // ---- 通風控制面板 ----
  const ventStatusText = () => {
    const st = S.status;
    if (f().powerRestored || f().roomDecayed) return st.restored[1];
    if (f().blackout) return st.blackout[1];
    if (f().ventDying || f().ventStopped) return st.ventDying[1];
    return D.ventOk;
  };
  add({
    id: 'vent', object: cr.ventPanel, distance: 2.2,
    label: () => (f().ventFault ? I.ventPanel : I.ventPanelOk),
    verb: () => (f().ventFault ? V.pull : V.inspect),
    enabled: () => !f().ventRestarting,
    onUse: () => {
      if (f().ventFault) emit('vent:restart', {});
      else shortInspect(ctx, 'vent', I.ventPanelOk, ventStatusText());
    },
  });

  // ---- 側門 ----
  add({
    id: 'sideDoor', object: cr.sideDoor, distance: 2.3,
    label: () => (f().blackout ? I.sideDoor : I.sideDoorLocked),
    verb: () => (f().blackout ? V.open : V.inspect),
    enabled: () => !f().sideDoorOpen,
    onUse: () => {
      if (f().blackout) {
        if (f().hasFlashlight) emit('sideDoor:open', {});
        else T(() => ctx.ui?.hint?.(S.objectives.blackout, 4));
      } else shortInspect(ctx, 'sideDoor', I.sideDoorLocked, D.sideDoorLocked);
    },
  });

  // ---- 緊急手電筒 ----
  add({
    id: 'flashlight', object: cr.flashlightBox, distance: 2.2,
    label: I.flashlight, verb: V.take,
    enabled: () => f().blackout && !f().hasFlashlight,
    onUse: () => emit('flashlight:take', {}),
  });

  // ---- 防爆門緊急解鎖 ----
  add({
    id: 'unlock', object: cr.unlockButton, distance: 2.0,
    label: S.prompts.unlockButton, verb: V.press,
    enabled: () => f().unlockArmed,
    onUse: () => emit('unlock:press', {}),
  });

  // ---- 廊道：防火門玻璃 ----
  add({
    id: 'fireDoorGlass', object: co.fireDoorGlass, distance: 2.3,
    label: I.fireDoorGlass, verb: V.inspect,
    enabled: () => f().headlightsSeen,
    onUse: () => openInspect(ctx, { id: 'fireDoorGlass', title: S.items.fireDoorGlass.title, body: S.items.fireDoorGlass.body }),
  });

  // ---- 廊道：線索物件 ----
  for (const k of ['watch', 'logbook', 'coat']) {
    add({
      id: k, object: co[k], distance: k === 'coat' ? 2.3 : 2.6,
      label: I[k], verb: V.inspect,
      onUse: () => {
        ctx.flags.itemsFound[k] = true;
        T(() => ctx.corridor?.markInspected?.(k), 'markInspected');
        if (k === 'logbook') T(() => ctx.audio?.sfx?.('paper', { position: co[k].getWorldPosition(new THREE.Vector3()), gain: 0.8 }));
        openInspect(ctx, { id: k, title: S.items[k].title, body: S.items[k].body, object: inspectClone(co[k]) });
      },
    });
  }

  // ---- 電閘室總開關 ----
  add({
    id: 'breaker', object: co.breaker, distance: 2.3,
    label: S.prompts.mainBreaker, verb: V.use,   // 拉桿是往上推回「復歸」，不用「拉下」
    enabled: () => inState(ctx, STATES.BLACKOUT_CORRIDOR) && !f().powerRestored && !f().breakerPulling,
    onUse: () => emit('breaker:pull', {}),
  });
}
