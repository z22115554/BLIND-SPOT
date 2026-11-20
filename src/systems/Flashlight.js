// =============================================================================
// Flashlight — 玩家手電筒（PlayerController 的輔助檔）
// * SpotLight 掛在相機上（右下方、略往前），光束方向以阻尼 slerp 延遲跟隨視線（手持感）＋極小的晃動。
// * 光斑貼圖（SpotLight.map，castShadow 必須為 true）：程式化產生的反射杯光斑——中央熱點、一圈略暗的環、
//   外圈偏暖的溢光、細微的鏡面瑕疵。全部在 Canvas 上生成，零外部資源。
// * 反彈補光：在光束命中點附近放一盞極弱、不投影的 PointLight，模擬窄廊道裡光線打在牆上的二次反射
//   （命中距離以 LAYOUT 的房間盒子解析計算，不做昂貴的場景射線）。
// * 霧中光暈：全螢幕加法疊加的柔和光暈，強度依 scene.fog.density 與光束射程而定，讓濃霧「被照亮」。
// * 開關：亮度沿「舒適曲線」過渡（comfortCurve：兩端柔和、中段等速，最大斜率只有平均的 1.14 倍），
//   開/關預設 1.1 秒（光敏感模式 1.6 秒）→ 任何 0.25 秒內的畫面亮度變化 ≤ 最終亮度的約 26%（黃金規則 ≤ 30%）。
//   色溫由暖橘升到暖白（鎢絲燈感），但強度會補償顏色本身的亮度差，所以變色不會額外造成亮度跳動。
//   dim（setDim）：獨立於開關的亮度乘數（例如車燈事件時讓手電筒相形失色），同一條曲線、在對數空間過渡
//   （1 → 0.3 → 1 每段時間的亮度「比例」變化相同；實測最暗的房間裡 1.0 秒降到 0.3 時每 0.25 秒 ≤ 約 25%）。
//   沒有任何閃爍；關閉時 shadow.autoUpdate = false 以省下陰影貼圖的渲染。
// =============================================================================
import * as THREE from 'three';
import { makeCanvas, canvasTexture, makeNoise, fbm } from '../gfx/canvasUtil.js';
import { rng, clamp, smoothstep } from '../core/util.js';

const LIGHT_OFFSET = new THREE.Vector3(0.16, -0.14, -0.05); // 相機座標：右下、略前
const CONVERGE = 5.5;            // 光束中心在約 5.5 m 處與準心交會
const MAX_INTENSITY = 34;        // cd（decay 1.6）
const BEAM_ANGLE = 0.47;         // SpotLight 半角（rad）
// 陰影/光斑貼圖的視錐比光錐寬 12%：three 會把 normalBias 加進光斑貼圖的投影座標，
// 若兩者一樣大，光錐邊緣會有一圈落在貼圖方框外、未被調變的亮弧。
const SHADOW_FOCUS = 1.12;
const COOKIE_EDGE = Math.tan(BEAM_ANGLE) / Math.tan(BEAM_ANGLE * SHADOW_FOCUS); // 光錐邊緣在貼圖上的半徑
const COLOR_ON = new THREE.Color(0xfff0d8);
const COLOR_WARM = new THREE.Color(0xffa860);
const lumOf = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;   // 線性亮度
const LUM_ON = lumOf(COLOR_ON);
/** 開/關手電筒的預設過渡秒數（一般 / 光敏感模式）。 */
export const FLASHLIGHT_RAMP = 1.1, FLASHLIGHT_RAMP_CALM = 1.6;
const MIN_RAMP = 0.4;            // 任何亮度變化 ≥ 0.4 秒（黃金規則）

