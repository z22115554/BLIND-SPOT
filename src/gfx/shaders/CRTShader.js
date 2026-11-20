// =============================================================================
// CRTShader — 主控室監視器的 CRT 螢幕材質（ShaderMaterial，輸出線性色彩）
// -----------------------------------------------------------------------------
// 模式（uMode）：0 OFF  1 LD  2 STATIC  3 BOOT  4 HD
//   LD     ：以約 160×120 取樣（4×4 盒狀濾波）、只取亮度、對比/伽瑪、中等時間顆粒（24fps）、
//            約 6 秒一圈的緩慢滾動干擾帶、類比鬼影、掃描線、輕微桶形變形與映像管內暈影。
//   STATIC ：低對比雪花，平均亮度固定（≈0.3 感知亮度），24fps；光敏感模式改為約 6fps 交叉淡化的緩慢流動噪點。
//   OFF    ：近乎全黑，只剩玻璃的微弱反光漸層。
//   BOOT   ：中央亮點 → 水平亮線 → 全畫面光柵緩慢展開（OSD 顯示頻寬解除字樣）→ 淡入 HD。uBoot = 0..1。
//   HD     ：全彩、乾淨、極淡掃描線。
// 轉場（全部無亮度突變）：
//   uModeMix 0→1：由 uPrevMode（讀 tPrev）交叉淡化到 uMode（讀 tFeed）。
//   uSwitch  1→0：切換頻道約 0.25 秒的垂直滾動＋撕裂雜訊，畫面由 tPrev 交叉淡化到 tFeed（雜訊平均為零）。
//   uAGC：切換後新畫面先以舊畫面的平均亮度出現，約 1 秒內緩慢回到自己的亮度（模擬攝影機自動增益）。
// OSD（tOSD / tOSDPrev）：透明 Canvas，跟著桶形變形；LD / STATIC 下轉為單色。REC 圓點由 shader 畫（緩慢呼吸）。
//
// 色彩管線：
//   * render target 內是場景線性 HDR（three 渲染到 render target 時不做 tone mapping）。
//   * 螢幕畫面在「顯示空間」（0..1 的顯示線性值）中設計：HD 先套用與 renderer 相同的 ACES 曲線，
//     LD 再加上監視器自己的對比曲線；OSD、掃描線、暈影也都在顯示空間合成。
//   * 最後以 ACES 的精確反函數（uInvTone = 1，renderer 使用 ACESFilmicToneMapping 時）轉回場景線性輸出 ——
//     這樣經過 OutputPass（或直接上螢幕時的 tonemapping_fragment）之後，看到的就是設計好的顯示值。
//   * 結尾 include tonemapping/colorspace chunk：渲染到 render target（EffectComposer）時是 no-op。
// =============================================================================
import * as THREE from 'three';

export const CRT_MODE = { OFF: 0, LD: 1, STATIC: 2, BOOT: 3, HD: 4 };

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// three r170 ACESFilmicToneMapping 使用的矩陣（GLSL 欄優先）
const ACES_IN_COLS = [[0.59719, 0.07600, 0.02840], [0.35458, 0.90834, 0.13383], [0.04823, 0.01566, 0.83777]];
const ACES_OUT_COLS = [[1.60475, -0.10208, -0.00327], [-0.53108, 1.10813, -0.07276], [-0.07367, -0.00605, 1.07602]];
function matFromCols(cols) {
  const m = new THREE.Matrix3();
  m.set(cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]);
  return m;
}
const ACES_IN_INV = matFromCols(ACES_IN_COLS).invert();
const ACES_OUT_INV = matFromCols(ACES_OUT_COLS).invert();

