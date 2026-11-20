// =============================================================================
// Corridor — 地下公務維修廊道＋防火門外主車道＋電閘室（第二幕）
// 【API 骨架 / CONTRACT STUB】實作者必須保留 objects 的所有鍵與所有公開方法。
// 位置一律取自 ctx.LAYOUT.CORRIDOR / SWITCH_ROOM / ROADWAY。
//
// 氛圍要求：狹長、低矮、濃霧（場景 FogExp2 由狀態設定，約 0.10–0.14）、潮濕混凝土、管線、排水溝、
//   失效的緊急出口燈、牆面區段編號（例如「B2-07」）。停電時廊道沒有任何燈；只能靠手電筒。
// 防火門幻影（triggerHeadlights）：
//   主車道上一道車燈緩慢掃過（SpotLight 由車道低角度射向防火門玻璃），
//   透過玻璃把玩家的影子（剪影投影體，見 corridor/silhouette.js）拉長投射在廊道南牆上。
//   亮度變化必須是 0.6 秒以上的漸強與 1 秒以上的漸弱（「一閃而過」但不是頻閃），
//   同時播放 audio.sfx('carPass')。結束後主車道上只有緩慢飄落的灰燼。
//   【修正後的編排】玩家向東走、在防火門前約 1.6 m 觸發：一輛看不見的車在煙裡倒車緩行（往西，車頭朝東），
//   車燈穿過玻璃，在玩家右前方的南牆上投出一塊柔邊的窗形光斑，光斑順著玩家行進方向往東滑；
//   依觸發時的位置與速度預測，玩家走過門後約 1.3 m 時恰好站進光束裡 → 自己被拉長的頭肩剪影落在光斑中，
//   持續約 1 秒，之後光斑淡出。左右邊緣很柔：牆上任一點由 10% 到 90% 亮度 ≥ 0.5 秒。
//   事件期間手電筒暫時調暗（player.setFlashlightDim，若存在），淡出時再慢慢回來，整體畫面亮度幾乎不變。
// 實作摘要：
//   * 靜態幾何依「材質 × 8 m 區段」合併（corridor/structure.js、switchRoom.js、roadway.js），
//     貼圖 UV 以世界座標公尺為單位，由材質 repeat 決定尺度（對齊 TextureFactory 的尺度說明）。
//   * 燈光：廊道＋電閘室共 5 盞 PointLight（有距離截止，不會漏進主控室），其餘靠燈罩自發光。
//     車燈 2 盞 SpotLight 常駐場景（燈數固定，不必重新編譯）；近側那盞 castShadow＋光斑遮罩（map），
//     shadow.autoUpdate 只在事件期間開啟，平時不渲染陰影貼圖。這盞燈的陰影貼圖只收廊道牆體、管線與
//     玩家剪影（門扇、封板等不擋它：光斑形狀由遮罩決定，邊緣才能夠柔）。
//   * 線索物件（watch/logbook/coat）在標準朝向下建模、置中，世界擺放由外層 mount 負責。
// =============================================================================
import * as THREE from 'three';
import { corridorDims, buildStructure } from './corridor/structure.js';
import { buildWatch, buildLogbook, buildLoosePage, buildCoat } from './corridor/items.js';
import { buildSwitchRoom, LEVER_OFF, LEVER_ON } from './corridor/switchRoom.js';
import { roadwayDims, buildRoadway, buildWindowFx } from './corridor/roadway.js';
import { particleMaterial } from './corridor/fx.js';
import * as TX from './corridor/tex.js';
import { buildSilhouette, filterShadowPass } from './corridor/silhouette.js';

const PI = Math.PI;
const HL_Y = 0.75;                 // 車燈離地高度（主車道路面 y = 0）
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const bell = (k, c, w) => Math.exp(-((k - c) * (k - c)) / (2 * w * w));
const dampTo = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
// ∫₀ᵗ smoothstep(a, b, s) ds（解析式）
const smoothInt = (a, b, t) => { if (t <= a) return 0; const w = b - a; if (t >= b) return w / 2 + (t - b); const x = (t - a) / w; return w * (x * x * x - x * x * x * x / 2); };
/** 車燈事件中車子已行駛的「等效秒數」：速度曲線 = smoothstep(a0,a1) − bk·smoothstep(b0,b1)（先加速、後略減速）。 */
const carTravel = (p, t) => smoothInt(p.a0, p.a1, t) - p.bk * smoothInt(p.b0, p.b1, t);

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3(), _c3 = new THREE.Vector3(), _c4 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** 可調參數（整合時微調用）。 */
export const CORRIDOR_TUNING = {
  fixtureEmissive: 1.7,       // 廊道燈罩自發光強度
  switchEmissive: 2.3,        // 電閘室燈罩自發光強度
  pointBase: [9, 9, 8, 6, 10],// 5 盞 PointLight 的燭光
  headlightPeak: 760,         // 近側車燈（穿窗、投影）峰值燭光（以「車燈 → 牆上光斑」12 m 為準，依距離正規化）
  headlightRoad: 420,         // 另一盞車燈（只作用在灰燼粒子與反光標記上，不是真實光源）
  headlightRise: 1.7,         // 漸強（秒）；光敏感模式 ×1.3
  headlightHold: 0.4,         // 玩家站進光束後再持續多久才開始漸弱（秒）
  headlightFall: 2.0,         // 漸弱（秒）
  headlightSpeed: [2.0, 3.4], // 車速範圍（m/s）：在煙裡緩行。光斑在牆上的滑速 ≈ 0.3 × 車速，與玩家同向
  headlightRiseTime: 0.9,     // 設計值：牆上任一點由 10% 到 90% 亮度的時間（秒）→ 決定光斑左右邊緣的柔度（實測 ≥ 0.5）
  headlightSoftMin: 0.5,      // 左右邊緣過渡寬度（m）下限
  headlightSoftV: 0.07,       // 上下邊緣的過渡寬度（m）：光斑幾乎只水平滑動，上下可以利落一點（更像窗框）
  headlightLaneZ: -4.4,       // 近側車燈所在的 z（車道上）
  headlightAlignX: 21.3,      // 預測玩家在這個 x 時站進光束（防火門 x = 20）
  flashlightDim: 0.3,         // 事件期間手電筒亮度倍率（需要 player.setFlashlightDim）
};