// 舒適曲線：斜率 s(x) = (1 - e^(-x/τ))(1 - e^(-(1-x)/τ))，積分後正規化。
// 起步與收尾柔和（沒有「一開就亮一截」的瞬間），中段等速；最大斜率 = 1/∫s ≈ 1.14 倍平均斜率，
// 所以任一 0.25 秒窗內的變化 ≤ 1.14 × 0.25 / 時長 × 總變化量。（指數/smoothstep 曲線的最大斜率是 1.5 倍以上。）
const CURVE_TAU = 0.06;
const CURVE_N = 512;
const CURVE_LUT = (() => {
  const lut = new Float32Array(CURVE_N + 1);
  const sl = (x) => (1 - Math.exp(-x / CURVE_TAU)) * (1 - Math.exp(-(1 - x) / CURVE_TAU));
  let acc = 0;
  for (let i = 1; i <= CURVE_N; i++) { acc += sl((i - 0.5) / CURVE_N) / CURVE_N; lut[i] = acc; }
  for (let i = 1; i <= CURVE_N; i++) lut[i] /= acc;
  lut[CURVE_N] = 1;
  return lut;
})();
/** 0..1 → 0..1 的舒適亮度曲線（單調、兩端斜率為 0、中段近似等速）。 */
export function comfortCurve(x) {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const f = x * CURVE_N, i = Math.floor(f);
  return CURVE_LUT[i] + (CURVE_LUT[i + 1] - CURVE_LUT[i]) * (f - i);
}

/** 以 comfortCurve 由目前值過渡到目標值的小工具（遊戲時間 dt 驅動；中途改目標會從目前值重新起步）。 */
class ComfortRamp {
  /** log = true：兩端都 > 0 時在對數空間內插（亮度乘數：每一段時間的「比例」變化相同）。 */
  constructor(v = 0, { log = false } = {}) { this.value = v; this.target = v; this._from = v; this._x = 1; this._dur = 0; this._log = log; }
  /** duration = 由 0 到 1 整段所需秒數；實際時間依變化量等比例縮短（但不少於 MIN_RAMP）。≤ 0 = 立即。 */
  set(target, duration) {
    target = clamp(Number(target) || 0, 0, 1);
    const d = Number(duration) || 0;
    if (d <= 0) { this.value = this.target = this._from = target; this._x = 1; return; }
    if (target === this.target && this._x < 1) return;          // 同一個目標：維持原本的過渡
    this._from = this.value;
    this.target = target;
    this._dur = Math.max(MIN_RAMP, d * Math.abs(target - this.value));
    this._x = target === this.value ? 1 : 0;
  }
  update(dt) {
    if (this._x >= 1) { this.value = this.target; return this.value; }
    this._x = Math.min(1, this._x + dt / this._dur);
    const k = comfortCurve(this._x);
    this.value = this._log && this._from > 0.02 && this.target > 0.02
      ? this._from * Math.pow(this.target / this._from, k)
      : this._from + (this.target - this._from) * k;
    return this.value;
  }
  get busy() { return this._x < 1; }
}

export class FlashlightRig {
  /** @param {object} ctx  @param {THREE.SpotLight} light 由 PlayerController 建立的 SpotLight（player.flashlight） */
  constructor(ctx, light) {
    this.ctx = ctx;
    this.light = light;
    this.level = 0;          // 0..1 開關亮度（舒適曲線過渡後）
    this.targetLevel = 0;
    this.rampDur = FLASHLIGHT_RAMP;
    this.dim = 1;            // 0..1 亮度乘數（setDim）
    this._on = new ComfortRamp(0);
    this._dim = new ComfortRamp(1, { log: true });
    this.maxIntensity = MAX_INTENSITY;
    this.bounceStrength = 0.036; // 反彈補光比例（相對於主燈 cd）
    this.hazeStrength = 1.0;     // 霧中光暈強度倍率（0 = 關閉）
    this.beamDistance = 6;       // 目前光束射程（解析估計，平滑後）
    this._beamQ = new THREE.Quaternion();
    this._camQ = new THREE.Quaternion();
    this._tmpQ = new THREE.Quaternion();
    this._swayE = new THREE.Euler(0, 0, 0, 'YXZ');
    this._dirLocal = new THREE.Vector3(-LIGHT_OFFSET.x, -LIGHT_OFFSET.y, -CONVERGE + LIGHT_OFFSET.z).normalize();
    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._snap = true;
    this._distTimer = 0;
    this._rawDist = 6;

    // ---- 主光：SpotLight ------------------------------------------------------
    light.color.copy(COLOR_ON);
    light.intensity = 0;
    light.distance = 16;
    light.angle = BEAM_ANGLE;    // 半角 ≈ 27°（主光區約 15°，其外為柔和溢光；形狀主要由光斑貼圖決定）
    light.penumbra = 0.28;       // 柔邊
    light.decay = 1.6;
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.bias = -0.0006;
    light.shadow.normalBias = 0.025;
    light.shadow.radius = 2;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 16;
    light.shadow.focus = SHADOW_FOCUS;
    light.shadow.autoUpdate = false;
    light.position.copy(LIGHT_OFFSET);
    light.name = 'playerFlashlight';
    light.map = makeCookieTexture(COOKIE_EDGE);
    light.userData.noOcclude = true;

    this.target = new THREE.Object3D();
    this.target.name = 'playerFlashlightTarget';
    light.target = this.target;

    // ---- 反彈補光（不投影） ----------------------------------------------------
    this.bounce = new THREE.PointLight(0xffdcb4, 0, 5.5, 2);
    this.bounce.name = 'playerFlashlightBounce';
    this.bounce.castShadow = false;

    // ---- 霧中光暈（全螢幕加法疊加） --------------------------------------------
    this.haze = makeHaze();
  }