const commonGLSL = /* glsl */`
uniform mat3 uAcesInInv;
uniform mat3 uAcesOutInv;
uniform float uInvTone;
uniform float uToneExposure;
const mat3 CRT_ACES_IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
const mat3 CRT_ACES_OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
vec3 crtRrtFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 crtRrtFitInv(vec3 y) {
  y = clamp(y, 0.0, 0.985);
  vec3 a = 0.983729 * y - 1.0;
  vec3 b = 0.432951 * y - 0.0245786;
  vec3 c = 0.238081 * y + 0.000090537;
  return (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
}
// 場景線性 → 顯示線性（與 renderer 的 ACES 相同）
vec3 sceneToDisplay(vec3 x) {
  x = max(x, 0.0) / 0.6;
  return clamp(CRT_ACES_OUT * crtRrtFit(CRT_ACES_IN * x), 0.0, 1.0);
}
float sceneToDisplay1(float x) {
  x = max(x, 0.0) / 0.6;
  return clamp(crtRrtFit(vec3(x)).x, 0.0, 1.0);
}
// 顯示線性 → 場景線性（上式的反函數；renderer 不是 ACES 時直接輸出顯示值）
vec3 displayToScene(vec3 y) {
  if (uInvTone < 0.5) return y;
  vec3 v = crtRrtFitInv(clamp(uAcesOutInv * y, 0.0, 0.985));
  return max(uAcesInInv * v, 0.0) * 0.6 / max(uToneExposure, 1e-3);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// 映像管曲面：螢幕座標 → 影像座標（邊緣先到達影像邊界 → 圓角黑邊）
vec2 barrel(vec2 uv, float k) {
  vec2 c = uv * 2.0 - 1.0;
  c *= 1.0 + k * vec2(c.y * c.y, c.x * c.x);
  return c * 0.5 + 0.5;
}
// 圓角矩形的映像管遮罩（柔邊）
float tubeMask(vec2 uv, float soft) {
  vec2 c = abs(uv * 2.0 - 1.0);
  vec2 q = max(c - (1.0 - 0.09), 0.0);
  float d = length(q) - 0.09 + max(max(c.x, c.y) - 1.0, 0.0);
  return 1.0 - smoothstep(-soft, 0.0, d);
}
// 玻璃：極淡的反光漸層（螢幕關著時唯一看得到的東西）
vec3 glassSheen(vec2 g) {
  float sheen = exp(-pow((g.x * 0.8 + (1.0 - g.y) * 0.6 - 0.32) / 0.12, 2.0)) * 0.6;
  return vec3(0.0030, 0.0036, 0.0042) * (0.35 + 0.65 * g.y) + vec3(0.0035, 0.0038, 0.0044) * sheen;
}
`;

