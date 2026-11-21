// =============================================================================
// InputMode — 目前的輸入方式：觸控（手機／平板）或 滑鼠＋鍵盤
// * 初始：主要指標為 coarse 且沒有任何 fine 指標（手機、平板）→ 觸控；否則（桌機、筆電、接了觸控板的 iPad）→ 滑鼠鍵盤。
//   ?touch=1 / ?touch=0 可強制（測試用）。
// * 之後依實際輸入切換（混合裝置）：pointerType 'touch' 的按下 → 觸控（'pen' 只在手機／平板上算觸控；
//   桌機的繪圖板／Surface 筆當作滑鼠，不會把整個遊戲切成觸控介面）；
//   真正的滑鼠按下或移動（累積 ≥ 8 px，且距離上一次觸控 ≥ 0.8 秒——排除觸控後瀏覽器補發的相容滑鼠事件）
//   或遊戲按鍵（WASD／方向鍵／E／Esc／Shift）→ 滑鼠鍵盤。
// * 觸控模式時 <html> 加上 class 'bs-touch'：所有觸控專用樣式都掛在這個 class 底下，桌機外觀完全不變。
//   在按下的手勢中切換時，class 延到該手勢的 click（或放開後 0.35 秒）才套用：版面不會在手指底下跳動
//   （否則標題的「點擊開始交接」會因為觸控說明出現而往下移，第一次點擊落空）。ctx.input.touch 本身立即改變。
// * 切換時 emit 'input:mode' { touch }（在觸發切換的輸入事件處理函式內同步發出：監聽者可在同一手勢內要求指標鎖定）。
// =============================================================================

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyE', 'Escape', 'ShiftLeft', 'ShiftRight']);
const MOUSE_AFTER_TOUCH_MS = 800;
const MOUSE_MOVE_PX = 8;

const mq = (q) => { try { return !!window.matchMedia?.(q).matches; } catch (e) { return false; } };

/** 這台裝置看起來是不是手機／平板（決定初始輸入模式與畫質預設）。 */
export function looksLikeTouchDevice() {
  const coarse = mq('(pointer: coarse)');
  const anyFine = mq('(any-pointer: fine)');
  let mobileUA = false;
  try {
    const ua = navigator.userAgent || '';
    mobileUA = !!navigator.userAgentData?.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)
      || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);   // iPadOS 以桌面版 UA 自稱
  } catch (e) { /* ignore */ }
  return (coarse && !anyFine) || (coarse && mobileUA);
}

export class InputMode {
  constructor(ctx) {
    this.ctx = ctx;
    const force = ctx.params?.get?.('touch');
    const device = looksLikeTouchDevice();
    this.touch = force === '1' ? true : force === '0' ? false : device;
    /** 觸控筆算不算觸控：手機／平板（或 ?touch=1）上算；桌機的筆當作滑鼠 */
    this._penIsTouch = force === '1' || device;
    /** 曾經用過觸控（混合裝置切回滑鼠時，第一次點擊畫布需要重新要求指標鎖定） */
    this.everTouch = this.touch;
    this.lastTouchAt = 0;
    this._mouse = null;     // { x, y, acc }
    this._lockedDowns = new WeakSet();
    this._pressing = false;
    this._applyPending = false;
    this._applyTimer = 0;
    this._apply();

    const opts = { capture: true, passive: true };
    window.addEventListener('pointerdown', (e) => this._onPointerDown(e), opts);
    window.addEventListener('pointermove', (e) => this._onPointerMove(e), opts);
    window.addEventListener('pointerup', () => this._onPressEnd(350), opts);
    window.addEventListener('pointercancel', () => this._onPressEnd(0), opts);
    window.addEventListener('click', () => this._flushApply(), opts);   // click 的目標已經決定：這時才改版面
    window.addEventListener('touchstart', () => this._touched(), opts);   // 沒有 Pointer Events 的舊瀏覽器
    window.addEventListener('keydown', (e) => { if (GAME_KEYS.has(e.code)) this.set(false); }, { capture: true });
  }

  _touched() {
    this.lastTouchAt = performance.now();
    this._mouse = null;
    this.set(true);
  }

  /** 這個 pointerdown 發生時指標仍鎖定著（Chromium 此時回報 clientX/Y = 0,0：TouchControls 等第一個 move 再取座標）。 */
  downWhileLocked(e) { return !!e && this._lockedDowns.has(e); }

  /** 這個指標算觸控嗎？（手指；手機／平板上的筆） */
  isTouchPointer(e) { return e?.pointerType === 'touch' || (e?.pointerType === 'pen' && this._penIsTouch); }
  _isMouseLike(e) { return e?.pointerType === 'mouse' || (e?.pointerType === 'pen' && !this._penIsTouch); }

  _onPointerDown(e) {
    if (this.isTouchPointer(e)) {
      try { if (document.pointerLockElement) this._lockedDowns.add(e); } catch (err) { /* ignore */ }
      this._pressing = true;
      this._touched();
      return;
    }
    if (this._isMouseLike(e) && performance.now() - this.lastTouchAt > MOUSE_AFTER_TOUCH_MS) this.set(false);
  }

  _onPressEnd(ms) {
    this._pressing = false;
    if (!this._applyPending) return;
    clearTimeout(this._applyTimer);
    this._applyTimer = setTimeout(() => this._flushApply(), ms);
  }

  _flushApply() {
    if (!this._applyPending) return;
    this._apply();
  }

  _onPointerMove(e) {
    if (!this.touch || !this._isMouseLike(e)) return;
    if (performance.now() - this.lastTouchAt < MOUSE_AFTER_TOUCH_MS) { this._mouse = null; return; }
    const m = this._mouse;
    if (!m) { this._mouse = { x: e.clientX, y: e.clientY, acc: 0 }; return; }
    m.acc += Math.abs(e.clientX - m.x) + Math.abs(e.clientY - m.y);
    m.x = e.clientX; m.y = e.clientY;
    if (m.acc >= MOUSE_MOVE_PX) { this._mouse = null; this.set(false); }
  }

  set(touch) {
    touch = !!touch;
    if (touch === this.touch) return;
    this.touch = touch;
    if (touch) this.everTouch = true;
    if (touch && this._pressing) {          // 手勢進行中：版面等到 click／放開之後才換（保險：最多 3 秒）
      this._applyPending = true;
      clearTimeout(this._applyTimer);
      this._applyTimer = setTimeout(() => this._flushApply(), 3000);
    } else this._apply();
    try { this.ctx.bus?.emit?.('input:mode', { touch }); } catch (e) { console.warn('[input] mode listener failed', e); }
  }

  _apply() {
    this._applyPending = false;
    clearTimeout(this._applyTimer);
    try { document.documentElement.classList.toggle('bs-touch', this.touch); } catch (e) { /* ignore */ }
  }
}