  /** 加入場景（PlayerController 建構時呼叫：讓燈光數量從第一幀起就固定，避免中途重編譯 shader）。 */
  attach(camera, scene) {
    camera.add(this.light);
    camera.add(this.haze);
    scene.add(this.target);
    scene.add(this.bounce);
  }

  /** 開/關。duration ≤ 0 = 立即（只在全黑的重置時使用）；否則為 0→1 整段的秒數。 */
  setOn(on, duration = FLASHLIGHT_RAMP) {
    this.targetLevel = on ? 1 : 0;
    this.rampDur = Math.max(0, Number(duration) || 0);
    this._on.set(this.targetLevel, this.rampDur);
    if (this.rampDur <= 0) { this.level = this._on.value; if (!on) this._dim.set(1, 0); }
  }

  /** 亮度乘數（0..1），以舒適曲線在 duration 秒內過渡；與開關無關。 */
  setDim(mult = 1, duration = 0.8) {
    const d = Math.max(0, Number(duration) || 0);
    // 「整段」時間換算：讓實際過渡時間 = duration（ComfortRamp 會依變化量縮放）
    const span = Math.abs(clamp(Number(mult), 0, 1) - this._dim.value);
    this._dim.set(mult, d > 0 && span > 1e-4 ? Math.max(d, MIN_RAMP) / span : d);
  }

  /** 瞬間把光束方向對齊視線（瞬移/過場後）。 */
  snap() { this._snap = true; }

