// =============================================================================
// CameraFeeds — CCTV 監視系統（4 個獨立 THREE.Scene → WebGLRenderTarget → 主 CRT 螢幕）
// 【API 骨架 / CONTRACT STUB】實作者必須保留所有公開方法/屬性。
//
// 每個頻道是一個獨立的小場景（自有燈光/霧），有 LD（前期）與 HD（後期）兩種佈置：
//   CAM-01 北向隧道入口：LD 濃霧、能見度極低 ／ HD 濃煙全面阻斷、封閉柵欄、緊急燈
//   CAM-02 主車道中段：LD 遠處一團模糊的熱源亮斑 ／ HD 燃燒中的多車追撞殘骸＋翻覆油罐車、橘色火光緩慢搖曳
//   CAM-03 公務維修廊道 B區（攝影機裝在防爆門上方、俯視廊道）：反光雨衣人影（Figure.js）
//           LD：人影只在「沒有被看著」時推進（見下方盲區規則）
//           HD：看清楚是融化面罩、隧道救援隊制服、手握破門斧的消防員，正在劈砍/撬防爆門（此時有動作）
//   CAM-04 4號緊急停車彎：LD 一輛熄火的白色轎車（駕駛座車門開著）／ HD 沒有車，只有褪色的警方封鎖線與焦黑牆面
//
// CRT 螢幕材質（shaders/CRTShader.js）：
//   LD：低解析度（約 160×120 取樣）、黑白、強雜訊、掃描線、滾動干擾條、輕微桶形變形、OSD 疊字
//   HD：640×480 彩色、乾淨、僅保留極淡掃描線
//   STATIC：雪花雜訊（低對比、亮度穩定；光敏感模式下改為緩慢流動的噪點）
//   OFF：黑屏（極淡反光）
//   BOOT：開機（亮點→展開→頻寬限制解除字樣→HD）
// OSD：左上「CAM-0n 地點」、左下狀態標籤（ctx.SCRIPT.cams[n].ld / .hd）、右上「REC ●」與時間戳
//      （ctx.flags.clockText + 秒數）。字型 FONTS.mono / FONTS.ui。
//
// ★ 盲區規則（Frustum Culling 應用，於 update() 實作）：
//   observed03 = mode === 'LD' && channel === 3 && ctx.gaze.mainScreenObserved
//   * observed03 持續 ≥ 0.8 秒 → seenSinceMove = true
//   * observed03 為 false 持續 ≥ 0.5 秒，且 (seenSinceMove 或 figureIndex < limits.min)，
//     且 figureIndex < limits.max → figureIndex++（瞬間換位置與姿勢，沒有任何移動動畫），
//     seenSinceMove = false，emit 'feeds:figureMoved' { index }
//   * observed03 為 true 時，人影「不得有任何變化」：沒有呼吸、擺動、動畫。
//   * 只渲染目前頻道（LD 以約 10fps 更新 render target 營造 CCTV 頓挫感；HD 30fps）。
// -----------------------------------------------------------------------------
// 實作補充（額外的公開成員，供整合/除錯）：
//   feeds.crtMaterial          主 CRT 的 ShaderMaterial（uniforms.uBrightness 可壓暗，例如焦黑時）
//   feeds.sideMaterials        [左, 右] 側邊螢幕材質
//   feeds.figure               Figure 實例（CAM-03）
//   feeds.channels             {1..4} 頻道物件（scene / camera / ld / hd）
//   feeds.seenSinceMove        盲區規則狀態
//   feeds.screenLightGain      螢幕光強度倍率（預設 1）
//   feeds.brightness           主螢幕＋側螢幕整體亮度倍率（預設 1，平滑套用）
//   feeds.debugBlit(renderer, { crt = true })  把目前頻道（經過 / 不經過 CRT）畫滿畫面（截圖測試用）
// =============================================================================
import * as THREE from 'three';
import { createCRTMaterial, CRT_MODE, syncToneUniforms } from '../gfx/shaders/CRTShader.js';
import { createChannels } from './feeds/channels.js';
import { OSD } from './feeds/OSD.js';
import { SideScreen } from './feeds/SideScreen.js';
import { clamp, damp, smoothstep } from '../core/util.js';

