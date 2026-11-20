// =============================================================================
// InspectView — 物件檢視（「低頭檢視物品」）
// 【API 骨架 / CONTRACT STUB】
// 開啟時：背景變暗（postfx.params.dim），右/下方顯示標題＋內文（支援 **粗體** *斜體*，段落陣列），
// 若提供 object，於畫面中央以獨立小場景渲染其 clone（自身燈光），可用滑鼠拖曳/移動旋轉。
// 開啟期間：玩家無法移動與環顧、GazeSystem 視為「沒有在看監視器」（這是盲區機制的關鍵）。
// 關閉：E、Esc、滑鼠右鍵、在閱讀面板以外按左鍵（開啟後 0.4 秒內忽略，避免同一次點擊立刻關閉）。
//       在閱讀面板上按左鍵（選取文字、拖曳捲動條）不會關閉。
// 事件：'inspect:open' { id } / 'inspect:close' { id }
// -----------------------------------------------------------------------------
// 實作說明：
//   * 閱讀面板：寬螢幕在右側、窄螢幕為底部抽屜；深色紙張質感（Canvas 程式化紙紋）。
//     整段 *斜體* 的段落（日誌條目）以手寫楷體＋左側細線呈現，像被引用的手寫筆跡；行內 *斜體* 也用手寫字。
//   * 3D 物件：object.clone(true)（共用幾何與材質，不會被釋放），重設 transform、Box3 置中、自動縮放到約 0.4 m，
//     放進獨立 THREE.Scene（主光/補光/輪廓光），以自己的 PerspectiveCamera 渲染到 MSAA 的 HalfFloat RenderTarget，
//     再以一個帶 tone mapping＋sRGB 的全螢幕四邊形疊加到畫面左/中區域（可平滑淡入淡出）。
//   * 平放物件（日誌、錶）會先傾斜朝向鏡頭並緩慢左右擺動；立體物件緩慢自轉。滑鼠（含指標鎖定）移動可旋轉。
//   * 由輸入觸發的關閉延後到本幀最後（update）才執行：同一個 E/點擊事件不會又被 Interaction 拿去重新開啟。
//   * 暫停中（clock.paused）忽略關閉輸入（點擊暫停畫面繼續值班時不會順便關掉檢視）。
//   * 背景變暗：補間的是「亮度乘數」（對數等速、舒適曲線，變暗 1.6 秒／恢復 2.2 秒；光敏感模式 ×1.5），再換算回 dim，
//     所以任何 0.25 秒內背景亮度變化 < 30%（以前是 dim 值的 sine 補間，關閉時一幀就亮了近 50%）。
//   * 長文（日誌）超出面板高度時：底部淡出遮罩＋「滾輪捲動」提示，捲到底後消失；方向鍵/PageUp/PageDown 也能捲動。
//     矮視窗（高度 ≤ 620px）收緊字級與行距。
//   * 咖啡：以俯角檢視（看得到杯中的液面／浮灰／乾涸的焦痕），依 flags.coffeeStage 調整俯角。
// =============================================================================
import * as THREE from 'three';
import { FONTS, makeCanvas, makeNoise, fbm, speckle } from '../gfx/canvasUtil.js';
import { injectStyle, uiRoot, el, renderMarkup, isWhollyItalic, baseCss } from './uiCommon.js';
import { dimToBrightness, brightnessToDim } from '../gfx/PostFX.js';
import { comfortCurve } from './Flashlight.js';

