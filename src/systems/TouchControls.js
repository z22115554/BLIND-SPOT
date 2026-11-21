// =============================================================================
// TouchControls — 手機／平板的觸控操作（只在觸控模式 ctx.input.touch 時作用；桌機完全不受影響）
// -----------------------------------------------------------------------------
// * 環顧：在畫面上（不是介面元件的地方）拖曳，方向同滑鼠（手指往右＝轉向右，行動 FPS 慣例）。
//   弧度/像素 = 1.25 × 垂直視角（直向時用橫向的基本視角）÷ 視窗短邊 × 設定的靈敏度；直接套用、沒有慣性、沒有吸附；
//   俯仰限制與滑鼠相同（PlayerController.lookBy）。單一事件位移超過視窗長邊 30% 時視為重新起點（不轉動）。
// * 移動：浮動虛擬搖桿——拇指落在左側區域（橫向：左 40%；直向：左半、下半）時在落點出現；類比、死區 20%；
//   手指拉超過 1.5 倍半徑時底座跟著滑過去。只有玩家能移動時才會出現（PlayerController.canMove()：
//   劇情過場、檢視、暫停時不出現，該區域的觸控改為環顧）；坐著時推動搖桿＝按下移動鍵（平滑站起後才走）。
//   能移動時左下角有一個很淡的提示圈。多點觸控：搖桿＋環顧可同時進行。
// * 互動：短按（< 0.45 秒（事件時間戳）、位移 < 10 px）＝點擊 → Interaction.tapAt（點到的可互動物件；含容錯環）；
//   拖曳永遠不會觸發互動。底部互動提示本身是按鈕（UI.js）。
// * 檢視畫面開啟時：拖曳＝旋轉物件（InspectView.nudge）、在面板外點一下＝關閉；面板內文以手指捲動；✕ 關閉鈕。
// * 暫停鈕：右上角（安全區內）44 px 觸控範圍，開啟既有的暫停/設定畫面。標題、結局選擇、名單、暫停中不顯示。
// * 開始遊戲時（標題的點擊手勢內）嘗試全螢幕＋鎖定橫向（Android Chrome）；不支援（iPhone）時安靜略過。
// * 直向：fovFor() 放寬垂直視角（最多 100°），讓水平視角至少約 62°，控制台與 CRT 仍完整可見（不拉伸）。
// * 瀏覽器衛生：觸控模式下畫布 touch-action:none、阻止相容滑鼠事件、長按選單、iOS 雙指縮放（gesturestart）、
//   頁面回彈（只允許標題/暫停/檢視內文等可捲動區域捲動）；所有 HUD 依 env(safe-area-inset-*) 內縮。
// * 沒有震動回饋（震動＝驚嚇）。所有出現/消失都是 ≥ 0.4 秒的淡入淡出。
// =============================================================================
import { injectStyle, uiRoot, el } from './uiCommon.js';

const TAP_SLOP = 10;          // px：超過就是拖曳
const TAP_MS = 450;           // 長於此不算點擊
const LOOK_GAIN = 1.25;       // 1 = 拖過整個畫面高度＝轉過整個垂直視角
const STICK_DEAD = 0.2;
const STICK_FOLLOW = 1.5;     // 手指超過半徑的倍數時底座跟著移動
const PORTRAIT_MIN_HFOV = 62; // 度
const PORTRAIT_MAX_VFOV = 100;
const evTime = (e) => { const t = Number(e?.timeStamp); return t > 0 && t < performance.now() + 1000 ? t : performance.now(); };
const SCROLLERS = '.bs-title, .bs-pause, .bs-insp__body, .bs-end, .bs-error, input, label';

