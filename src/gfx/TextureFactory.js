// =============================================================================
// TextureFactory — 所有共用的程式化貼圖（HTML5 Canvas → THREE.CanvasTexture）
// 【API 骨架 / CONTRACT STUB】實作者必須保留下列所有公開方法與回傳型別。
//
// 實作說明：
//   * 共用貼圖第一次被要求時才產生（lazy），並快取；產生器在 ./textures/*.js。
//   * material(name) 會一併掛上 bumpMap（高度圖）與必要的 roughnessMap（地磚、廊道積水、隧道磁磚）。
//   * 靜態劇情物件（錶、日誌、外套、咖啡、配置圖、面板）同樣快取；便利貼、電子鐘、標籤、標誌每次呼叫都是新的。
//   * 所有產生器都是確定性的（同一個 seed → 同一張圖）。
//
// 貼圖尺寸與對應的實際尺度（建議 repeat = 表面尺寸 ÷ 下列尺度）：
//   concrete/concreteDark 512²≈1.2 m（模板接縫每 0.6 m、繫桿孔）；floorTiles 512²=2×2 片 60 cm 地磚（1.2 m）；
//   ceilingTiles 512²=2×2 片 60 cm 礦纖板＋T-bar（1.2 m）；corridorWall 512×1024：V 0=地面…1=2.5 m、U 一格≈1.25 m
//   （下 1.15 m 灰綠油漆＋1.07–1.15 m 深色腰帶）；corridorFloor 512²≈1.2 m（上緣為伸縮縫）；
//   steelDoor 512×704：整片門扇貼一次（1.7×2.3 m），警示帶在 v≈0.09–0.16；steelDoorSide 384×800：側門門扇（1.0×2.1 m，無噴漆字/警示帶）；tunnelTiles 256²：16×16 片，V 0=路面…1=牆頂；
//   roadLines 256²：U 橫跨兩車道（邊線＋中央白實線）、V 沿路平鋪；policeTape 1024×64：U 沿膠帶平鋪；
//   pipe 256×512：U 繞圓周、V 沿管長；waterStain/soot/scorch：四邊淡出為 0，soot 的下緣為煙源（門框/風口上緣）。
//   版面資訊另附在 texture.userData.layout（steelDoor、corridorWall、roadLines、各面板）。
// =============================================================================
import * as THREE from 'three';
import { makeCanvas, canvasTexture, fillNoise, FONTS } from './canvasUtil.js';
import * as SURF from './textures/surfaces.js';
import * as MATS from './textures/materials.js';
import * as OVER from './textures/overlays.js';
import { makeStickyNote } from './textures/hand.js';
import { makeLedClock, drawLabel, drawSign, drawPanel } from './textures/props.js';
import { watchFace, watchBack, logbookCover, logbookPage, coatBack, coffeeSurface, tunnelMap, watchHandAngles } from './textures/items.js';

/**
 * 共用貼圖名稱（get(name)）：
 *  牆/地/天花：'concrete' 'concreteDark' 'floorTiles' 'ceilingTiles' 'corridorWall' 'corridorFloor'
 *  金屬/設備：'metalPanel' 'paintedMetal' 'steelDoor' 'steelDoorSide' 'hazard' 'rust' 'grate' 'crtBezel' 'plasticBeige' 'pipe' 'rubberMat' 'fabricSeat'
 *  隧道/道路：'tunnelTiles' 'asphalt' 'roadLines' 'policeTape'
 *  腐化疊層（RGBA，透明底，用於 decal）：'waterStain' 'soot' 'scorch'
 *  全焦黑：'charred'
 *  粒子精靈（RGBA）：'ash' 'smoke' 'glow' 'glint'
 * 未知名稱 → console.warn 並回傳灰色噪音貼圖（不得丟例外）。
 */