const INPUT_GUARD_MS = 400;
const FIT_SIZE = 0.4;          // 物件最大邊自動縮放到約 0.4 m
const DIM_LEVEL = 0.78;
// 背景變暗時間（秒，整段 1 ↔ 0.21 亮度）：亮度乘數以對數等速＋舒適曲線變化（光敏感模式 ×1.5）。
// 實測畫面亮度的對數變化率約為乘數的 1.4～1.5 倍（ACES 暗部的趾部曲線＋關閉時 3D 物件先淡出、背景從更暗處回升），
// 所以恢復比變暗更慢：每 0.25 秒畫面亮度變化約 ≤ 26%。
const DIM_IN = 1.6, DIM_OUT = 2.2;
const DIM_FULL_LOG = Math.log(1 / dimToBrightness(DIM_LEVEL));
// 3D 物件與閱讀面板的淡入/淡出：物件常是畫面上最亮的東西（便利貼、日誌），關閉時它的消失本身就是亮度變化，
// 所以淡出要比淡入更慢（實測 0.7 秒時畫面 0.2 秒內暗了 32%）。
const FADE_IN = 0.8, FADE_OUT = 1.2;

const CSS = `
.bs-insp { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
.bs-insp__panel { position: absolute; right: max(2em, 5vw); top: 50%; width: min(31em, 40vw); max-height: 84vh;
  display: flex; flex-direction: column; pointer-events: auto; color: #d6d0c2;
  background-color: #15120e; background-repeat: repeat; background-size: 192px 192px;
  border: 1px solid rgba(217, 212, 199, 0.1);
  box-shadow: 0 1.6em 4.5em rgba(0, 0, 0, 0.7), inset 0 0 3.2em rgba(0, 0, 0, 0.5);
  transform: translate(0.9em, -50%); opacity: 0; transition: opacity ${FADE_IN}s ease, transform 0.9s ease; }
.bs-insp.is-on .bs-insp__panel { opacity: 1; transform: translate(0, -50%); }
.bs-insp:not(.is-on) .bs-insp__panel { pointer-events: none; }   /* 淡出中的面板不攔截點擊 */
.bs-insp.is-closing .bs-insp__panel { transition-duration: ${FADE_OUT}s, ${FADE_OUT}s; }
.bs-insp.is-solo .bs-insp__panel { right: auto; left: 50%; width: min(36em, 88vw); transform: translate(-50%, -48%); }
.bs-insp.is-solo.is-on .bs-insp__panel { transform: translate(-50%, -50%); }
.bs-insp.is-burnt .bs-insp__panel { border-color: rgba(120, 82, 46, 0.22);
  box-shadow: 0 1.6em 4.5em rgba(0, 0, 0, 0.75), inset 0 0 4.5em rgba(24, 12, 4, 0.85), inset 0 0 1.1em rgba(0, 0, 0, 0.85); }

.bs-insp__head { flex: none; padding: 1.7em 2.2em 1.05em; border-bottom: 1px solid var(--bs-rule); }
.bs-insp__title { margin: 0; font-family: var(--bs-serif); font-weight: 600; font-size: 1.42em; line-height: 1.45;
  letter-spacing: 0.2em; color: #ebe5d6; }
.bs-insp__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 1.35em 2.2em 0.4em;
  font-family: var(--bs-serif); font-size: 1.02em; line-height: 2; letter-spacing: 0.045em;
  scrollbar-width: thin; scrollbar-color: rgba(217, 212, 199, 0.22) transparent; }
.bs-insp__body::-webkit-scrollbar { width: 6px; }
.bs-insp__body::-webkit-scrollbar-thumb { background: rgba(217, 212, 199, 0.2); }
.bs-insp__body p { margin: 0 0 1.05em; text-align: justify; text-justify: inter-character; }
.bs-insp__body strong { font-weight: 600; color: var(--bs-accent); letter-spacing: 0.06em; }
.bs-insp__body em { font-style: normal; font-family: var(--bs-hand); font-size: 1.06em; color: #dccfb0; }
.bs-insp__body p.bs-insp__hand { position: relative; margin: 0.2em 0 1.35em 0.15em; padding: 0.05em 0 0.05em 1.25em;
  border-left: 1px solid rgba(188, 197, 214, 0.32); text-align: left;
  font-family: var(--bs-hand); font-size: 1.12em; line-height: 1.95; letter-spacing: 0.05em; color: #bfc7d6; }
.bs-insp__body p.bs-insp__hand em { font-size: 1em; color: inherit; }
.bs-insp__foot { flex: none; display: flex; align-items: center; gap: 0.8em; padding: 0.95em 2.2em 1.35em;
  border-top: 1px solid rgba(217, 212, 199, 0.07); font-size: 0.74em; letter-spacing: 0.2em; color: var(--bs-dim); }
.bs-insp__foot::before { content: ''; width: 1.6em; height: 1px; background: var(--bs-amber-soft); }
/* 長文提示：底部淡出＋「滾輪捲動 ▾」（捲到底後消失） */
.bs-insp.is-more .bs-insp__body { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 3.2em), rgba(0, 0, 0, 0.12));
  mask-image: linear-gradient(to bottom, #000 calc(100% - 3.2em), rgba(0, 0, 0, 0.12)); }
.bs-insp__scroll { margin-left: auto; white-space: nowrap; color: var(--bs-amber); opacity: 0; transition: opacity 0.5s ease; }
.bs-insp__scroll::after { content: ' ▾'; }
.bs-insp.is-more .bs-insp__scroll { opacity: 0.85; }
@media (max-height: 620px) {
  .bs-insp__panel { max-height: 90vh; }
  .bs-insp__head { padding: 1.05em 2em 0.7em; }
  .bs-insp__title { font-size: 1.24em; line-height: 1.35; }
  .bs-insp__body { padding: 0.85em 2em 0.2em; font-size: 0.95em; line-height: 1.78; }
  .bs-insp__body p { margin-bottom: 0.75em; }
  .bs-insp__body p.bs-insp__hand { margin: 0.1em 0 0.9em 0.1em; line-height: 1.7; }
  .bs-insp__foot { padding: 0.65em 2em 0.85em; }
}

@media (max-width: 760px), (max-aspect-ratio: 1/1) {
  .bs-insp__panel, .bs-insp.is-solo .bs-insp__panel { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 54vh;
    border-left: 0; border-right: 0; border-bottom: 0; transform: translateY(1.2em); }
  .bs-insp.is-on .bs-insp__panel, .bs-insp.is-solo.is-on .bs-insp__panel { transform: none; }
  .bs-insp__head { padding: 1.2em 1.4em 0.8em; }
  .bs-insp__body { padding: 1em 1.4em 0.3em; }
  .bs-insp__foot { padding: 0.8em 1.4em 1.1em; }
}
`;