  update(dt, t, { camera, moveAmount = 0, stridePhase = 0, reduceFlicker = false }) {
    const light = this.light;
    // ---- 亮度（舒適曲線，無閃爍）-------------------------------------------------------
    this.level = this._on.update(dt);
    this.dim = this._dim.update(dt);
    // 關到全黑之後，dim 回到 1（下次開燈從正常亮度開始；此時亮度為 0，看不出來）
    if (this.level <= 0 && !this._on.busy && this.targetLevel === 0 && this.dim !== 1) { this._dim.set(1, 0); this.dim = 1; }
    const k = this.level * this.dim;
    // 光束打在很近的表面時略為收斂（像眼睛適應），避免整片過曝；beamDistance 已平滑，變化緩慢無閃爍
    const nearDim = 0.55 + 0.45 * smoothstep(0.45, 2.6, this.beamDistance);
    light.color.copy(COLOR_WARM).lerp(COLOR_ON, smoothstep(0.0, 0.85, this.level));
    // 色溫變化不改變亮度：以顏色本身的亮度做補償（暖橘色的亮度只有暖白的一半）
    const colorComp = LUM_ON / Math.max(0.05, lumOf(light.color));
    light.intensity = this.maxIntensity * k * nearDim * colorComp;
    const active = k > 0.001;
    light.shadow.autoUpdate = active;
    if (!active) light.shadow.needsUpdate = false;

    // ---- 光束方向：阻尼 slerp 延遲跟隨 + 晃動 -------------------------------------
    camera.getWorldQuaternion(this._camQ);
    if (this._snap) { this._beamQ.copy(this._camQ); this._snap = false; }
    else if (dt > 0) {
      this._beamQ.slerp(this._camQ, 1 - Math.exp(-11 * dt));
      // 延遲角度上限：快速轉身時光束不會落到畫面外
      const ang = this._beamQ.angleTo(this._camQ);
      const maxLag = 0.16;
      if (ang > maxLag) this._beamQ.slerp(this._camQ, 1 - maxLag / ang);
    }
    const sw = reduceFlicker ? 0.45 : 1;
    const idleY = (Math.sin(t * 0.63) * 0.0045 + Math.sin(t * 1.71 + 1.3) * 0.0022) * sw;
    const idleX = (Math.sin(t * 0.81 + 0.7) * 0.0038 + Math.sin(t * 2.07 + 2.1) * 0.0016) * sw;
    const walkY = Math.sin(stridePhase * Math.PI) * 0.011 * moveAmount * sw;
    const walkX = -Math.abs(Math.cos(stridePhase * Math.PI)) * 0.008 * moveAmount * sw;
    this._swayE.set(idleX + walkX, idleY + walkY, 0);
    this._tmpQ.setFromEuler(this._swayE).premultiply(this._beamQ);
    this._dir.copy(this._dirLocal).applyQuaternion(this._tmpQ);

    light.getWorldPosition(this._pos);
    this.target.position.copy(this._pos).addScaledVector(this._dir, 6);
    this.target.updateMatrixWorld();

    // ---- 光束射程（解析估計，約 12 Hz）＋反彈補光 ---------------------------------------
    this._distTimer -= dt;
    if (this._distTimer <= 0 || this._snap) {
      this._distTimer = 0.08;
      this._rawDist = beamDistance(this.ctx, this._pos, this._dir);
    }
    this.beamDistance += (this._rawDist - this.beamDistance) * (1 - Math.exp(-10 * Math.max(dt, 0.016)));
    const d = this.beamDistance;
    // 補光放在光斑附近（窄廊道裡溢光先打到身旁的牆面，所以最遠只放到前方約 2.4 m），略離開表面避免過亮的奇點。
    // 反射光通量 ≈ 反照率 × 光束總通量，與距離無關 → 補光強度固定，只隨主燈亮度變化。
    const near = Math.min(d, 2.4);
    const pull = Math.min(0.32, near * 0.28);
    this.bounce.position.copy(this._pos).addScaledVector(this._dir, Math.max(0.05, near - pull));
    this.bounce.intensity = this.maxIntensity * k * this.bounceStrength * colorComp;
    this.bounce.distance = 4.5;

    // ---- 霧中光暈 -----------------------------------------------------------------------
    const fog = this.ctx.scene.fog;
    const dens = fog && fog.isFogExp2 ? fog.density : (fog ? 0.03 : 0);
    const u = this.haze.material.uniforms;
    u.strength.value = k * this.hazeStrength * (this.maxIntensity / MAX_INTENSITY) * 0.14 * colorComp;
    // 貢獻可忽略（燈剛開/快關、幾乎沒霧）時整個全螢幕光暈 pass 都不畫
    this.haze.visible = u.strength.value > 0.002 && dens > 0.004;
    if (this.haze.visible) {
      const invCam = this._tmpQ.copy(this._camQ).invert();
      u.beamDir.value.copy(this._dir).applyQuaternion(invCam);
      u.lightPos.value.copy(light.position);                    // 相機座標（燈掛在相機上）
      u.sigma.value = dens;
      u.maxDist.value = Math.max(0.3, Math.min(d, 10));         // 光束撞牆即止
      u.decay.value = light.decay;
      const th = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      u.tanHalf.value.set(th * camera.aspect, th);
      u.color.value.copy(light.color);
      u.cosOuter.value = Math.cos(light.angle);
      u.cosInner.value = Math.cos(light.angle * 0.45);
    }
  }
}