const CSS = `
/* ---------- 觸控模式：瀏覽器衛生 ---------- */
html.bs-touch, html.bs-touch body { overscroll-behavior: none; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
html.bs-touch body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
html.bs-touch #game-canvas { touch-action: none; }
html.bs-touch #ui-root { -webkit-touch-callout: none; }
html.bs-touch .bs-title, html.bs-touch .bs-pause, html.bs-touch .bs-insp__body { touch-action: pan-y; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
html.bs-touch .bs-end, html.bs-touch .bs-credits, html.bs-touch .bs-prompt, html.bs-touch button,
html.bs-touch .bs-range, html.bs-touch .bs-set { touch-action: manipulation; }

/* ---------- 觸控模式：顯示對應的文字 ---------- */
html.bs-touch .bs-title__touch { display: block; }
html.bs-touch .bs-title__touch p { margin: 0; }
html.bs-touch .bs-controls--desk { display: none; }
html.bs-touch .bs-controls--touch { display: flex; }

/* ---------- 觸控模式：安全區＋HUD 版面 ---------- */
html.bs-touch .bs-obj { left: calc(max(1.4em, 3.2vw) + env(safe-area-inset-left, 0px)); top: calc(max(1.3em, 4.4vh) + env(safe-area-inset-top, 0px));
  width: min(24em, 46vw); }
html.bs-touch .bs-hint { top: calc(max(1.4em, 6.2vh) + env(safe-area-inset-top, 0px)); max-width: min(30em, 62vw); }
@media (max-width: 640px) {   /* 直向窄螢幕：提示放在左上目標的下方（與桌機窄視窗相同的位置＋安全區） */
  html.bs-touch .bs-hint { top: calc(max(1.3em, 4.4vh) + 5.4em + env(safe-area-inset-top, 0px)); max-width: 90vw; }
  html.bs-touch .bs-obj { width: min(24em, 70vw); }
}
/* 橫向手機（寬 ≤ 960）：置中的提示會壓到左上的目標文字 → 同樣放在目標下方、靠左對齊（避開瀏海安全區） */
@media (max-width: 960px) and (min-aspect-ratio: 1/1) {
  html.bs-touch .bs-hint { left: calc(max(1.4em, 3.2vw) + env(safe-area-inset-left, 0px)); transform: none; text-align: left;
    top: calc(max(1.3em, 4.4vh) + 5.2em + env(safe-area-inset-top, 0px)); max-width: min(30em, 60vw); padding-left: 0; }
}
html.bs-touch .bs-prompt { bottom: calc(max(1.2em, 4vh) + env(safe-area-inset-bottom, 0px));
  max-width: min(40em, calc(100vw - 2.4em - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
  min-height: 44px; padding: 0.55em 1.3em 0.55em 0.75em; gap: 0.35em 0.75em;
  border: 1px solid rgba(217, 212, 199, 0.26); border-radius: 3px; background: rgba(4, 4, 4, 0.5);
  pointer-events: auto; cursor: pointer; transition: opacity 0.4s ease, border-color 0.4s ease; }
html.bs-touch .bs-prompt:not(.is-on) { pointer-events: none; }
html.bs-touch .bs-prompt:active { border-color: var(--bs-amber-soft); }
html.bs-touch .bs-prompt .bs-key { min-width: 3.4em; height: 2.2em; font-family: var(--bs-ui); letter-spacing: 0.18em; border-color: var(--bs-amber-soft); }
html.bs-touch .bs-subs { bottom: calc(max(1.2em, 4vh) + 5em + env(safe-area-inset-bottom, 0px)); }
html.bs-touch .bs-debug { top: calc(0.6em + env(safe-area-inset-top, 0px)); right: calc(4.2em + env(safe-area-inset-right, 0px)); }

/* ---------- 觸控模式：標題、暫停、結局、檢視 ---------- */
html.bs-touch .bs-title__main { padding-left: calc(max(1.4em, 8.5vw) + env(safe-area-inset-left, 0px));
  padding-right: calc(max(1.4em, 8.5vw) + env(safe-area-inset-right, 0px)); padding-top: calc(max(2.2em, 8vh) + env(safe-area-inset-top, 0px)); }
html.bs-touch .bs-title__bar { padding-left: calc(max(1.4em, 8.5vw) + env(safe-area-inset-left, 0px));
  padding-right: calc(max(1.4em, 8.5vw) + env(safe-area-inset-right, 0px)); padding-bottom: calc(max(1.4em, 3.2vh) + env(safe-area-inset-bottom, 0px)); }
html.bs-touch .bs-title__start { min-height: 48px; padding: 0.9em 0; }
html.bs-touch .bs-pause { place-items: start center; padding: calc(1.6em + env(safe-area-inset-top, 0px)) calc(1.2em + env(safe-area-inset-right, 0px))
  calc(1.6em + env(safe-area-inset-bottom, 0px)) calc(1.2em + env(safe-area-inset-left, 0px)); }
html.bs-touch .bs-pause__panel { margin: auto 0; }
html.bs-touch .bs-end { padding: calc(2em + env(safe-area-inset-top, 0px)) calc(1.2em + env(safe-area-inset-right, 0px))
  calc(2em + env(safe-area-inset-bottom, 0px)) calc(1.2em + env(safe-area-inset-left, 0px)); }
html.bs-touch .bs-btn { min-height: 48px; padding-left: 0.6em; padding-right: 0.6em; }
html.bs-touch .bs-set { min-height: 44px; }
html.bs-touch .bs-range { height: 44px; }
html.bs-touch .bs-range::-webkit-slider-thumb { width: 30px; height: 30px; margin-top: -15px; border-radius: 0;
  background: linear-gradient(to right, transparent 13px, var(--bs-fg) 13px, var(--bs-fg) 17px, transparent 17px); }
html.bs-touch .bs-range:hover::-webkit-slider-thumb, html.bs-touch .bs-range:focus-visible::-webkit-slider-thumb {
  background: linear-gradient(to right, transparent 13px, var(--bs-accent) 13px, var(--bs-accent) 17px, transparent 17px); }
html.bs-touch .bs-range::-moz-range-thumb { width: 6px; height: 26px; }
html.bs-touch .bs-check { width: 1.35em; height: 1.35em; }
html.bs-touch .bs-insp__head { position: relative; padding-right: 3.8em; }
html.bs-touch .bs-insp__x { display: grid; place-items: center; position: absolute; top: 50%; right: 0.5em; transform: translateY(-50%);
  width: 44px; height: 44px; margin: 0; padding: 0; border: 0; background: transparent; color: var(--bs-fg);
  font: 16px/1 var(--bs-ui); opacity: 0.72; cursor: pointer; transition: opacity 0.4s ease, color 0.4s ease; }
html.bs-touch .bs-insp__x:active { opacity: 1; color: var(--bs-accent); }
html.bs-touch .bs-insp__panel { right: calc(max(2em, 5vw) + env(safe-area-inset-right, 0px)); }
@media (max-width: 760px), (max-aspect-ratio: 1/1) {
  html.bs-touch .bs-insp__panel, html.bs-touch .bs-insp.is-solo .bs-insp__panel { right: 0; padding-bottom: env(safe-area-inset-bottom, 0px); }
}
/* 矮的橫向手機：底部抽屜高一點（多看幾行）；側邊面板模式則幾乎用滿整個高度 */
@media (max-width: 760px) and (min-aspect-ratio: 1/1) {
  html.bs-touch .bs-insp__panel, html.bs-touch .bs-insp.is-solo .bs-insp__panel { max-height: 64vh; }
}
@media (max-height: 520px) and (min-width: 761px) and (min-aspect-ratio: 1/1) {
  html.bs-touch .bs-insp__panel { max-height: calc(100vh - 2.4em); }
}

/* ---------- 搖桿 / 暫停鈕 ---------- */
.bs-tc { position: absolute; z-index: 3; pointer-events: none; opacity: 0; transition: opacity 0.4s ease; }
.bs-tc.is-on { opacity: 1; }
.bs-stick { left: 0; top: 0; width: 0; height: 0; }
.bs-stick__base, .bs-stick__knob { position: absolute; left: 0; top: 0; border-radius: 50%; }
.bs-stick__base { width: var(--d); height: var(--d); margin: calc(var(--d) / -2) 0 0 calc(var(--d) / -2);
  border: 1px solid rgba(217, 212, 199, 0.2); background: radial-gradient(closest-side, rgba(0, 0, 0, 0.22), rgba(0, 0, 0, 0.08)); }
.bs-stick__knob { width: calc(var(--d) * 0.42); height: calc(var(--d) * 0.42); margin: calc(var(--d) * -0.21) 0 0 calc(var(--d) * -0.21);
  border: 1px solid rgba(217, 212, 199, 0.34); background: rgba(217, 212, 199, 0.1); }
.bs-stick--ghost.is-on { opacity: 0.5; }
.bs-stick--ghost .bs-stick__knob { opacity: 0.6; }
.bs-tc-pause { top: calc(4px + env(safe-area-inset-top, 0px)); right: calc(4px + env(safe-area-inset-right, 0px)); z-index: 7;
  width: 48px; height: 48px; margin: 0; padding: 0; border: 0; background: transparent; cursor: pointer; touch-action: manipulation;
  -webkit-tap-highlight-color: transparent; }
.bs-tc-pause.is-on { pointer-events: auto; opacity: 0.62; }
.bs-tc-pause::before, .bs-tc-pause::after { content: ''; position: absolute; top: 16px; width: 3px; height: 15px; background: var(--bs-fg);
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.9); }
.bs-tc-pause::before { left: 19px; }
.bs-tc-pause::after { left: 26px; }
.bs-tc-pause:active { opacity: 1; }
#ui-root.bs-menu .bs-stick, #ui-root.bs-inspecting .bs-stick--ghost { opacity: 0 !important; }
`;

