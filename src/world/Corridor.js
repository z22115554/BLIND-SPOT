// =============================================================================
// Corridor — 地下公務維修廊道＋防火門外主車道＋電閘室（第二幕）
// 【API 骨架 / CONTRACT STUB】實作者必須保留 objects 的所有鍵與所有公開方法。
// 位置一律取自 ctx.LAYOUT.CORRIDOR / SWITCH_ROOM / ROADWAY。
//
// 氛圍要求：狹長、低矮、濃霧（場景 FogExp2 由狀態設定，約 0.10–0.14）、潮濕混凝土、管線、排水溝、
//   失效的緊急出口燈、牆面區段編號（例如「B2-07」）。停電時廊道沒有任何燈；只能靠手電筒。
// 防火門幻影（triggerHeadlights）：
//   主車道上一道車燈由遠而近掃過（SpotLight 由 ROADWAY.laneZ 車道、低角度射向防火門玻璃），
//   透過玻璃把玩家的影子（ctx.player.shadowProxy）拉長投射在廊道南牆上。
//   亮度變化必須是 0.6 秒以上的漸強與 1 秒以上的漸弱（「一閃而過」但不是頻閃），整段約 2.5–3 秒，
//   同時播放 audio.sfx('carPass')。結束後主車道上只有緩慢飄落的灰燼。
//
// 實作摘要：
//   * 靜態幾何依「材質 × 8 m 區段」合併（corridor/structure.js、switchRoom.js、roadway.js），
//     貼圖 UV 以世界座標公尺為單位，由材質 repeat 決定尺度（對齊 TextureFactory 的尺度說明）。
//   * 燈光：廊道＋電閘室共 5 盞 PointLight（有距離截止，不會漏進主控室），其餘靠燈罩自發光。
//     車燈 2 盞 SpotLight 常駐場景（強度 0 時著色器會跳過，不必重新編譯）；近側那盞 castShadow，
//     但 shadow.autoUpdate 只在事件期間開啟，平時不渲染陰影貼圖。
//   * 線索物件（watch/logbook/coat）在標準朝向下建模、置中，世界擺放由外層 mount 負責。
// =============================================================================
import * as THREE from 'three';
import { corridorDims, buildStructure } from './corridor/structure.js';
import { buildWatch, buildLogbook, buildLoosePage, buildCoat } from './corridor/items.js';
import { buildSwitchRoom, LEVER_OFF, LEVER_ON } from './corridor/switchRoom.js';
import { roadwayDims, buildRoadway, buildWindowFx } from './corridor/roadway.js';
import { particleMaterial } from './corridor/fx.js';
import * as TX from './corridor/tex.js';

const PI = Math.PI;
const HL_Y = 0.75;                 // 車燈離地高度（主車道路面 y = 0）
const HL_RISE = 1.3, HL_FALL = 1.3;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const bell = (k, c, w) => Math.exp(-((k - c) * (k - c)) / (2 * w * w));
const dampTo = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