// -----------------------------------------------------------------------------
// 光束射程：以 LAYOUT 的房間盒子（主控室/門口/廊道/轉角/電閘室）解析計算射線離開空間的距離
// -----------------------------------------------------------------------------
function spaceBoxes(L) {
  const R = L.CONTROL_ROOM, C = L.CORRIDOR, S = L.SWITCH_ROOM;
  const boxes = [
    [R.minX, 0, R.minZ, R.maxX, R.height, R.maxZ],
    [C.main.minX - 0.2, 0, C.main.minZ, C.main.maxX, C.main.height, C.main.maxZ],
    [C.leg.minX, 0, C.leg.minZ - 0.01, C.leg.maxX, C.leg.height, C.leg.maxZ + 0.01],
    [S.minX, 0, S.minZ, S.maxX, S.height, S.maxZ],
  ];
  const p = L.PORTALS?.sideDoor;
  if (p?.open) boxes.push([p.minX, 0, p.minZ, p.maxX, R.sideDoor.height, p.maxZ]);
  return boxes;
}
function inside(b, p, m = 0) {
  return p.x >= b[0] - m && p.x <= b[3] + m && p.y >= b[1] - m && p.y <= b[4] + m && p.z >= b[2] - m && p.z <= b[5] + m;
}
function exitT(b, p, d) {
  let t = Infinity;
  const ax = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i++) {
    const di = d[ax[i]], pi = p[ax[i]];
    if (di > 1e-6) t = Math.min(t, (b[i + 3] - pi) / di);
    else if (di < -1e-6) t = Math.min(t, (b[i] - pi) / di);
  }
  return Math.max(0, t);
}
const _q = new THREE.Vector3();
export function beamDistance(ctx, origin, dir, maxDist = 18) {
  const L = ctx.LAYOUT;
  if (!L?.CONTROL_ROOM) return 6;
  const boxes = spaceBoxes(L);
  _q.copy(origin);
  let total = 0;
  for (let hop = 0; hop < 5; hop++) {
    let best = -1;
    for (const b of boxes) if (inside(b, _q, 0.001)) best = Math.max(best, exitT(b, _q, dir));
    if (best < 0) break;
    total += best;
    if (total >= maxDist) return maxDist;
    _q.addScaledVector(dir, best + 0.02);
    total += 0.02;
    let cont = false;
    for (const b of boxes) if (inside(b, _q, 0)) { cont = true; break; }
    if (!cont) break;
  }
  return clamp(total || 6, 0.05, maxDist);
}

// -----------------------------------------------------------------------------
// 光斑貼圖（線性資料貼圖，乘在光色上）
// -----------------------------------------------------------------------------
function makeCookieTexture(edge = 1) {
  const S = 256;
  const { canvas, g } = makeCanvas(S, S);
  const img = g.createImageData(S, S);
  const noise = makeNoise(4242, 64);
  const r = rng(77);
  // 反射杯上的幾道細微瑕疵（角度方向的條紋）
  const flaws = Array.from({ length: 7 }, () => ({ a: r() * Math.PI * 2, w: 0.04 + r() * 0.08, k: 0.05 + r() * 0.08 }));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      const rr = Math.hypot(u, v) / edge;   // 1.0 = 光錐邊緣
      const a = Math.atan2(v, u);
      // 徑向輪廓：熱點 → 主光區 → 暗環 → 反射環 → 寬而柔和的溢光（最後除以中心值正規化）
      let I = 0.28 * Math.exp(-rr * rr / 0.05);                  // 中央熱點
      I += 0.58 * (1 - smoothstep(0.1, 0.7, rr));                // 主光區
      I -= 0.05 * Math.exp(-((rr - 0.33) ** 2) / 0.0018);        // 暗環
      I += 0.07 * Math.exp(-((rr - 0.45) ** 2) / 0.003);         // 反射環
      I += 0.42 * (1 - smoothstep(0.38, 1.0, rr));               // 外圈溢光
      I /= 1.28;
      // 角度方向的反射杯瑕疵＋低頻噪音（舊手電筒的不均勻）
      let flaw = 0;
      for (const f of flaws) {
        let da = Math.abs(a - f.a); da = Math.min(da, Math.PI * 2 - da);
        flaw += f.k * Math.exp(-(da * da) / (f.w * f.w)) * smoothstep(0.15, 0.7, rr);
      }
      const n = fbm(noise, u * 6 + 32, v * 6 + 32, 3);
      I *= 1 - flaw * 0.6 + (n - 0.5) * 0.08;
      I *= 1 - smoothstep(0.9, 1.0, rr);                           // 邊緣歸零（貼圖方形外框不可見）
      I = clamp(I, 0, 1.2);
      // 外圈略偏暖（鎢絲燈＋反射杯的色散）
      const warm = smoothstep(0.25, 0.85, rr);
      const i = (y * S + x) * 4;
      img.data[i] = clamp(I * 1.0) * 255;
      img.data[i + 1] = clamp(I * (1 - warm * 0.07)) * 255;
      img.data[i + 2] = clamp(I * (1 - warm * 0.2)) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(canvas, { color: false, wrap: false, anisotropy: 1, mipmaps: true });
}