export class TouchControls {
  constructor(ctx) {
    this.ctx = ctx;
    this.ptrs = new Map();       // pointerId → { role, x0, y0, x, y, t0, moved }
    this.stick = null;           // { id, cx, cy, kx, ky }
    this.lookId = null;
    this._baseFov = ctx.camera?.fov || 70;
    this._vis = { ghost: null, pause: null };
    // 測試用：?tapms=N 放寬點擊時間（SwiftShader 下每個觸控事件要等一幀才送達）
    this._tapMs = Number(ctx.params?.get?.('tapms')) || TAP_MS;

    injectStyle('bs-touch-style', CSS);
    const root = uiRoot();
    this.stickEl = el('div', 'bs-tc bs-stick');
    this.stickEl.hidden = false;
    this.stickEl.append(el('div', 'bs-stick__base'), (this.knobEl = el('div', 'bs-stick__knob')));
    this.ghostEl = el('div', 'bs-tc bs-stick bs-stick--ghost');
    this.ghostEl.append(el('div', 'bs-stick__base'), el('div', 'bs-stick__knob'));
    this.pauseEl = el('button', 'bs-tc bs-tc-pause');
    this.pauseEl.type = 'button';
    this.pauseEl.setAttribute('aria-label', ctx.SCRIPT?.touch?.pause || '');
    root.append(this.ghostEl, this.stickEl, this.pauseEl);
    for (const n of [this.stickEl, this.ghostEl, this.pauseEl]) n.setAttribute('aria-hidden', n === this.pauseEl ? 'false' : 'true');
    this._layoutStick();
  }