const COMPOSITE_VS = /* glsl */`
uniform vec4 uRect;      // NDC x0, y0, x1, y1
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(mix(uRect.xy, uRect.zw, uv), 0.0, 1.0);
}`;
const COMPOSITE_FS = /* glsl */`
uniform sampler2D tMap;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tMap, vUv);
  float a = clamp(c.a, 0.0, 1.0);
  vec3 rgb = a > 0.0005 ? c.rgb / a : vec3(0.0);   // RT 內為預乘 alpha
  gl_FragColor = vec4(max(rgb, 0.0), a * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export class InspectView {
  constructor(ctx) {
    this.ctx = ctx;
    this.isOpen = false;
    this.current = null;
    this.opacity = 0;                 // 3D 疊加層與面板的整體可見度（動畫用）
    this._opacityTarget = 0;
    this._pendingClose = false;
    this._openedAt = 0;
    this._dimTw = null;
    this._time = 0;
    this._rot = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, idle: 99, base: 0, mode: 'spin' };
    this._rect = { cx: 0, cy: 0, size: 0 };

    // ---- 3D 小場景 -----------------------------------------------------------
    this.scene = new THREE.Scene();
    this.scene.name = 'inspectScene';
    this.camera = new THREE.PerspectiveCamera(26, 1, 0.01, 20);
    this.camera.position.set(0, 0, 1.6);
    this.camera.lookAt(0, 0, 0);
    const key = new THREE.DirectionalLight(0xffeedb, 2.6);
    key.position.set(-1.2, 1.5, 1.6);
    const fill = new THREE.DirectionalLight(0x9fb2cc, 0.55);
    fill.position.set(1.6, 0.2, 1.0);
    const rim = new THREE.DirectionalLight(0xffdcae, 2.1);
    rim.position.set(0.6, 1.2, -1.8);
    const amb = new THREE.HemisphereLight(0x4a4c55, 0x121010, 0.7);
    this.lights = { key, fill, rim, amb };
    this.scene.add(key, fill, rim, amb);
    this.pitchGroup = new THREE.Group();
    this.yawGroup = new THREE.Group();
    this.tiltGroup = new THREE.Group();
    this.pitchGroup.add(this.yawGroup);
    this.yawGroup.add(this.tiltGroup);
    this.scene.add(this.pitchGroup);
    this.object = null;               // 目前的 clone（包在 holder 內）
    this._holder = null;

    this.rt = null;
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, uOpacity: { value: 0 }, uRect: { value: new THREE.Vector4(-1, -1, 1, 1) } },
      vertexShader: COMPOSITE_VS,
      fragmentShader: COMPOSITE_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.compositeMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._clearColor = new THREE.Color();

    // ---- DOM ---------------------------------------------------------------------
    injectStyle('bs-ui-base', baseCss(FONTS));
    injectStyle('bs-insp-style', CSS);
    this.dom = el('div', 'bs-insp');
    this.dom.hidden = true;
    this.panel = el('aside', 'bs-insp__panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'false');
    const head = el('header', 'bs-insp__head');
    this.titleEl = el('h2', 'bs-insp__title');
    head.append(this.titleEl);
    this.bodyEl = el('div', 'bs-insp__body');
    this.footEl = el('footer', 'bs-insp__foot');
    this.closeHintEl = el('span', 'bs-insp__close');
    this.scrollHintEl = el('span', 'bs-insp__scroll');
    this.scrollHintEl.setAttribute('aria-hidden', 'true');
    this.footEl.append(this.closeHintEl, this.scrollHintEl);
    this.panel.append(head, this.bodyEl, this.footEl);
    this.bodyEl.addEventListener('scroll', () => this._updateScrollCue(), { passive: true });
    this.dom.append(this.panel);
    uiRoot().append(this.dom);
    try { this.panel.style.backgroundImage = `url(${InspectView._paperTexture()})`; } catch (e) { /* 純色底亦可 */ }
  }

  init() {
    // 關閉輸入：E / Esc / 滑鼠左右鍵
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const scroll = { ArrowDown: 48, ArrowUp: -48, PageDown: 0.85, PageUp: -0.85 }[e.code];
      if (scroll) {
        e.preventDefault();
        const b = this.bodyEl;
        b.scrollTop += Math.abs(scroll) < 1 ? scroll * b.clientHeight : scroll;
        return;
      }
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.key === 'e' || e.key === 'E' || e.key === 'Escape') this._requestClose(e);
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.isOpen) return;
      // 左鍵落在閱讀面板上（選取文字、拖曳捲動條；拖曳環顧模式下游標看得見）→ 不關閉。右鍵任何地方都關閉。
      if (e.button === 0 && this.panel.contains(e.target)) return;
      if (e.button === 0 || e.button === 2) this._requestClose(e);
    });
    window.addEventListener('contextmenu', (e) => { if (this.isOpen || this.opacity > 0) e.preventDefault(); });
    // 滑鼠移動（指標鎖定或一般）旋轉物件
    document.addEventListener('mousemove', (e) => {
      if (!this.isOpen || !this.object) return;
      const mx = Number(e.movementX) || 0, my = Number(e.movementY) || 0;
      if (Math.abs(mx) > 300 || Math.abs(my) > 300) return; // 部分瀏覽器鎖定瞬間的異常跳動
      const r = this._rot;
      r.tYaw += mx * 0.0055;
      r.tPitch = Math.max(-1.0, Math.min(1.0, r.tPitch + my * 0.0045));
      r.idle = 0;
    });
    // 滾輪：捲動長文（指標鎖定時游標不在面板上，所以全域處理）
    window.addEventListener('wheel', (e) => {
      if (!this.isOpen) return;
      const k = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? this.bodyEl.clientHeight : 1;
      this.bodyEl.scrollTop += e.deltaY * k;
    }, { passive: true });
    window.addEventListener('resize', () => { if (this.opacity > 0 || this.isOpen) { this._layout(); this._updateScrollCue(); } });
  }

  /** @param {{ id?: string, title: string, body: string[], object?: import('three').Object3D, scale?: number, onClose?: Function }} o
   *  @returns {Promise<void>} 關閉時 resolve */
  open(o = {}) {
    if (this.isOpen) this._finishClose(false);   // 直接換內容：前一個 promise 先 resolve
    const id = o.id ?? null;
    this.current = { id, onClose: o.onClose };
    this.isOpen = true;
    this._pendingClose = false;
    this._openedAt = performance.now();

    // ---- 面板內容 ----
    this.titleEl.textContent = String(o.title ?? '');
    this.bodyEl.innerHTML = '';
    const body = Array.isArray(o.body) ? o.body : (o.body != null ? [o.body] : []);
    for (const para of body) {
      const p = el('p', isWhollyItalic(para) ? 'bs-insp__hand' : '');
      p.innerHTML = renderMarkup(String(para));
      this.bodyEl.append(p);
    }
    this.bodyEl.scrollTop = 0;
    this.closeHintEl.textContent = this.ctx.SCRIPT?.hints?.closeInspect || '';
    this.scrollHintEl.textContent = this.ctx.SCRIPT?.hints?.scrollInspect || '';
    this.footEl.hidden = !this.closeHintEl.textContent;

    // ---- 3D ----
    this._setObject(o.object || null, Number(o.scale) || 1);
    this.dom.classList.toggle('is-solo', !this.object);
    this.dom.classList.toggle('is-burnt', id === 'logbook');
    this.dom.classList.remove('is-closing');
    this.dom.hidden = false;
    void this.dom.offsetWidth;
    this.dom.classList.add('is-on');
    this._opacityTarget = 1;
    this._layout();
    this._updateScrollCue();

    this._tweenDim(DIM_LEVEL, DIM_IN);
    if (id === 'stickyNote' || id === 'logbook' || id === 'endingNote') {
      try { this.ctx.audio?.sfx?.('paper'); } catch (e) { /* ignore */ }
    }
    this.ctx.bus.emit('inspect:open', { id });
    return new Promise((res) => { this._resolve = res; });
  }

  close() {
    if (!this.isOpen) return;
    this._finishClose(true);
  }

  update(dt, t) {
    this._time += dt;
    if (this._pendingClose) { this._pendingClose = false; if (this.isOpen) this._finishClose(true); }

    // 背景變暗補間（遊戲時間）：亮度乘數在對數空間沿舒適曲線變化，再換算回 dim
    const tw = this._dimTw;
    if (tw && this.ctx.postfx?.params) {
      tw.t = Math.min(1, tw.t + (tw.dur > 0 ? dt / tw.dur : 1));
      const b = tw.b0 * Math.pow(tw.b1 / tw.b0, comfortCurve(tw.t));
      this.ctx.postfx.params.dim = tw.t >= 1 ? tw.to : brightnessToDim(b);
      if (tw.t >= 1) this._dimTw = null;
    }

    // 整體淡入淡出
    const target = this._opacityTarget;
    if (this.opacity !== target) {
      const step = dt / (target > this.opacity ? FADE_IN : FADE_OUT);
      this.opacity = target > this.opacity ? Math.min(target, this.opacity + step) : Math.max(target, this.opacity - step);
      if (this.opacity <= 0 && !this.isOpen) this._detachObject();
    }

    // 物件旋轉
    if (this.object && this.opacity > 0) {
      const r = this._rot;
      r.idle += dt;
      const auto = Math.min(1, Math.max(0, (r.idle - 1.2) / 2.0));
      let sway = 0;
      if (r.mode === 'spin') r.tYaw += 0.24 * auto * dt;
      else sway = Math.sin(this._time * 0.42) * 0.38 * auto;
      r.swayCur = damp(r.swayCur || 0, sway, 3, dt);
      r.yaw = damp(r.yaw, r.tYaw, 7, dt);
      r.pitch = damp(r.pitch, r.tPitch, 7, dt);
      this.yawGroup.rotation.y = r.yaw + r.swayCur;
      this.pitchGroup.rotation.x = r.base + r.pitch;
      const k = easeInOut(this.opacity);
      this.pitchGroup.scale.setScalar(0.93 + 0.07 * k);
      this.pitchGroup.position.y = (1 - k) * -0.02;
      // 面板滑入的 CSS 轉場期間跟著重算位置；之後只在 resize 時重算（避免每幀強制排版）
      if (this.isOpen && performance.now() - this._openedAt < 1300) { this._layout(); this._updateScrollCue(); }
    }
  }

  /** 主畫面渲染之後呼叫：疊加渲染檢視物件（renderer.autoClear 需自行處理）。 */
  renderOverlay(renderer) {
    if (!this.object || this.opacity <= 0.001 || this._rect.size < 8) return;
    const pr = renderer.getPixelRatio();
    const px = Math.max(64, Math.min(1600, Math.round(this._rect.size * pr)));
    if (!this.rt) {
      let msaa = 4;
      try { if (!renderer.extensions?.has?.('EXT_color_buffer_float')) msaa = 0; } catch (e) { msaa = 0; }
      this.rt = new THREE.WebGLRenderTarget(px, px, { type: THREE.HalfFloatType, samples: msaa });
      this.rt.texture.name = 'InspectView.rt';
    } else if (this.rt.width !== px) {
      this.rt.setSize(px, px);
    }
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.getClearColor(this._clearColor);
    const prevAlpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.autoClear = false;
      renderer.render(this.scene, this.camera);

      renderer.setRenderTarget(prevTarget);
      renderer.clearDepth();
      const W = window.innerWidth, H = window.innerHeight, R = this._rect;
      const x0 = (R.cx - R.size / 2) / W * 2 - 1, x1 = (R.cx + R.size / 2) / W * 2 - 1;
      const y0 = 1 - (R.cy + R.size / 2) / H * 2, y1 = 1 - (R.cy - R.size / 2) / H * 2;
      const u = this.compositeMat.uniforms;
      u.uRect.value.set(x0, y0, x1, y1);
      u.tMap.value = this.rt.texture;
      u.uOpacity.value = comfortCurve(Math.min(1, this.opacity));
      renderer.render(this.quadScene, this.quadCam);
    } finally {
      renderer.autoClear = prevAuto;
      renderer.setClearColor(this._clearColor, prevAlpha);
      renderer.setRenderTarget(prevTarget);
    }
  }

  // ---------------------------------------------------------------------------
  _requestClose(e = null) {
    if (!this.isOpen) return;
    if (this.ctx.clock?.paused) return;
    // 以輸入事件「發生」的時間判斷（主執行緒忙碌時事件可能晚一點才被處理）；開啟前就按下的那一下也會被忽略
    const now = performance.now();
    let at = Number(e?.timeStamp);
    if (!(at > 0) || at > now + 1000) at = now;   // 舊式 epoch 時間戳或缺值 → 用目前時間
    if (at - this._openedAt < INPUT_GUARD_MS) return;
    this._pendingClose = true;    // 本幀最後（update）才真正關閉
  }

  _finishClose(animate) {
    const cur = this.current || {};
    this.isOpen = false;
    this._pendingClose = false;
    this.current = null;
    this._opacityTarget = 0;
    if (animate) {
      this.dom.classList.add('is-closing');
      this.dom.classList.remove('is-on');
      const dom = this.dom;
      const tok = (this._domTok = (this._domTok || 0) + 1);
      setTimeout(() => { if (this._domTok === tok && !this.isOpen) dom.hidden = true; }, FADE_OUT * 1000 + 80);
      this._tweenDim(0, DIM_OUT);
    }
    const resolve = this._resolve;
    this._resolve = null;
    this.ctx.bus.emit('inspect:close', { id: cur.id ?? null });
    try { cur.onClose?.(); } catch (e) { console.error('[inspect] onClose failed', e); }
    resolve?.();
  }

  _tweenDim(to, dur) {
    const from = Number(this.ctx.postfx?.params?.dim) || 0;
    const b0 = dimToBrightness(from), b1 = dimToBrightness(to);
    // 時間依「亮度比」等比例：從半途反向時不會用整段時間；最少 0.4 秒。光敏感模式 ×1.5。
    const calm = !!this.ctx.settings?.get?.('reduceFlicker');
    const frac = Math.min(1, Math.abs(Math.log(b1 / b0)) / DIM_FULL_LOG);
    const d = frac < 1e-3 ? 0 : Math.max(0.4, dur * frac * (calm ? 1.5 : 1));
    this._dimTw = { from, to, b0, b1, t: d > 0 ? 0 : 1, dur: d };
  }

  /** 內文超出面板高度且還沒捲到底 → 顯示底部淡出與「滾輪捲動」提示。 */
  _updateScrollCue() {
    const b = this.bodyEl;
    if (!b || this.dom.hidden) return;
    const more = b.scrollHeight - b.clientHeight > 4 && b.scrollTop + b.clientHeight < b.scrollHeight - 6;
    if (more !== this._moreShown) {
      this._moreShown = more;
      this.dom.classList.toggle('is-more', more);
    }
  }

  _setObject(src, extraScale) {
    this._detachObject();
    if (!src || typeof src.clone !== 'function') return;
    let clone;
    try { clone = src.clone(true); } catch (e) { console.warn('[inspect] clone failed', e); return; }
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.quaternion.identity();
    clone.scale.set(1, 1, 1);
    clone.visible = true;
    clone.matrixAutoUpdate = true;
    const lights = [];
    clone.traverse((c) => {
      if (c.isLight) lights.push(c);
      c.castShadow = false;
    });
    for (const l of lights) l.parent?.remove(l);

    const holder = new THREE.Group();
    holder.add(clone);
    holder.updateMatrixWorld(true);
    const box = InspectView._visibleBox(clone);
    const size = new THREE.Vector3(0.1, 0.1, 0.1), center = new THREE.Vector3();
    if (!box.isEmpty()) { box.getSize(size); box.getCenter(center); }
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);
    const s = (FIT_SIZE / maxDim);
    clone.position.copy(center).multiplyScalar(-1);
    holder.scale.setScalar(s);

    // 姿勢：平放的物件（Y 很薄）傾斜朝向鏡頭並緩慢擺動；面向 +Z 的薄片直接擺動；其他緩慢自轉
    const r = this._rot;
    const horiz = Math.max(size.x, size.z);
    if (size.y < 0.32 * horiz) { this.tiltGroup.rotation.set(1.08, 0, 0); r.mode = 'sway'; r.base = 0.0; }
    else if (size.z < 0.32 * Math.max(size.x, size.y)) { this.tiltGroup.rotation.set(0, 0, 0); r.mode = 'sway'; r.base = 0.06; }
    else { this.tiltGroup.rotation.set(0, 0, 0); r.mode = 'spin'; r.base = 0.34; }
    // 咖啡：俯角檢視杯中（熱咖啡的液面／冷掉浮灰／杯底乾涸焦痕——越低的液面需要越陡的俯角）
    if (this.current?.id === 'coffee') {
      const st = Math.max(0, Math.min(2, this.ctx.flags?.coffeeStage | 0));
      r.mode = 'spin'; r.base = st === 2 ? 1.08 : 0.82;
    }
    r.yaw = r.tYaw = r.mode === 'spin' ? -0.5 : 0;
    r.pitch = r.tPitch = 0;
    r.swayCur = 0;
    r.idle = 0;

    this.tiltGroup.add(holder);
    this.object = clone;
    this._holder = holder;

    // 相機距離：依縮放後的包圍球決定（extraScale > 1 → 看起來更大）
    const radius = 0.5 * size.length() * s;
    const half = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const dist = Math.max(radius * 1.25, (radius / Math.sin(half)) * 1.06 / Math.max(0.2, extraScale));
    this.camera.position.set(0, 0, dist);
    this.camera.near = Math.max(0.005, dist - radius * 2.5);
    this.camera.far = dist + radius * 3;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  /** 只計算「看得見」的網格（略過隱藏的互動 hitbox、粒子、線段），避免隱形碰撞盒讓物件縮小又偏心。 */
  static _visibleBox(root) {
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverseVisible((o) => {
      if (!o.isMesh || !o.geometry || o.userData?.hitbox || o.userData?.noInspect) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    });
    if (box.isEmpty()) box.setFromObject(root);   // 退回：整棵樹
    return box;
  }

  _detachObject() {
    if (this._holder) this.tiltGroup.remove(this._holder);
    this._holder = null;
    this.object = null;
  }

  /** 計算 3D 物件在畫面上的區域（css px）：寬螢幕＝面板左側；窄螢幕＝底部抽屜上方。 */
  _layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const pr = this.panel.getBoundingClientRect();
    const sheet = pr.width >= W - 2 && pr.top > H * 0.2;   // 底部抽屜
    if (sheet) {
      const avail = Math.max(60, pr.top);
      const size = Math.min(W * 0.86, avail * 0.92);
      this._rect = { cx: W / 2, cy: avail / 2 + H * 0.01, size };
    } else {
      const avail = Math.max(120, Math.min(pr.left, W));
      const size = Math.min(avail * 0.84, H * 0.74);
      this._rect = { cx: avail / 2 + W * 0.01, cy: H / 2, size };
    }
  }

  /** 程式化深色紙紋（data URL，零外部資源）。 */
  static _paperTexture() {
    if (InspectView._paperUrl) return InspectView._paperUrl;
    const N = 192;
    const { canvas, g } = makeCanvas(N, N);
    // 可無縫平鋪的 fbm（雜訊週期 = 第一層格數）
    const P = 6, noise = makeNoise(31, P);
    const img = g.createImageData(N, N), d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const v = Math.min(1, Math.max(0, (fbm(noise, (x / N) * P, (y / N) * P, 4) - 0.5) * 1.2 + 0.5));
        const i = (y * N + x) * 4;
        d[i] = 17 + 12 * v; d[i + 1] = 15 + 10 * v; d[i + 2] = 12 + 8 * v; d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // 細纖維
    g.save();
    g.globalAlpha = 0.05;
    g.strokeStyle = '#d9d4c7';
    g.lineWidth = 0.6;
    let s = 77;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 70; i++) {
      const x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI, l = 3 + rnd() * 9;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
    }
    g.restore();
    speckle(g, N, N, { seed: 9, count: 260, color: 'rgba(0,0,0,0.18)', min: 0.3, max: 1.1 });
    speckle(g, N, N, { seed: 12, count: 90, color: 'rgba(217,212,199,0.035)', min: 0.3, max: 0.9 });
    InspectView._paperUrl = canvas.toDataURL('image/png');
    return InspectView._paperUrl;
  }
}