// -----------------------------------------------------------------------------
// 霧中光暈：全螢幕 quad（不經相機矩陣）。沿每個像素的視線做 8 次等角取樣（＋抖動），
// 累積「點光源 × 光錐 × 衰減 × 霧的穿透率」的單次散射，得到從手邊斜斜射出的柔和光柱。
// 只在手電筒開啟且有霧時繪製；輸出線性色彩，經柔性壓縮避免光源附近過曝。
// -----------------------------------------------------------------------------
function makeHaze() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      strength: { value: 0 },
      sigma: { value: 0.1 },
      maxDist: { value: 8 },
      decay: { value: 1.6 },
      lightPos: { value: new THREE.Vector3() },
      beamDir: { value: new THREE.Vector3(0, 0, -1) },
      tanHalf: { value: new THREE.Vector2(1, 1) },
      color: { value: new THREE.Color(1, 1, 1) },
      cosOuter: { value: 0.9 },
      cosInner: { value: 0.97 },
    },
    vertexShader: /* glsl */`
      varying vec2 vNdc;
      void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float strength; uniform float sigma; uniform float maxDist; uniform float decay;
      uniform vec3 lightPos; uniform vec3 beamDir; uniform vec2 tanHalf; uniform vec3 color;
      uniform float cosOuter; uniform float cosInner;
      varying vec2 vNdc;
      // interleaved gradient noise：比白噪音平滑得多的抖動
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void main() {
        vec3 vd = normalize(vec3(vNdc * tanHalf, -1.0));
        float j = ign(gl_FragCoord.xy);
        // 等角取樣（equiangular sampling, Kulla & Fajardo 2012）：在光源看出去的角度上均勻取樣，
        // 估計式中的 1/r² 被 pdf 抵消，8 個樣本就幾乎沒有雜訊
        vec3 L = lightPos;
        float delta = dot(L, vd);
        float D = max(length(L - vd * delta), 0.02);
        float ta = atan((0.05 - delta) / D);
        float tb = atan((maxDist - delta) / D);
        float acc = 0.0;
        const int N = 8;
        for (int i = 0; i < N; i++) {
          float th = mix(ta, tb, (float(i) + j) / float(N));
          float t = delta + D * tan(th);
          vec3 lp = vd * t - L;
          float r2 = max(dot(lp, lp), 1e-4);
          float cone = smoothstep(cosOuter, cosInner, dot(lp * inversesqrt(r2), beamDir));
          // 光源附近做軟化（手掌/燈頭本身會擋住一部分）
          acc += cone * exp(-sigma * t) * r2 / pow(r2 + 0.06, decay * 0.5);
        }
        acc *= (tb - ta) / (D * float(N));
        acc *= sigma * strength;
        acc = acc / (1.0 + acc * 2.5);                  // 柔性壓縮
        float dither = (j - 0.5) / 255.0;
        gl_FragColor = vec4(color * acc + dither * step(0.0004, acc), 1.0);
        // 經 EffectComposer（render target）時兩者皆為恆等；直接畫到螢幕時才做 tone mapping / sRGB
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.name = 'playerFlashlightHaze';
  mesh.frustumCulled = false;
  mesh.renderOrder = 900;
  mesh.visible = false;
  mesh.userData.noOcclude = true;
  return mesh;
}
