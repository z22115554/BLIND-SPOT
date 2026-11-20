// =============================================================================
// ControlRoom — 主控室（3D 場景、燈光、可互動物件、漸進式環境腐化）
// 【API 骨架 / CONTRACT STUB】實作者必須保留 objects 的所有鍵與所有公開方法。
// 位置一律取自 ctx.LAYOUT.CONTROL_ROOM / BLAST_STUB。
//
// 腐化（setCorruption c: 0..1，可連續）：
//   牆角水漬、天花板煙燻、螢幕外殼焦痕的不透明度隨 c 增加；
//   日光燈色溫隨 c 「降低」＝ 由冷白 (≈6500K, #dfe9ff) 漸變為髒琥珀色 (≈3000K, #ffc58a)，亮度下降；
//   c 高時加入輕微燈管不穩（緩慢的亮度起伏，週期 ≥ 0.4 秒，振幅 ≤ 15%，不可頻閃）。
// 焦黑（setBurnt b: 0..1）：終幕的「貼圖剝落為焦黑廢墟」，牆面/桌面/設備混合為 charred 材質、螢幕全黑破裂。
// 所有 set* 都必須平滑過渡（update 中 damp），而且可以在任何時候重複呼叫。
//
// 實作備註：
//   * 靜態幾何依材質合併（controlRoom/kit.js Batcher），所有主控室材質共用一組 onBeforeCompile uniform
//     （controlRoom/surfaceFX.js：uDirt 腐化髒污、uBurnt 焦黑剝落）。
//   * 室內光源只有 3 盞 SpotLight（日光燈位置／緊急紅燈位置共用，切換時先熄再移再亮）＋1 盞補光 PointLight
//     ＋螢幕光＋解鎖鈕紅光，避免光源數量拖慢其他場景。
//   * 防爆門外的短廊使用不受光的暗色材質（頂點色由門口向內遞減），保證永遠只有黑暗與深度。
//   * CAM 按鈕指示燈（docs/pacing/spec.md §3.2）：目前頻道綠燈；有未查看的動態偵測（feeds.alertLevel(n)）時
//     交叉淡化成琥珀色並緩慢呼吸（週期 2.4 秒、亮度起伏 ≤ 15%；光敏感模式恆亮）。只改 LED 顏色，不加光源。
//   * 防爆門上鎖（spec §3.5 / §6.5）：setBlastLocked(locked, { duration }) → Promise、blastLocked；
//     門上狀態燈：未鎖定 綠／上鎖中・解鎖中 琥珀緩慢起伏／已鎖定 紅（顏色變化 ≥ 0.4 秒）。
// =============================================================================
import * as THREE from 'three';
import { Batcher, Fader, keyCurve, quad, noRaycast } from './controlRoom/kit.js';
import { createSurfaceUniforms } from './controlRoom/surfaceFX.js';
import { createMaterials, UVS } from './controlRoom/materials.js';
import { buildShell } from './controlRoom/buildShell.js';
import { buildConsole } from './controlRoom/buildConsole.js';
import { buildFixtures } from './controlRoom/buildFixtures.js';
import { LedBank, LED_COLORS } from './controlRoom/leds.js';
import { SmokeSystem, SteamSystem } from './controlRoom/particles.js';
import * as LT from './controlRoom/localTextures.js';
import { clamp, smoothstep, damp } from '../core/util.js';

// ---- 燈光參數（可調） --------------------------------------------------------------
const F_CD = 16;         // 單盞日光燈（SpotLight）最大燭光
const E_CD = 6;          // 緊急紅燈
const FILL_CD = 6.5;      // 補光（模擬天花板/牆面反射）
const TUBE_EM = 4.2;     // 燈管自發光
const DIFF_EM = 0.9;     // 擴散板自發光
const LENS_EM = 1.5;     // 緊急燈罩自發光
const ENV_K = 0.55;      // 主控室專用環境貼圖（反射＋間接漫射）強度
const AMBER = new THREE.Color('#ffc58a');

const MODES = {
  off: { pos: 'F', I: [0, 0, 0], col: '#dbeee4', tube: [0, 0, 0, 0, 0, 0], diff: [0, 0, 0], emerg: 0, fill: 0, fillCol: '#9fb2ad', power: 1, warm: 1 },
  normal: { pos: 'F', I: [1, 1, 1], col: '#dbeee4', tube: [1, 1, 1, 1, 1, 1], diff: [1, 1, 1], emerg: 0, fill: 1, fillCol: '#a7beb6', power: 1, warm: 1 },
  emergency: { pos: 'E', I: [1, 1, 1], col: '#ff1c0a', tube: [0, 0, 0, 0, 0, 0], diff: [0, 0, 0], emerg: 1, fill: 0.3, fillCol: '#ff2410', power: 0, warm: 0 },
  restored: { pos: 'F', I: [0.56, 0.55, 0.3], col: '#ffd9a6', tube: [0.56, 0.56, 0.55, 0.55, 0.52, 0], diff: [0.56, 0.55, 0.3], emerg: 0, fill: 0.55, fillCol: '#d9b68e', power: 1, warm: 1 },
  ending: { pos: 'F', I: [0.62, 0.54, 0.4], col: '#ff7a2e', tube: [0.16, 0.14, 0.12, 0.1, 0.08, 0], diff: [0.16, 0.12, 0.08], emerg: 0.7, fill: 0.55, fillCol: '#ff6a26', power: 1, warm: 0, fire: 1 },
};
// 日光燈啟動：幾次緩慢、低振幅的明暗起伏（每段 ≥ 0.35 秒，0.25 秒內變化 < 30%）
const STARTUP_KEYS = [[0, 0], [0.12, 0.22], [0.24, 0.08], [0.4, 0.38], [0.52, 0.2], [0.7, 0.62], [0.8, 0.5], [1, 1]];
const STARTUP_SOFT = [[0, 0], [0.45, 0.3], [1, 1]];
const DECAL_TIERS = [[0.04, 0.3], [0.22, 0.52], [0.45, 0.76], [0.68, 0.98]];
const DECAL_MAX = { waterStain: 0.85, soot: 0.9, scorch: 0.95 };

// ---- 終幕濃煙（setSmoke 0..1 對應的煙層行為；可調） ----------------------------------
// 煙層下緣高度（公尺）：先貼著天花板分層，再一路往下沉（banking down）
const SMOKE_LAYER_Y = [[0, 3.2], [0.06, 2.95], [0.3, 2.3], [0.55, 1.95], [0.78, 1.55], [0.9, 1.2], [1, 0.25]];
// 煙層每公尺消光係數
const SMOKE_LAYER_K = [[0, 0], [0.05, 0], [0.22, 0.6], [0.55, 0.8], [0.8, 0.95], [1, 1.45]];
const SMOKE_ALBEDO = 2.2;       // 煙被室內光照亮的程度（乘在光源強度上）
const SMOKE_DESAT = 0.86;       // 煙色往亮度去飽和的比例（0 = 光源原色）
const SMOKE_K_SPOT = 0.0065;    // 每盞日光燈（cd）對煙色的貢獻
const SMOKE_K_FILL = 0.011;     // 補光（cd）對煙色的貢獻
const SMOKE_FLOOR = new THREE.Color(0.006, 0.0048, 0.0038);
// 指示燈的緩慢呼吸：亮度在 [1 - depth, 1] 之間以 period 秒的餘弦起伏（depth ≤ 0.15 = 黃金規則的 15% 上限）
// CAM 按鈕的動態偵測琥珀燈；光敏感模式恆亮 steady。
const CAM_LED = { period: 2.4, depth: 0.15, steady: 0.8, glow: 0.45 };
// 防爆門狀態燈：上鎖中 / 解鎖中的琥珀燈（週期 1.4 秒）；光敏感模式恆亮 0.6
const BLAST_LAMP = { period: 1.4, depth: 0.15, level: 0.7, steady: 0.6, unlocked: 0.7, lerp: 5 };
const breathe = (t, period, depth) => 1 - depth * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / period));
const EMBER_MAX = 0.36;         // 焦黑龜裂的餘燼光（線性 HDR）
// 終幕火光：補光（PointLight）移到防爆門內側、變成橘紅色，隨焦黑出現/退去（場景光源數量不變）
const FIRE_CD = 15;
const FIRE_COL = new THREE.Color('#ff6418');