/** 可調參數（整合時微調用）。 */
export const CORRIDOR_TUNING = {
  fixtureEmissive: 1.7,       // 廊道燈罩自發光強度
  switchEmissive: 2.3,        // 電閘室燈罩自發光強度
  pointBase: [9, 9, 8, 6, 10],// 5 盞 PointLight 的燭光
  headlightPeak: 1300,        // 近側車燈（穿窗、投影）峰值燭光（以 8 m 處為準，會依距離正規化）
  headlightRoad: 420,         // 遠側車燈（只照車道）峰值燭光
  headlightDuration: 2.9,
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
    this._hl = { run: 0, active: false, env: 0 };
    this._ash = { target: 1, level: 1 };
    this._leds = { trip: 1, power: 0, tripT: 1, powerT: 0 };
    this._breakerOn = false;
    this._flash = 0;
    this._bufSize = new THREE.Vector2();
    this._applyLeds();
    for (const g of this.sw.gauges) g.pivot.rotation.z = this._needleAngle(0);
    if (ctx.debug) console.info(`[corridor] built in ${Math.round(performance.now() - tBuild)} ms`);
  }

  init() {}

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
    const ctx = this.ctx, C = ctx.LAYOUT.CORRIDOR, fd = C.fireDoor;
    const run = ++this._hl.run;
    const D = CORRIDOR_TUNING.headlightDuration;
    // 讓光線在亮度最高時恰好穿過玻璃、掠過玩家（以觸發時的位置與行進預測）
    const p = ctx.player?.position;
    const pz = clamp(p?.z ?? 2.0, C.main.minZ + 0.3, C.main.maxZ - 0.15);
    const moving = ctx.player?.isMoving ? 1 : 0;
    const tAlign = 1.45;                               // 亮度持平段（1.3–1.6 秒）的中央
    const xp = Math.min(fd.x + 0.4, (p?.x ?? fd.x - 3) + moving * 1.3 * tAlign);
    const zl = this.rdDims.laneZ + 0.7;
    const xAlign = clamp(fd.x + (fd.x - xp) * ((fd.z - zl) / Math.max(0.3, pz - fd.z)), fd.x + 1, fd.x + 16);
    const plan = { run, D, tAlign, xAlign, v: 11.0, zl, zr: this.rdDims.laneZ - 0.7 };
    this._hl.plan = plan; this._hl.active = true;
    const hl0 = this.road.hl[0];
    hl0.shadow.autoUpdate = true;
    try { ctx.audio?.sfx?.('carPass', { position: new THREE.Vector3(fd.x, fd.glass.y, fd.z) }); } catch (e) { console.warn('[corridor] carPass sfx failed', e); }
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
    this.roadGroup.visible = (camPos.x > 5.5 && camPos.x < 34.5) || camPos.z < ctx.LAYOUT.CORRIDOR.main.minZ;

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

    // 車燈事件期間：陰影貼圖每幀更新
    if (this._hl.active) this.road.hl[0].shadow.needsUpdate = true;
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
  }

  // ---- 車燈事件 --------------------------------------------------------------
  _hlFrame(t, plan) {
    const ctx = this.ctx, fd = ctx.LAYOUT.CORRIDOR.fireDoor, R = this.road;
    const D = plan.D;
    const xc = plan.xAlign + plan.v * (t - plan.tAlign);
    const env = smooth(0, HL_RISE, t) * (1 - smooth(D - HL_FALL, D, t));     // 1.3 秒漸強、1.3 秒漸弱（0.25 秒內變化 < 30%）
    const win = _v1.set(fd.x, fd.glass.y, fd.z - 0.07);
    const p0 = _v2.set(xc, HL_Y, plan.zl);
    const toWin = _v3.copy(win).sub(p0); const dW = toWin.length(); toWin.divideScalar(dW);
    const facing = smooth(-0.45, 0.65, toWin.x);                 // 車頭朝 +X：車子過了窗戶之後光就背對我們
    const fwd = 0.62 + 0.38 * facing;
    // 以「到窗戶的距離」正規化：不論車子在哪，穿窗光斑的亮度都差不多（遠處光束中心本來就比較亮）
    const norm = clamp((dW / 8) * (dW / 8), 0.6, 4.5);
    const I0 = CORRIDOR_TUNING.headlightPeak * env * fwd * norm;
    const I1 = CORRIDOR_TUNING.headlightRoad * env;
    const [h0, h1] = R.hl;
    h0.position.copy(p0); h0.target.position.copy(win).addScaledVector(toWin, 1.6);
    h0.intensity = I0;
    h1.position.set(xc, HL_Y, plan.zr); h1.target.position.set(xc + 9, 0.0, plan.zr + 1.2);
    h1.intensity = I1;
    h0.target.updateMatrixWorld(); h1.target.updateMatrixWorld();
    // 車燈本身的眩光（只有透過玻璃看得到）
    const spriteVis = env * (0.3 + 0.7 * facing);
    R.hlSprites[0].position.set(xc + 0.25, HL_Y, plan.zl); R.hlSprites[1].position.set(xc + 0.25, HL_Y, plan.zr);
    for (const s of R.hlSprites) { s.material.opacity = 0.95 * spriteVis; s.scale.setScalar(1.2 + 0.6 * facing); }
    // 玻璃上的散射光＋穿窗光束
    this.windowFx.scatterMat.opacity = 0.7 * env * fwd;
    const beam = this.windowFx.beam;
    beam.visible = env > 0.01;
    if (beam.visible) {
      const zS = ctx.LAYOUT.CORRIDOR.main.maxZ;
      const len = clamp((zS - fd.z) / Math.max(0.15, toWin.z), 1.4, 5.5);
      beam.position.set(fd.x, fd.glass.y, fd.z - 0.06);
      _q.setFromUnitVectors(_up, toWin); beam.quaternion.copy(_q);
      beam.scale.set(1, len, 1);
      this.windowFx.beamMat.uniforms.uI.value = 0.15 * env * fwd;
    }
    // 粒子與反光標記也接收車燈
    const hlScaleAsh = 1 / 60;
    for (const u of [R.ash.material.uniforms]) {
      u.uHL0.value.copy(h0.position); u.uHL1.value.copy(h1.position);
      u.uHLDir0.value.copy(toWin); u.uHLDir1.value.set(1, -0.1, 0.1).normalize();
      u.uHLI0.value = I0 * hlScaleAsh; u.uHLI1.value = I1 * hlScaleAsh;
    }
    const ru = R.reflectors.uniforms;
    ru.uHL0.value.copy(h0.position); ru.uHL1.value.copy(h1.position);
    ru.uHLI0.value = env * 9; ru.uHLI1.value = env * 9;
    this._hl.env = env;
  }

  _hlEnd() {
    const R = this.road;
    for (const l of R.hl) { l.intensity = 0; l.position.set(0, -50, this.rdDims.laneZ); }
    for (const s of R.hlSprites) s.material.opacity = 0;
    this.windowFx.scatterMat.opacity = 0;
    this.windowFx.beam.visible = false;
    const u = R.ash.material.uniforms; u.uHLI0.value = 0; u.uHLI1.value = 0;
    R.reflectors.uniforms.uHLI0.value = 0; R.reflectors.uniforms.uHLI1.value = 0;
    R.hl[0].shadow.autoUpdate = false; R.hl[0].shadow.needsUpdate = true;
    this._hl.active = false; this._hl.env = 0;
  }
}