  get touch() { return !!this.ctx.input?.touch; }

  init() {
    const ctx = this.ctx;
    const cv = ctx.renderer.domElement;
    const pOpts = { passive: false };
    cv.addEventListener('pointerdown', (e) => this._onDown(e), pOpts);
    cv.addEventListener('pointermove', (e) => this._onMove(e), pOpts);
    cv.addEventListener('pointerup', (e) => this._onUp(e, true), pOpts);
    cv.addEventListener('pointercancel', (e) => this._onUp(e, false), pOpts);
    // 觸控事件本身：阻止瀏覽器的預設行為（相容滑鼠事件、雙擊縮放、捲動）。Pointer Events 照常送達。
    for (const t of ['touchstart', 'touchmove', 'touchend']) cv.addEventListener(t, (e) => { if (e.cancelable) e.preventDefault(); }, pOpts);

    // 全頁：iOS 雙指縮放、長按選單、頁面回彈（可捲動的介面例外）
    // （只在觸控模式：桌機 Safari 的觸控板縮放手勢也是 gesture* 事件，桌機行為不變）
    for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => { if (this.touch) e.preventDefault(); }, pOpts);
    document.addEventListener('touchmove', (e) => {
      if (!e.cancelable || !this.touch) return;
      if (e.touches && e.touches.length > 1) { e.preventDefault(); return; }
      if (!e.target?.closest?.(SCROLLERS)) e.preventDefault();
    }, pOpts);
    document.addEventListener('contextmenu', (e) => { if (this.touch) e.preventDefault(); });
    document.addEventListener('dblclick', (e) => { if (this.touch) e.preventDefault(); }, pOpts);