/** 顏色過渡器 */
class ColorFader {
  constructor(c) { this.v = new THREE.Color(c); this.from = this.v.clone(); this.to = this.v.clone(); this.f = new Fader(1); }
  set(c, dur, now) { this.from.copy(this.v); this.to.set(c); this.f.snap(0); this.f.set(1, dur, now); if (dur <= 0) this.v.copy(this.to); return this; }
  snap(c) { this.v.set(c); this.from.copy(this.v); this.to.copy(this.v); this.f.snap(1); }
  update(now) { const k = this.f.update(now); this.v.copy(this.from).lerp(this.to, k); return this.v; }
}

export class ControlRoom {
  constructor(ctx) {
    this.ctx = ctx;
    const L = (this.L = ctx.LAYOUT.CONTROL_ROOM);
    this.BS = ctx.LAYOUT.BLAST_STUB;
    this.group = new THREE.Group();
    this.group.name = 'controlRoom';
    ctx.scene.add(this.group);

    this.objects = {};
    this.parts = {};
    /** 終幕便利貼的手寫動畫貼圖（TextureFactory.createStickyNote 的回傳物件）；stickyNoteTex 為主 CRT 上那張 */
    this.stickyNoteTex = null;
    this.endingNoteTex = null;

    // ---- 共用資源 ----
    this.U = createSurfaceUniforms(ctx);
    this.mats = createMaterials(ctx, this.U);
    this.envTex = this._buildEnv();
    if (this.envTex) this.mats.setEnvMap(this.envTex);
    this.tex = this._texApi();
    this.sb = new Batcher(UVS);
    this.leds = new LedBank(360);
    this.glowTex = this.tex.get('glow');
    this.dialTex = LT.dialTexture();
    // 通風拉桿（rotation.x；桿身沿 +Y、π/2 = 垂直面板伸出）：上 = 運轉、下 = 拉下/重啟，桿頭都在面板的拉桿槽範圍內
    this.LEVER_UP = Math.PI / 2 - 0.5;
    this.LEVER_DOWN = Math.PI / 2 + 0.5;
    this.endingNoteOffsetZ = 0.045; // 終幕便利貼往玩家方向偏移（避免與 CAM 按鈕座重疊）
    // 天花板特殊片：出風口、焦黑時下垂/脫落的天花板（格線索引見 buildShell.buildCeiling）
    this.ceilingSpecial = [
      { ix: 7, iz: 6, kind: 'vent' },
      { ix: 3, iz: 7, kind: 'droop', hinge: 'x0', angle: 0.5, th: 0.35 },
      { ix: 10, iz: 2, kind: 'droop', hinge: 'z1', angle: 1.05, th: 0.45 },
      { ix: 9, iz: 6, kind: 'missing', hinge: 'x1', angle: 0.3, th: 0.55 },
      { ix: 4, iz: 10, kind: 'missing', hinge: 'z0', angle: 0.25, th: 0.65 },
      { ix: 6, iz: 1, kind: 'droop', hinge: 'x1', angle: 0.38, th: 0.5 },
    ];
    this._decalLists = new Batcher();
    this._decalMats = [];

    // ---- 螢幕（材質由 CameraFeeds.init() 指派） ----
    const ms = L.mainScreen;
    const screenMat = new THREE.MeshStandardMaterial({ color: 0x0c0e0d, roughness: 0.55, metalness: 0.0 });
    const mainScreen = new THREE.Mesh(new THREE.PlaneGeometry(ms.w, ms.h), screenMat);
    mainScreen.position.set(ms.x, ms.y, ms.z);
    mainScreen.name = 'mainScreen';
    this.group.add(mainScreen);
    const sideScreens = L.sideScreens.map((s, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), screenMat);
      m.position.set(s.x, s.y, s.z); m.rotation.y = s.yaw;
      m.name = i === 0 ? 'sideScreenLeft' : 'sideScreenRight';
      this.group.add(m);
      return m;
    });
    const screenLight = new THREE.PointLight(0x9fb4c8, 0.6, 6, 2);
    screenLight.position.set(ms.x, ms.y, ms.z + 0.5);
    this.group.add(screenLight);
    this.objects.mainScreen = mainScreen;
    this.objects.sideScreens = sideScreens;
    this.objects.screenLight = screenLight;

    // ---- 建模 ----
    buildShell(this);
    buildConsole(this);
    buildFixtures(this);
    this.sb.build((k) => this.mats.get(k), this.group, { name: 'static' });
    this._buildDecals();
    this._buildScreenCracks();
    this.group.add(this.leds.mesh);

    // ---- 室內光源 ----
    this._buildLights();
    // ---- 粒子 ----
    this.smoke = new SmokeSystem(this);
    const c = L.coffee;
    this.steam = new SteamSystem(this, new THREE.Vector3(c.x, c.y + this.parts.mug.height * 0.86, c.z));

    // ---- 狀態 ----
    this._f = {
      corruption: new Fader(0), burnt: new Fader(0), smoke: new Fader(0), unlock: new Fader(0),
      fill: new Fader(0), emerg: new Fader(0), power: new Fader(1), warm: new Fader(1), fire: new Fader(0),
      tube: [0, 1, 2, 3, 4, 5].map(() => new Fader(0)), diff: [0, 1, 2].map(() => new Fader(0)),
      lightI: [0, 1, 2].map(() => new Fader(0)),
    };
    this._lightCol = [0, 1, 2].map(() => new ColorFader('#dbeee4'));
    this._fillCol = new ColorFader('#a7beb6');
    this._lightPos = ['F', 'F', 'F'];
    this._pending = [null, null, null];
    this._mode = 'off';
    this._startup = null;
    this._clockText = this.ctx.flags?.clockText || '02:00';
    this._colonOn = null;
    this._intercomMode = 'off';
    this._ventMode = 'ok';
    this._ventGauge = null;
    this._needle = 0.62;
    this._ventLedK = { run: 0, fault: 0, stop: 0 };
    this._intercomCol = new THREE.Color(0, 0, 0);
    this._blastState = 'locked';
    this._blastLampCol = new THREE.Color(0, 0, 0);
    this._sideOpen = false;
    this._coffeeStage = 0;
    this._penP = -1; this._penAct = 0;
    this._penBase = new THREE.Vector3();
    this._tok = {};
    /** 目前被室內光照亮的煙色（線性；states/common.js 用它設定霧色與 postfx 煙霾色）。唯讀。 */
    this.smokeColor = new THREE.Color(0, 0, 0);
    /** 濃煙外觀的可調參數（除錯/調校用）：光照倍率、去飽和、煙團上/下側亮度、煙層顏色倍率與濃度倍率、餘燼光。 */
    this.smokeLook = { albedo: SMOKE_ALBEDO, desat: SMOKE_DESAT, top: 1.25, low: 0.85, warm: 0.7, layerCol: 0.75, layerK: 1, haze: 0.55, ember: EMBER_MAX, front: 0.07, fire: 1 };
    /** 整片霧與 postfx 煙霾用的顏色（線性；smokeColor × smokeLook.haze）。唯讀。 */
    this.hazeColor = new THREE.Color(0, 0, 0);
    this._smokeTop = new THREE.Color();
    this._smokeLow = new THREE.Color();
    this.U.uBurnOrigin.value.set(L.minX, 1.7, L.blastDoor.z);
    // 天花板片的焦黑門檻：離防爆門越遠越晚下垂/脫落（與表面焦黑的蔓延一致）
    for (const tl of this.ceilingTiles || []) {
      const d = Math.hypot(tl.pivot.position.x - L.minX, tl.pivot.position.z - L.blastDoor.z);
      tl.thEff = clamp(0.12 + d * 0.075 + (tl.th - 0.5) * 0.25, 0.1, 0.8);
    }
    this.setLighting('off', { duration: 0 });
    this.setClock(this._clockText);
    this.setCoffeeStage(0);
    this.setIntercomLed('off');
    this.setVentLed('ok');
  }

  init() {
    // 便利貼循環記號（存檔的循環次數）
    try { this.setLoopTallies(this.ctx.flags?.loopCount || 0); } catch (e) { console.warn('[ControlRoom] tallies', e); }
  }

  // ===========================================================================
  // 內部：貼圖 API（容錯）、光源、貼花、螢幕裂痕
  // ===========================================================================
  _texApi() {
    const tx = this.ctx.textures;
    const blank = () => LT.solidTexture('#6a6a6a');
    const safe = (fn, fb) => {
      try { const r = fn(); return r ?? fb(); } catch (e) { console.warn('[ControlRoom] texture call failed', e); return fb(); }
    };
    const noteFb = () => ({ texture: blank(), canvas: null, setProgress() {}, setTallies() {}, penPosition: () => ({ u: 0.5, v: 0.5 }) });
    const clockFb = () => ({ texture: blank(), setText() {}, setColonVisible() {}, setDim() {} });
    return {
      get: (n) => safe(() => tx.get(n), blank),
      label: (text, o) => safe(() => tx.createLabel(text, o), blank),
      panel: (k) => safe(() => tx.createPanelGraphic(k), blank),
      sign: (t, o) => safe(() => tx.createSign(t, o), blank),
      coffee: (n) => safe(() => tx.createCoffeeSurface(n), blank),
      tunnelMap: () => safe(() => tx.createTunnelMap(), blank),
      stickyNote: () => safe(() => tx.createStickyNote(), noteFb),
      ledClock: () => safe(() => tx.createLedClock(), clockFb),
    };
  }

  /** 主控室專用的環境貼圖：暗色房間＋三條日光燈帶（只套在本模組材質上，不設 scene.environment）。 */
  _buildEnv() {
    const r = this.ctx.renderer;
    if (!r) return null;
    try {
      const L = this.L, eye = 1.4;
      const scene = new THREE.Scene();
      const disp = [];
      const add = (g, color, side = THREE.FrontSide) => {
        const m = new THREE.MeshBasicMaterial({ color, side });
        const mesh = new THREE.Mesh(g, m); scene.add(mesh); disp.push(g, m); return mesh;
      };
      const room = add(new THREE.BoxGeometry(L.maxX - L.minX, L.height, L.maxZ - L.minZ), new THREE.Color(0.05, 0.058, 0.055), THREE.BackSide);
      room.position.y = L.height / 2 - eye;
      const floor = add(new THREE.PlaneGeometry(8, 7), new THREE.Color(0.08, 0.085, 0.08));
      floor.rotation.x = -Math.PI / 2; floor.position.y = 0.01 - eye;
      const desk = add(new THREE.BoxGeometry(5.2, 0.9, 0.9), new THREE.Color(0.03, 0.033, 0.033));
      desk.position.set(0, 0.4 - eye, (L.desk.minZ + L.desk.maxZ) / 2);
      for (const f of L.fluorescents) {
        const m = add(new THREE.PlaneGeometry(1.24, 0.28), new THREE.Color(5.0, 5.6, 5.3));
        m.rotation.x = Math.PI / 2; m.position.set(f.x, L.height - 0.08 - eye, f.z);
      }
      const pm = new THREE.PMREMGenerator(r);
      const rt = pm.fromScene(scene, 0.04, 0.05, 30);
      pm.dispose();
      for (const d of disp) d.dispose();
      return rt.texture;
    } catch (e) {
      console.warn('[ControlRoom] env map unavailable', e);
      return null;
    }
  }

  _buildLights() {
    const L = this.L, H = L.height;
    this._posF = L.fluorescents.map((f) => ({ p: new THREE.Vector3(f.x, H - 0.09, f.z), t: new THREE.Vector3(f.x, 0, f.z + 0.15), angle: 1.56, pen: 0.55, dist: 7 }));
    const tgt = [new THREE.Vector3(-2.9, 0.2, -0.6), new THREE.Vector3(3.3, 0.5, 1.1), new THREE.Vector3(1.2, 0, 1.2)];
    this._posE = L.emergencyLights.map((e, i) => ({ p: new THREE.Vector3(e.x, e.y - 0.07, e.z + (e.z < 0 ? 0.06 : -0.06)), t: tgt[i] || new THREE.Vector3(0, 0, 0), angle: 1.15, pen: 1, dist: 6 }));
    this.roomLights = [0, 1, 2].map((i) => {
      const s = new THREE.SpotLight(0xffffff, 0, 6.5, 1.36, 0.85, 2);
      s.name = `roomLight${i}`;
      s.castShadow = false;
      this.group.add(s, s.target);
      this._placeLight(s, this._posF[i]);
      return s;
    });
    this.fillLight = new THREE.PointLight(0xffffff, 0, 7, 2);
    this.fillLight.position.set(0, 1.75, 0.1);
    this._fillHome = this.fillLight.position.clone();
    // 終幕火光的位置：防爆門內側、門洞中段高度（門外是火場）
    this._fireAt = new THREE.Vector3(L.minX + 0.6, 1.2, L.blastDoor.z + 0.25);
    /** 終幕火光強度 0..1（唯讀；濃煙粒子在門外的亮度用它） */
    this.fireLevel = 0;
    this.group.add(this.fillLight);
  }
  _placeLight(s, P) {
    s.position.copy(P.p); s.target.position.copy(P.t); s.target.updateMatrixWorld();
    s.angle = P.angle; s.penumbra = P.pen; s.distance = P.dist;
  }

  /** 腐化貼花（依材質/門檻層合併）。 */
  addDecal(texName, tier, w, h, matrix, geom = null) {
    const g = geom || quad(w, h);
    this._decalLists.add(`${texName}|${tier}`, g, matrix, { uv: false });
  }
  _buildDecals() {
    const meshes = this._decalLists.build((key) => {
      const [name, tier] = key.split('|');
      const m = this.mats.make({
        map: this.tex.get(name), transparent: true, depthWrite: false, opacity: 0, roughness: 0.95, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }, `cr:decal:${key}`);
      this._decalMats.push({ m, name, tier: Number(tier) });
      return m;
    }, this.group, { name: 'decals' });
    for (const [key, mesh] of Object.entries(meshes)) {
      noRaycast(mesh); mesh.visible = false; mesh.renderOrder = 1;
      const d = this._decalMats.find((x) => `${x.name}|${x.tier}` === key);
      if (d) d.mesh = mesh;
    }
  }

  _buildScreenCracks() {
    const L = this.L;
    const crackMat = (seed) => new THREE.MeshStandardMaterial({ map: LT.crackTexture(seed), roughness: 0.18, metalness: 0.2, transparent: true, opacity: 0, depthWrite: false });
    this._cracks = [];
    const ms = L.mainScreen;
    const m0 = new THREE.Mesh(new THREE.PlaneGeometry(ms.w, ms.h), crackMat(7));
    m0.position.set(ms.x, ms.y, ms.z + 0.004);
    this._cracks.push(m0);
    L.sideScreens.forEach((s, i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), crackMat(11 + i * 5));
      m.position.set(s.x + Math.sin(s.yaw) * 0.004, s.y, s.z + Math.cos(s.yaw) * 0.004);
      m.rotation.y = s.yaw;
      this._cracks.push(m);
    });
    for (const m of this._cracks) { m.visible = false; m.renderOrder = 1; this.group.add(noRaycast(m)); }
  }

  // ===========================================================================
  // 公開 API
  // ===========================================================================

  /** 玩家碰撞用的障礙物（XZ 平面 AABB）：控制台、櫃子、門框等（不含椅子）。@returns {{minX,maxX,minZ,maxZ}[]} */
  getObstacles() {
    const L = this.L, d = L.desk, bd = L.blastDoor, S = L.maxZ;
    const pocket = this.blastPocket || { z0: bd.z + bd.width / 2 + 0.07, z1: bd.z + bd.width / 2 + 2.2 };
    return [
      { minX: d.minX, maxX: d.maxX, minZ: d.minZ, maxZ: d.maxZ },                         // 控制台
      { minX: d.minX + 0.05, maxX: d.maxX - 0.05, minZ: L.minZ, maxZ: d.minZ },          // 控制台後方
      { minX: -3.02, maxX: -1.46, minZ: S - 0.66, maxZ: S },                             // 檔案櫃
      { minX: 0.83, maxX: 2.27, minZ: S - 0.6, maxZ: S },                                // 咖啡台
      { minX: L.minX, maxX: -3.43, minZ: L.minZ, maxZ: -2.93 },                          // 置物櫃
      { minX: 3.35, maxX: L.maxX, minZ: L.minZ, maxZ: -2.85 },                           // 機櫃
      { minX: L.minX, maxX: L.minX + 0.34, minZ: bd.z - bd.width / 2 - 0.3, maxZ: pocket.z0 }, // 防爆門框與手輪
      { minX: L.minX, maxX: L.minX + 0.47, minZ: pocket.z0, maxZ: pocket.z1 },           // 防爆門門袋
      { minX: L.maxX - 0.22, maxX: L.maxX, minZ: 2.94, maxZ: 3.16 },                    // 滅火器
      // 側門向外旋開後貼在廊道北側的門扇（關門時此區在牆外，無影響）
      { minX: L.maxX + 0.15, maxX: L.maxX + 0.17 + L.sideDoor.width + 0.05, minZ: L.sideDoor.hingeZ - 0.2, maxZ: L.sideDoor.hingeZ + 0.07 },
    ];
  }

  /** mode: 'off' | 'normal' | 'emergency'（紅色緊急照明）| 'restored'（第三幕：昏暗暖色）| 'ending'（濃煙中的殘光） */
  setLighting(mode, { duration = 1 } = {}) {
    const M = MODES[mode];
    if (!M) { console.warn('[ControlRoom] unknown lighting mode', mode); return; }
    const now = this.ctx.clock.time;
    const dur = Math.max(0, duration);
    this._mode = mode;
    if (this._startup && this._lastStartK) {
      // 啟動中途被改變：把目前的啟動包絡併入各過渡器，避免亮度跳變
      for (let i = 0; i < 3; i++) {
        const k = this._lastStartK[i];
        this._f.lightI[i].snap(this._f.lightI[i].v * k);
        this._f.diff[i].snap(this._f.diff[i].v * k);
        this._f.tube[i * 2].snap(this._f.tube[i * 2].v * k);
        this._f.tube[i * 2 + 1].snap(this._f.tube[i * 2 + 1].v * k);
      }
      this._f.fill.snap(this._f.fill.v * (this._lastStartK[0] + this._lastStartK[1] + this._lastStartK[2]) / 3);
    }
    this._startup = null;
    for (let i = 0; i < 3; i++) {
      const fI = this._f.lightI[i];
      if (this._lightPos[i] !== M.pos && fI.v > 0.002 && dur > 0) {
        // 先熄滅、移到新位置、再亮起
        fI.set(0, dur * 0.5, now);
        this._pending[i] = { pos: M.pos, I: M.I[i], col: M.col, dur: dur * 0.5 };
      } else {
        this._pending[i] = null;
        if (this._lightPos[i] !== M.pos) {
          this._lightPos[i] = M.pos;
          this._placeLight(this.roomLights[i], (M.pos === 'F' ? this._posF : this._posE)[i]);
          this._lightCol[i].snap(M.col);
        } else this._lightCol[i].set(M.col, dur, now);
        fI.set(M.I[i], dur, now);
      }
    }
    M.tube.forEach((v, j) => this._f.tube[j].set(v, dur, now));
    M.diff.forEach((v, j) => this._f.diff[j].set(v, dur, now));
    this._f.emerg.set(M.emerg, dur, now);
    this._f.fill.set(M.fill, dur, now);
    this._f.fire.set(M.fire || 0, dur, now);
    this._fillCol.set(M.fillCol, dur, now);
    this._f.power.set(M.power, Math.min(dur, 0.6), now);
    this._f.warm.set(M.warm, dur, now);
  }

  /** 序幕：日光燈啟動（幾次緩慢、低振幅的明暗起伏後穩定點亮；不可頻閃）。含 audio 'tubeStart'。@returns {Promise<void>} */
  lightsStartup(duration = 3.5) {
    const now = this.ctx.clock.time;
    const prev = this._overallLevel ?? 0;
    try { this.ctx.audio?.sfx?.('tubeStart'); } catch (e) { console.warn('[ControlRoom] sfx', e); }
    this.setLighting('normal', { duration: 0 });
    this._startup = { t0: now, dur: Math.max(0.8, duration), carry: prev };
    return this.ctx.clock.wait(Math.max(0.8, duration));
  }

  setCorruption(c, { duration = 2 } = {}) { this._f.corruption.set(clamp(c), duration, this.ctx.clock.time); }
  setBurnt(b, { duration = 3 } = {}) { this._f.burnt.set(clamp(b), duration, this.ctx.clock.time); }

  /** 0 熱咖啡（冒蒸氣粒子）/ 1 冷掉浮灰 / 2 乾涸龜裂的杯子 */
  setCoffeeStage(stage) {
    const s = Math.max(0, Math.min(2, Math.round(stage || 0)));
    this._coffeeStage = s;
    const m = this.parts.mug;
    if (!m) return;
    m.liqMat.map = m.tex[s];
    m.liqMat.needsUpdate = true;
    m.liqMat.roughness = s === 0 ? 0.1 : s === 1 ? 0.55 : 0.9;
    m.liquid.position.y = m.height * (s === 0 ? 0.82 : s === 1 ? 0.78 : 0.075);
    m.liquid.scale.setScalar(s === 2 ? 0.93 : 1);
    m.mugMat.color.set(s === 0 ? 0xe9e4d8 : s === 1 ? 0xd8d0bf : 0xaea38f);
    m.mugMat.roughness = s === 0 ? 0.3 : s === 1 ? 0.45 : 0.75;
    m.crack.visible = s === 2;
    m.rings[0].visible = s >= 1;
    m.rings[1].visible = s === 2;
  }

  /** LED 鐘顯示 'HH:MM'（冒號每秒閃爍由本模組處理；'blank' / blank = true 顯示 '--:--'）。 */
  setClock(text, blank = false) {
    const isBlank = blank === true || blank?.blank === true || text === 'blank' || text === true || text == null || text === '';
    const t = isBlank ? '--:--' : String(text);
    this._clockText = t;
    try { this.ledClock?.setText(t); } catch (e) { console.warn('[ControlRoom] clock', e); }
  }

  /** 'off' | 'ringing'（緩慢脈動的琥珀燈，週期 1.2 秒）| 'talking'（穩定綠燈） */
  setIntercomLed(mode) { this._intercomMode = mode === 'ringing' || mode === 'talking' ? mode : 'off'; }
  /** 'ok' | 'fault'（琥珀）| 'off' */
  setVentLed(mode) { this._ventMode = mode === 'fault' || mode === 'off' ? mode : 'ok'; }
  /** （額外）直接指定轉速表讀數 0..1；null = 依 setVentLed 狀態自動。 */
  setVentGauge(v) { this._ventGauge = v == null ? null : clamp(v); }

  /** 拉桿動畫（拉下後保持在下方），回傳 Promise。 */
  pullVentLever() {
    const lever = this.parts.vent?.lever;
    if (!lever) return this.ctx.clock.wait(0.6);
    const tok = this._token('lever');
    const a0 = lever.rotation.x, a1 = this.LEVER_DOWN;
    return this.ctx.clock.tween(0.55, (e) => { if (this._tok.lever === tok) lever.rotation.x = a0 + (a1 - a0) * e; }, 'inOut')
      .then(() => this.ctx.clock.tween(0.22, (e, k) => { if (this._tok.lever === tok) lever.rotation.x = a1 + Math.sin(k * Math.PI) * 0.07; }, 'linear'));
  }
  /** （額外）直接設定拉桿位置（跳關用）。 */
  setVentLever(down, { duration = 0 } = {}) {
    const lever = this.parts.vent?.lever;
    if (!lever) return Promise.resolve();
    const tok = this._token('lever');
    const a0 = lever.rotation.x, a1 = down ? this.LEVER_DOWN : this.LEVER_UP;
    if (duration <= 0) { lever.rotation.x = a1; return Promise.resolve(); }
    return this.ctx.clock.tween(duration, (e) => { if (this._tok.lever === tok) lever.rotation.x = a0 + (a1 - a0) * e; });
  }

  /** 按鈕按下動畫（0..3）。 */
  pressCamButton(index) {
    const btn = this.objects.camButtons?.[index];
    if (!btn) return Promise.resolve();
    const key = `cam${index}`;
    const tok = this._token(key);
    const rest = btn.userData.rest, n = btn.userData.normal;
    return this.ctx.clock.tween(0.07, (e) => { if (this._tok[key] === tok) btn.position.copy(rest).addScaledVector(n, -0.005 * e); }, 'out')
      .then(() => this.ctx.clock.tween(0.16, (e) => { if (this._tok[key] === tok) btn.position.copy(rest).addScaledVector(n, -0.005 * (1 - e)); }, 'inOut'));
  }

  /** 解鎖鈕發出緩慢呼吸的紅光（週期 ≥ 1.5 秒，不可閃爍）。 */
  setUnlockGlow(on) { this._f.unlock.set(on ? 1 : 0, 0.9, this.ctx.clock.time); }

  /** 翻開透明護蓋並壓下紅色蘑菇鈕。@returns {Promise<void>} */
  pressUnlockButton() {
    const u = this.parts.unlock;
    if (!u) return this.ctx.clock.wait(0.4);
    const tok = this._token('unlock');
    const c0 = u.coverPivot.rotation.x;
    return this.ctx.clock.tween(0.32, (e) => { if (this._tok.unlock === tok) u.coverPivot.rotation.x = c0 + (-1.95 - c0) * e; }, 'out')
      .then(() => this.ctx.clock.tween(0.14, (e) => { if (this._tok.unlock === tok) u.btn.position.y = 0.024 - 0.009 * e; }, 'inOut'));
  }

  /** 手電筒從箱子取下（隱藏箱內手電筒）。 */
  takeFlashlight() { if (this.parts.flashlight) this.parts.flashlight.fl.visible = false; }

  /** 側門向外（+X）旋開；回傳 Promise。 */
  openSideDoor(duration = 2.4) {
    this._sideOpen = true;
    return this._swingSideDoor(Math.PI / 2 * 0.96, duration);
  }
  /** （額外）關上側門。 */
  closeSideDoor(duration = 1.6) { this._sideOpen = false; return this._swingSideDoor(0, duration); }
  _swingSideDoor(target, duration) {
    const pivot = this.objects.sideDoor;
    const tok = this._token('side');
    const a0 = pivot.rotation.y;
    if (duration <= 0) { pivot.rotation.y = target; return Promise.resolve(); }
    // 厚重的門：先慢慢鬆開，再穩穩盪開
    const ease = (k) => { const s = k * k * (3 - 2 * k); return s * s * (3 - 2 * s) * 0.35 + s * 0.65; };
    return this.ctx.clock.tween(duration, (e) => { if (this._tok.side === tok) pivot.rotation.y = a0 + (target - a0) * e; }, ease);
  }

  /** 防爆門沿 +Z 滑入牆內門袋；回傳 Promise。（先轉動氣壓閥手輪、縮回鎖栓，再滑開） */
  openBlastDoor(duration = 4.5) {
    const P = this.parts.blast;
    const slide = this.L.blastDoor.slide;
    const tok = this._token('blast');
    const D = Math.max(0.5, duration);
    const tA = D * 0.24;
    const w0 = P.wheel.rotation.x, b0 = P.bolts.position.z, d0 = P.door.position.z;
    this._blastState = 'opening';
    const alive = () => this._tok.blast === tok;
    return this.ctx.clock.tween(tA, (e) => {
      if (!alive()) return;
      P.wheel.rotation.x = w0 + e * Math.PI * 2.5;
      P.bolts.position.z = b0 + (0.12 - b0) * e;
    }, 'inOut').then(() => this.ctx.clock.tween(D - tA, (e) => {
      if (!alive()) return;
      P.door.position.z = d0 + (slide - d0) * e;
    }, 'inOut')).then(() => { if (alive()) this._blastState = 'open'; });
  }
  /** （額外）直接設定防爆門開關（跳關/重置）。 */
  setBlastDoorOpen(open) {
    const P = this.parts.blast;
    this._token('blast');
    P.door.position.z = open ? this.L.blastDoor.slide : 0;
    P.bolts.position.z = open ? 0.12 : 0;
    this._blastState = open ? 'open' : 'locked';
  }

  /**
   * 防爆門氣壓閥上鎖 / 解鎖（門保持關著）：手輪轉 2.5 圈（0.7·duration，上鎖反向），再推出 / 縮回鎖栓（0.3·duration）。
   * duration ≤ 0 立即完成（跳關/重置）。狀態燈：'locking' | 'unlocking' → 'locked' | 'unlocked'。
   * @returns {Promise<void>}
   */
  setBlastLocked(locked, { duration = 2.4 } = {}) {
    const P = this.parts.blast;
    const tok = this._token('blast');
    locked = !!locked;
    const b1 = locked ? 0 : 0.12;
    if (!(duration > 0)) {
      P.door.position.z = 0;
      P.bolts.position.z = b1;
      this._blastState = locked ? 'locked' : 'unlocked';
      return Promise.resolve();
    }
    const alive = () => this._tok.blast === tok;
    const dir = locked ? -1 : 1;    // openBlastDoor 解鎖時手輪 +2.5π；上鎖反向
    const w0 = P.wheel.rotation.x;
    const tW = duration * 0.7, tB = duration * 0.3;
    this._blastState = locked ? 'locking' : 'unlocking';
    return this.ctx.clock.tween(tW, (e) => {
      if (alive()) P.wheel.rotation.x = w0 + dir * e * Math.PI * 2.5;
    }, 'inOut').then(() => {
      const b0 = P.bolts.position.z;
      return this.ctx.clock.tween(tB, (e) => { if (alive()) P.bolts.position.z = b0 + (b1 - b0) * e; }, 'inOut');
    }).then(() => { if (alive()) this._blastState = locked ? 'locked' : 'unlocked'; });
  }
  /** 防爆門目前是否鎖死（鎖栓推出、門關著）。 */
  get blastLocked() { return this._blastState === 'locked'; }

  /** 濃煙（0..1）：從防爆門湧入、翻滾著充滿房間的煙霧粒子，並讓室內燈光被煙吞沒變暗。
   *  scene.fog 由 states/common.js 統一管理：它會讀取 this.smokeLevel（目前平滑後的值 0..1）把霧轉黑轉濃。 */
  setSmoke(amount, { duration = 4 } = {}) { this._f.smoke.set(clamp(amount), duration, this.ctx.clock.time); }
  /** 目前（平滑後）的濃煙量 0..1 —— 唯讀，供 states/common.js 調整 scene.fog。 */
  get smokeLevel() { return this._f ? this._f.smoke.v : 0; }

  /** 'monitor'（主 CRT 上那張）/ 'ending'（桌上那張＋筆）可見性 */
  setNoteVisible(which, on) {
    if (which === 'monitor') this.objects.stickyNote.visible = !!on;
    else if (which === 'ending') { this.objects.endingNote.visible = !!on; this.objects.pen.visible = !!on; }
  }

  /** 終幕寫字：0..1，同步更新 endingNote 的貼圖與筆的位置。 */
  setEndingWriting(p) {
    const k = clamp(p);
    try { this.endingNoteTex?.setProgress(k); } catch (e) { console.warn('[ControlRoom] setProgress', e); }
    if (this._penP >= 0 && Math.abs(k - this._penP) > 1e-5) this._penAct = 1;
    this._penP = k;
    let uv = { u: 0.5, v: 0.5 };
    try { uv = this.endingNoteTex?.penPosition?.() || uv; } catch (e) { /* 保持預設 */ }
    const note = this.objects.endingNote;
    const size = this.L.endingNote.size;
    // TextureFactory.penPosition() 回傳標準 UV（u 左→右、v 下→上），與 PlaneGeometry 的 UV 一致
    const local = new THREE.Vector3((clamp(uv.u) - 0.5) * size, (clamp(uv.v) - 0.5) * size, 0.0015);
    note.updateMatrix();
    this._penBase.copy(local.applyMatrix4(note.matrix));
    this.objects.pen.position.copy(this._penBase);
  }

  /** 便利貼角落的「正」字記號（循環次數）。 */
  setLoopTallies(n) {
    for (const t of [this.stickyNoteTex, this.endingNoteTex]) {
      try { t?.setTallies(n); } catch (e) { console.warn('[ControlRoom] setTallies', e); }
    }
  }

  /** 重置為序幕初始狀態（循環重來時呼叫）：門關、腐化 0、焦黑 0、咖啡 0、煙 0。 */
  reset() {
    for (const k of Object.keys(this._tok)) this._tok[k]++;
    const f = this._f;
    f.corruption.snap(0); f.burnt.snap(0); f.smoke.snap(0); f.unlock.snap(0);
    this.smoke.reset();
    this.setCoffeeStage(0);
    this.setBlastDoorOpen(false);
    this.parts.blast.wheel.rotation.x = 0;
    this.objects.sideDoor.rotation.y = 0;
    this._sideOpen = false;
    this.setVentLever(false);
    const u = this.parts.unlock;
    u.coverPivot.rotation.x = 0; u.btn.position.y = 0.024;
    this.camButtonsReset();
    if (this.parts.flashlight) this.parts.flashlight.fl.visible = true;
    this.setNoteVisible('monitor', true);
    this.setNoteVisible('ending', false);
    this._penP = -1; this._penAct = 0;
    this.setIntercomLed('off');
    this.setVentLed('ok');
    this._ventGauge = null;
    this.setLighting('normal', { duration: 0 });
    for (const tl of this.ceilingTiles || []) { tl.pivot.rotation.set(0, 0, 0); if (tl.mat.transparent) tl.mat.opacity = 1; tl.pivot.visible = true; }
    this.U.uLayerK.value = 0; this.U.uLayerY.value = 3.2; this.U.uEmberGlow.value = 0;
  }
  camButtonsReset() { for (const b of this.objects.camButtons || []) b.position.copy(b.userData.rest); }

  _token(key) { this._tok[key] = (this._tok[key] || 0) + 1; return this._tok[key]; }

  // ===========================================================================
  // 每幀
  // ===========================================================================
  update(dt, t) {
    const now = this.ctx.clock.time;
    const reduce = !!this.ctx.settings?.get?.('reduceFlicker');
    const f = this._f;
    const c = f.corruption.update(now);
    const b = f.burnt.update(now);
    const s = f.smoke.update(now);
    const power = f.power.update(now);
    const warm = f.warm.update(now);
    const emerg = f.emerg.update(now);
    const fill = f.fill.update(now);
    const fillCol = this._fillCol.update(now);

    this.U.uDirt.value = c;
    this.U.uBurnt.value = b;
    // 燃燒前緣：一條往房內推進的暗橘光帶（焦黑完成後消失）
    this.U.uEmber.value = b > 0.001 ? this.smokeLook.front * (1 - b * b) : 0;
    // 龜裂餘燼光：焦黑完成後慢慢亮起、濃煙中略被吞沒；起伏由著色器處理（光敏感模式不起伏）
    this.U.uEmberGlow.value = this.smokeLook.ember * smoothstep(0.08, 0.55, b) * (1 - 0.45 * smoothstep(0.6, 1, s));
    this.U.uEmberWobble.value = reduce ? 0 : 0.12;
    this.U.uSfxTime.value = t;

    // ---- 燈光 ----
    const corrDim = 1 - 0.42 * c;
    const smokeDim = 1 - 0.42 * s;
    const burnDim = 1 - 0.15 * b;
    const undA = reduce ? 0 : 0.12 * smoothstep(0.55, 1, c);
    const startK = [1, 1, 1];
    if (this._startup) {
      const st = this._startup;
      const keys = reduce ? STARTUP_SOFT : STARTUP_KEYS;
      let done = true;
      for (let i = 0; i < 3; i++) {
        const lag = [0, 0.18, 0.09][i];
        const k = (now - st.t0 - lag) / st.dur;
        if (k < 1) done = false;
        const carry = st.carry * clamp(1 - (now - st.t0) / 1.2);
        startK[i] = Math.max(keyCurve(keys, clamp(k)), carry);
      }
      if (done) this._startup = null;
    }
    this._lastStartK = startK;
    let level = 0;
    for (let i = 0; i < 3; i++) {
      const fI = f.lightI[i];
      const Iv = fI.update(now);
      const pend = this._pending[i];
      if (pend && fI.done) {
        this._pending[i] = null;
        this._lightPos[i] = pend.pos;
        this._placeLight(this.roomLights[i], (pend.pos === 'F' ? this._posF : this._posE)[i]);
        this._lightCol[i].snap(pend.col);
        fI.set(pend.I, pend.dur, now);
      }
      const isF = this._lightPos[i] === 'F';
      const und = undA > 0 ? 1 - undA * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 2.9 + i * 2.1)) * (0.65 + 0.35 * Math.sin((t * Math.PI * 2) / 7.7 + i * 1.3)) : 1;
      const col = this._lightCol[i].update(now);
      const L = this.roomLights[i];
      L.color.copy(col);
      if (isF) L.color.lerp(AMBER, c * warm);
      const k = Iv * (isF ? startK[i] * und * corrDim : 1) * smokeDim * burnDim;
      L.intensity = k * (isF ? F_CD : E_CD);
      level += isF ? k : k * 0.3;
      // 燈管/擴散板
      const tubes = this.tubeMats[i];
      for (let j = 0; j < 2; j++) {
        const tv = f.tube[i * 2 + j].update(now) * startK[i] * und * corrDim * (1 - 0.5 * s);
        tubes[j].emissive.copy(L.color);
        tubes[j].emissiveIntensity = tv * TUBE_EM;
      }
      const dv = f.diff[i].update(now) * startK[i] * und * corrDim * (1 - 0.45 * s);
      this.diffuserMats[i].emissive.copy(L.color);
      this.diffuserMats[i].emissiveIntensity = dv * DIFF_EM;
    }
    this._overallLevel = clamp(level / 3);
    // 環境貼圖強度（跟著日光燈亮度、腐化、濃煙、焦黑）
    const envK = ENV_K * this._overallLevel * (1 - 0.35 * c) * smokeDim * burnDim;
    if (Math.abs(envK - (this._envK ?? -1)) > 1e-4) {
      this._envK = envK;
      for (const m of this.mats.all) m.envMapIntensity = envK;
    }
    // 燈管兩端：腐化時發黑；啟動時燈絲先發出微弱橘光
    const filament = this._startup ? clamp(1 - (startK[0] + startK[1] + startK[2]) / 3) * clamp((now - this._startup.t0) / 0.3) : 0;
    this.tubeEndMat.opacity = Math.max(smoothstep(0.25, 0.9, c) * 0.85, filament * 0.9);
    this.tubeEndMat.emissive.setRGB(1, 0.42, 0.12);
    this.tubeEndMat.emissiveIntensity = filament * 1.6;
    this.emergLensMat.emissiveIntensity = emerg * LENS_EM * (1 - 0.45 * s);
    this.fillLight.color.copy(fillCol);
    if (warm > 0.01) this.fillLight.color.lerp(AMBER, c * 0.6 * warm);
    const fillStart = (startK[0] + startK[1] + startK[2]) / 3;
    // 終幕火光：補光滑到防爆門內側、轉為橘紅，強度跟著焦黑（門口先燒起來）；緩慢起伏 ≤ 9%、週期 ≥ 1.9 秒
    const fire = f.fire.update(now);
    const fireK = fire * smoothstep(0.02, 0.4, b) * this.smokeLook.fire;
    this.fireLevel = fireK;
    this.fillLight.position.lerpVectors(this._fillHome, this._fireAt, fire);
    if (fireK > 0.001) this.fillLight.color.lerp(FIRE_COL, Math.min(1, fireK));
    const fwob = reduce ? 1 : 1 + 0.09 * (0.6 * Math.sin((t * Math.PI * 2) / 1.9) + 0.4 * Math.sin((t * Math.PI * 2) / 3.3 + 1.3));
    this.fillLight.intensity = (fill * FILL_CD * fillStart * corrDim + FIRE_CD * fireK * fwob) * smokeDim * burnDim;

    // 防爆門外的短廊（不受光材質）：只在門口附近帶到一點點室內光
    if (this.stubMat) {
      const k = 0.3 * this._overallLevel + 0.12 * emerg;
      this.stubMat.color.copy(this.roomLights[0].color).multiplyScalar(k * (1 - 0.6 * s));
      // 終幕：門外的短廊被火光映成暗橘紅
      if (this.fireLevel > 0.001) this.stubMat.color.add(_tmpC.copy(FIRE_COL).multiplyScalar(0.55 * this.fireLevel));
    }

    // ---- 腐化貼花 ----
    const fadeBurn = 1 - smoothstep(0.3, 0.85, b);
    for (const d of this._decalMats) {
      const [a0, a1] = DECAL_TIERS[d.tier] || DECAL_TIERS[3];
      const op = smoothstep(a0, a1, c) * (DECAL_MAX[d.name] ?? 0.85) * fadeBurn;
      d.m.opacity = op;
    }
    for (const d of this._decalMats) if (d.mesh) d.mesh.visible = d.m.opacity > 0.003;

    // ---- 焦黑：螢幕裂痕、天花板片 ----
    const crackOp = smoothstep(0.2, 0.7, b);
    for (const m of this._cracks) { m.material.opacity = crackOp; m.visible = crackOp > 0.003; }
    for (const tl of this.ceilingTiles || []) {
      const th = tl.thEff ?? tl.th;
      const a = smoothstep(th, Math.min(1, th + 0.3), b) * tl.angle;
      if (tl.axis === 'z') tl.pivot.rotation.z = tl.sign * a; else tl.pivot.rotation.x = -tl.sign * a;
      if (tl.kind === 'missing') {
        const op = 1 - smoothstep(th + 0.12, th + 0.4, b);
        tl.mat.opacity = op; tl.pivot.visible = op > 0.01;
      }
    }

    // ---- 指示燈 ----
    const live = 1 - b;
    this.leds.update(t, { mains: power, ups: 1, upsAlarm: 1 - power }, live, reduce);
    // CAM 頻道指示
    const fd = this.ctx.feeds;
    const ch = fd?.channel;
    // 有未查看的動態偵測：綠（目前頻道）→ 琥珀交叉淡化（alertLevel 已平滑約 0.6 秒），琥珀緩慢呼吸 ≤ 15%
    const camBreath = reduce ? CAM_LED.steady : breathe(t, CAM_LED.period, CAM_LED.depth);
    this.camLeds?.forEach((led, i) => {
      const sel = ch === i + 1 ? 1 : 0;
      const al = clamp(Number(fd?.alertLevel?.(i + 1)) || 0);
      _tmpC.copy(LED_COLORS.green).multiplyScalar(sel * (1 - al));
      _tmpL.copy(LED_COLORS.amber).multiplyScalar(al * camBreath);
      _tmpC.add(_tmpL).multiplyScalar(power * live);
      led.setColor(_tmpC, 0.35 + (CAM_LED.glow - 0.35) * al);
    });
    // 對講機
    let icK = 0, icC = LED_COLORS.amber;
    if (this._intercomMode === 'ringing') icK = 0.12 + 0.88 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 1.2));
    else if (this._intercomMode === 'talking') { icK = 1; icC = LED_COLORS.green; }
    this._intercomCol.lerp(_tmpC.copy(icC).multiplyScalar(icK * live), 1 - Math.exp(-14 * dt));
    this._applyLed(this.parts.intercom.led, this._intercomCol);
    this.intercomRingMat.color.copy(this._intercomCol).multiplyScalar(0.7);
    // 通風：面板上的三顆狀態燈（運轉 綠／異常 琥珀，緩慢脈動／停止 紅；停電時全熄）
    const vTarget = VENT_LED_K;
    vTarget.run = this._ventMode === 'ok' ? 1 : 0;
    vTarget.fault = this._ventMode === 'fault' ? 0.62 + 0.38 * (0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 1.6)) : 0;
    vTarget.stop = this._ventMode === 'off' ? 0.8 : 0;
    const vk = 1 - Math.exp(-10 * dt);
    const vLeds = this.parts.vent.leds;
    for (const key of ['run', 'fault', 'stop']) {
      this._ventLedK[key] += (vTarget[key] * power * live - this._ventLedK[key]) * vk;
      vLeds?.[key]?.set(VENT_LED_COLORS[key], this._ventLedK[key]);
    }
    // 轉速表（0..1 = 0..1800 RPM，與面板上印的錶盤相同）：正常在綠區中段、異常在琥珀區
    let g = this._ventGauge;
    if (g == null) {
      g = this._ventMode === 'ok' ? 0.62 + 0.012 * Math.sin(t * 7.3) + 0.008 * Math.sin(t * 12.7)
        : this._ventMode === 'fault' ? 0.82 + 0.05 * Math.sin((t * Math.PI * 2) / 1.7) + 0.012 * Math.sin(t * 5.1) : 0;
    }
    g *= power;
    this._needle = damp(this._needle, g, 1.6, dt);
    this.parts.vent.needle.rotation.z = 2.356 - this._needle * 4.712;
    // 電磁鎖（市電＋門關著才亮綠）
    this.parts.side.maglockLed.set(LED_COLORS.green, power * (this._sideOpen ? 0 : 1) * live);
    // 手電筒充電燈
    const flOn = this.parts.flashlight?.fl.visible;
    this.parts.flashlight?.led.set(flOn ? LED_COLORS.green : LED_COLORS.amber, (flOn ? 0.9 : 0.0) * live);
    // 防爆門狀態燈
    let bk = 0.85, bc = LED_COLORS.red;
    const bs = this._blastState;
    if (bs === 'opening') { bc = LED_COLORS.amber; bk = reduce ? 0.6 : 0.35 + 0.65 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 1.4)); }
    else if (bs === 'open') { bc = LED_COLORS.amber; bk = 0.5; }
    else if (bs === 'unlocked') { bc = LED_COLORS.green; bk = BLAST_LAMP.unlocked; }
    else if (bs === 'locking' || bs === 'unlocking') { bc = LED_COLORS.amber; bk = reduce ? BLAST_LAMP.steady : BLAST_LAMP.level * breathe(t, BLAST_LAMP.period, BLAST_LAMP.depth); }
    this._blastLampCol.lerp(_tmpC.copy(bc).multiplyScalar(bk * live), 1 - Math.exp(-BLAST_LAMP.lerp * dt));
    this._applyLed(this.parts.blast.lamp, this._blastLampCol, 0.6);
    // 解鎖鈕呼吸紅光（週期 2.4 秒）
    const ug = f.unlock.update(now);
    const breath = 0.3 + 0.7 * (0.5 - 0.5 * Math.cos((t * Math.PI * 2) / 2.4));
    const uk = ug * breath * live;
    this.parts.unlock.ringMat.color.setRGB(1.6 * uk, 0.08 * uk, 0.04 * uk);
    this.parts.unlock.capMat.emissiveIntensity = 0.9 * uk;
    this.parts.unlock.light.intensity = 0.32 * uk;

    // ---- 電子鐘 ----
    const colon = Math.floor(t * 2) % 2 === 0;
    if (colon !== this._colonOn) {
      this._colonOn = colon;
      try { this.ledClock?.setColonVisible(colon); } catch (e) { /* ignore */ }
    }
    // 停電時 LED 鐘靠內建電池維持微弱顯示
    const clockK = live * (0.3 + 0.7 * power);
    this.clockFaceMat.color.setScalar(1.35 * clockK);
    this.clockSpillMat.opacity = 0.2 * clockK * (1 - 0.5 * s);
    // 出口燈（電池）
    this.exitMat.emissiveIntensity = 0.85 * (1 - 0.4 * s);

    // ---- 蒸氣與濃煙 ----
    const mugVisible = this.objects.coffee.visible;
    // 焦黑退去到一半就開始冒蒸氣（終幕回到桌面時看得到「熱咖啡回來了」）
    this.steam.update(dt, t, this._coffeeStage === 0 && mugVisible && b < 0.4 && s < 0.5, 0.6 + 0.4 * this._overallLevel);
    this._updateSmoke(dt, t, s, emerg);

    // ---- 筆（寫字時輕微擺動） ----
    const pen = this.objects.pen;
    if (pen.visible && this._penP >= 0) {
      this._penAct = Math.max(0, this._penAct - dt * 2.5);
      const a = this._penAct;
      pen.position.set(
        this._penBase.x + Math.sin(t * 29) * 0.0011 * a,
        this._penBase.y + Math.abs(Math.sin(t * 17)) * 0.0006 * a,
        this._penBase.z + Math.cos(t * 23) * 0.0008 * a,
      );
      pen.rotation.set(Math.sin(t * 2.1) * 0.015 + Math.sin(t * 19) * 0.02 * a, Math.sin(t * 1.3) * 0.02, Math.sin(t * 25) * 0.025 * a);
    }
  }

  _applyLed(led, col, glowK = 0.35) { led?.setColor(col, glowK); }

  /** 濃煙：依室內光算煙色 → 煙層（表面著色器）＋翻滾的煙團（單一 draw call）。 */
  _updateSmoke(dt, t, s, emerg) {
    const look = this.smokeLook;
    // 室內光（日光燈＋補光）照在煙上的量與顏色
    const light = _tmpL.setRGB(0, 0, 0);
    for (const Lt of this.roomLights) light.r += Lt.color.r * Lt.intensity * SMOKE_K_SPOT, light.g += Lt.color.g * Lt.intensity * SMOKE_K_SPOT, light.b += Lt.color.b * Lt.intensity * SMOKE_K_SPOT;
    const fl = this.fillLight;
    light.r += fl.color.r * fl.intensity * SMOKE_K_FILL; light.g += fl.color.g * fl.intensity * SMOKE_K_FILL; light.b += fl.color.b * fl.intensity * SMOKE_K_FILL;
    light.r += 0.004 * emerg;   // 緊急紅燈罩的殘光
    light.multiplyScalar(look.albedo);
    // 煙（灰黑的煙灰）只帶一部分光源的顏色：往亮度去飽和，成為暖灰
    const sc = this.smokeColor.copy(light);
    const lum = 0.2126 * sc.r + 0.7152 * sc.g + 0.0722 * sc.b;
    sc.lerp(_tmpC.setRGB(lum * 1.12, lum, lum * 0.86), look.desat);
    sc.r = Math.max(sc.r, SMOKE_FLOOR.r); sc.g = Math.max(sc.g, SMOKE_FLOOR.g); sc.b = Math.max(sc.b, SMOKE_FLOOR.b);
    // 整片霧／後期煙霾的顏色：比煙團暗（讓畫面變暗變濁，而不是蒙上一層亮褐色）
    this.hazeColor.copy(sc).multiplyScalar(look.haze);
    const U = this.U;
    const layerY = keyCurve(SMOKE_LAYER_Y, s);
    this.smokeLayerY = layerY;
    U.uLayerY.value = layerY;
    U.uLayerK.value = keyCurve(SMOKE_LAYER_K, s) * look.layerK;
    U.uLayerCol.value.copy(sc).multiplyScalar(look.layerCol);
    if (s < 0.0005 && !this.smoke.visibleCount && this._f.smoke.to <= 0) { if (this.smoke.mesh.visible) this.smoke.reset(); return; }
    const P = this.parts.blast;
    const doorOpen = P ? clamp(P.door.position.z / Math.max(0.01, this.L.blastDoor.slide)) : 0;
    const fog = this.ctx.scene.fog;
    this.smoke.update(dt, t, {
      level: s,
      flowing: this._f.smoke.to > 0.02,
      doorOpen,
      layerY,
      // 煙團：上側灰（日光燈）、下側帶一點火光的暖橘（焦黑牆面的餘燼與終幕燈光從下方照上來）
      litTop: this._smokeTop.copy(sc).multiplyScalar(look.top),
      litLow: this._smokeLow.copy(sc).lerp(light, look.warm).multiplyScalar(look.low),
      fogColor: fog?.color || sc,
      fogDensity: fog?.density || 0,
      outK: 0.18 + 0.8 * this.fireLevel,
      camera: this.ctx.camera,
    });
  }
}

const _tmpC = new THREE.Color();
const _tmpL = new THREE.Color();
const VENT_LED_K = { run: 0, fault: 0, stop: 0 };
const VENT_LED_COLORS = { run: LED_COLORS.green, fault: LED_COLORS.amber, stop: LED_COLORS.red };