export const FIGURE_STEPS = 8; // CAM-03 人影的位置數（index 0 = 最遠，面壁；7 = 防爆門前）

const MODES = ['OFF', 'LD', 'STATIC', 'BOOT', 'HD'];
const FEED_W = 640, FEED_H = 480;
const LD_INTERVAL = 0.1;        // LD：10fps
const HD_INTERVAL = 1 / 30;     // HD / BOOT：30fps
const SWITCH_DUR = 0.25;        // 頻道切換過場
const AGC_DUR = 2.0;            // 切換後亮度回復時間（自動增益慢慢回到 1；0.25 秒內的變化 < 20%）
const SCREEN_LIGHT_SCALE = 2.2; // 螢幕光強度（燭光）＝ 頻道預設 × 此倍率 × screenLightGain
// 各頻道畫面在 CRT 上的平均亮度（sRGB 0–255 的概略值）：只用來決定「模式」交叉淡化的長短
const FEED_MEAN = { LD: { 1: 51, 2: 31, 3: 25, 4: 40 }, HD: { 1: 23, 2: 26, 3: 27, 4: 35 } };
// 自動增益（AGC）用：各頻道「畫面內容」在 CRT 上的平均線性亮度（實測：坐姿看主 CRT 的螢幕區域、增益 = 1、
// 穩定 1.2 秒的平均，再扣掉關機時的玻璃反光底值 0.004）。切換頻道時新畫面先以舊畫面的平均亮度出現，
// 再用 AGC_DUR 慢慢回到自己的亮度（像監視器的自動曝光）。AGC 只乘在畫面內容上（OSD 不受影響）。
const FEED_LUM = { LD: { 1: 0.0281, 2: 0.0197, 3: 0.0104, 4: 0.0280 }, HD: { 1: 0.0085, 2: 0.0096, 3: 0.0115, 4: 0.0198 } };
const AGC_MIN = 0.35, AGC_MAX = 2.8;   // 表是實測的，範圍只是防呆（CAM-03 與 CAM-01/04 相差約 2.7 倍）

export class CameraFeeds {
  constructor(ctx) {
    this.ctx = ctx;
    this.channel = 3;           // 1..4
    this.mode = 'OFF';          // 'OFF' | 'LD' | 'STATIC' | 'BOOT' | 'HD'
    this.figureIndex = 0;       // 0..FIGURE_STEPS-1
    this.limits = { min: 0, max: 0 };
    this.hdAction = false;
    this.hdSeen = new Set();    // 在 HD 模式下被注視累計 ≥ 1.5 秒的頻道

    // ---- 額外狀態 ----
    this.seenSinceMove = false;
    this.observedTime = 0;      // observed03 連續秒數
    this.unobservedTime = 0;    // !observed03 連續秒數
    this.screenLightGain = 1;
    this.brightness = 1;
    this._bright = 1;
    this._hdObs = { 1: 0, 2: 0, 3: 0, 4: 0 };

    // ---- 頻道場景 ----
    this.channels = createChannels();
    this.figure = this.channels[3].figure;
    this.figure.onAxeHit = () => this.ctx.bus.emit('feeds:axeHit', {});
    for (const ch of Object.values(this.channels)) ch.setVariant('LD');

    // ---- Render targets（兩張輪替：cur = 目前畫面，prev = 轉場用的上一張）----
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: true, samples: 4 };
    this.renderTargets = [new THREE.WebGLRenderTarget(FEED_W, FEED_H, rtOpts), new THREE.WebGLRenderTarget(FEED_W, FEED_H, rtOpts)];
    for (const rt of this.renderTargets) { rt.texture.name = 'cctvFeed'; rt.texture.generateMipmaps = false; }
    this._cur = 0;

    // ---- OSD、CRT、側邊螢幕 ----
    this.osd = new OSD(FEED_W, FEED_H);
    this.crtMaterial = createCRTMaterial({
      feed: this.renderTargets[0].texture, prev: this.renderTargets[1].texture,
      osd: this.osd.texture, osdPrev: this.osd.prevTexture, feedRes: [FEED_W, FEED_H], ldRes: [160, 120],
    });
    const S = ctx.SCRIPT.status;
    this.sideScreens = [new SideScreen('left'), new SideScreen('right')];
    this.sideMaterials = this.sideScreens.map((s) => s.material);
    this.sideScreens[0].setStatus({ title: S.leftTitle, lines: [S.logLines[0]], tone: 'normal' });
    this.sideScreens[1].setStatus({ title: S.rightTitle, lines: S.normal, tone: 'normal' });