    // 暫停鈕：pointerdown 取消預設（不產生相容滑鼠事件 → 不會被當成「點擊檢視面板外」）
    this.pauseEl.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') e.preventDefault(); });
    this.pauseEl.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!this._vis.pause) return;
      this._releaseAll();
      ctx.bus.emit('pause:request');
    });

    ctx.bus.on('input:mode', ({ touch } = {}) => {
      if (!touch) this._releaseAll();
      try { if (ctx.inspect?.isOpen) ctx.inspect.syncHints?.(); } catch (e) { /* ignore */ }
    });
    ctx.bus.on('game:paused', () => this._releaseAll());
    ctx.bus.on('inspect:open', () => this._releaseStick());
    // 旋轉螢幕／視窗大幅改變：手指還按著的話，舊座標已經沒有意義 → 放開所有觸控（避免視角在一幀內跳動、搖桿中心錯位）
    this._lastSize = { w: window.innerWidth, h: window.innerHeight };
    ctx.bus.on('resize', () => {
      const w = window.innerWidth, h = window.innerHeight, L = this._lastSize;
      if ((w >= h) !== (L.w >= L.h) || Math.abs(w - L.w) > 0.2 * L.w || Math.abs(h - L.h) > 0.2 * L.h) this._releaseAll();
      this._lastSize = { w, h };
      this._layoutStick();
    });
    window.addEventListener('blur', () => this._releaseAll());
  }

  // ---------------------------------------------------------------------------
  // 視角（直向放寬 FOV）
  // ---------------------------------------------------------------------------
  /** 主相機的垂直視角（度）。桌機/橫向＝原值；觸控裝置直向放寬到水平視角 ≥ 62°（垂直最多 100°）。
   *  依「這台裝置用過觸控」（everTouch）而不是目前的輸入方式：直向的平板接上鍵盤或碰一下觸控板時視角不會瞬間跳動。 */
  fovFor(w, h) {
    const base = this._baseFov;
    if (!(this.touch || this.ctx.input?.everTouch) || !(w > 0 && h > 0)) return base;
    const aspect = w / h;
    const tanH = Math.tan((PORTRAIT_MIN_HFOV * Math.PI) / 360);
    const v = (2 * Math.atan(tanH / aspect) * 180) / Math.PI;
    return Math.min(PORTRAIT_MAX_VFOV, Math.max(base, v));
  }

  // ---------------------------------------------------------------------------
  // 開始遊戲（標題點擊的手勢內）：全螢幕＋橫向
  // ---------------------------------------------------------------------------
  enterImmersive() {
    if (!this.touch) return;
    const lockLandscape = () => {
      try { const p = screen.orientation?.lock?.('landscape'); if (p && typeof p.catch === 'function') p.catch(() => {}); } catch (e) { /* 不支援 */ }
    };
    try {
      const de = document.documentElement;
      const req = de.requestFullscreen || de.webkitRequestFullscreen;
      if (document.fullscreenElement || document.webkitFullscreenElement) { lockLandscape(); return; }
      if (typeof req !== 'function') return;   // iPhone Safari：沒有全螢幕 API
      const p = req.call(de, { navigationUI: 'hide' });
      if (p && typeof p.then === 'function') p.then(lockLandscape, () => {});
      else lockLandscape();
    } catch (e) { /* 失敗就維持一般視窗 */ }
  }

  // ---------------------------------------------------------------------------
  // 觸控輸入
  // ---------------------------------------------------------------------------
  _stickZone(x, y) {
    const W = window.innerWidth, H = window.innerHeight;
    if (W >= H) return x < W * 0.4 && y > H * 0.22;
    return x < W * 0.5 && y > H * 0.5;
  }

  _canMove() {
    const ctx = this.ctx;
    if (!ctx.player?.canMove || ctx.fsm?.currentName === ctx.STATES?.TITLE) return false;
    if (ctx.ui?.menuVisible?.()) return false;
    return ctx.player.canMove();
  }

  _onDown(e) {
    if (e.pointerType === 'mouse') return;
    if (e.pointerType === 'pen' && !this.touch) return;   // 桌機的筆＝滑鼠（PlayerController 透過相容滑鼠事件處理）
    if (e.cancelable) e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (err) { /* ignore */ }
    const x = e.clientX, y = e.clientY;
    // 時間用事件的 timeStamp（主執行緒忙碌、事件晚一點才處理時，點擊仍然算點擊）
    const p = { role: 'tap', x0: x, y0: y, x, y, t0: evTime(e), moved: 0 };
    // 混合裝置：滑鼠指標鎖定中第一次觸控 → 這個事件的座標是 (0,0)（瀏覽器在鎖定中凍結座標）。
    // 先不決定角色，等第一個 move（指標已解除鎖定、座標正確）再以那個位置為起點；沒有 move 就以 pointerup 的位置點擊。
    let locked = false;
    try { locked = !!document.pointerLockElement || !!this.ctx.input?.downWhileLocked?.(e); } catch (err) { /* ignore */ }
    if (locked) { p.role = 'pending'; this.ptrs.set(e.pointerId, p); return; }
    this._assignRole(p, e.pointerId, x, y);
    this.ptrs.set(e.pointerId, p);
  }

  /** 決定觸控點的角色：搖桿（左側區域、能移動時）／環顧（同時只有一個）／點擊。 */
  _assignRole(p, id, x, y) {
    p.role = 'tap';
    if (!this.stick && !this.ctx.inspect?.isOpen && this._canMove() && this._stickZone(x, y)) {
      p.role = 'stick';
      this.stick = { id, cx: x, cy: y, kx: 0, ky: 0 };
      this._paintStick();
      this.stickEl.classList.add('is-on');
    } else if (this.lookId == null) {
      p.role = 'look';
      this.lookId = id;
    }
  }

  _onMove(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    if (e.cancelable) e.preventDefault();
    const x = e.clientX, y = e.clientY;
    if (p.role === 'pending') {          // 鎖定中按下的觸控：以第一個正確的座標為起點（這一次不環顧）
      try { if (document.pointerLockElement) return; } catch (err) { /* ignore */ }
      p.x0 = p.x = x; p.y0 = p.y = y;
      this._assignRole(p, e.pointerId, x, y);
      return;
    }
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    p.moved = Math.max(p.moved, Math.hypot(x - p.x0, y - p.y0));
    // 保險：單一事件的位移大於視窗長邊的 30%（座標跳動、旋轉螢幕時手指沒放開）→ 視為重新起點，不轉動視角
    if (Math.abs(dx) > this._jumpPx() || Math.abs(dy) > this._jumpPx()) {
      if (p.role === 'stick' && this.stick?.id === e.pointerId) { this.stick.cx = x; this.stick.cy = y; this.stick.kx = 0; this.stick.ky = 0; this._paintStick(); }
      p.moved = Math.max(p.moved, TAP_SLOP);
      return;
    }
    if (p.role === 'look') {
      const ctx = this.ctx;
      if (ctx.inspect?.isOpen) { ctx.inspect.nudge?.(dx, dy); return; }
      const k = this._lookRadPerPx();
      ctx.player?.lookBy?.(dx * k, dy * k);
    } else if (p.role === 'stick' && this.stick?.id === e.pointerId) {
      const s = this.stick, R = this._R;
      let ox = x - s.cx, oy = y - s.cy;
      const d = Math.hypot(ox, oy);
      if (d > R * STICK_FOLLOW) {   // 底座跟著手指滑動
        const k = (d - R * STICK_FOLLOW) / d;
        s.cx += ox * k; s.cy += oy * k;
        ox = x - s.cx; oy = y - s.cy;
      }
      const dd = Math.hypot(ox, oy);
      const c = dd > R ? R / dd : 1;
      s.kx = ox * c; s.ky = oy * c;
      this._paintStick();
    }
  }

  _onUp(e, ok) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(e.pointerId);
    if (e.cancelable) e.preventDefault();
    if (p.role === 'stick') this._releaseStick();
    if (this.lookId === e.pointerId) this.lookId = null;
    // 'pending'（鎖定中按下、沒有 move）：pointerup 的座標已經正確
    const tx = p.role === 'pending' ? e.clientX : p.x, ty = p.role === 'pending' ? e.clientY : p.y;
    if (ok && p.moved < TAP_SLOP && evTime(e) - p.t0 < this._tapMs) this._tap(tx, ty, e);
  }

  _jumpPx() { return 0.3 * Math.max(window.innerWidth || 800, window.innerHeight || 600); }

  _tap(x, y, e) {
    const ctx = this.ctx;
    if (ctx.clock?.paused) return;
    if (ctx.inspect?.isOpen) { ctx.inspect._requestClose?.(e); return; }   // 面板外點一下＝關閉（面板本身攔截自己的觸控）
    try { ctx.interact?.tapAt?.(x, y); } catch (err) { console.warn('[touch] tap failed', err); }
  }

  _lookRadPerPx() {
    // 以視窗短邊與橫向的視角計算：直向（短邊＝寬、視角放寬到 ~100°）時不會變得太慢（iPhone SE 直向整個寬度 ≈ 88°），橫向不變
    const fov = ((Math.min(this.ctx.camera?.fov || 70, this._baseFov || 70)) * Math.PI) / 180;
    const h = Math.max(200, Math.min(window.innerWidth || 800, window.innerHeight || 600));
    const sens = Number(this.ctx.settings?.get?.('sensitivity'));
    return (LOOK_GAIN * fov / h) * (Number.isFinite(sens) && sens > 0 ? sens : 1);
  }

  _releaseStick() {
    if (this.stick) {
      const id = this.stick.id;
      const p = this.ptrs.get(id);
      if (p) p.role = 'tap';
      this.stick = null;
    }
    this.stickEl.classList.remove('is-on');
    const a = this.ctx.player?.analog;
    if (a) { a.x = 0; a.z = 0; }
  }

  _releaseAll() {
    this._releaseStick();
    this.ptrs.clear();
    this.lookId = null;
  }

  _layoutStick() {
    const W = window.innerWidth || 800, H = window.innerHeight || 600;
    this._R = Math.max(40, Math.min(64, Math.min(W, H) * 0.13));
    const d = `${Math.round(this._R * 2)}px`;
    this.stickEl.style.setProperty('--d', d);
    this.ghostEl.style.setProperty('--d', d);
    // 提示圈：左下（安全區由 CSS 變數無法進 transform，這裡用固定比例；拇指自然落點附近）
    const gx = Math.max(this._R + 28, W * (W >= H ? 0.14 : 0.2));
    const gy = H - Math.max(this._R + 36, H * (W >= H ? 0.3 : 0.2));
    this.ghostEl.style.transform = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px)`;
  }

  _paintStick() {
    const s = this.stick;
    if (!s) return;
    this.stickEl.style.transform = `translate(${s.cx.toFixed(1)}px, ${s.cy.toFixed(1)}px)`;
    this.knobEl.style.transform = `translate(${s.kx.toFixed(1)}px, ${s.ky.toFixed(1)}px)`;
  }

  // ---------------------------------------------------------------------------
  update() {
    const ctx = this.ctx;
    const touch = this.touch;
    const canMove = touch && this._canMove();
    // 搖桿 → PlayerController.analog（類比：死區之外重新映射到 0..1）
    const a = ctx.player?.analog;
    if (a) {
      if (this.stick && canMove) {
        const R = this._R, vx = this.stick.kx / R, vy = this.stick.ky / R;
        const m = Math.min(1, Math.hypot(vx, vy));
        const k = m <= STICK_DEAD ? 0 : (m - STICK_DEAD) / (1 - STICK_DEAD) / m;
        a.x = vx * k; a.z = vy * k;
      } else {
        a.x = 0; a.z = 0;
        if (this.stick && !canMove) this._releaseStick();
      }
    }
    const ghost = canMove && !this.stick;
    if (ghost !== this._vis.ghost) { this._vis.ghost = ghost; this.ghostEl.classList.toggle('is-on', ghost); }
    const pause = touch && !!ctx.fsm && ctx.fsm.currentName !== ctx.STATES?.TITLE && !ctx.clock?.paused && !ctx.ui?.menuVisible?.();
    if (pause !== this._vis.pause) { this._vis.pause = pause; this.pauseEl.classList.toggle('is-on', pause); }
  }
}