const fragmentShader = /* glsl */`
uniform sampler2D tFeed;
uniform sampler2D tPrev;
uniform sampler2D tOSD;
uniform sampler2D tOSDPrev;
uniform float uTime;
uniform float uMode;
uniform float uPrevMode;
uniform float uModeMix;
uniform float uBoot;
uniform float uSwitch;
uniform float uSwitchSeed;
uniform float uReduceFlicker;
uniform float uExposure;
uniform float uPrevExposure;
uniform float uAGC;           // 自動增益：切換頻道後讓新畫面的平均亮度由舊畫面的水準緩慢回到正常
uniform float uPrevAGC;       // 舊畫面（tPrev）被換掉那一刻的增益：過場中的舊畫面維持它原本被顯示的亮度（連按不會閃）
uniform float uOSDOn;
uniform float uOSDPrevOn;
uniform vec4 uRec;            // xy = OSD uv 中心, z = 半徑（高度比例）, w = 啟用
uniform vec2 uFeedRes;        // 640×480
uniform vec2 uLDRes;          // 160×120
uniform vec3 uTintLD;         // 單色磷光（略帶藍白）
uniform float uWhite;         // 顯示白點（CRT 最亮處的顯示線性值）
uniform float uBrightness;    // 整體亮度（主控室腐化/毀損時可壓低）
uniform float uGlass;         // 玻璃反光強度
uniform float uCurvature;
varying vec2 vUv;

${commonGLSL}

// ---- LD：低頻寬黑白監視畫面（回傳顯示線性值）---------------------------------
vec3 ldImage(sampler2D tex, vec2 uv, float exposure) {
  float t = uTime;
  // 滾動干擾帶（約 6 秒一圈，由上往下）
  float by = 1.0 - fract(t / 6.2);
  float dy = uv.y - by; dy -= floor(dy + 0.5);
  float band = exp(-dy * dy / (2.0 * 0.04 * 0.04));
  float line = floor(uv.y * uLDRes.y);
  float fr10 = floor(t * 10.0);
  float jit = (hash12(vec2(line, fr10)) - 0.5) * (0.0012 + band * 0.0065) * (1.0 - 0.6 * uReduceFlicker);
  vec2 suv = vec2(uv.x + jit, uv.y);
  vec2 cell = floor(suv * uLDRes);
  vec2 cuv = (cell + 0.5) / uLDRes;
  vec2 px = 1.0 / uFeedRes;
  // 4 個雙線性取樣 = 每格 4×4 texel 的盒狀平均（穩定、不閃爍的降採樣）
  vec3 c = texture2D(tex, cuv + vec2(-px.x, -px.y)).rgb + texture2D(tex, cuv + vec2(px.x, -px.y)).rgb
         + texture2D(tex, cuv + vec2(-px.x, px.y)).rgb + texture2D(tex, cuv + vec2(px.x, px.y)).rgb;
  float v = luma(c) * 0.25 * exposure;
  // 類比鬼影（右側偏移的淡影）與亮部暈光
  vec2 cs = 1.0 / uLDRes;
  float ghost = luma(texture2D(tex, cuv - vec2(cs.x * 2.5, 0.0)).rgb) * exposure;
  float halo = luma(texture2D(tex, cuv + vec2(cs.x * 2.0, 0.0)).rgb + texture2D(tex, cuv - vec2(cs.x * 2.0, 0.0)).rgb
                  + texture2D(tex, cuv + vec2(0.0, cs.y * 2.0)).rgb + texture2D(tex, cuv - vec2(0.0, cs.y * 2.0)).rgb) * 0.25 * exposure;
  v += ghost * 0.05 + max(halo - 1.2, 0.0) * 0.12;
  // 攝影機響應：ACES 曲線 → 感知空間 → 壓黑＋S 曲線（CCTV 的硬對比）
  float p = pow(sceneToDisplay1(v), 0.4545);
  p = clamp((p - 0.05) / 0.93, 0.0, 1.0);
  p = mix(p, p * p * (3.0 - 2.0 * p), 0.5);
  // 時間顆粒（每格；光敏感模式：低振幅、約 6fps 交叉淡化）
  float g;
  if (uReduceFlicker > 0.5) {
    float f = t * 6.0; float fi = floor(f);
    g = mix(hash12(cell + fi * vec2(13.7, 7.3)), hash12(cell + (fi + 1.0) * vec2(13.7, 7.3)), fract(f)) - 0.5;
    g *= 0.04;
  } else {
    float fr = floor(t * 24.0);
    g = (hash12(cell + fr * vec2(13.7, 7.3)) - 0.5) * 0.075;
  }
  // 干擾帶內：微亮＋水平雜訊
  float bn = (hash12(vec2(cell.x * 0.37, line) + fr10 * 3.1) - 0.5) * 0.07 * (1.0 - 0.6 * uReduceFlicker);
  p += g * (0.6 + 0.4 * p) + band * (0.04 + bn);
  // 黑位微微浮起（CCTV 從來不是全黑）
  p = clamp(p, 0.0, 1.0) * 0.95 + 0.035;
  return vec3(pow(p, 2.2)) * uTintLD;
}

// ---- STATIC：雪花（低對比、平均亮度固定）------------------------------------
vec3 staticImage(vec2 uv) {
  float t = uTime;
  float p;
  if (uReduceFlicker > 0.5) {
    float f = t * 6.0; float fi = floor(f);
    vec2 q = uv * vec2(90.0, 64.0) + vec2(t * 0.8, t * 0.3);
    float n = mix(vnoise(q + fi * 17.0), vnoise(q + (fi + 1.0) * 17.0), fract(f));
    p = 0.30 + (n - 0.5) * 0.10;
  } else {
    vec2 res = vec2(330.0, 250.0);
    vec2 cell = floor(uv * res);
    float fr = floor(t * 24.0);
    float n = hash12(cell + fr * vec2(31.7, 17.3));
    // 水平拖尾：同一掃描線上較長的條紋
    float n2 = hash12(vec2(floor(cell.x / 6.0), cell.y) + fr * vec2(5.1, 9.7));
    n = mix(n, n2, 0.4);
    p = 0.30 + (n - 0.5) * 0.24;
  }
  // 緩慢上滾的暗帶（只是 ±4% 的起伏）
  float by = fract(t / 4.8);
  float dy = uv.y - by; dy -= floor(dy + 0.5);
  p -= exp(-dy * dy / (2.0 * 0.05 * 0.05)) * 0.04;
  p += exp(-pow((uv.y - fract(by + 0.5)) / 0.12, 2.0)) * 0.02;
  return vec3(pow(clamp(p, 0.0, 1.0), 2.2)) * vec3(0.93, 0.97, 1.0);
}

// ---- HD：彩色、乾淨 ----------------------------------------------------------
vec3 hdImage(sampler2D tex, vec2 uv, float exposure) {
  vec2 px = 1.0 / uFeedRes;
  vec3 c = texture2D(tex, uv).rgb;
  // 極輕微的類比色彩滲漏
  c.r = mix(c.r, texture2D(tex, uv + vec2(px.x * 1.2, 0.0)).r, 0.3);
  c.b = mix(c.b, texture2D(tex, uv - vec2(px.x * 1.2, 0.0)).b, 0.3);
  vec3 d = sceneToDisplay(c * exposure);
  // 極淡顆粒
  float fr = floor(uTime * 30.0);
  float g = hash12(floor(uv * uFeedRes) + fr * vec2(11.3, 5.7)) - 0.5;
  d *= 1.0 + g * mix(0.06, 0.02, uReduceFlicker);
  return d + 0.0015;
}

// ---- BOOT：開機程序 ----------------------------------------------------------
vec3 bootImage(vec2 uv, float k) {
  vec2 c = uv - 0.5;
  c.x *= 1.3333;
  vec3 tint = vec3(0.86, 0.93, 1.0);
  // 1) 中央亮點（0 → 0.2）
  float dotA = smoothstep(0.0, 0.13, k) * (1.0 - smoothstep(0.17, 0.24, k));
  float r = 0.006 + 0.01 * smoothstep(0.0, 0.16, k);
  float dotv = dotA * exp(-dot(c, c) / (r * r)) * 0.9;
  // 2) 水平亮線展開（0.17 → 0.34）
  float lw = smoothstep(0.17, 0.34, k) * 0.68;
  float lineA = step(0.17, k) * (1.0 - smoothstep(0.38, 0.47, k));
  float lh = 0.0035 + 0.002 * smoothstep(0.3, 0.4, k);
  float linev = lineA * smoothstep(lw + 0.02, lw - 0.03, abs(c.x)) * exp(-c.y * c.y / (lh * lh)) * 0.8;
  // 3) 垂直展開成全畫面光柵（0.34 → 0.62），帶微弱的雜訊
  float vh = smoothstep(0.34, 0.62, k) * 0.5;
  float rasterA = step(0.34, k) * smoothstep(vh + 0.004, vh - 0.012, abs(uv.y - 0.5));
  float rn = vnoise(uv * vec2(160.0, 120.0) + floor(uTime * 12.0) * 7.0);
  float raster = rasterA * (0.013 + rn * 0.006 + 0.005 * smoothstep(0.5, 0.0, abs(uv.y - 0.5)));
  // 映像管預熱的微光（避免整個程序經過全黑再亮起來的大幅亮度變化）
  float warm = 0.0045 * smoothstep(0.0, 0.25, k);
  return vec3(dotv + linev + max(raster, warm)) * tint;
}

vec3 screenImage(float mode, sampler2D tex, vec2 uv, float exposure) {
  if (mode < 0.5) return vec3(0.0);
  if (mode < 1.5) return ldImage(tex, uv, exposure);
  if (mode < 2.5) return staticImage(uv);
  if (mode < 3.5) {
    vec3 b = bootImage(uv, uBoot);
    float toHD = smoothstep(0.7, 1.0, uBoot);
    if (toHD > 0.0) b = mix(b, hdImage(tex, uv, exposure), toHD);
    return b;
  }
  return hdImage(tex, uv, exposure);
}

float scanAmount(float mode) {
  if (mode < 0.5) return 0.0;
  if (mode < 1.5) return 0.26;
  if (mode < 2.5) return 0.2;
  if (mode < 3.5) return 0.2 - 0.14 * smoothstep(0.7, 1.0, uBoot);
  return 0.06;
}

void osdLayer(sampler2D osd, vec2 uv, float on, float mode, inout vec3 col) {
  vec4 o = texture2D(osd, uv);
  vec3 oc = o.rgb;
  if (mode < 2.5) oc = vec3(luma(oc)) * uTintLD;   // LD / STATIC：單色
  col = mix(col, oc * 0.78, o.a * on);
}

void main() {
  vec2 uv = barrel(vUv, uCurvature);
  float mask = tubeMask(uv, 0.035);

  // ---- 頻道切換：垂直滾動＋撕裂（uSwitch 1→0）----
  float sw = clamp(uSwitch, 0.0, 1.0);
  float swk = sin(3.14159265 * sw);
  vec2 fuv = uv;
  float vbi = 1.0;
  if (sw > 0.0) {
    float fr = floor(uTime * 30.0);
    float yy = uv.y + swk * 0.16;
    fuv.y = fract(yy);
    // 垂直遮沒區：滾過畫面的一條細暗帶
    vbi = 1.0 - (1.0 - smoothstep(0.0, 0.025, fuv.y)) * swk * 0.85;
    float ln = floor(fuv.y * 240.0);
    fuv.x += (hash12(vec2(ln, fr + uSwitchSeed)) - 0.5) * 0.035 * swk;
  }

  vec3 col = screenImage(uMode, tFeed, fuv, uExposure) * uAGC;
  if (sw > 0.0) {
    vec3 pc = screenImage(uMode, tPrev, fuv, uPrevExposure) * uPrevAGC;
    col = mix(col, pc, smoothstep(0.3, 0.7, sw));
    // 平均為零的撕裂雜訊（不改變整體亮度）
    float n = hash12(floor(fuv * vec2(200.0, 150.0)) + floor(uTime * 30.0) * 3.7) - 0.5;
    col *= (1.0 + n * 0.45 * swk * (1.0 - 0.6 * uReduceFlicker)) * vbi;
  }
  if (uModeMix < 0.999) {
    vec3 pm = screenImage(uPrevMode, tPrev, uv, uPrevExposure) * uPrevAGC;
    col = mix(pm, col, smoothstep(0.0, 1.0, uModeMix));
  }

  // ---- OSD ----
  float osdOn = uOSDOn * uModeMix;
  if (sw > 0.0) {
    float k = smoothstep(0.3, 0.7, sw);
    osdLayer(tOSDPrev, uv, uOSDOn * k, uMode, col);
    osdLayer(tOSD, uv, uOSDOn * (1.0 - k), uMode, col);
  } else {
    if (uModeMix < 0.999) osdLayer(tOSDPrev, uv, uOSDPrevOn * (1.0 - uModeMix), uPrevMode, col);
    osdLayer(tOSD, uv, osdOn, uMode, col);
  }
  // REC 圓點（緩慢呼吸，週期 1.8 秒；光敏感模式 3.6 秒、振幅更小）
  if (uRec.w > 0.0) {
    vec2 d = (uv - uRec.xy) * vec2(1.3333, 1.0);
    float rr = uRec.z;
    float dotm = 1.0 - smoothstep(rr * 0.75, rr, length(d));
    float period = mix(1.8, 3.6, uReduceFlicker);
    float pulse = mix(0.6, 0.8, uReduceFlicker) + mix(0.4, 0.2, uReduceFlicker) * sin(uTime * 6.2831853 / period);
    vec3 rc = uMode > 3.5 ? vec3(0.8, 0.06, 0.04) : uTintLD * 0.62;
    col = mix(col, rc * pulse, dotm * uRec.w * osdOn);
  }

  // ---- 掃描線（依螢幕上的線距自動淡出，避免摩爾紋）----
  float lines = 240.0;
  float fw = fwidth(uv.y * lines);
  float amt = mix(scanAmount(uPrevMode), scanAmount(uMode), uModeMix) * (1.0 - smoothstep(0.35, 0.85, fw));
  float sl = 0.5 + 0.5 * cos(uv.y * lines * 6.2831853);
  col *= (1.0 - amt * sl) * (1.0 + amt * 0.5);

  // ---- 映像管內暈影、白點、整體亮度 ----
  vec2 vc = uv - 0.5;
  float vig = 1.0 - smoothstep(0.18, 0.62, length(vc * vec2(1.0, 1.12))) * 0.42;
  col = min(col * uWhite, vec3(0.97)) * vig * mask * uBrightness;
  col += glassSheen(vUv) * uGlass;

  gl_FragColor = vec4(displayToScene(col), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function toneUniforms() {
  return {
    uAcesInInv: { value: ACES_IN_INV.clone() },
    uAcesOutInv: { value: ACES_OUT_INV.clone() },
    uInvTone: { value: 1 },
    uToneExposure: { value: 1 },
  };
}

/** 依 renderer 目前的 tone mapping 設定更新反函數 uniforms（每幀呼叫即可）。 */
export function syncToneUniforms(material, renderer) {
  const u = material.uniforms;
  if (!u?.uInvTone || !renderer) return;
  u.uInvTone.value = renderer.toneMapping === THREE.ACESFilmicToneMapping ? 1 : 0;
  u.uToneExposure.value = renderer.toneMappingExposure || 1;
}

/** 主 CRT 螢幕材質。 */
export function createCRTMaterial({ feed = null, prev = null, osd = null, osdPrev = null, feedRes = [640, 480], ldRes = [160, 120] } = {}) {
  return new THREE.ShaderMaterial({
    name: 'CRTScreen',
    uniforms: {
      ...toneUniforms(),
      tFeed: { value: feed },
      tPrev: { value: prev },
      tOSD: { value: osd },
      tOSDPrev: { value: osdPrev },
      uTime: { value: 0 },
      uMode: { value: CRT_MODE.OFF },
      uPrevMode: { value: CRT_MODE.OFF },
      uModeMix: { value: 1 },
      uBoot: { value: 0 },
      uSwitch: { value: 0 },
      uSwitchSeed: { value: 0 },
      uReduceFlicker: { value: 0 },
      uExposure: { value: 1 },
      uPrevExposure: { value: 1 },
      uAGC: { value: 1 },
      uPrevAGC: { value: 1 },
      uOSDOn: { value: 0 },
      uOSDPrevOn: { value: 0 },
      uRec: { value: new THREE.Vector4(0.9, 0.9, 0.012, 0) },
      uFeedRes: { value: new THREE.Vector2(feedRes[0], feedRes[1]) },
      uLDRes: { value: new THREE.Vector2(ldRes[0], ldRes[1]) },
      uTintLD: { value: new THREE.Color(0.86, 0.93, 1.0) },
      uWhite: { value: 0.9 },
      uBrightness: { value: 1 },
      uGlass: { value: 1 },
      uCurvature: { value: 0.045 },
    },
    vertexShader,
    fragmentShader,
    toneMapped: true,
  });
}

// =============================================================================
// 側邊系統監視器：磷光終端機（綠/琥珀/紅字在深色底上、掃描線、輝光、輕微曲面）
// tText：文字/標題列的 alpha Canvas（顏色由 uTone 決定）。顯示空間設計、輸出前反 tone mapping。
// =============================================================================
const termFragment = /* glsl */`
uniform sampler2D tText;
uniform float uTime;
uniform float uOn;
uniform float uReduceFlicker;
uniform vec3 uTone;
uniform vec4 uCursor;      // 游標矩形（uv：x0,y0,x1,y1）
uniform vec2 uTexel;
uniform float uBrightness;
uniform float uSnow;       // 0 = 文字畫面，1 = 訊號中斷的雪花（低對比、平均亮度與文字畫面相近；由 SideScreen 平滑過渡）
varying vec2 vUv;
${commonGLSL}
// 終端機的雪花：與主 CRT 的 STATIC 同一種低對比雜訊（平均亮度接近一整頁文字＋標題列的平均亮度）
vec3 termSnow(vec2 uv) {
  float t = uTime, p;
  if (uReduceFlicker > 0.5) {
    float f = t * 6.0; float fi = floor(f);
    vec2 q = uv * vec2(80.0, 60.0) + vec2(t * 0.7, t * 0.25);
    float n = mix(vnoise(q + fi * 17.0), vnoise(q + (fi + 1.0) * 17.0), fract(f));
    p = 0.29 + (n - 0.5) * 0.07;
  } else {
    vec2 cell = floor(uv * vec2(260.0, 196.0));
    float fr = floor(t * 24.0);
    float n = hash12(cell + fr * vec2(23.1, 41.7));
    float n2 = hash12(vec2(floor(cell.x / 5.0), cell.y) + fr * vec2(7.3, 3.9));
    n = mix(n, n2, 0.4);
    p = 0.29 + (n - 0.5) * 0.16;
  }
  float by = fract(t / 5.6);
  float dy = uv.y - by; dy -= floor(dy + 0.5);
  p -= exp(-dy * dy / (2.0 * 0.05 * 0.05)) * 0.03;
  // 磷光色調（去飽和）：單色終端機的雪花帶一點螢光粉的顏色
  vec3 tint = mix(vec3(0.9, 0.95, 1.0), uTone / max(max(uTone.r, uTone.g), uTone.b), 0.45);
  return vec3(pow(clamp(p, 0.0, 1.0), 2.2)) * tint;
}
void main() {
  vec2 uv = barrel(vUv, 0.035);
  float mask = tubeMask(uv, 0.03);
  float a = texture2D(tText, uv).a;
  // 磷光輝光：周圍取樣
  vec2 o1 = uTexel * 1.6, o2 = uTexel * 4.0;
  float glow = (texture2D(tText, uv + vec2(o1.x, 0.0)).a + texture2D(tText, uv - vec2(o1.x, 0.0)).a
             + texture2D(tText, uv + vec2(0.0, o1.y)).a + texture2D(tText, uv - vec2(0.0, o1.y)).a) * 0.25;
  float glow2 = (texture2D(tText, uv + vec2(o2.x, o2.y)).a + texture2D(tText, uv - vec2(o2.x, o2.y)).a
              + texture2D(tText, uv + vec2(o2.x, -o2.y)).a + texture2D(tText, uv - vec2(o2.x, -o2.y)).a) * 0.25;
  // 游標：緩慢呼吸（週期 1.6 秒；光敏感模式：恆亮）
  float inC = step(uCursor.x, uv.x) * step(uv.x, uCursor.z) * step(uCursor.y, uv.y) * step(uv.y, uCursor.w);
  float cur = inC * mix(0.55 + 0.45 * sin(uTime * 6.2831853 / 1.6), 0.8, uReduceFlicker);
  float v = a * 0.62 + glow * 0.16 + glow2 * 0.07 + cur * 0.55;
  vec3 col = uTone * v + uTone * 0.006 + vec3(0.002, 0.003, 0.0025);
  if (uSnow > 0.001) col = mix(col, termSnow(uv), clamp(uSnow, 0.0, 1.0));
  // 掃描線
  float lines = 200.0;
  float fw = fwidth(uv.y * lines);
  float amt = 0.28 * (1.0 - smoothstep(0.35, 0.85, fw));
  col *= (1.0 - amt * (0.5 + 0.5 * cos(uv.y * lines * 6.2831853))) * (1.0 + amt * 0.5);
  // 極緩慢的亮度起伏（≤ 3%，週期 7 秒）
  col *= 1.0 + 0.03 * sin(uTime * 0.9) * (1.0 - uReduceFlicker);
  vec2 vc = uv - 0.5;
  col *= (1.0 - smoothstep(0.2, 0.65, length(vc)) * 0.4) * mask * uOn * uBrightness;
  col += glassSheen(vUv);
  gl_FragColor = vec4(displayToScene(min(col, vec3(0.97))), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** 側邊磷光終端機材質。 */
export function createTerminalMaterial(textTexture, { texel = [1 / 512, 1 / 384] } = {}) {
  return new THREE.ShaderMaterial({
    name: 'CRTTerminal',
    uniforms: {
      ...toneUniforms(),
      tText: { value: textTexture },
      uTime: { value: 0 },
      uOn: { value: 0 },
      uReduceFlicker: { value: 0 },
      uTone: { value: new THREE.Color(0.32, 1.0, 0.5) },
      uCursor: { value: new THREE.Vector4(0, 0, 0, 0) },
      uTexel: { value: new THREE.Vector2(texel[0], texel[1]) },
      uBrightness: { value: 1 },
      uSnow: { value: 0 },
    },
    vertexShader,
    fragmentShader: termFragment,
    toneMapped: true,
  });
}

/** 方便其他模組（例如 debug 全螢幕檢視）重用的著色器原始碼 */
export const CRTShader = { vertexShader, fragmentShader, modes: CRT_MODE };