export class Corridor {
  constructor(ctx) {
    this.ctx = ctx;
    const tBuild = performance.now();
    const C = ctx.LAYOUT.CORRIDOR;
    this.group = new THREE.Group();
    this.group.name = 'corridor';
    ctx.scene.add(this.group);

    this.dims = corridorDims(ctx.LAYOUT);
    this.mats = this._makeMaterials();
    this.world = new THREE.Group(); this.world.name = 'corridor:world';
    this.lightRig = new THREE.Group(); this.lightRig.name = 'corridor:lights';
    this.group.add(this.world, this.lightRig);

    // ---- 結構與道具 ---------------------------------------------------------
    // 依區域分組：電閘室道具與主車道只有在附近時才繪製（Raycaster 不受 visible 影響，互動照常）
    this.swGroup = new THREE.Group(); this.swGroup.name = 'corridor:switchRoom';
    this.roadGroup = new THREE.Group(); this.roadGroup.name = 'corridor:roadway';
    this.world.add(this.swGroup, this.roadGroup);
    this.struct = buildStructure(ctx, this.world, this.mats, this.dims);
    this.sw = buildSwitchRoom(ctx, this.swGroup, this.mats, this.dims);
    this.rdDims = roadwayDims(ctx.LAYOUT);
    this.road = buildRoadway(ctx, this.roadGroup, this.mats, this.rdDims);
    for (const l of this.road.hl) { this.lightRig.add(l); this.lightRig.add(l.target); }
    this.windowFx = buildWindowFx(this.world, this.struct.glass);
    // 車燈事件的玩家剪影（只投影在 hl[0] 的陰影貼圖中）
    this.silhouette = buildSilhouette(ctx.LAYOUT.EYE.standing);
    this.world.add(this.silhouette);

    // ---- 線索物件 -----------------------------------------------------------
    const watch = buildWatch(ctx);
    const wsize = new THREE.Box3().setFromObject(watch).getSize(new THREE.Vector3());
    this.watchMount = new THREE.Group(); this.watchMount.name = 'watchMount';
    this.watchMount.position.set(C.watch.x, -0.004 + wsize.z / 2 + 0.0005, C.watch.z);
    this.watchMount.rotation.set(-PI / 2 + 0.04, 0, 0.55);          // 平躺在格柵上，錶鍊斜向排水溝
    this.watchMount.add(watch); this.world.add(this.watchMount);
    // 錶面的反光點（獨立精靈，不在 watch 群組內）
    this.glint = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ctx.textures.get('glint'), color: 0xfff6e8, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true,
    }));
    this.glint.scale.set(0.07, 0.07, 1); this.glint.renderOrder = 5;
    this.glint.position.set(C.watch.x - 0.004, wsize.z + 0.008, C.watch.z - 0.004);
    this.world.add(this.glint);
    this._glint = { target: 1, level: 1 };

    const logbook = buildLogbook(ctx);
    const lsize = new THREE.Box3().setFromObject(logbook).getSize(new THREE.Vector3());
    this.logbookMount = new THREE.Group(); this.logbookMount.name = 'logbookMount';
    this.logbookMount.position.set(C.logbook.x, lsize.z / 2 + 0.002, C.logbook.z);
    this.logbookMount.rotation.set(-PI / 2, 0, 0.42);
    this.logbookMount.add(logbook); this.world.add(this.logbookMount);
    for (const [x, z, ry, s] of [[C.logbook.x - 0.32, C.logbook.z - 0.42, 0.7, 1], [C.logbook.x + 0.38, C.logbook.z + 0.58, -0.5, 2], [C.logbook.x + 0.12, C.logbook.z + 1.25, 2.1, 3]]) {
      const p = buildLoosePage(ctx, s); p.position.set(x, 0.004, z); p.rotation.y = ry; this.world.add(p);
    }
    {
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshStandardMaterial({
        map: TX.scorchTexture(7), transparent: true, depthWrite: false, roughness: 0.95,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      }));
      sc.rotation.x = -PI / 2; sc.position.set(C.logbook.x + 0.05, 0.003, C.logbook.z + 0.05); sc.receiveShadow = true;
      this.world.add(sc);
    }

    const coat = buildCoat(ctx);
    this.coatFabric = coat.fabricMat;
    const csize = new THREE.Box3().setFromObject(coat.group).getSize(new THREE.Vector3());
    const hook = this.sw.coatHook;
    this.coatPivot = new THREE.Group(); this.coatPivot.name = 'coatPivot';
    this.coatPivot.position.copy(hook);
    this.coatMount = new THREE.Group(); this.coatMount.name = 'coatMount';
    this.coatMount.position.set(-0.07, -csize.y / 2 + 0.03, 0);    // 掛環在鉤子上，外套背面貼近鐵架
    this.coatMount.rotation.y = -PI / 2;                           // 正面朝西（-X）
    this.coatMount.add(coat.group); this.coatPivot.add(this.coatMount); this.swGroup.add(this.coatPivot);
    this._sway = { amp: 0, phase: 0 };

    /** 可互動物件（States 會對它們註冊互動） */
    this.objects = {
      fireDoorGlass: this.struct.glass,      // 防火門強化玻璃（Mesh）
      watch,                                 // 碎裂機械錶（Group，標準朝向：錶面 +Z、12 點 +Y）
      logbook,                               // 燒焦巡檢日誌（Group，封面 +Z）
      coat: coat.group,                      // 黃色雨衣／消防外套（Group，正面 +Z）
      breaker: this.sw.breaker,              // 總開關面板（Group）
      breakerLever: this.sw.lever,           // 總開關拉桿（Group，rotation.x：LEVER_OFF 0.5 = 下（跳脫），LEVER_ON -0.5 = 上（復歸））
    };

    // ---- 浮塵（手電筒光柱裡才看得到） ---------------------------------------
    {
      const N = 320, pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
      const bs = new THREE.Vector3(5, 2.6, 5);
      let s = 9;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let i = 0; i < N; i++) {
        pos[i * 3] = rnd() * bs.x; pos[i * 3 + 1] = rnd() * bs.y; pos[i * 3 + 2] = rnd() * bs.z;
        seed[i * 4] = rnd(); seed[i * 4 + 1] = 0.01 + rnd() * 0.025; seed[i * 4 + 2] = 0.5 + rnd(); seed[i * 4 + 3] = 0;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      const m = particleMaterial({ follow: true, size: 0.009, ambient: 0x000000, fall: 1, opacity: 0.55 });
      m.uniforms.uBoxSize.value.copy(bs);
      m.uniforms.uBoxMin.value.set(-100, -100, -100);
      this.dust = new THREE.Points(g, m); this.dust.frustumCulled = false; this.dust.name = 'dustMotes'; this.dust.renderOrder = 1;
      this.world.add(this.dust);
    }

    // ---- 天花板滲水滴落（落進積水，泛起一圈細小漣漪；只有被照到才看得見） ----------
    {
      const H = this.dims.H;
      const dropGeo = new THREE.SphereGeometry(0.0055, 8, 6); dropGeo.scale(1, 1.7, 1);
      const dropMat = new THREE.MeshStandardMaterial({ color: 0xcfdce2, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.85 });
      const rippleGeo = new THREE.RingGeometry(0.82, 1.0, 36); rippleGeo.rotateX(-PI / 2);
      this.drips = [[9.75, 1.98, 4.3, 0.2], [25.6, 1.9, 5.7, 2.1], [39.0, 5.85, 3.6, 1.3]].map(([x, z, period, phase]) => {
        const drop = new THREE.Mesh(dropGeo, dropMat); drop.position.set(x, H - 0.012, z); drop.visible = false;
        const rm = new THREE.MeshStandardMaterial({ color: 0xd6e2e6, roughness: 0.08, transparent: true, opacity: 0, depthWrite: false });
        const ripple = new THREE.Mesh(rippleGeo, rm); ripple.position.set(x, 0.005, z); ripple.visible = false;
        this.world.add(drop, ripple);
        return { drop, ripple, rm, period, t: phase, H };
      });
    }

    // ---- 燈光 ---------------------------------------------------------------
    this.fixtures = this.struct.fixtures;
    const xs = this.fixtures.map((f) => f.x);
    for (const f of this.fixtures) {
      f.delay = f.zone === 'switch' ? 0 : f.zone === 'leg' ? 0.3 : 0.5 + (xs[xs.length - 1] - f.x) * 0.034;
      f.base = (f.zone === 'switch' ? CORRIDOR_TUNING.switchEmissive : CORRIDOR_TUNING.fixtureEmissive) * (0.86 + ((f.x * 7.31) % 1) * 0.28);
      f.level = 0;
      f.unstable = f.zone === 'main' && Math.abs(f.x - 24) < 0.1;
    }
    const fx = (x, z) => this.fixtures.find((f) => Math.abs(f.x - x) < 0.1 && (z == null || Math.abs(f.z - z) < 0.1));
    const pointDefs = [
      { pos: [12, 2.12, 2.25], dist: 7.5, drivers: [fx(12, 2.0)] },
      { pos: [24, 2.12, 2.25], dist: 7.5, drivers: [fx(24, 2.0)] },
      { pos: [36, 2.12, 2.25], dist: 6.5, drivers: [fx(36, 2.0)] },
      { pos: [39.2, 2.12, 5.5], dist: 5.0, drivers: [fx(39.2, 5.5)] },
      { pos: [39.2, 1.95, 10.6], dist: 9.0, drivers: this.fixtures.filter((f) => f.zone === 'switch') },
    ];
    this.points = pointDefs.map((p, i) => {
      const l = new THREE.PointLight(0xdfe9ff, 0, p.dist, 2);
      l.position.set(...p.pos); l.castShadow = false; l.name = `corridorLight${i}`;
      this.lightRig.add(l);
      return { light: l, base: CORRIDOR_TUNING.pointBase[i], drivers: p.drivers.filter(Boolean) };
    });
    this._power = { on: false, t0: -1e9, ramp: 0, from: null };
    this._powerLevel = 0;

    // ---- 狀態 ---------------------------------------------------------------
    this._hl = { run: 0, active: false, env: 0, dimmed: false, plan: null };
    this._ash = { target: 1, level: 1 };
    this._leds = { trip: 1, power: 0, tripT: 1, powerT: 0 };
    this._breakerOn = false;
    this._flash = 0;
    this._bufSize = new THREE.Vector2();
    this._applyLeds();
    for (const g of this.sw.gauges) g.pivot.rotation.z = this._needleAngle(0);
    if (ctx.debug) console.info(`[corridor] built in ${Math.round(performance.now() - tBuild)} ms`);
  }

  init() {
    // 車燈 hl[0] 的陰影貼圖：只收管線與玩家剪影。北牆、門扇、門框、封板、道具等都不擋它——
    // 光斑形狀與柔邊完全由光斑遮罩決定（若讓北牆的門洞參與，光斑的邊緣會被門框切出硬邊）。
    // PlayerController 的膠囊也不擋它（改用更像人的剪影）。其他光源的陰影完全不受影響。
    const hlCam = () => this.road.hl[0].shadow.camera;
    const castsHL = (o) => o === this.silhouette || /^pipe:/.test(o.name || '');
    this.group.traverse((o) => { if (o.isMesh && o.castShadow && !castsHL(o)) filterShadowPass(o, hlCam, 'skip'); });
    filterShadowPass(this.silhouette, hlCam, 'only');
    const proxy = this.ctx.player?.shadowProxy;
    if (proxy && proxy.isMesh) filterShadowPass(proxy, hlCam, 'skip');
  }

  // ===========================================================================
  // 材質
  // ===========================================================================
  _makeMaterials() {
    const T = this.ctx.textures;
    const S = THREE.MeshStandardMaterial;
    const rot90 = (m) => { for (const k of ['map', 'bumpMap', 'roughnessMap', 'normalMap']) if (m[k]) { m[k].center.set(0.5, 0.5); m[k].rotation = PI / 2; } return m; };
    const M = {};
    M.wall = T.material('corridorWall', { repeat: [1 / 1.25, 1 / 2.5] });
    M.wallSR = T.material('corridorWall', { repeat: [1 / 1.25, 1 / 2.6] });
    M.floor = rot90(T.material('corridorFloor', { repeat: [1 / 1.2, 1 / 1.2] }));
    M.srFloor = T.material('concrete', { repeat: [1 / 1.2, 1 / 1.2], color: 0x9aa596 });
    M.ceil = T.material('concreteDark', { repeat: [1 / 1.2, 1 / 1.2] });
    M.ditch = T.material('concreteDark', { repeat: [1 / 1.2, 1 / 1.2], color: 0x777773 });
    M.wetEnv = TX.wetEnvCube();
    M.water = new S({ color: 0x05070a, roughness: 0.04, metalness: 0.2, envMap: M.wetEnv, envMapIntensity: 0 });
    M.grate = T.material('grate', { repeat: [1 / 0.25, 1 / 0.3], alphaTest: 0.5, side: THREE.DoubleSide });
    M.pipe = T.material('pipe', { vertexColors: true, roughness: 0.55, metalness: 0.2 });
    M.metalDark = T.material('paintedMetal', { color: 0x6a6e6a, roughness: 0.7, metalness: 0.35 });
    M.frame = T.material('paintedMetal', { color: 0x8f938c, roughness: 0.6, metalness: 0.3 });
    M.door = T.material('paintedMetal', { color: 0xaaac9f, roughness: 0.62, metalness: 0.25 });
    M.cabinet = T.material('paintedMetal', { color: 0xbcc1b8, roughness: 0.6, metalness: 0.25 });
    M.tray = new S({ color: 0x8e9496, roughness: 0.48, metalness: 0.6 });
    M.rack = new S({ color: 0x3e4a57, roughness: 0.6, metalness: 0.4 });
    M.shelf = new S({ color: 0x7d8486, roughness: 0.55, metalness: 0.5 });
    M.steel = new S({ color: 0xa5aaab, roughness: 0.35, metalness: 0.8 });
    M.black = new S({ color: 0x141414, roughness: 0.75 });
    M.needle = new S({ color: 0x1a1210, roughness: 0.5 });
    M.cable = new S({ color: 0x1b1c1c, roughness: 0.6 });
    M.fixture = new S({ color: 0xc7c5bd, roughness: 0.55, metalness: 0.3 });
    M.tubeGlass = new S({ color: 0xd9dad4, roughness: 0.3 });
    M.red = new S({ color: 0x7c1a12, roughness: 0.62, metalness: 0.2, map: TX.grimeTexture(), bumpMap: null });
    M.redDark = new S({ color: 0x3c0d09, roughness: 0.75 });
    M.hose = new S({ color: 0xcfc6ae, roughness: 0.85 });
    M.lampRed = new S({ color: 0x5a0d08, roughness: 0.25 });
    M.lampGreen = new S({ color: 0x0b3a14, roughness: 0.25 });
    M.lampGreenLit = new S({ color: 0x0b3a14, roughness: 0.25, emissive: 0x3cdc64, emissiveIntensity: 0 });
    M.cabinetGlass = new S({ color: 0xdde8e2, transparent: true, opacity: 0.14, roughness: 0.05, depthWrite: false });
    M.cone = new S({ color: 0xc2501d, roughness: 0.6 });
    M.reflectWhite = new S({ color: 0xe6e6de, roughness: 0.35 });
    M.gripRed = new S({ color: 0xa3150f, roughness: 0.45 });
    M.boot = new S({ color: 0x1f1f1d, roughness: 0.55 });
    M.bootSole = new S({ color: 0x3a2a1e, roughness: 0.9 });
    M.rope = new S({ color: 0x9b8a5a, roughness: 0.95 });
    M.tarp = new S({ color: 0x324a6a, roughness: 0.9 });
    // 主車道
    M.asphalt = T.material('asphalt', { repeat: [1 / 1.6, 1 / 1.6] });
    M.roadLines = T.material('roadLines', { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    M.walk = T.material('concrete', { repeat: [1 / 1.2, 1 / 1.2], color: 0x85857f });
    M.curbPaint = new S({ color: 0xa8a28c, roughness: 0.8 });
    M.tiles = T.material('tunnelTiles');
    M.arch = T.material('concreteDark', { color: 0x5c5a57 });
    M.lampHousing = new S({ color: 0x55585a, roughness: 0.6, metalness: 0.5 });
    M.lampDead = new S({ color: 0x8a8578, roughness: 0.3 });
    M.fan = new S({ color: 0x6f7476, roughness: 0.55, metalness: 0.5 });
    M.fanDark = new S({ color: 0x2b2d2e, roughness: 0.7, metalness: 0.4 });
    for (const [k, m] of Object.entries(M)) if (m && m.isMaterial && !m.name) m.name = k;
    // 合併用的共用材質：同類材質只差顏色時，合併成一個 vertexColors 材質（大幅減少 draw call）
    M.painted = T.material('paintedMetal', { vertexColors: true, roughness: 0.62, metalness: 0.28 }); M.painted.name = 'painted';
    M.plain = new S({ vertexColors: true, roughness: 0.62, metalness: 0.1 }); M.plain.name = 'plain';
    M.metal = new S({ vertexColors: true, roughness: 0.4, metalness: 0.7 }); M.metal.name = 'metal';
    for (const k of ['metalDark', 'frame', 'door', 'cabinet']) M[k].userData.tintOf = M.painted;
    for (const k of ['black', 'cone', 'reflectWhite', 'boot', 'bootSole', 'rope', 'tarp', 'hose', 'redDark', 'fixture', 'tubeGlass',
      'curbPaint', 'lampHousing', 'lampDead', 'fanDark', 'cable', 'rack', 'lampRed']) M[k].userData.tintOf = M.plain;
    for (const k of ['steel', 'tray', 'shelf', 'fan']) M[k].userData.tintOf = M.metal;
    return M;
  }

  // ===========================================================================
  // 公開 API
  // ===========================================================================
  /** @returns {{minX,maxX,minZ,maxZ}[]} 廊道內的障礙物（管線支架、鐵架、配電箱等） */
  getObstacles() {
    return [...this.struct.obstacles, ...this.sw.obstacles].map((o) => ({ ...o }));
  }

  /** 廊道/電閘室照明。停電：全暗（可保留極微弱的綠色緊急出口牌，或連那個也壞了）。復電：昏暗、不穩但不頻閃的日光燈。 */
  setPower(on, { duration = 2 } = {}) {
    on = !!on;
    const now = this.ctx.clock.time;
    const instant = !(duration > 0.05);
    this._power = {
      on, t0: now,
      ramp: instant ? 0 : on ? Math.max(2.2, duration) : Math.max(0.45, duration),
      from: this.fixtures.map((f) => f.level),
    };
    if (on) { this._breakerOn = true; this._leds.tripT = 0; this._leds.powerT = 1; }
    else {
      // 停電＝中段繼電器跳脫：總開關回到跳脫位置、跳脫燈亮
      this._breakerOn = false; this._leds.tripT = 1; this._leds.powerT = 0;
      this.objects.breakerLever.rotation.x = LEVER_OFF;
    }
    if (instant) { this._updatePower(now, 0); this._applyLeds(true); }
  }

  /** 防火門外的車燈幻影（見檔頭）。只會在每次呼叫時播放一次。@returns {Promise<void>} */
  triggerHeadlights() {
    const ctx = this.ctx, C = ctx.LAYOUT.CORRIDOR, fd = C.fireDoor, TU = CORRIDOR_TUNING;
    const run = ++this._hl.run;
    const reduce = !!ctx.settings?.get?.('reduceFlicker');
    const slow = reduce ? 1.3 : 1;                         // 光敏感模式：更慢、更暗
    const rise = TU.headlightRise * slow, fall = TU.headlightFall * slow;
    const zg = this.struct.glass.position.z;              // 玻璃平面
    const zl = TU.headlightLaneZ, zr = zl - 1.45;         // 兩盞車燈（左右燈相距 1.45 m）
    const dzCW = zg - zl;
    // ---- 依玩家觸發時的位置與速度，預測「站進光束」的時刻 tA，反推車子位置 ----
    // 車子往西（倒車）緩行，光斑在南牆上往東滑（與玩家同向），玩家的影子在光斑裡停留得最久。
    const P = ctx.player, p = P?.position, vel = P?.velocity;
    const px = p?.x ?? fd.x - 1.5;
    const pz = clamp(p?.z ?? 2.0, C.main.minZ + 0.25, C.main.maxZ - 0.25);
    const vx = clamp(vel?.x ?? 0, -2.5, 2.5), vz = clamp(vel?.z ?? 0, -2, 2);
    let tA = rise + 0.3;
    if (vx > 0.35) tA = clamp((TU.headlightAlignX - px) / vx, rise - 0.2, rise + 1.0);
    const xpA = px + Math.max(0, vx) * tA;
    const pzA = clamp(pz + vz * Math.min(tA, 1) * 0.5, C.main.minZ + 0.3, C.main.maxZ - 0.3);
    // 光線與窗戶法線的水平夾角：預測位置在門的東側 → 對準玩家；否則用 50°（光斑落在玩家前方的南牆上）
    let tanT = xpA > fd.x + 0.3 ? (xpA - fd.x) / Math.max(0.3, pzA - zg) : Math.tan(50 * PI / 180);
    tanT = clamp(tanT, 0.35, 2.4);
    const xcA = fd.x - tanT * dzCW;                        // tA 時車燈的 x
    const xcMax = fd.x - 0.6;                              // 起點一定在窗戶西側（車頭朝東，車燈才照得進來）
    // 車速曲線：光斑先在原地慢慢亮起，亮到一半車子才開始緩緩移動；漸弱時車子也慢下來。
    // （牆上的點因此不會同時遇到「亮度包絡上升」與「光斑邊緣掃過」兩種變化而亮得太快）
    const tF = Math.max(rise, tA) + TU.headlightHold;     // 漸弱開始
    const D = tF + fall;
    // 漸弱時車子只略為減速：光斑仍跟著玩家往前滑，在視野裡淡出（而不是被玩家甩到畫面外）
    const prof = { a0: 0.45 * rise, a1: rise + 0.35, b0: tF, b1: tF + fall, bk: 0.35 };
    const GA = carTravel(prof, tA);
    const [vMin, vMax] = TU.headlightSpeed;
    const v = clamp((xcMax - xcA) / Math.max(0.05, GA), vMin, vMax) / Math.sqrt(slow);
    const xc0 = Math.min(xcMax, xcA + v * GA);
    // 光斑在牆上的滑速 → 左右柔邊寬度（牆上任一點 10→90% 的時間 = headlightRiseTime）
    const u = v * (C.main.maxZ - zg) / dzCW;
    const soft = Math.max(TU.headlightSoftMin, u * TU.headlightRiseTime * slow);
    const plan = {
      run, D, rise, fall, tF, v, xc0, zl, zr, zg, tA, reduce, prof,
      I: TU.headlightPeak * (reduce ? 0.62 : 1),
      soft, softV: TU.headlightSoftV,
      restored: false,
    };
    this._hl.plan = plan; this._hl.active = true;
    const hl0 = this.road.hl[0];
    hl0.shadow.autoUpdate = true;
    this.silhouette.visible = true;
    this._syncSilhouette();
    // 手電筒暫時調暗（PlayerController.setFlashlightDim；不存在就略過），讓光斑讀得出來
    try { if (ctx.player?.setFlashlightDim) { ctx.player.setFlashlightDim(TU.flashlightDim, rise * 0.85); this._hl.dimmed = true; } } catch (e) { console.warn('[corridor] setFlashlightDim failed', e); }
    try { ctx.audio?.sfx?.('carPass', { position: new THREE.Vector3(fd.x, fd.glass.y, fd.z) }); } catch (e) { console.warn('[corridor] carPass sfx failed', e); }
    if (ctx.debug) console.info('[corridor] headlights', JSON.stringify({ px: +px.toFixed(2), pz: +pz.toFixed(2), vx: +vx.toFixed(2), tA: +tA.toFixed(2), xpA: +xpA.toFixed(2), xcA: +xcA.toFixed(2), xc0: +xc0.toFixed(2), v: +v.toFixed(2), soft: +soft.toFixed(2), D: +D.toFixed(2) }));
    return ctx.clock.tween(D, (e, k) => { if (this._hl.run === run) this._hlFrame(k * D, plan); }, 'linear')
      .then(() => { if (this._hl.run === run) this._hlEnd(); });
  }

  /** 主車道上的灰燼粒子。 */
  setAsh(on) { this._ash.target = on ? 1 : 0; if (on) this.road.ash.visible = true; }

  /** 總開關拉桿推上的動畫（含 audio 'breaker'）。@returns {Promise<void>} */
  pullBreaker() {
    const ctx = this.ctx, lever = this.objects.breakerLever;
    const a0 = lever.rotation.x, a1 = LEVER_ON;
    let latched = false;
    const pos = lever.getWorldPosition(new THREE.Vector3());
    return ctx.clock.tween(1.15, (e, k) => {
      // 一開始很沉（慢）、過了死點猛然扣上、稍微回彈
      let f;
      if (k < 0.78) { const x = k / 0.78; f = 1.035 * Math.pow(x, 2.1); }
      else { const x = (k - 0.78) / 0.22; f = 1 + 0.035 * (1 - x) * (1 - x); }
      lever.rotation.x = a0 + (a1 - a0) * f;
      if (!latched && k >= 0.76) {
        latched = true;
        try { ctx.audio?.sfx?.('breaker', { position: pos }); } catch (err) { console.warn('[corridor] breaker sfx failed', err); }
        this._breakerOn = true; this._leds.tripT = 0; this._leds.powerT = 1;
      }
    }, 'linear').then(() => { lever.rotation.x = a1; });
  }

  /** 物件被拿起/檢視後的狀態（例如錶的反光點消失）。key: 'watch' | 'logbook' | 'coat' */
  markInspected(key) {
    if (key === 'watch') this._glint.target = 0;
    else if (key === 'coat') { this._sway.amp = 0.045; this._sway.phase = 0; }
  }

  reset() {
    this._hl.run++; this._hlEnd();
    this.setPower(false, { duration: 0 });
    this.objects.breakerLever.rotation.x = LEVER_OFF;
    this._breakerOn = false;
    this._leds.tripT = 1; this._leds.powerT = 0; this._applyLeds(true);
    for (const g of this.sw.gauges) { g.value = 0; g.pivot.rotation.z = this._needleAngle(0); }
    this._glint.target = 1; this._glint.level = 1;
    this._ash.target = 1; this._ash.level = 1; this.road.ash.visible = true;
    this._sway.amp = 0; this.coatPivot.rotation.set(0, 0, 0);
  }

  // ===========================================================================
  // 每幀
  // ===========================================================================
  update(dt, t) {
    const ctx = this.ctx, cam = ctx.camera;
    const reduce = !!ctx.settings?.get?.('reduceFlicker');
    this._updatePower(ctx.clock.time, dt, reduce);

    // 手電筒（以相機位置/方向近似，PlayerController 的光源掛在相機上）
    const fl = ctx.player?.flashlight;
    const flOn = !!(fl && fl.visible !== false && fl.intensity > 0.001);
    this._flash = dampTo(this._flash, flOn ? 1 : 0, 10, dt);
    const camPos = cam.getWorldPosition(_v1);
    const camDir = cam.getWorldDirection(_v2);
    const flCos = Math.cos(Math.min(1.2, (fl?.angle ?? 0.42) * 0.9));
    const inCorridor = smooth(4.1, 4.7, camPos.x);
    // 區域可見性（純繪製最佳化）
    this.swGroup.visible = camPos.x > 33.5;
    // 主車道只從防火門玻璃看得到：只有相機在廊道裡（x 5.5–34.5）才繪製（主控室裡完全不畫）
    this.roadGroup.visible = (camPos.x > 5.5 && camPos.x < 34.5) || (camPos.z < ctx.LAYOUT.CORRIDOR.main.minZ && camPos.x > ctx.LAYOUT.CORRIDOR.main.minX);

    // 粒子共用 uniform
    ctx.renderer.getDrawingBufferSize(this._bufSize);
    const scale = this._bufSize.y * 0.5;
    this._ash.level = dampTo(this._ash.level, this._ash.target, 1.5, dt);
    if (this._ash.level < 0.002 && this._ash.target === 0) this.road.ash.visible = false;
    for (const [pts, flashMul] of [[this.road.ash, 1], [this.dust, inCorridor]]) {
      const u = pts.material.uniforms;
      u.uTime.value += dt; u.uScale.value = scale;
      u.uCamPos.value.copy(camPos); u.uCamDir.value.copy(camDir);
      u.uFlash.value = this._flash * flashMul; u.uFlashCos.value = flCos;
    }
    this.road.ash.material.uniforms.uOpacity.value = this._ash.level;
    this.dust.visible = inCorridor > 0.01;

    // 錶的反光：手電筒照到時才緩慢地亮起、呼吸
    {
      const w = this.glint.position;
      _v3.copy(w).sub(camPos); const dist = _v3.length(); _v3.divideScalar(Math.max(1e-4, dist));
      const inBeam = smooth(flCos - 0.02, flCos + 0.12, _v3.dot(camDir));
      const near = smooth(7, 2.0, dist);
      this._glint.level = dampTo(this._glint.level, this._glint.target, 1.2, dt);
      const pulse = 0.62 + 0.38 * Math.sin(t * (2 * PI / 2.6));          // 週期 2.6 秒的緩慢起伏
      this.glint.material.opacity = this._glint.level * this._flash * inBeam * near * (reduce ? 0.8 : pulse) * 0.95;
      this.glint.visible = this.glint.material.opacity > 0.002;
    }

    // 外套反光條（回歸反射：手電筒照到時亮起）
    {
      const cp = this.coatPivot.getWorldPosition(_v3);
      cp.y -= 0.4;
      const d = cp.sub(camPos); const dist = d.length(); d.divideScalar(Math.max(1e-4, dist));
      const lit = smooth(flCos - 0.05, flCos + 0.1, d.dot(camDir)) * this._flash * smooth(9, 1.5, dist);
      this.coatFabric.emissiveIntensity = dampTo(this.coatFabric.emissiveIntensity, lit * 0.55, 6, dt);
      if (this._sway.amp > 0.0005) {
        this._sway.phase += dt;
        const a = this._sway.amp * Math.exp(-this._sway.phase / 4.5) * Math.sin(this._sway.phase * 2 * PI / 2.3);
        this.coatPivot.rotation.x = a;
        if (this._sway.phase > 14) { this._sway.amp = 0; this.coatPivot.rotation.x = 0; }
      }
    }

    // 滴水
    for (const d of this.drips) {
      d.t += dt;
      const near = Math.abs(d.drop.position.x - camPos.x) < 14 && inCorridor > 0;
      if (!near) { d.drop.visible = false; d.ripple.visible = false; continue; }
      const cyc = d.t % d.period, hang = 0.9, fall = Math.sqrt((2 * (d.H - 0.02)) / 9.8);
      if (cyc < hang) {                                   // 水珠在天花板上慢慢長大
        d.drop.visible = true; d.drop.position.y = d.H - 0.012; d.drop.scale.setScalar(0.35 + 0.65 * (cyc / hang));
      } else if (cyc < hang + fall) {                     // 落下
        const ft = cyc - hang; d.drop.visible = true; d.drop.scale.set(0.85, 1.25, 0.85);
        d.drop.position.y = d.H - 0.012 - 0.5 * 9.8 * ft * ft;
      } else d.drop.visible = false;
      const k = (cyc - hang - fall) / 1.1;                // 漣漪
      d.ripple.visible = k > 0 && k < 1;
      if (d.ripple.visible) { d.ripple.scale.setScalar(0.015 + 0.13 * Math.sqrt(k)); d.rm.opacity = 0.42 * (1 - k); }
    }

    // 總開關狀態燈與儀表
    this._applyLeds(false, dt);
    for (const g of this.sw.gauges) {
      const target = this._breakerOn && this._powerLevel > 0.2 ? g.max : 0;
      g.value = dampTo(g.value, target, 1.4, dt);
      g.pivot.rotation.z = this._needleAngle(g.value);
    }

    // 車燈事件期間：剪影跟著玩家（本模組在 player 之後更新），陰影貼圖每幀更新
    if (this._hl.active) { this._syncSilhouette(); this.road.hl[0].shadow.needsUpdate = true; }
  }

  /** 儀表指針角度：0 → 左下（-135°），1 → 右下（+135°）。 */
  _needleAngle(v) { return (0.75 - v * 1.5) * PI; }

  _applyLeds(instant = false, dt = 0) {
    const L = this._leds;
    if (instant) { L.trip = L.tripT; L.power = L.powerT; } else { L.trip = dampTo(L.trip, L.tripT, 3, dt); L.power = dampTo(L.power, L.powerT, 3, dt); }
    if (this.sw.leds.trip) this.sw.leds.trip.emissiveIntensity = 0.55 * L.trip;
    if (this.sw.leds.power) this.sw.leds.power.emissiveIntensity = 1.4 * L.power;
    this.mats.lampGreenLit.emissiveIntensity = 0.9 * L.power * Math.min(1, this._powerLevel * 1.5);
  }

  /** 依目前的供電補間計算每個燈具的亮度。 */
  _updatePower(now, dt, reduce = false) {
    const P = this._power;
    let maxLevel = 0;
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      let lv;
      if (P.on) {
        if (P.ramp <= 0) lv = 1;
        else {
          const k = (now - P.t0 - f.delay) / P.ramp;
          if (k <= 0) lv = P.from ? P.from[i] : 0;
          else if (k >= 1) lv = 1;
          else {
            // 主要漸亮佔 65%；兩次緩慢的下沉（各約 0.4–0.5 秒），光敏感模式下省略
            let e = smooth(0, 0.65, k);
            if (!reduce) e *= (1 - 0.26 * bell(k, 0.6, 0.085)) * (1 - 0.12 * bell(k, 0.84, 0.06));
            const from = P.from ? P.from[i] : 0;
            lv = from + (1 - from) * e;
          }
        }
      } else {
        if (P.ramp <= 0) lv = 0;
        else {
          const k = clamp((now - P.t0) / P.ramp);
          const from = P.from ? P.from[i] : 0;
          lv = from * (1 - smooth(0, 1, k));
        }
      }
      // 一盞不穩的燈管：週期 1.9 秒、振幅 8% 的緩慢起伏
      if (f.unstable && lv > 0 && !reduce) lv *= 1 - 0.08 * (0.5 + 0.5 * Math.sin(now * (2 * PI / 1.9)));
      f.level = lv;
      f.mat.emissiveIntensity = f.dead ? 0 : lv * f.base;
      if (!f.dead) maxLevel = Math.max(maxLevel, lv);
    }
    this._powerLevel = maxLevel;
    for (const p of this.points) {
      let lv = 0;
      for (const f of p.drivers) lv += f.level;
      lv /= Math.max(1, p.drivers.length);
      p.light.intensity = p.base * lv;
    }
    for (const cm of this.struct.cathodes) cm.opacity = 0.32 * maxLevel;
    // 積水只有在燈亮時才映出天花板與燈管（停電時只剩手電筒的高光）
    for (const wm of this.struct.wetMats) wm.envMapIntensity = 2.6 * maxLevel;
    if (this.struct.glassSheen) this.struct.glassSheen.material.envMapIntensity = 0.3 * maxLevel;
  }

  // ---- 車燈事件 --------------------------------------------------------------
  /** 玩家剪影跟著玩家（腳底位置＋面向）。 */
  _syncSilhouette() {
    const P = this.ctx.player, sil = this.silhouette;
    if (!P) return;
    sil.position.set(P.position.x + (P.rig?.x || 0), 0, P.position.z + (P.rig?.z || 0));
    sil.rotation.set(0, P.yaw || 0, 0);
    sil.updateMatrixWorld();
  }

  /**
   * 光斑遮罩：直接在「南牆座標」定義一個柔邊矩形（中心 X/Y、半寬 W、半高 H、左右/上下過渡半寬 A/B），
   * 逐一把遮罩貼圖的每個像素（光源視角的 tan 空間 [-R, R]²）投到牆面上求值。
   * 斜射時牆上兩側的拉伸不同（遠端被拉得更長），在牆面座標定義才能讓兩側邊緣都一樣柔。
   * @returns {number} 涵蓋整個光斑所需的 tan 半徑 R（光錐半角 = atan(R)）
   */
  _drawCookie(L, Wt, zWall, X, Y, W, H, A, B, reduce) {
    const { tex, data, N } = this.road.hlCookie;
    // 光源相機的基底（與 SpotLightShadow 的 lookAt 一致：up = +Y）
    const f = _c1.copy(Wt).sub(L).normalize();
    const r = _c2.crossVectors(f, _up).normalize();
    const u = _c3.crossVectors(r, f).normalize();
    // 需要的 tan 半徑：柔邊矩形四角投影回 tan 空間
    let R = 0;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      _c4.set(X + sx * (W + A * 1.5), Y + sy * (H + B), zWall).sub(L);
      const dz = _c4.dot(f);
      if (dz > 1e-3) R = Math.max(R, Math.hypot(_c4.dot(r) / dz, _c4.dot(u) / dz));
    }
    R = Math.max(1e-3, R * 1.06);                          // 光錐（圓）要包住整個柔邊矩形
    const span = W + A;
    for (let j = 0; j < N; j++) {
      const ty = ((j + 0.5) / N * 2 - 1) * R;
      for (let i = 0; i < N; i++) {
        const tx = ((i + 0.5) / N * 2 - 1) * R;
        const dx = f.x + r.x * tx + u.x * ty, dy = f.y + r.y * tx + u.y * ty, dz = f.z + r.z * tx + u.z * ty;
        let v = 0;
        if (dz > 1e-4) {
          const s = (zWall - L.z) / dz;
          const sx = L.x + dx * s - X, ox = Math.abs(sx), oy = Math.abs(L.y + dy * s - Y);
          // 光斑往東滑：後緣（西側）再柔一些——車子起步時，後緣掃過的牆面不會暗得太快
          const As = sx < 0 ? A * 1.5 : A;
          const ex = 1 - smooth(W - As, W + As, ox), ey = 1 - smooth(H - B, H + B, oy);
          // 中央略亮（車燈熱點）；光敏感模式下均勻
          const hot = reduce ? 1 : 0.84 + 0.16 * Math.exp(-(ox * ox) / (2 * (0.55 * span) ** 2));
          v = ex * ey * hot;
        }
        const o = (j * N + i) * 4, b = Math.round(255 * v);
        data[o] = b; data[o + 1] = b; data[o + 2] = b; data[o + 3] = 255;
      }
    }
    tex.needsUpdate = true;
    return R;
  }

  _hlFrame(t, plan) {
    const ctx = this.ctx, C = ctx.LAYOUT.CORRIDOR, fd = C.fireDoor, R = this.road;
    const D = plan.D;
    const xc = plan.xc0 - plan.v * carTravel(plan.prof, t);
    // 亮度包絡：慢慢漸強、慢慢漸弱
    const env = smooth(0, plan.rise, t) * (1 - smooth(plan.tF, D, t));
    // 淡出前一刻就讓手電筒慢慢回來（與光斑的淡出互補，整體畫面亮度幾乎不變）
    if (!plan.restored && t >= plan.tF - 0.3) {
      plan.restored = true;
      try { if (this._hl.dimmed) { ctx.player?.setFlashlightDim?.(1, plan.fall + 0.3); this._hl.dimmed = false; } } catch (e) { console.warn('[corridor] setFlashlightDim failed', e); }
    }
    const win = _v1.set(fd.x, fd.glass.y, plan.zg);
    const p0 = _v2.set(xc, HL_Y, plan.zl);
    const toWin = _v3.copy(win).sub(p0); const dW = toWin.length(); toWin.divideScalar(dW);
    // 車頭朝 +X：窗戶越接近車燈主軸越亮（車子貼近窗前時，窗戶在車燈側面 → 暗）
    const facing = smooth(-0.45, 0.65, toWin.x);
    const fwd = 0.45 + 0.55 * smooth(0.12, 0.62, toWin.x);
    // 光線打到南牆的位置（光斑中心）與距離；窗戶在牆上的投影（放大率 m）
    const zWall = C.main.maxZ;
    const sWall = (zWall - p0.z) / Math.max(0.05, toWin.z);
    const m = (zWall - p0.z) / Math.max(0.05, plan.zg - p0.z);
    const X = p0.x + toWin.x * sWall, Y = p0.y + toWin.y * sWall;
    // 牆上的柔邊矩形：窗戶投影（0.62 × 0.8 × m）；核心至少要比柔邊寬一些（否則兩側柔邊重疊成尖峰，牆上的點會亮得太快）
    const A = plan.soft / 1.22;                            // smoothstep 的 10–90% 約佔全寬的 0.61
    const Wc = Math.max((fd.glass.w / 2) * m, 0.55 * A);
    const Hc = (fd.glass.h / 2) * m;
    const Bv = plan.softV / 1.22;
    const Rt = this._drawCookie(p0, win, zWall, X, Y, Wc, Hc, A, Bv, plan.reduce);
    const I0 = plan.I * env * fwd * (sWall / 12) * (sWall / 12);
    const I1 = CORRIDOR_TUNING.headlightRoad * env * (plan.reduce ? 0.7 : 1);   // 另一盞車燈（只作用在灰燼／反光標記上）
    const h0 = R.hl[0];
    const p1 = _c4.set(xc, HL_Y, plan.zr);
    h0.position.copy(p0); h0.target.position.copy(win);
    h0.angle = Math.atan(Rt);
    h0.intensity = I0;
    h0.target.updateMatrixWorld();
    this._syncSilhouette();
    // 車燈本身的眩光（只有透過玻璃看得到）；車子退到封板附近時淡出
    const spriteVis = env * (0.3 + 0.7 * facing) * smooth(6.2, 8.0, xc);
    R.hlSprites[0].position.set(xc + 0.25, HL_Y, plan.zl); R.hlSprites[1].position.set(xc + 0.25, HL_Y, plan.zr);
    for (const s of R.hlSprites) { s.material.opacity = 0.95 * spriteVis; s.scale.setScalar(1.2 + 0.6 * facing); }
    // 玻璃上的散射光＋穿窗光束
    this.windowFx.scatterMat.opacity = 0.55 * env * fwd;
    const beam = this.windowFx.beam;
    beam.visible = env > 0.01;
    if (beam.visible) {
      const len = clamp(sWall - dW, 1.2, 6.0);
      beam.position.set(fd.x, fd.glass.y, plan.zg + 0.01);
      _q.setFromUnitVectors(_up, toWin); beam.quaternion.copy(_q);
      const wid = clamp((2 * (Wc + A * 0.6) / m) * Math.max(0.35, toWin.z / Math.max(1e-4, Math.hypot(toWin.x, toWin.z))) / 0.95, 0.35, 1.2);
      beam.scale.set(wid, len, wid);
      this.windowFx.beamMat.uniforms.uI.value = 0.13 * env * fwd * (plan.reduce ? 0.7 : 1);
    }
    // 粒子與反光標記也接收車燈
    const hlScaleAsh = 1 / 60;
    {
      const u = R.ash.material.uniforms;
      u.uHL0.value.copy(h0.position); u.uHL1.value.copy(p1);
      u.uHLDir0.value.copy(toWin); u.uHLDir1.value.set(1, -0.1, 0.1).normalize();
      u.uHLI0.value = Math.min(I0, 2600) * hlScaleAsh; u.uHLI1.value = I1 * hlScaleAsh;
    }
    const ru = R.reflectors.uniforms;
    ru.uHL0.value.copy(h0.position); ru.uHL1.value.copy(p1);
    ru.uHLI0.value = env * 9; ru.uHLI1.value = env * 9;
    this._hl.env = env;
    this._hl.xc = xc;
  }

  _hlEnd() {
    const R = this.road;
    { const l = R.hl[0]; l.intensity = 0; l.position.set(0, -50, this.rdDims.laneZ); }
    for (const s of R.hlSprites) s.material.opacity = 0;
    this.windowFx.scatterMat.opacity = 0;
    this.windowFx.beam.visible = false;
    const u = R.ash.material.uniforms; u.uHLI0.value = 0; u.uHLI1.value = 0;
    R.reflectors.uniforms.uHLI0.value = 0; R.reflectors.uniforms.uHLI1.value = 0;
    R.hl[0].shadow.autoUpdate = false; R.hl[0].shadow.needsUpdate = true;
    this.silhouette.visible = false;
    if (this._hl.dimmed) {
      this._hl.dimmed = false;
      try { this.ctx.player?.setFlashlightDim?.(1, 1.5); } catch (e) { console.warn('[corridor] setFlashlightDim failed', e); }
    }
    this._hl.active = false; this._hl.env = 0;
  }
}
