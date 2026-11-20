// =============================================================================
// PostFX — EffectComposer 後期處理
// 【API 骨架 / CONTRACT STUB】
// 管線：RenderPass(scene, camera) → 自訂 ShaderPass（暈影 vignette、底片顆粒 film grain、
//       微弱色差 chromatic、淡入淡出 fade、背景變暗 dim、去飽和 desaturate、濃煙 smoke、色調 tint）→ OutputPass
// （場景本身使用 FogExp2 指數霧，由各區域設定 scene.fog.density / color。）
// 光敏感模式（ctx.settings.get('reduceFlicker')）：顆粒改為低振幅、低更新率；色差關閉。
// -----------------------------------------------------------------------------
// 實作說明：
//   * EffectComposer 使用 HalfFloat 目標（線性 HDR）；場景目標啟用 2× MSAA（canvas 本身不開反鋸齒），
//     中間目標不做 MSAA。最終 ShaderPass 在 tone mapping 之前（線性色彩）運算，OutputPass 負責 ACES + sRGB。
//   * 為了讓「數值變化 ≒ 畫面亮度變化」（配合 0.25 秒內亮度變化 ≤ 30% 的規則），fade 換算成
//     tone mapping 前的乘數 (1 - fade)^1.15（dim 為 (1 - 0.9·dim)^1.3，0.78 時背景約剩 1/4 亮度）：
//     three 的 ACES 曲線在暗部近乎線性（並有硬黑截斷），
//     實測這個主控室的亮度範圍內 fade 0.5 ≒ 畫面看起來一半亮（若用 γ2.2 換算，fade 0.5 只剩約 23%，
//     淡入會在最後一段才突然亮起來）。暈影仍以感知空間 (v^2.2) 塑形。
//   * 顆粒：在感知空間加上、依亮度加權（中間調最明顯、亮部減弱、純黑幾乎沒有），尺寸隨解析度縮放（4K 不會變成細砂）。
//     光敏感模式：振幅 40%、約每秒 6 次才換一次顆粒圖樣；色差關閉。
//   * smoke：畫面柔化（光源在煙中暈開）＋往褐灰色煙霾混合（低頻雜訊緩慢飄移，上方較濃）＋整體變暗。
//   * dim：檢視物品時的背景 — 柔化、去飽和、變暗。
//   * to(param, …)：同一參數的新補間會接手舊補間（舊的停止寫入，但其 Promise 仍在原本的時間點 resolve）。
//     tint 可用 THREE.Color 補間。
// =============================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

/** params.dim → 背景亮度乘數（shader 的 uDimMul）。InspectView 以此換算，讓「亮度」而不是 dim 值呈對數等速變化。 */
export const dimToBrightness = (dim) => Math.pow(1 - 0.9 * clamp01(dim), 1.3);
/** dimToBrightness 的反函數。 */
export const brightnessToDim = (b) => clamp01((1 - Math.pow(Math.min(1, Math.max(1e-4, Number(b) || 0)), 1 / 1.3)) / 0.9);