// 產生器：回傳 { map: canvas, bump?: canvas, rough?: canvas }
const GENERATORS = {
  concrete: () => SURF.concrete(),
  concreteDark: () => SURF.concrete({ dark: true }),
  floorTiles: () => SURF.floorTiles(),
  ceilingTiles: () => SURF.ceilingTiles(),
  corridorWall: () => SURF.corridorWall(),
  corridorFloor: () => SURF.corridorFloor(),
  metalPanel: () => MATS.metalPanel(),
  paintedMetal: () => MATS.paintedMetal(),
  steelDoor: () => MATS.steelDoor(),
  steelDoorSide: () => MATS.steelDoor({ side: true }),
  hazard: () => MATS.hazard(),
  rust: () => MATS.rust(),
  grate: () => MATS.grate(),
  crtBezel: () => MATS.plastic({ bezel: true }),
  plasticBeige: () => MATS.plastic({ bezel: false }),
  pipe: () => MATS.pipe(),
  rubberMat: () => MATS.rubberMat(),
  fabricSeat: () => MATS.fabricSeat(),
  tunnelTiles: () => SURF.tunnelTiles(),
  asphalt: () => SURF.asphalt(),
  roadLines: () => SURF.roadLines(),
  policeTape: () => MATS.policeTape(),
  waterStain: () => OVER.waterStain(),
  soot: () => OVER.soot(),
  scorch: () => OVER.scorch(),
  charred: () => OVER.charred(),
  ash: () => OVER.ashSprite(),
  smoke: () => OVER.smokeSprite(),
  glow: () => OVER.glowSprite(),
  glint: () => OVER.glintSprite(),
};

const DECAL = { roughness: 0.92, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 };
const SPRITE = { roughness: 1, metalness: 0, transparent: true, depthWrite: false };

