// =============================================================================
// UI — HTML/CSS 覆蓋層（標題、互動提示、目標、暫停、結局選擇、工作人員名單）
// 【API 骨架 / CONTRACT STUB】實作者必須保留所有公開方法。
// DOM 全部建立在 #ui-root 內；CSS 以 <style> 注入（不得依賴外部字型或圖片）。
// 視覺方向：極簡、冷調、像值班系統的終端字體；不得有閃爍動畫。
// =============================================================================
export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = document.getElementById('ui-root');
  }
  init() {}
  /** 標題畫面：標題、注意事項、操作說明、設定（靈敏度/音量/光敏感模式）、開始按鈕。
   *  onStart 必須在 click 事件處理函式內同步呼叫（使用者手勢：AudioContext 與 Pointer Lock 需要）。 */
  showTitle({ onStart } = {}) {}
  hideTitle() {}
  /** 畫面下方中央互動提示：「[E] 檢視　黃色便利貼」。text = null 隱藏。 */
  setPrompt(text, { verb = '檢視', key = 'E' } = {}) {}
  /** 準心：'dot'（預設微小點）| 'active'（瞄準可互動物時的細環）| 'hidden' */
  setCrosshair(mode) {}
  /** 左上角目前目標（淡入淡出）。null 隱藏。 */
  setObjective(text) {}
  /** 暫時提示（操作說明等），seconds 後淡出。 */
  hint(text, seconds = 4) {}
  /** 暫停覆蓋層；點擊時 emit 'pause:resume'（PlayerController 會在同一手勢內重新鎖定指標）。 */
  showPause(on) {}
  /** 電影黑邊 0..1（過場用）。 */
  setLetterbox(amount, seconds = 1) {}
  /** 終幕選擇：再次交接（重置循環）/ 工作人員名單。loop = 已完成的循環次數。 */
  showEndChoice({ loop = 1, onRestart, onCredits } = {}) {}
  hideEndChoice() {}
  /** 緩慢捲動的工作人員名單（ctx.SCRIPT.credits），結束後呼叫 onDone。 */
  showCredits(credits, { onDone } = {}) {}
  /** 全螢幕錯誤訊息（WebGL 失敗等）。 */
  showError(msg) {}
  hideAll() {}
  /** 除錯資訊（?debug=1 時右上角顯示）。 */
  debugText(str) {}
  update(dt, t) {}
}