const FinalShader = {
  name: 'BlindSpotFinalShader',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uTime: { value: 0 },
    uSeed: { value: 0 },
    uGrainScale: { value: 1.25 },
    uVignette: { value: 0.42 },
    uGrain: { value: 0.07 },
    uChromatic: { value: 0.4 },
    uFadeMul: { value: 0 },
    uDim: { value: 0 },
    uDimMul: { value: 1 },
    uDesat: { value: 0 },
    uSmoke: { value: 0 },
    uSoft: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uExposure: { value: 1 },
    uSmokeColor: { value: new THREE.Color(0.044, 0.036, 0.028) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uSeed;
    uniform float uGrainScale;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uChromatic;
    uniform float uFadeMul;
    uniform float uDim;
    uniform float uDimMul;
    uniform float uDesat;
    uniform float uSmoke;
    uniform float uSoft;
    uniform vec3 uTint;
    uniform float uExposure;
    uniform vec3 uSmokeColor;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float vnoise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
      float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float aspect = uResolution.x / max(uResolution.y, 1.0);

      // ---- 取樣（含微弱徑向色差）----
      vec3 col;
      if (uChromatic > 0.001) {
        vec2 off = d * dot(d, d) * uChromatic * 0.012;
        col.r = texture2D(tDiffuse, uv + off).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - off * 0.85).b;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }

      // ---- 柔化（濃煙中的光暈 / 檢視時的背景）：每像素旋轉的 12 點圓盤取樣 ----
      vec3 soft = col;
      if (uSoft > 0.001) {
        vec2 px = 1.0 / uResolution;
        float rad = (1.5 + 11.0 * uSoft) * (uResolution.y / 1080.0);
        float rot = hash12(gl_FragCoord.xy) * 6.2831853;
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 12; i++) {
          float fi = float(i);
          float a = fi * 2.3999632 + rot;
          float rr = rad * sqrt((fi + 0.5) / 12.0);
          acc += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * rr * px).rgb;
        }
        soft = acc / 12.0;
        col = mix(col, soft, clamp(uSoft * 1.15, 0.0, 0.9));
      }

      col *= uExposure;
      soft *= uExposure;
      col *= uTint;

      // ---- 去飽和 ----
      col = mix(col, vec3(luma(col)), clamp(uDesat, 0.0, 1.0));

      // ---- 濃煙：褐灰煙霾＋低頻雜訊緩慢飄移（上方較濃）----
      if (uSmoke > 0.001) {
        vec2 sp = vec2(d.x * aspect, d.y) * 1.7;
        float n = vnoise(sp * 1.25 + vec2(uTime * 0.031, -uTime * 0.052)) * 0.62
                + vnoise(sp * 3.1 + vec2(-uTime * 0.047, -uTime * 0.083) + 7.3) * 0.38;
        float dens = uSmoke * (0.7 + 0.6 * (n - 0.5) + 0.22 * uv.y);
        vec3 haze = uSmokeColor * (0.5 + 0.9 * n) + soft * uTint * 0.3;   // 光源在煙裡暈開
        col = mix(col, haze, clamp(dens, 0.0, 0.94));
        col *= 1.0 - 0.42 * uSmoke;
      }

      // ---- 檢視背景變暗：去飽和＋變暗 ----
      if (uDim > 0.001) {
        col = mix(col, vec3(luma(col)), uDim * 0.42);
        col *= uDimMul;
      }

      // ---- 暈影：中央大部分不受影響，往四角平滑變暗（預設 0.42：桌面角落約 -20%、畫面最角落約 -40%）----
      if (uVignette > 0.001) {
        float vr = length(vec2(d.x * mix(1.0, aspect, 0.35), d.y));
        float v = 1.0 - uVignette * 0.7 * smoothstep(0.34, 0.96, vr);
        col *= pow(max(v, 0.0), 2.2);
      }

      // ---- 底片顆粒：感知空間、依亮度加權（中間調最明顯；純黑與高光幾乎沒有）----
      // 兩層：約 1.3 px 的柔和顆粒團（value noise）＋每像素的細顆粒（三角分佈），單色。
      // 預設 0.07 → 中間調標準差約 3.5/255，足以有底片質感又不會吃掉貼圖細節。
      if (uGrain > 0.0005) {
        vec2 fc = gl_FragCoord.xy;
        vec2 gp = fc / uGrainScale + vec2(uSeed * 37.0, uSeed * 59.0);
        float clump = vnoise(gp) - 0.5;
        float fine = hash12(fc + uSeed * 113.0) + hash12(fc.yx * 1.31 + uSeed * 71.0 + 17.0) - 1.0;
        float g = clump * 0.62 + fine * 0.3;
        vec3 pc = pow(max(col, 0.0), vec3(1.0 / 2.2));
        float pl = luma(pc);
        float w = smoothstep(0.015, 0.22, pl) * (1.0 - 0.55 * smoothstep(0.55, 1.0, pl));
        pc += g * uGrain * 1.05 * w;
        col = pow(max(pc, 0.0), vec3(2.2));
      }

      // ---- 淡出（1 = 全黑；乘數見 render()）----
      col *= uFadeMul;

      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class PostFX {
  constructor(ctx) {
    this.ctx = ctx;
    /** 全部 0..1（tint 為顏色乘數）。直接改值即生效；要平滑請用 to()。 */
    this.params = { vignette: 0.42, grain: 0.07, chromatic: 0.4, fade: 1, dim: 0, desaturate: 0, smoke: 0, tint: new THREE.Color(1, 1, 1), exposure: 1 };
    /** 濃煙煙霾的顏色（線性；可由狀態調整）。 */
    this.smokeColor = new THREE.Color(0.044, 0.036, 0.028);
    this.enabled = true;
    this._tweenTok = {};
    this._seed = 0;
    this._seedStep = -1;
    this._failed = false;

    const r = ctx.renderer;
    const pr = r.getPixelRatio();
    const size = r.getSize(new THREE.Vector2());
    // 場景目標：HalfFloat + MSAA（composer 會把它 clone 成第二個目標）
    // 沒有 EXT_color_buffer_float 時，HalfFloat 的多重取樣緩衝可能不完整 → 不用 MSAA
    let floatMSAA = true;
    try { floatMSAA = !!r.extensions?.has?.('EXT_color_buffer_float'); } catch (e) { floatMSAA = false; }
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), {
      type: THREE.HalfFloatType,
      samples: floatMSAA ? 2 : 0,   // 2× MSAA：場景多為柔和的暗部，4× 的額外成本在內顯上不划算
    });
    rt.texture.name = 'PostFX.rt';
    this.composer = new EffectComposer(r, rt);
    // RenderPass 永遠寫入 readBuffer（= renderTarget2，保留 MSAA）；renderTarget1 只給全螢幕 pass 用，不需要 MSAA
    this.composer.renderTarget1.samples = 0;

    this.renderPass = new RenderPass(ctx.scene, ctx.camera);
    this.finalPass = new ShaderPass(FinalShader);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.finalPass);
    this.composer.addPass(this.outputPass);
    this.setSize(size.x, size.y);
  }

  init() {}

  /** 平滑改變參數（遊戲時間）。@returns {Promise<void>} */
  to(param, value, duration = 1, ease = 'inOut') {
    const p = this.params;
    const tok = (this._tweenTok[param] = (this._tweenTok[param] || 0) + 1);
    if (param === 'tint' || p[param]?.isColor) {
      const from = (p[param]?.isColor ? p[param] : new THREE.Color(1, 1, 1)).clone();
      const target = value?.isColor ? value.clone() : new THREE.Color(value);
      if (!p[param]?.isColor) p[param] = from.clone();
      const out = p[param];
      return this.ctx.clock.tween(duration, (k) => {
        if (this._tweenTok[param] === tok) out.copy(from).lerp(target, k);
      }, ease);
    }
    const from = Number(p[param]) || 0;
    const to = Number(value) || 0;
    return this.ctx.clock.tween(duration, (k) => {
      if (this._tweenTok[param] === tok) p[param] = from + (to - from) * k;
    }, ease);
  }

  /** fade 1 = 全黑，0 = 正常。@returns {Promise<void>} */
  fadeTo(value, duration = 1, ease = 'inOut') { return this.to('fade', value, duration, ease); }

  setSize(w, h) {
    const r = this.ctx.renderer;
    const pr = r.getPixelRatio();
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    const u = this.finalPass.uniforms;
    u.uResolution.value.set(w * pr, h * pr);
    u.uGrainScale.value = 1.25 * Math.max(1, (h * pr) / 1080);
  }

  /** 畫面是否完全黑（fade ≥ 0.999）：此時不必渲染 3D 場景（標題、終幕選單/名單）。 */
  isBlack() { return clamp01(this.params.fade) >= 0.999; }

  render(dt, t) {
    const { renderer, scene, camera } = this.ctx;
    if (this.isBlack()) {
      // 全黑：只清除畫面（省下 RenderPass + MSAA + 後期）；fade 一降到 0.999 以下的那一幀就恢復完整渲染，
      // 那時亮度乘數 ≈ 0.0008，畫面仍是黑的，所以不會有跳變。
      renderer.setRenderTarget(null);
      renderer.getClearColor(this._cc || (this._cc = new THREE.Color()));
      const a = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, false);
      renderer.setClearColor(this._cc, a);
      return;
    }
    if (!this.enabled || this._failed) { renderer.render(scene, camera); return; }
    const p = this.params;
    const u = this.finalPass.uniforms;
    const calm = !!this.ctx.settings?.get?.('reduceFlicker');
    const real = this.ctx.clock?.realTime ?? (performance.now() / 1000);

    // 顆粒圖樣：一般每幀重新取樣；光敏感模式約 6 fps
    if (calm) {
      const step = Math.floor(real * 6);
      if (step !== this._seedStep) { this._seedStep = step; this._seed = Math.random() * 61; }
    } else {
      this._seed = Math.random() * 61;
    }

    const fade = clamp01(p.fade);
    const dim = clamp01(p.dim);
    const smoke = clamp01(p.smoke);
    u.uTime.value = Number.isFinite(t) ? t : real;
    u.uSeed.value = this._seed;
    u.uVignette.value = clamp01(p.vignette);
    u.uGrain.value = clamp01(p.grain) * (calm ? 0.4 : 1);
    u.uChromatic.value = calm ? 0 : Math.max(0, Number(p.chromatic) || 0);
    u.uFadeMul.value = Math.pow(1 - fade, 1.15);
    u.uDim.value = dim;
    u.uDimMul.value = dimToBrightness(dim);              // dim 0.78 → 背景約剩 1/5 亮度（檢視時物件與文字才跳得出來）
    u.uDesat.value = clamp01(p.desaturate);
    u.uSmoke.value = smoke;
    u.uSoft.value = Math.max(smoke * 0.62, dim * 0.85);
    if (p.tint?.isColor) u.uTint.value.copy(p.tint);
    else if (p.tint != null) u.uTint.value.set(p.tint);
    u.uExposure.value = Math.max(0, Number(p.exposure ?? 1));
    u.uSmokeColor.value.copy(this.smokeColor);

    // 相機若被替換（理論上不會），跟著更新
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    try {
      this.composer.render(dt);
    } catch (e) {
      console.error('[postfx] composer failed, falling back to direct render', e);
      this._failed = true;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }
}