// 材質預設值與貼圖取樣設定（wrap: false → ClampToEdge）
const SPEC = {
  concrete: { mat: { roughness: 0.93, metalness: 0, bumpScale: 1.4 }, aniso: 8 },
  concreteDark: { mat: { roughness: 0.82, metalness: 0, bumpScale: 1.4 }, aniso: 8 },
  floorTiles: { mat: { roughness: 1, metalness: 0, bumpScale: 0.9 }, aniso: 16 },
  ceilingTiles: { mat: { roughness: 0.96, metalness: 0, bumpScale: 0.6 }, aniso: 8 },
  corridorWall: { mat: { roughness: 0.9, metalness: 0, bumpScale: 1.4 }, aniso: 8 },
  corridorFloor: { mat: { roughness: 1, metalness: 0, bumpScale: 1.3 }, aniso: 16 },
  metalPanel: { mat: { roughness: 0.55, metalness: 0.15, bumpScale: 0.9 }, aniso: 8 },
  paintedMetal: { mat: { roughness: 0.6, metalness: 0.12, bumpScale: 0.7 } },
  steelDoor: { mat: { roughness: 0.62, metalness: 0.2, bumpScale: 1.8 }, wrap: false, aniso: 8 },
  steelDoorSide: { mat: { roughness: 0.6, metalness: 0.22, bumpScale: 1.6 }, wrap: false, aniso: 8 },
  hazard: { mat: { roughness: 0.68, metalness: 0.08, bumpScale: 0.7 } },
  rust: { mat: { roughness: 0.95, metalness: 0.15, bumpScale: 2.0 } },
  grate: { mat: { roughness: 0.7, metalness: 0.4, bumpScale: 1.0, alphaTest: 0.5, side: THREE.DoubleSide }, aniso: 8 },
  crtBezel: { mat: { roughness: 0.72, metalness: 0, bumpScale: 0.6 } },
  plasticBeige: { mat: { roughness: 0.55, metalness: 0, bumpScale: 0.35 } },
  pipe: { mat: { roughness: 0.58, metalness: 0.12, bumpScale: 0.7 } },
  rubberMat: { mat: { roughness: 0.96, metalness: 0, bumpScale: 2.2 } },
  fabricSeat: { mat: { roughness: 1, metalness: 0, bumpScale: 1.0 } },
  tunnelTiles: { mat: { roughness: 1, metalness: 0, bumpScale: 0.9 }, aniso: 8 },
  asphalt: { mat: { roughness: 0.94, metalness: 0, bumpScale: 1.5 }, aniso: 16 },
  roadLines: { mat: { roughness: 0.75, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, aniso: 16 },
  policeTape: { mat: { roughness: 0.55, metalness: 0, side: THREE.DoubleSide }, aniso: 8 },
  waterStain: { mat: DECAL, wrap: false },
  soot: { mat: DECAL, wrap: false },
  scorch: { mat: DECAL, wrap: false },
  charred: { mat: { roughness: 0.97, metalness: 0, bumpScale: 2.2 } },
  ash: { mat: SPRITE, wrap: false },
  smoke: { mat: SPRITE, wrap: false },
  glow: { mat: { ...SPRITE, blending: THREE.AdditiveBlending }, wrap: false },
  glint: { mat: { ...SPRITE, blending: THREE.AdditiveBlending }, wrap: false },
};

const PANEL_KINDS = ['vent', 'intercom', 'breaker', 'unlock', 'flashlightBox', 'camPanel'];

const toRepeat = (r) => {
  if (r == null) return [1, 1];
  if (typeof r === 'number') return [r, r];
  if (Array.isArray(r)) return [Number(r[0]) || 1, Number(r[1] ?? r[0]) || 1];
  if (typeof r === 'object' && 'x' in r) return [r.x, r.y];
  return [1, 1];
};

export class TextureFactory {
  constructor(ctx) {
    this.ctx = ctx;
    /** name → 共用的顏色貼圖（CanvasTexture） */
    this.cache = new Map();
    /** name → { map, bump, rough } */
    this._entries = new Map();
    this._static = new Map();
    this._warned = new Set();
    /** 每張貼圖的產生時間（毫秒），除錯/效能量測用 */
    this.stats = {};
  }

  /** 所有共用貼圖名稱 */
  static get NAMES() { return Object.keys(GENERATORS); }
  get names() { return Object.keys(GENERATORS); }

  _warnOnce(key, msg) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`[TextureFactory] ${msg}`);
  }

  _fallbackEntry(name) {
    const { canvas, g } = makeCanvas(64, 64);
    fillNoise(g, 64, 64, { seed: 7, scale: 4, c0: [92, 92, 92], c1: [132, 132, 132] });
    return { map: canvasTexture(canvas), bump: null, rough: null, fallback: true, name };
  }

  _entry(name) {
    let e = this._entries.get(name);
    if (e) return e;
    const gen = GENERATORS[name];
    if (!gen) {
      this._warnOnce(`unknown:${name}`, `unknown texture '${name}' — using neutral grey fallback`);
      e = this._entries.get('__fallback__') || this._fallbackEntry('__fallback__');
      this._entries.set('__fallback__', e);
      return e;
    }
    const t0 = performance.now();
    try {
      const out = gen(this.ctx);
      const spec = SPEC[name] || {};
      const wrap = spec.wrap !== false;
      const anisotropy = spec.aniso ?? 4;
      e = {
        map: canvasTexture(out.map, { wrap, anisotropy }),
        bump: out.bump ? canvasTexture(out.bump, { color: false, wrap, anisotropy }) : null,
        rough: out.rough ? canvasTexture(out.rough, { color: false, wrap, anisotropy }) : null,
        name,
      };
      e.map.name = name;
      if (out.layout) e.map.userData.layout = out.layout;
    } catch (err) {
      this._warnOnce(`fail:${name}`, `failed to generate '${name}': ${err?.message || err}`);
      e = this._fallbackEntry(name);
    }
    this.stats[name] = performance.now() - t0;
    this._entries.set(name, e);
    this.cache.set(name, e.map);
    return e;
  }

  _withRepeat(base, repeat) {
    if (!base) return null;
    const [rx, ry] = toRepeat(repeat);
    if (rx === 1 && ry === 1) return base;
    const t = base.clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return t;
  }

  /** 取得（快取的）共用貼圖。repeat ≠ [1,1] 時回傳共用 image 的 clone（各自的 repeat）。 */
  get(name, { repeat = [1, 1] } = {}) {
    return this._withRepeat(this._entry(name).map, repeat);
  }

  /** 共用貼圖的高度圖（bumpMap 用，資料貼圖）；沒有則回傳 null。 */
  getBump(name, { repeat = [1, 1] } = {}) { return this._withRepeat(this._entry(name).bump, repeat); }
  /** 共用貼圖的粗糙度圖（roughnessMap 用）；沒有則回傳 null。 */
  getRoughness(name, { repeat = [1, 1] } = {}) { return this._withRepeat(this._entry(name).rough, repeat); }

  /** 依名稱建立預設好粗糙度/金屬度/凹凸的 MeshStandardMaterial。opts 會覆寫預設值（含 repeat）。 */
  material(name, opts = {}) {
    const { repeat, ...rest } = opts || {};
    const e = this._entry(name);
    const spec = (!e.fallback && SPEC[name]) || {};
    const params = { roughness: 0.85, metalness: 0.05, ...(spec.mat || {}) };
    params.map = this._withRepeat(e.map, repeat);
    if (e.bump) params.bumpMap = this._withRepeat(e.bump, repeat);
    else delete params.bumpScale;
    if (e.rough) params.roughnessMap = this._withRepeat(e.rough, repeat);
    Object.assign(params, rest);
    const m = new THREE.MeshStandardMaterial(params);
    m.name = name;
    return m;
  }

  /** 預先產生（全部或指定的）共用貼圖；回傳總耗時（毫秒）。 */
  prewarm(names = this.names) {
    const t0 = performance.now();
    for (const n of names) this._entry(n);
    return performance.now() - t0;
  }

  _cached(key, make) {
    let v = this._static.get(key);
    if (!v) {
      const t0 = performance.now();
      try { v = make(); } catch (err) {
        this._warnOnce(`fail:${key}`, `failed to generate '${key}': ${err?.message || err}`);
        v = this._fallbackEntry(key).map;
      }
      this.stats[key] = performance.now() - t0;
      this._static.set(key, v);
    }
    return v;
  }

  /**
   * 黃色便利貼（手寫字，含終幕寫字動畫）。文字來自 ctx.SCRIPT.stickyNote.lines。
   * setProgress(p)：0..1，只顯示前 p 比例的字（1 = 全部）。setTallies(n)：右下角「正」字記號（循環次數）。
   * @returns {{ texture: THREE.CanvasTexture, canvas: HTMLCanvasElement, setProgress(p:number):void, setTallies(n:number):void, penPosition():{u:number,v:number} }}
   */
  createStickyNote(opts = {}) {
    const note = makeStickyNote(this.ctx?.SCRIPT, opts || {});
    note.init();
    const texture = canvasTexture(note.canvas, { wrap: false, anisotropy: 8 });
    texture.name = 'stickyNote';
    const touch = (changed) => { if (changed) texture.needsUpdate = true; };
    return {
      texture,
      canvas: note.canvas,
      /** 總字數（setProgress 以此換算） */
      totalChars: note.total,
      /** 最後一句（鎖死防爆門。）開始處的 progress 值：終幕可由此補間到 1 */
      lastLineStart: note.lastLineStart,
      setProgress(p) { touch(note.setProgress(Number(p) || 0)); },
      setTallies(n) { touch(note.setTallies(Number(n) || 0)); },
      /** 最後一個已寫出的字後方的筆尖位置（UV，v 朝上） */
      penPosition: () => note.penPosition(),
    };
  }

  /**
   * LED 七段電子鐘（黑底、紅色亮段＋暗紅殘影段）。
   * setDim(v)：v = 調暗量 0..1（0 = 全亮，1 = 幾乎熄滅，只剩殘影段）。
   * @returns {{ texture: THREE.CanvasTexture, setText(hhmm:string):void, setColonVisible(on:boolean):void, setDim(v:number):void }}
   */
  createLedClock() {
    const clk = makeLedClock();
    const texture = canvasTexture(clk.canvas, { wrap: false, anisotropy: 4 });
    texture.name = 'ledClock';
    const touch = (changed) => { if (changed) texture.needsUpdate = true; };
    return {
      texture,
      canvas: clk.canvas,
      setText(hhmm) { touch(clk.setText(hhmm)); },
      setColonVisible(on) { touch(clk.setColonVisible(on)); },
      setDim(v) { touch(clk.setDim(v)); },
    };
  }

  /** 小標籤（按鈕/面板文字）。@returns {THREE.CanvasTexture} */
  createLabel(text, { w = 256, h = 64, bg = '#1c1c1c', fg = '#d8d8d8', size = 30, font = FONTS.ui, align = 'center', border = null } = {}) {
    const canvas = drawLabel(text ?? '', { w, h, bg, fg, size, font, align, border });
    const t = canvasTexture(canvas, { wrap: false, anisotropy: 8 });
    t.name = `label:${text}`;
    return t;
  }

  /** 標誌牌。style: 'exit'（綠色緊急出口）| 'warning'（黃黑）| 'plate'（金屬銘牌）| 'stencil'（牆面噴漆字）@returns {THREE.CanvasTexture} */
  createSign(text, { sub = '', w = 512, h = 160, style = 'plate', color = null } = {}) {
    const canvas = drawSign(text ?? '', { sub, w, h, style, color });
    const t = canvasTexture(canvas, { wrap: false, anisotropy: 8 });
    t.name = `sign:${style}:${text}`;
    return t;
  }

  /** 碎裂的機械錶錶面（指針停在 02:14:08、蜘蛛網裂痕、內側黑灰水氣）。@returns {THREE.CanvasTexture} */
  createWatchFace() {
    return this._cached('watchFace', () => {
      const t = canvasTexture(watchFace(), { wrap: false, anisotropy: 8 });
      t.name = 'watchFace'; t.userData.handAngles = watchHandAngles();
      return t;
    });
  }

  /** 錶背刻字「給阿哲，值夜班注意安全」。@returns {THREE.CanvasTexture} */
  createWatchBack() {
    return this._cached('watchBack', () => { const t = canvasTexture(watchBack(this.ctx?.SCRIPT), { wrap: false, anisotropy: 8 }); t.name = 'watchBack'; return t; });
  }

  /** 燒焦的交接日誌：封面『雪嶺隧道中央控制室 — 交接日誌』與內頁（焦邊、水漬、手寫）。@returns {{cover: THREE.CanvasTexture, page: THREE.CanvasTexture}} */
  createLogbook() {
    return this._cached('logbook', () => {
      const cover = canvasTexture(logbookCover(this.ctx?.SCRIPT), { wrap: false, anisotropy: 8 });
      const page = canvasTexture(logbookPage(this.ctx?.SCRIPT), { wrap: false, anisotropy: 8 });
      cover.name = 'logbookCover'; page.name = 'logbookPage';
      return { cover, page };
    });
  }

  /** 消防救援外套背面：髒黃色布料、反光條、『雪嶺隧道特種消防救援隊』字樣。@returns {THREE.CanvasTexture} */
  createCoatBack() {
    return this._cached('coatBack', () => { const t = canvasTexture(coatBack(this.ctx?.SCRIPT), { wrap: false, anisotropy: 8 }); t.name = 'coatBack'; return t; });
  }

  /** 咖啡液面（俯視圓形）。stage 0 熱咖啡（深褐、反光）/ 1 冷掉浮灰燼 / 2 乾涸焦黑咖啡漬。@returns {THREE.CanvasTexture} */
  createCoffeeSurface(stage = 0) {
    const s = Math.max(0, Math.min(2, Math.round(Number(stage) || 0)));
    return this._cached(`coffee${s}`, () => { const t = canvasTexture(coffeeSurface(s), { wrap: false, anisotropy: 4 }); t.name = `coffee${s}`; return t; });
  }

  /** 牆上的「雪嶺隧道 平面配置圖」。@returns {THREE.CanvasTexture} */
  createTunnelMap() {
    return this._cached('tunnelMap', () => { const t = canvasTexture(tunnelMap(this.ctx?.SCRIPT), { wrap: false, anisotropy: 8 }); t.name = 'tunnelMap'; return t; });
  }

  /**
   * 設備面板正面圖。kind:
   *  'vent'      通風系統控制面板（轉速表、指示燈位置、「主排風機」字樣）
   *  'intercom'  緊急對講機（喇叭格柵、「緊急對講」「通話」字樣）
   *  'breaker'   電閘室總開關面板（「隧道中段供電」「監控頻寬限制」字樣、危險標誌）
   *  'unlock'    防爆門緊急解鎖（黃黑斜紋、「防爆門 緊急解鎖」）
   *  'flashlightBox' 緊急手電筒箱（「緊急照明」）
   *  'camPanel'  CAM 切換按鈕座
   * texture.userData.layout 提供轉速表/指示燈/拉桿/按鈕在貼圖上的 UV 位置（v 朝上）。
   * @returns {THREE.CanvasTexture}
   */
  createPanelGraphic(kind) {
    const k = PANEL_KINDS.includes(kind) ? kind : null;
    if (!k) {
      this._warnOnce(`panel:${kind}`, `unknown panel kind '${kind}' — using blank panel`);
      return this._cached('panel:__blank__', () => canvasTexture(drawLabel('', { w: 256, h: 256, bg: '#5d625e' }), { wrap: false }));
    }
    return this._cached(`panel:${k}`, () => {
      const out = drawPanel(k, this.ctx?.SCRIPT);
      const t = canvasTexture(out.canvas, { wrap: false, anisotropy: 8 });
      t.name = `panel:${k}`;
      t.userData.layout = out.layout || {};
      t.userData.aspect = out.canvas.width / out.canvas.height;
      return t;
    });
  }

  /** 除錯／效能：產生所有共用貼圖與靜態物件貼圖，回傳 { total, stats }（毫秒）。 */
  generateAll() {
    const t0 = performance.now();
    this.prewarm();
    this.createWatchFace(); this.createWatchBack(); this.createLogbook(); this.createCoatBack();
    for (let s = 0; s < 3; s++) this.createCoffeeSurface(s);
    this.createTunnelMap();
    for (const k of PANEL_KINDS) this.createPanelGraphic(k);
    const t1 = performance.now();
    const note = this.createStickyNote(); note.texture.dispose();
    const clk = this.createLedClock(); clk.texture.dispose();
    this.stats.stickyNote = performance.now() - t1;
    return { total: performance.now() - t0, stats: { ...this.stats } };
  }
}
