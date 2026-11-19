// =============================================================================
// TextureFactory — 所有共用的程式化貼圖（HTML5 Canvas → THREE.CanvasTexture）
// 【API 骨架 / CONTRACT STUB】實作者必須保留下列所有公開方法與回傳型別。
// =============================================================================
import * as THREE from 'three';
import { makeCanvas, canvasTexture, fillNoise, FONTS } from './canvasUtil.js';

/**
 * 共用貼圖名稱（get(name)）：
 *  牆/地/天花：'concrete' 'concreteDark' 'floorTiles' 'ceilingTiles' 'corridorWall' 'corridorFloor'
 *  金屬/設備：'metalPanel' 'paintedMetal' 'steelDoor' 'hazard' 'rust' 'grate' 'crtBezel' 'plasticBeige' 'pipe' 'rubberMat' 'fabricSeat'
 *  隧道/道路：'tunnelTiles' 'asphalt' 'roadLines' 'policeTape'
 *  腐化疊層（RGBA，透明底，用於 decal）：'waterStain' 'soot' 'scorch'
 *  全焦黑：'charred'
 *  粒子精靈（RGBA）：'ash' 'smoke' 'glow' 'glint'
 * 未知名稱 → console.warn 並回傳灰色噪音貼圖（不得丟例外）。
 */
export class TextureFactory {
  constructor(ctx) {
    this.ctx = ctx;
    this.cache = new Map();
  }

  /** 取得（快取的）共用貼圖。repeat ≠ [1,1] 時回傳共用 image 的 clone（各自的 repeat）。 */
  get(name, { repeat = [1, 1] } = {}) {
    let base = this.cache.get(name);
    if (!base) {
      const { canvas, g } = makeCanvas(128, 128);
      fillNoise(g, 128, 128, { seed: name.length, scale: 4, c0: [80, 80, 80], c1: [130, 130, 130] });
      base = canvasTexture(canvas);
      this.cache.set(name, base);
    }
    if (repeat[0] === 1 && repeat[1] === 1) return base;
    const t = base.clone(); t.repeat.set(repeat[0], repeat[1]); t.needsUpdate = true; return t;
  }

  /** 依名稱建立預設好粗糙度/金屬度/凹凸的 MeshStandardMaterial。opts 會覆寫預設值（含 repeat）。 */
  material(name, opts = {}) {
    const { repeat, ...rest } = opts;
    return new THREE.MeshStandardMaterial({ map: this.get(name, { repeat }), roughness: 0.85, metalness: 0.05, ...rest });
  }

  /**
   * 黃色便利貼（手寫字，含終幕寫字動畫）。文字來自 ctx.SCRIPT.stickyNote.lines。
   * setProgress(p)：0..1，只顯示前 p 比例的字（1 = 全部）。setTallies(n)：右下角「正」字記號（循環次數）。
   * @returns {{ texture: THREE.CanvasTexture, canvas: HTMLCanvasElement, setProgress(p:number):void, setTallies(n:number):void, penPosition():{u:number,v:number} }}
   */
  createStickyNote(opts = {}) {
    const { canvas } = makeCanvas(256, 256);
    const texture = canvasTexture(canvas, { wrap: false });
    return { texture, canvas, setProgress() {}, setTallies() {}, penPosition: () => ({ u: 0.5, v: 0.5 }) };
  }

  /**
   * LED 七段電子鐘（黑底、紅色亮段＋暗紅殘影段）。
   * @returns {{ texture: THREE.CanvasTexture, setText(hhmm:string):void, setColonVisible(on:boolean):void, setDim(v:number):void }}
   */
  createLedClock() {
    const { canvas } = makeCanvas(512, 180);
    const texture = canvasTexture(canvas, { wrap: false });
    return { texture, setText() {}, setColonVisible() {}, setDim() {} };
  }

  /** 小標籤（按鈕/面板文字）。@returns {THREE.CanvasTexture} */
  createLabel(text, { w = 256, h = 64, bg = '#1c1c1c', fg = '#d8d8d8', size = 30, font = FONTS.ui, align = 'center', border = null } = {}) {
    const { canvas } = makeCanvas(w, h);
    return canvasTexture(canvas, { wrap: false });
  }

  /** 標誌牌。style: 'exit'（綠色緊急出口）| 'warning'（黃黑）| 'plate'（金屬銘牌）| 'stencil'（牆面噴漆字）@returns {THREE.CanvasTexture} */
  createSign(text, { sub = '', w = 512, h = 160, style = 'plate' } = {}) {
    const { canvas } = makeCanvas(w, h);
    return canvasTexture(canvas, { wrap: false });
  }

  /** 碎裂的機械錶錶面（指針停在 02:14:08、蜘蛛網裂痕、內側黑灰水氣）。@returns {THREE.CanvasTexture} */
  createWatchFace() { const { canvas } = makeCanvas(256, 256); return canvasTexture(canvas, { wrap: false }); }

  /** 錶背刻字「給阿哲，值夜班注意安全」。@returns {THREE.CanvasTexture} */
  createWatchBack() { const { canvas } = makeCanvas(256, 256); return canvasTexture(canvas, { wrap: false }); }

  /** 燒焦的交接日誌：封面『雪嶺隧道中央控制室 — 交接日誌』與內頁（焦邊、水漬、手寫）。@returns {{cover: THREE.CanvasTexture, page: THREE.CanvasTexture}} */
  createLogbook() {
    const a = makeCanvas(256, 340), b = makeCanvas(256, 340);
    return { cover: canvasTexture(a.canvas, { wrap: false }), page: canvasTexture(b.canvas, { wrap: false }) };
  }

  /** 消防救援外套背面：髒黃色布料、反光條、『雪嶺隧道特種消防救援隊』字樣。@returns {THREE.CanvasTexture} */
  createCoatBack() { const { canvas } = makeCanvas(512, 512); return canvasTexture(canvas, { wrap: false }); }

  /** 咖啡液面（俯視圓形）。stage 0 熱咖啡（深褐、反光）/ 1 冷掉浮灰燼 / 2 乾涸焦黑咖啡漬。@returns {THREE.CanvasTexture} */
  createCoffeeSurface(stage = 0) { const { canvas } = makeCanvas(128, 128); return canvasTexture(canvas, { wrap: false }); }

  /** 牆上的「雪嶺隧道 平面配置圖」。@returns {THREE.CanvasTexture} */
  createTunnelMap() { const { canvas } = makeCanvas(512, 320); return canvasTexture(canvas, { wrap: false }); }

  /**
   * 設備面板正面圖。kind:
   *  'vent'      通風系統控制面板（轉速表、指示燈位置、「主排風機」字樣）
   *  'intercom'  緊急對講機（喇叭格柵、「緊急對講」「通話」字樣）
   *  'breaker'   電閘室總開關面板（「隧道中段供電」「監控頻寬限制」字樣、危險標誌）
   *  'unlock'    防爆門緊急解鎖（黃黑斜紋、「防爆門 緊急解鎖」）
   *  'flashlightBox' 緊急手電筒箱（「緊急照明」）
   *  'camPanel'  CAM 切換按鈕座
   * @returns {THREE.CanvasTexture}
   */
  createPanelGraphic(kind) { const { canvas } = makeCanvas(256, 256); return canvasTexture(canvas, { wrap: false }); }
}