    // ---- 顯示狀態（實際呈現中的模式/頻道；與 this.mode / this.channel 比對以觸發平滑轉場）----
    this._shownMode = 'OFF';
    this._prevMode = 'OFF';
    this._modeMix = 1;
    this._modeFadeDur = 0.6;
    this._shownChannel = this.channel;
    this._prevExposure = 1;
    this._agc = 1;
    this._prevAgc = 1;          // 舊畫面被換掉那一刻的增益（過場中舊畫面維持原本的亮度）
    this._agcFrom = 1;
    this._agcT = 1;
    this._switch = 0;
    this._switchSeed = 0;
    this._shownIndex = -1;
    this._boot = 0;
    this._bootToken = 0;
    this._renderAcc = 0;
    this._needRender = true;
    this._osdOn = 0;
    this._osdPrevOn = 0;
    this._clockText = null;
    this._clockAt = 0;
    this._t = 0;
    this._light = { color: new THREE.Color(0, 0, 0), intensity: 0 };
    this._lightTarget = { color: new THREE.Color(), intensity: 0 };
    this._lightPrev = { color: new THREE.Color(), intensity: 0 };
    this._tmpLight = { color: new THREE.Color(), intensity: 0 };
    this._applyFigure();
  }

  /** 指派 CRT 材質給 ctx.controlRoom.objects.mainScreen 與 sideScreens。 */
  init() {
    const objs = this.ctx.controlRoom?.objects;
    if (objs?.mainScreen) objs.mainScreen.material = this.crtMaterial;
    if (Array.isArray(objs?.sideScreens)) {
      objs.sideScreens.forEach((m, i) => { if (m && this.sideMaterials[i]) m.material = this.sideMaterials[i]; });
    }
    // 多重取樣的半浮點 render target 需要 EXT_color_buffer_float；不支援時退回不做 MSAA
    try {
      if (!this.ctx.renderer?.extensions?.has?.('EXT_color_buffer_float')) for (const rt of this.renderTargets) rt.samples = 0;
    } catch { for (const rt of this.renderTargets) rt.samples = 0; }
    this._precompile();
  }

  /** 預先編譯每個頻道 LD / HD 兩種燈光配置的著色器，避免第一次切換頻道或開機進入 HD 時卡頓。 */
  _precompile() {
    const r = this.ctx.renderer;
    if (!r?.compile) return;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.renderTargets[0]);
      for (const ch of Object.values(this.channels)) {
        for (const v of ['HD', 'LD']) { ch.setVariant(v); r.compile(ch.scene, ch.camera); }
      }
    } catch (e) {
      console.warn('[feeds] precompile skipped', e);
    } finally {
      r.setRenderTarget(prev);
      for (const ch of Object.values(this.channels)) ch.setVariant('LD');
      this._applyFigure();
    }
  }

  /** 切換頻道（短暫的切換過場：0.25 秒滾動干擾，整體亮度不可突變）；emit 'feeds:channel' { channel } */
  setChannel(n) {
    n = clamp(Math.round(Number(n) || 3), 1, 4);
    this.channel = n;
    this.ctx.bus.emit('feeds:channel', { channel: n });
  }
  setMode(mode) {
    if (!MODES.includes(mode)) { console.warn('[feeds] unknown mode', mode); return; }
    if (mode !== 'BOOT') this._bootToken++;   // 中斷進行中的開機程序
    this.mode = mode;
  }
  /** BOOT → HD 開機程序（含 audio 'crtBoot'、顯示 SCRIPT.status.bandwidth）。@returns {Promise<void>} */
  boot(duration = 3) {
    const token = ++this._bootToken;
    this.mode = 'BOOT';
    this._boot = 0;
    try { this.ctx.audio?.sfx?.('crtBoot'); } catch (e) { console.error('[feeds] crtBoot sfx', e); }
    return this.ctx.clock.tween(Math.max(0.5, duration), (e, k) => {
      if (token === this._bootToken) this._boot = k;
    }, 'linear').then(() => {
      if (token === this._bootToken && this.mode === 'BOOT') this.mode = 'HD';
    });
  }
  /** 人影推進上下限（MonitoringState 依節拍設定）。 */
  setFigureLimits({ min = 0, max = 0 } = {}) {
    const top = FIGURE_STEPS - 1;
    this.limits = { min: clamp(Math.round(min), 0, top), max: clamp(Math.round(max), 0, top) };
  }
  /** 直接設定人影位置（跳關/重置用）。 */
  setFigureIndex(i) {
    this.figureIndex = clamp(Math.round(Number(i) || 0), 0, FIGURE_STEPS - 1);
    this.seenSinceMove = false;
    this.unobservedTime = 0;
    this._applyFigure();
  }
  /** HD 下人影是否劈砍防爆門（有動作；每次斧頭擊中門的瞬間 emit 'feeds:axeHit'，約每 2.2–3 秒一次）。 */
  setHDAction(on) { this.hdAction = !!on; }
  /** 側邊螢幕內容。side: 'left' | 'right'；tone: 'normal' | 'warn' | 'alert'；lines: string[] */
  setStatus(side, { title = '', lines = [], tone = 'normal' } = {}) {
    const i = side === 'right' || side === 1 ? 1 : 0;
    this.sideScreens[i].setStatus({ title, lines, tone });
  }
  /** 目前主螢幕是否被玩家看著且正顯示頻道 n（LD 或 HD）。 */
  isChannelObserved(n) { return (this.mode === 'LD' || this.mode === 'HD') && this.channel === n && !!this.ctx.gaze?.mainScreenObserved; }
  /** 重置（循環重來）：頻道 3、人影 index 0、hdSeen 清空、模式 LD。 */
  reset() {
    this._bootToken++;
    this.channel = 3; this.figureIndex = 0; this.hdSeen.clear(); this.mode = 'LD'; this.hdAction = false;
    this.seenSinceMove = false; this.observedTime = 0; this.unobservedTime = 0;
    this._hdObs = { 1: 0, 2: 0, 3: 0, 4: 0 };
    // 立即呈現（重置發生在全黑畫面中，不需要轉場）
    this._shownMode = 'LD'; this._prevMode = 'LD'; this._modeMix = 1;
    this._shownChannel = 3; this._switch = 0; this._boot = 0; this._agc = 1; this._agcT = 1; this._prevAgc = 1;
    for (const ch of Object.values(this.channels)) ch.setVariant('LD');
    for (const s of this.sideScreens) s.snow = 0;
    this.figure.setAction(false);
    this._applyFigure();
    this.osd.swap();
    this._needRender = true;
  }

  // ---------------------------------------------------------------------------
  _exposureFor(ch, mode) {
    const c = this.channels[ch];
    if (!c) return 1;
    return mode === 'LD' ? c.exposure.LD : c.exposure.HD;
  }
  _swapTargets() { this._cur = 1 - this._cur; }

  _applyFigure() {
    this._shownIndex = this.figureIndex;
    this.channels[3].setFigurePose(this.figureIndex);
    this._needRender = true;
  }

  _beginMode(m) {
    const prev = this._shownMode;
    this._prevMode = prev;
    this._prevExposure = this._exposureFor(this._shownChannel, prev);
    this._prevAgc = this._agc;
    this._osdPrevOn = this._osdOn;
    this._shownMode = m;
    const seamless = prev === 'BOOT' && m === 'HD';
    if (!seamless) {
      this._swapTargets();
      this.osd.swap();
      this._modeMix = 0;
      // 交叉淡化時間依亮度差調整：亮度差越大越慢（0.6–1.8 秒），確保 0.25 秒內的亮度變化很小
      const a = this._meanOf(prev, this._shownChannel), b = this._meanOf(m, this._shownChannel);
      this._modeFadeDur = m === 'BOOT' && prev !== 'OFF' ? 1.4 : clamp(0.5 + 0.8 * Math.abs(Math.log2(a / b)), 0.6, 1.8);
    } else {
      this._modeMix = 1;
    }
    const v = (m === 'HD' || m === 'BOOT') ? 'HD' : (m === 'LD' ? 'LD' : null);
    if (v) {
      for (const ch of Object.values(this.channels)) ch.setVariant(v);
      if (v === 'LD') this._applyFigure();
    }
    if (m !== 'BOOT') this._boot = m === 'HD' ? 1 : 0;
    this._renderAcc = 0;
    this._needRender = true;
  }

  /** 模式/頻道在 CRT 上的大約平均亮度（sRGB 0–255） */
  _meanOf(mode, ch) {
    if (mode === 'LD') return FEED_MEAN.LD[ch] || 30;
    if (mode === 'HD') return FEED_MEAN.HD[ch] || 28;
    if (mode === 'STATIC') return 66;
    return 9;   // OFF / BOOT（開機由暗開始）
  }

  _beginSwitch(n) {
    const showsFeed = this._shownMode === 'LD' || this._shownMode === 'HD' || this._shownMode === 'BOOT' || this._shownMode === 'STATIC';
    this._prevExposure = this._exposureFor(this._shownChannel, this._shownMode);
    this._prevAgc = this._agc;
    // 自動增益：新畫面先以舊畫面的平均亮度出現，再緩慢回到自己的亮度
    const v = this._shownMode === 'LD' ? 'LD' : (this._shownMode === 'HD' || this._shownMode === 'BOOT') ? 'HD' : null;
    if (v) {
      const a = FEED_LUM[v][this._shownChannel] || 0.03, b = FEED_LUM[v][n] || 0.03;
      this._agcFrom = clamp(this._agc * (a / b), AGC_MIN, AGC_MAX);
      this._agcT = 0;
      this._agc = this._agcFrom;
    }
    this._shownChannel = n;
    if (showsFeed && this._modeMix >= 1) {
      this._swapTargets();
      this.osd.swap();
      this._switch = 1;
      this._switchSeed = Math.random() * 100;
    }
    this._renderAcc = 0;
    this._needRender = true;
  }

  /** 盲區規則（見檔頭）。 */
  _blindSpot(dt) {
    const observed03 = this.mode === 'LD' && this.channel === 3 && !!this.ctx.gaze?.mainScreenObserved;
    if (observed03) {
      this.observedTime += dt;
      this.unobservedTime = 0;
      if (this.observedTime >= 0.8) this.seenSinceMove = true;
      return;
    }
    this.observedTime = 0;
    this.unobservedTime += dt;
    if (this.unobservedTime >= 0.5
        && (this.seenSinceMove || this.figureIndex < this.limits.min)
        && this.figureIndex < this.limits.max
        && this.figureIndex < FIGURE_STEPS - 1) {
      this.figureIndex++;
      this.seenSinceMove = false;
      this.unobservedTime = 0;
      this._applyFigure();
      this.ctx.bus.emit('feeds:figureMoved', { index: this.figureIndex });
    }
  }

  _hdSeenTick(dt) {
    if (this.mode !== 'HD' || !this.ctx.gaze?.mainScreenObserved) return;
    const n = this.channel;
    this._hdObs[n] = (this._hdObs[n] || 0) + dt;
    if (this._hdObs[n] >= 1.5 && !this.hdSeen.has(n)) {
      this.hdSeen.add(n);
      this.ctx.bus.emit('feeds:hdSeen', { channel: n });
    }
  }

  _timestamp(t) {
    const text = this.ctx.flags?.clockText || this.ctx.CLOCK?.start || '02:00';
    if (text !== this._clockText) { this._clockText = text; this._clockAt = t; }
    const spm = this.ctx.CLOCK?.secondsPerMinute || 17;
    const sec = Math.min(59, Math.floor(((t - this._clockAt) * 60) / spm));
    return `${text}:${String(Math.max(0, sec)).padStart(2, '0')}`;
  }

  _updateOSD(t) {
    const m = this._shownMode;
    const cam = this.ctx.SCRIPT.cams[this._shownChannel] || this.ctx.SCRIPT.cams[3];
    const S = this.ctx.SCRIPT.status;
    let state, on = 1;
    if (m === 'LD' || m === 'HD' || (m === 'BOOT' && this._boot >= 0.8)) {
      const hd = m !== 'LD';
      const label = hd ? cam.hd : cam.ld;
      state = { kind: 'feed', hd, camId: cam.id, place: cam.place, label, warn: label.includes('警告'), time: this._timestamp(t) };
      if (m === 'BOOT') on = smoothstep(0.84, 1.0, this._boot);
    } else if (m === 'BOOT') {
      state = { kind: 'boot', center: S.bandwidth };
      on = smoothstep(0.46, 0.56, this._boot) * (1 - smoothstep(0.72, 0.8, this._boot));
    } else if (m === 'STATIC') {
      state = { kind: 'static', camId: cam.id, center: S.noSignal };
    } else {
      state = { kind: 'none' };
      on = 0;
    }
    this.osd.draw(state);
    this._osdOn = on;
  }

  _computeLight(mode, t, out) {
    const ch = this.channels[this._shownChannel];
    switch (mode) {
      case 'LD': {
        const p = ch.light.LD; out.color.copy(p.color); out.intensity = p.intensity; break;
      }
      case 'STATIC': out.color.setRGB(0.78, 0.82, 0.86); out.intensity = 0.42; break;
      case 'BOOT': {
        const k = this._boot;
        ch.screenLight(t, out);
        const hdI = out.intensity;
        const raster = smoothstep(0.34, 0.56, k) * 0.3 + (k < 0.34 ? 0.03 * smoothstep(0, 0.15, k) : 0);
        const toHD = smoothstep(0.7, 1.0, k);
        out.color.lerp(this._tmpLight.color.setRGB(0.8, 0.86, 1.0), 1 - toHD);
        out.intensity = raster * (1 - toHD) + hdI * toHD;
        break;
      }
      case 'HD': ch.screenLight(t, out); break;
      default: out.color.setRGB(0, 0, 0); out.intensity = 0;
    }
  }

  update(dt, t) {
    this._t = t;
    // ---- 反應式轉場：允許其他模組直接指定 mode / channel ----
    if (this.mode !== this._shownMode) this._beginMode(this.mode);
    // 切換過場還沒結束時不接新的切換（連按按鈕只會在前一次過場結束後切到最後選的頻道，不會疊成閃爍）
    if (this.channel !== this._shownChannel && this._switch <= 0) this._beginSwitch(this.channel);
    if (this.figureIndex !== this._shownIndex) this._applyFigure();

    // ---- 盲區規則、HD 注視 ----
    this._blindSpot(dt);
    this._hdSeenTick(dt);

    // ---- 動畫（只有目前頻道的 HD 場景會動；人影的劈門動作無論顯示哪個頻道都會進行）----
    const reduceFlicker = !!this.ctx.settings?.get?.('reduceFlicker');
    this.figure.setAction(this.hdAction && this.figure.look === 'HD');
    this.figure.update(dt, t);
    this.channels[this._shownChannel].update(dt, t, { reduceFlicker });

    // ---- 轉場進度 ----
    if (this._modeMix < 1) this._modeMix = Math.min(1, this._modeMix + dt / this._modeFadeDur);
    if (this._switch > 0) this._switch = Math.max(0, this._switch - dt / SWITCH_DUR);
    if (this._agcT < 1) {
      this._agcT = Math.min(1, this._agcT + dt / AGC_DUR);
      const k = this._agcT * this._agcT * (3 - 2 * this._agcT);
      this._agc = this._agcFrom + (1 - this._agcFrom) * k;
    }

    // ---- OSD ----
    this._updateOSD(t);

    // ---- CRT uniforms ----
    this._bright = damp(this._bright, clamp(this.brightness, 0, 2), 3, dt);
    const u = this.crtMaterial.uniforms;
    u.uTime.value = t;
    u.uMode.value = CRT_MODE[this._shownMode];
    u.uPrevMode.value = CRT_MODE[this._prevMode];
    u.uModeMix.value = this._modeMix;
    u.uBoot.value = this._shownMode === 'BOOT' ? this._boot : (this._shownMode === 'HD' ? 1 : 0);
    u.uSwitch.value = this._switch;
    u.uSwitchSeed.value = this._switchSeed;
    u.uReduceFlicker.value = reduceFlicker ? 1 : 0;
    u.uExposure.value = this._exposureFor(this._shownChannel, this._shownMode);
    u.uPrevExposure.value = this._prevExposure;
    u.uAGC.value = this._agc;
    u.uPrevAGC.value = this._prevAgc;
    u.tFeed.value = this.renderTargets[this._cur].texture;
    u.tPrev.value = this.renderTargets[1 - this._cur].texture;
    u.tOSD.value = this.osd.texture;
    u.tOSDPrev.value = this.osd.prevTexture;
    u.uOSDOn.value = this._osdOn;
    u.uOSDPrevOn.value = this._osdPrevOn;
    const rec = this.osd.rec;
    u.uRec.value.set(rec.u, rec.v, rec.r, rec.r > 0 ? 1 : 0);
    u.uBrightness.value = this._bright;

    syncToneUniforms(this.crtMaterial, this.ctx.renderer);
    for (const m of this.sideMaterials) syncToneUniforms(m, this.ctx.renderer);

    // ---- 側邊螢幕 ----
    const sideOn = this.mode !== 'OFF' ? 1 : 0;
    // 主 CRT 訊號中斷（STATIC）時兩台系統監視器也一起變成雪花；開機（BOOT → HD）時一起回來
    const sm = this._shownMode;
    const sideSnow = sm === 'STATIC' ? 1 : sm === 'BOOT' ? 1 - smoothstep(0.35, 0.8, this._boot) : 0;
    for (const s of this.sideScreens) {
      s.setClock(this.ctx.flags?.clockText || '');
      s.update(dt, t, { on: sideOn, reduceFlicker, brightness: this._bright, snow: sideSnow });
    }

    // ---- 螢幕光（平滑跟隨畫面內容；無閃爍）----
    const ctl = this.ctx.controlRoom?.objects?.screenLight;
    if (ctl) {
      this._computeLight(this._shownMode, t, this._lightTarget);
      if (this._modeMix < 1) {
        this._computeLight(this._prevMode, t, this._lightPrev);
        const k = this._modeMix;
        this._lightTarget.color.lerp(this._lightPrev.color, 1 - k);   // color 先往 prev 拉回
        this._lightTarget.intensity = this._lightPrev.intensity * (1 - k) + this._lightTarget.intensity * k;
      }
      const L = this._light;
      const a = 1 - Math.exp(-3.2 * dt);
      L.color.lerp(this._lightTarget.color, a);
      L.intensity += (this._lightTarget.intensity - L.intensity) * a;
      ctl.color.copy(L.color);
      // 自動增益只作用在 CRT 畫面上，不乘進房間的螢幕光（否則切換頻道的那一幀房間亮度會跳變）
      ctl.intensity = Math.max(0, L.intensity * SCREEN_LIGHT_SCALE * this.screenLightGain * this._bright);
    }

    // ---- 渲染節奏：LD 10fps（CCTV 頓挫感）、HD/BOOT 30fps ----
    const iv = this._shownMode === 'LD' ? LD_INTERVAL : HD_INTERVAL;
    this._renderAcc += dt;
    if (this._renderAcc >= iv) {
      this._renderAcc %= iv;
      this._needRender = true;
    }
  }

  /** 每幀在主畫面渲染之前呼叫：把目前頻道渲染到 render target。 */
  renderFeeds(renderer) {
    if (!this._needRender) return;
    const m = this._shownMode;
    if (m !== 'LD' && m !== 'HD' && m !== 'BOOT') { this._needRender = false; return; }
    this._needRender = false;
    const ch = this.channels[this._shownChannel];
    if (!ch) return;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevXR = renderer.xr?.enabled;
    try {
      if (renderer.xr) renderer.xr.enabled = false;
      renderer.autoClear = true;
      renderer.setRenderTarget(this.renderTargets[this._cur]);
      renderer.render(ch.scene, ch.camera);
    } catch (e) {
      console.error('[feeds] render failed', e);
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAutoClear;
      if (renderer.xr) renderer.xr.enabled = prevXR;
    }
  }

  /** 測試用：把目前頻道（crt = true 時經過 CRT 著色器）畫滿整個畫面。 */
  debugBlit(renderer, { crt = true } = {}) {
    if (!this._blit) {
      this._blitScene = new THREE.Scene();
      this._blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this._blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.crtMaterial);
      this._blitScene.add(this._blitMesh);
      this._blit = true;
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(null);
    if (crt) {
      this._blitMesh.material = this.crtMaterial;
      renderer.render(this._blitScene, this._blitCam);
    } else {
      const ch = this.channels[this._shownChannel];
      renderer.render(ch.scene, ch.camera);
    }
    renderer.setRenderTarget(prev);
  }
}
