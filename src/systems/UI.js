// =============================================================================
// UI — HTML/CSS 覆蓋層（標題、互動提示、目標、暫停、結局選擇、工作人員名單）
// 【API 骨架 / CONTRACT STUB】實作者必須保留所有公開方法。
// DOM 全部建立在 #ui-root 內；CSS 以 <style> 注入（不得依賴外部字型或圖片）。
// 視覺方向：極簡、冷調、像值班系統的終端字體；不得有閃爍動畫。
// -----------------------------------------------------------------------------
// 實作說明：
//   * 視覺語彙＝「夜班值勤終端」：黑底、骨白字（--fg）、低彩度琥珀點綴、細線、寬字距。
//   * 所有出現/消失都只是緩慢的透明度轉場（≥ 0.4 秒）；標題的開始提示以 3.6 秒週期「呼吸」。
//     光敏感模式（reduceFlicker）與 prefers-reduced-motion 時關閉呼吸動畫。
//   * 字級以 #ui-root 的 font-size（隨視窗縮放，13–30px）為基準，所有尺寸用 em，720p 到 4K 比例一致。
//   * 互動覆蓋層（標題、暫停、結局選擇、名單、錯誤）只有在可見時才 pointer-events:auto。
//   * 結局選擇/名單顯示期間，若因指標鎖定解除而觸發暫停，會在下一幀自動恢復（這些畫面本身就是選單）。
// =============================================================================
import { FONTS } from '../gfx/canvasUtil.js';
import { injectStyle, uiRoot, el, reveal, renderMarkup, baseCss } from './uiCommon.js';

// 【補充文案】觸控裝置提醒（script.js 沒有對應字串；整合時可移到 SCRIPT.title.touchNotice）
const PAUSE_FADE_MS = 1400;   // 暫停幕淡入/淡出（毫秒），見 .bs-pause 的 linear() 曲線
const TOUCH_NOTICE = '本作需要鍵盤與滑鼠操作。觸控裝置可以開始遊戲，但可能無法正常遊玩。';

const CSS = `
/* ---------- HUD：準心 / 互動提示 / 目標 / 暫時提示 ---------- */
.bs-cross { position: absolute; left: 50%; top: 50%; width: 0; height: 0; z-index: 2; transition: opacity 0.4s ease; }
.bs-cross__dot { position: absolute; width: max(3px, 0.2em); height: max(3px, 0.2em); left: 0; top: 0; transform: translate(-50%, -50%);
  border-radius: 50%; background: var(--bs-fg); opacity: 0.6; box-shadow: 0 0 2px rgba(0, 0, 0, 0.85); transition: opacity 0.35s ease; }
.bs-cross__ring { position: absolute; width: max(12px, 0.86em); height: max(12px, 0.86em); left: 0; top: 0;
  transform: translate(-50%, -50%) scale(0.55); border-radius: 50%; border: 1px solid rgba(217, 212, 199, 0.78);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.7), inset 0 0 2px rgba(0, 0, 0, 0.7); opacity: 0;
  transition: opacity 0.35s ease, transform 0.45s ease; }
.bs-cross.is-active .bs-cross__ring { opacity: 0.85; transform: translate(-50%, -50%) scale(1); }
.bs-cross.is-active .bs-cross__dot { opacity: 0.4; }
.bs-cross.is-hidden { opacity: 0; }

.bs-prompt { position: absolute; left: 50%; bottom: max(2.4em, 7.5vh); transform: translateX(-50%); z-index: 2;
  display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0.5em 0.9em;
  width: max-content; max-width: min(46em, 92vw); text-align: center;
  font-size: 0.98em; letter-spacing: 0.14em; line-height: 1.6; text-shadow: var(--bs-shadow);
  opacity: 0; transition: opacity 0.4s ease; }
.bs-prompt.is-on { opacity: 1; }
.bs-prompt__verb { color: var(--bs-amber); font-size: 0.92em; letter-spacing: 0.22em; }
.bs-prompt__label { color: var(--bs-fg); text-wrap: balance; }
.bs-prompt .bs-sfx { color: var(--bs-dim); font-size: 0.88em; letter-spacing: 0.08em; }
.bs-prompt .bs-sfx--alert { color: #c9675d; }

.bs-key { display: inline-flex; align-items: center; justify-content: center; flex: none;
  min-width: 1.95em; height: 1.95em; padding: 0 0.5em; border: 1px solid rgba(217, 212, 199, 0.5); border-radius: 2px;
  font-family: var(--bs-mono); font-size: 0.78em; letter-spacing: 0.04em; line-height: 1; color: var(--bs-fg);
  background: rgba(0, 0, 0, 0.42); box-shadow: inset 0 -2px 0 rgba(217, 212, 199, 0.12), 0 0 0.6em rgba(0, 0, 0, 0.5); text-shadow: none; }

.bs-obj { position: absolute; left: max(1.4em, 3.2vw); top: max(1.3em, 4.4vh); z-index: 2; display: grid;
  width: min(28em, 64vw); transition: opacity 0.6s ease; }
.bs-obj__item { grid-area: 1 / 1; position: relative; isolation: isolate; justify-self: start; max-width: 100%;
  opacity: 0; transition: opacity 0.6s ease; }
.bs-obj__item::before { content: ''; position: absolute; z-index: -1; inset: -1.6em -2.2em -1.5em -2em; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(3, 3, 3, 0.62), rgba(3, 3, 3, 0.48) 50%, rgba(3, 3, 3, 0.16) 80%, rgba(3, 3, 3, 0) 100%); }
.bs-obj__item.is-on { opacity: 1; }
.bs-obj__stamp { display: flex; align-items: center; gap: 0.9em; font-family: var(--bs-mono); font-size: 0.72em;
  letter-spacing: 0.3em; color: var(--bs-amber); text-shadow: var(--bs-shadow); min-height: 1.2em; }
.bs-obj__stamp::after { content: ''; width: 2.8em; height: 1px; background: var(--bs-rule-strong); }
.bs-obj__text { margin-top: 0.45em; font-size: 0.94em; line-height: 1.6; letter-spacing: 0.08em; color: var(--bs-fg);
  text-shadow: var(--bs-shadow); }

.bs-hint { position: absolute; left: 50%; top: max(1.4em, 6.2vh); transform: translateX(-50%); z-index: 2; isolation: isolate;
  width: max-content; max-width: min(36em, 88vw); padding: 0.45em 1.2em; text-align: center;
  font-size: 0.88em; letter-spacing: 0.16em; line-height: 1.7; color: var(--bs-fg); text-shadow: var(--bs-shadow);
  opacity: 0; transition-property: opacity; transition-timing-function: ease; }
.bs-hint.is-on { opacity: 0.92; }
.bs-hint::before { content: ''; position: absolute; z-index: -1; inset: -0.9em -1.6em; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(3, 3, 3, 0.6), rgba(3, 3, 3, 0.45) 50%, rgba(3, 3, 3, 0.14) 80%, rgba(3, 3, 3, 0) 100%); }

#ui-root.bs-inspecting .bs-prompt, #ui-root.bs-inspecting .bs-cross { opacity: 0 !important; }
#ui-root.bs-menu .bs-prompt, #ui-root.bs-menu .bs-cross, #ui-root.bs-menu .bs-obj { opacity: 0 !important; }
#ui-root.bs-inspecting .bs-obj { opacity: 0.3; }

/* ---------- 電影黑邊 ---------- */
.bs-lb { position: absolute; inset: 0; z-index: 1; pointer-events: none; }
.bs-lb__bar { position: absolute; left: 0; right: 0; height: 12vh; background: #000; transform: scaleY(0); }
.bs-lb__bar--top { top: 0; transform-origin: 50% 0; }
.bs-lb__bar--bottom { bottom: 0; transform-origin: 50% 100%; }

/* ---------- 共用：設定控制項、按鈕、操作說明 ---------- */
.bs-settings { color: var(--bs-dim); }
.bs-set { display: inline-flex; align-items: center; gap: 0.9em; font-size: 0.84em; letter-spacing: 0.1em; cursor: pointer; }
.bs-set__label { white-space: nowrap; }
.bs-set__value { min-width: 3.4em; font-family: var(--bs-mono); font-size: 0.95em; letter-spacing: 0.04em; color: var(--bs-fg); }
.bs-settings--row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.9em 2em; }
.bs-settings--row .bs-range { width: 6.6em; }
.bs-settings--stack { display: grid; grid-template-columns: max-content minmax(6em, 1fr) max-content; align-items: center;
  gap: 1.15em 1.3em; font-size: 0.88em; }
.bs-settings--stack .bs-set { font-size: 1em; }
.bs-settings--stack .bs-set--range { display: contents; }
.bs-settings--stack .bs-range { width: 100%; }
.bs-settings--stack .bs-set__value { text-align: right; }
.bs-settings--stack .bs-set--check { grid-column: 1 / -1; margin-top: 0.2em; }

.bs-range { -webkit-appearance: none; appearance: none; width: 8em; height: 1.5em; margin: 0; padding: 0;
  background: transparent; cursor: pointer; --p: 50%; }
.bs-range::-webkit-slider-runnable-track { height: 1px; border: 0;
  background: linear-gradient(to right, var(--bs-fg) 0, var(--bs-fg) var(--p), var(--bs-rule-strong) var(--p), var(--bs-rule-strong) 100%); }
.bs-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 3px; height: 1.05em; margin-top: calc(-0.525em + 0.5px);
  border: 0; border-radius: 0; background: var(--bs-fg); transition: background-color 0.4s ease; }
.bs-range::-moz-range-track { height: 1px; border: 0; background: var(--bs-rule-strong); }
.bs-range::-moz-range-progress { height: 1px; background: var(--bs-fg); }
.bs-range::-moz-range-thumb { width: 3px; height: 1.05em; border: 0; border-radius: 0; background: var(--bs-fg); }
.bs-range:hover::-webkit-slider-thumb, .bs-range:focus-visible::-webkit-slider-thumb { background: var(--bs-accent); }
.bs-range:hover::-moz-range-thumb, .bs-range:focus-visible::-moz-range-thumb { background: var(--bs-accent); }
.bs-range:focus { outline: none; }
.bs-range:focus-visible { outline: 1px solid var(--bs-amber-soft); outline-offset: 0.3em; }

.bs-check { -webkit-appearance: none; appearance: none; flex: none; display: inline-grid; place-content: center;
  width: 1.05em; height: 1.05em; margin: 0; border: 1px solid var(--bs-rule-strong); border-radius: 0; background: transparent;
  cursor: pointer; transition: border-color 0.4s ease; }
.bs-check::before { content: ''; width: 0.5em; height: 0.5em; background: var(--bs-accent); opacity: 0; transition: opacity 0.4s ease; }
.bs-check:checked { border-color: var(--bs-amber); }
.bs-check:checked::before { opacity: 0.9; }
.bs-check:focus { outline: none; }
.bs-check:focus-visible { outline: 1px solid var(--bs-amber-soft); outline-offset: 0.25em; }
.bs-set--check .bs-set__label { white-space: normal; line-height: 1.6; }
.bs-set--check:hover .bs-check { border-color: var(--bs-fg); }

.bs-btn { font: inherit; color: var(--bs-fg); background: transparent; border: 0; border-bottom: 1px solid var(--bs-rule-strong);
  border-radius: 0; padding: 0.75em 0.15em 0.65em; letter-spacing: 0.26em; cursor: pointer;
  transition: color 0.5s ease, border-color 0.5s ease; }
.bs-btn:hover, .bs-btn:focus-visible { color: var(--bs-bright); border-bottom-color: var(--bs-amber); outline: none; }
.bs-btn[disabled] { cursor: default; }

.bs-controls { display: flex; flex-wrap: wrap; gap: 0.7em 1.7em; margin: 0; font-size: 0.8em; letter-spacing: 0.1em; color: var(--bs-dim); }
.bs-controls__item { display: inline-flex; align-items: center; gap: 0.65em; white-space: nowrap; }
.bs-controls .bs-key { font-size: 0.86em; min-width: 1.9em; height: 1.85em; color: var(--bs-fg); border-color: rgba(217, 212, 199, 0.32); background: transparent; box-shadow: none; }

@keyframes bs-breathe { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

/* ---------- 標題畫面 ---------- */
.bs-title { position: absolute; inset: 0; z-index: 9; pointer-events: auto; display: flex; flex-direction: column;
  overflow-x: hidden; overflow-y: auto; background: #000; opacity: 0; transition-property: opacity; transition-timing-function: ease; }
.bs-title.is-on { opacity: 1; }
.bs-title__main { flex: 1 0 auto; display: flex; flex-direction: column; justify-content: center;
  padding: max(2.2em, 8vh) max(1.4em, 8.5vw) 2.6em; }
.bs-title__stamp { display: flex; align-items: center; gap: 1.3em; margin: 0 0 3.2em; font-family: var(--bs-mono);
  font-size: 0.76em; letter-spacing: 0.34em; color: var(--bs-dim); }
.bs-title__stamp::after { content: ''; flex: 0 1 15em; height: 1px; background: var(--bs-rule); }
.bs-title__touch { max-width: 30em; margin: 0 0 2.4em; padding: 0.85em 1.1em; border: 1px solid var(--bs-amber-soft);
  font-size: 0.84em; line-height: 1.75; letter-spacing: 0.06em; color: var(--bs-fg); }
.bs-title__zh { margin: 0 -0.4em 0 0; font-family: var(--bs-serif); font-weight: 500; font-size: min(6.6em, 13.4vw, 15.5vh);
  line-height: 1.12; letter-spacing: 0.4em; white-space: nowrap; color: var(--bs-fg);
  text-shadow: 0.045em 0 0 rgba(217, 212, 199, 0.07), -0.028em 0 0 rgba(150, 172, 196, 0.06); }
.bs-title__en { margin: 1.05em 0 0; font-family: var(--bs-mono); font-size: 0.84em; letter-spacing: 0.64em; color: var(--bs-dim); }
.bs-title__notes { max-width: 36em; margin: 2.9em 0 0; padding: 0; list-style: none; font-size: 0.86em; line-height: 1.95;
  letter-spacing: 0.08em; color: var(--bs-dim); }
.bs-title__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 1em 2.6em; margin-top: 2.8em; }
.bs-title__start { display: inline-flex; align-items: center; gap: 1.1em; padding: 0.7em 0; border: 0; background: none;
  font: inherit; font-size: 1.12em; letter-spacing: 0.38em; color: var(--bs-fg); cursor: pointer;
  animation: bs-breathe 3.6s ease-in-out infinite; }
.bs-title__start .bs-tick { display: block; width: 1.7em; height: 1px; background: var(--bs-amber); transition: width 0.7s ease; }
.bs-title__start:hover, .bs-title__start:focus-visible { animation-play-state: paused; opacity: 1; outline: none; color: var(--bs-bright); }
.bs-title__start:hover .bs-tick, .bs-title__start:focus-visible .bs-tick { width: 3.2em; }
.bs-title__loop { font-family: var(--bs-mono); font-size: 0.76em; letter-spacing: 0.3em; color: var(--bs-amber); }
.bs-title__main { position: relative; }
.bs-title__feed { position: absolute; right: max(1.4em, 8.5vw); bottom: 2.9em; display: grid; justify-items: end; gap: 0.55em;
  font-family: var(--bs-mono); font-size: 0.72em; letter-spacing: 0.18em; line-height: 1.5; color: var(--bs-dim); opacity: 0.55;
  text-align: right; }
.bs-title__feed-head { display: flex; align-items: center; gap: 0.9em; color: var(--bs-fg); opacity: 0.8; }
.bs-title__feed-head::before { content: ''; width: 0.5em; height: 0.5em; border-radius: 50%; background: var(--bs-alert); opacity: 0.75; }
.bs-title__feed-rule { width: 9em; height: 1px; background: var(--bs-rule); }
@media (max-width: 1000px), (max-height: 560px) { .bs-title__feed { display: none; } }
.bs-title__bar { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1.1em 2.4em;
  padding: 1.25em max(1.4em, 8.5vw) max(1.4em, 3.2vh); border-top: 1px solid var(--bs-rule); }

/* ---------- 暫停 ---------- */
.bs-pause { position: absolute; inset: 0; z-index: 8; pointer-events: auto; display: grid; place-items: center;
  padding: 2em 1.2em; overflow-y: auto; background: rgba(2, 2, 2, 0.8); cursor: pointer;
  opacity: 0; transition-property: opacity;
  /* 背景亮度（1 ↔ 0.2）以對數等速變化：0.25 秒內亮度變化 ≤ 約 25%（1.4 秒；光敏感模式 2.1 秒）。
     linear() 精確描述該曲線；不支援的瀏覽器退回近似的 cubic-bezier。此規則是「淡出」用（亮度回升）。 */
  transition-timing-function: cubic-bezier(0.55, 0.06, 0.82, 0.55);
  transition-timing-function: linear(0, 0.044, 0.095, 0.155, 0.226, 0.309, 0.407, 0.521, 0.656, 0.814, 1); }
.bs-pause.is-on { opacity: 1;
  transition-timing-function: cubic-bezier(0.18, 0.45, 0.45, 0.94);
  transition-timing-function: linear(0, 0.186, 0.344, 0.479, 0.593, 0.691, 0.774, 0.845, 0.905, 0.956, 1); }
.bs-pause__panel { position: relative; isolation: isolate; width: min(30em, 100%); }
.bs-pause__panel::before { content: ''; position: absolute; z-index: -1; inset: -4em -6em; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0.6) 55%, rgba(0, 0, 0, 0) 100%); pointer-events: none; }
.bs-pause__title { margin: 0 -0.5em 0 0; text-align: center; font-family: var(--bs-serif); font-weight: 500;
  font-size: 2.5em; line-height: 1.2; letter-spacing: 0.5em; color: var(--bs-fg); }
.bs-pause__resume { margin: 1.1em 0 2.6em; text-align: center; font-size: 0.95em; letter-spacing: 0.3em; color: var(--bs-fg);
  animation: bs-breathe 4.2s ease-in-out infinite; }
.bs-pause__rule { height: 1px; margin: 0 0 1.9em; background: var(--bs-rule); }
.bs-pause .bs-settings { cursor: default; margin-bottom: 1.9em; color: #a8a295; }
.bs-pause .bs-controls { justify-content: center; }

/* ---------- 終幕選擇 ---------- */
.bs-end { position: absolute; inset: 0; z-index: 5; pointer-events: auto; display: flex; flex-direction: column;
  align-items: center; justify-content: center; padding: 2em 1.2em; background: rgba(0, 0, 0, 0.55);
  opacity: 0; transition-property: opacity; transition-timing-function: ease; }
.bs-end.is-on { opacity: 1; }
.bs-end__stamp { font-family: var(--bs-mono); font-size: 0.76em; letter-spacing: 0.34em; color: var(--bs-amber); }
.bs-end__loop { margin: 1.3em -0.5em 0 0; font-family: var(--bs-serif); font-size: 1.65em; letter-spacing: 0.5em; color: var(--bs-fg); text-align: center; }
.bs-end__rule { width: min(22em, 70vw); height: 1px; margin: 2.4em 0 1.6em; background: var(--bs-rule); }
.bs-end__choices { display: flex; flex-wrap: wrap; justify-content: center; gap: 1em 3.2em; }
.bs-end__choices .bs-btn { font-size: 0.95em; }

/* ---------- 工作人員名單 ---------- */
.bs-credits { position: absolute; inset: 0; z-index: 6; pointer-events: auto; display: grid; place-items: center;
  background: #000; opacity: 0; transition-property: opacity; transition-timing-function: ease; }
.bs-credits.is-on { opacity: 1; }
.bs-credit { grid-area: 1 / 1; max-width: min(40em, 92vw); padding: 0 1em; text-align: center;
  opacity: 0; transition-property: opacity; transition-timing-function: ease-in-out; }
.bs-credit.is-on { opacity: 1; }
.bs-credit__h { margin-right: -0.42em; font-family: var(--bs-serif); font-size: 1.5em; line-height: 1.5; letter-spacing: 0.42em; color: var(--bs-fg); }
.bs-credit__s { margin-top: 1.25em; font-size: 0.9em; line-height: 1.9; letter-spacing: 0.22em; color: var(--bs-dim); }
.bs-credit__rule { width: 2.4em; height: 1px; margin: 1.5em auto 0; background: var(--bs-amber-soft); }
.bs-credit--title .bs-credit__h { margin-right: -0.4em; font-size: min(3.4em, 11vw); letter-spacing: 0.4em; }
.bs-credit--title .bs-credit__s { font-family: var(--bs-mono); letter-spacing: 0.6em; margin-right: -0.6em; }
.bs-credit--dedication .bs-credit__s { margin: 0 -0.3em 0 0; font-family: var(--bs-serif); font-size: 1.3em; letter-spacing: 0.3em; color: var(--bs-fg); }

/* ---------- 錯誤 / 除錯 ---------- */
.bs-error { position: absolute; inset: 0; z-index: 10; pointer-events: auto; display: grid; place-items: center; padding: 2em 1.2em;
  background: #000; opacity: 0; transition-property: opacity; }
.bs-error.is-on { opacity: 1; }
.bs-error__box { max-width: 36em; padding: 1.2em 1.5em; border-left: 1px solid var(--bs-alert);
  font-size: 0.95em; line-height: 1.85; letter-spacing: 0.06em; color: var(--bs-fg); white-space: pre-wrap; -webkit-user-select: text; user-select: text; }
.bs-debug { position: absolute; top: 0.6em; right: 0.8em; z-index: 11; max-width: 70vw; text-align: right; white-space: pre-wrap;
  font: 11px/1.45 var(--bs-mono); color: rgba(217, 212, 199, 0.62); text-shadow: 0 0 2px #000, 0 0 4px #000; }

/* ---------- 光敏感 / 減少動態 ---------- */
#ui-root.bs-calm .bs-title__start, #ui-root.bs-calm .bs-pause__resume { animation: none; opacity: 0.92; }
@media (prefers-reduced-motion: reduce) {
  .bs-title__start, .bs-pause__resume { animation: none !important; opacity: 0.92; }
}

/* ---------- 窄螢幕 ---------- */
@media (max-width: 640px) {
  .bs-title__stamp { margin-bottom: 2.4em; }
  .bs-title__zh { letter-spacing: 0.26em; margin-right: -0.26em; }
  .bs-title__en { letter-spacing: 0.46em; }
  .bs-title__notes { margin-top: 2.2em; }
  .bs-title__bar { flex-direction: column; align-items: stretch; }
  .bs-title__bar .bs-settings--row { display: grid; grid-template-columns: max-content minmax(5em, 1fr) max-content;
    align-items: center; gap: 1.15em 1.1em; }
  .bs-title__bar .bs-settings--row .bs-set--range { display: contents; }
  .bs-title__bar .bs-settings--row { font-size: 0.88em; }
  .bs-title__bar .bs-settings--row .bs-set { font-size: 1em; }
  .bs-title__bar .bs-settings--row .bs-range { width: 100%; }
  .bs-title__bar .bs-settings--row .bs-set__value { text-align: right; }
  .bs-title__bar .bs-settings--row .bs-set--check { grid-column: 1 / -1; }
  .bs-controls { gap: 0.6em 1.2em; }
  .bs-hint { top: calc(max(1.3em, 4.4vh) + 5.4em); max-width: 90vw; }
  .bs-pause__title { font-size: 2em; }
  .bs-end__choices { flex-direction: column; align-items: center; }
}
@media (max-height: 520px) {
  .bs-title__stamp { margin-bottom: 1.6em; }
  .bs-title__notes { margin-top: 1.6em; }
  .bs-title__actions { margin-top: 1.6em; }
}
`;

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = document.getElementById('ui-root') || uiRoot();
    injectStyle('bs-ui-base', baseCss(FONTS));
    injectStyle('bs-ui-style', CSS);

    this._prompt = { key: null };
    this._crossMode = null;
    this._objective = { text: undefined, flip: 0 };
    this._hint = { left: 0, on: false };
    this._lb = { from: 0, to: 0, cur: 0, t: 1, dur: 1 };
    this._settingsViews = [];
    this._endVisible = false;
    this._creditsVisible = false;
    this._autoResume = false;
    this._creditsToken = 0;
    this._titleStarted = false;

    this._buildHud();
  }

  init() {
    const { bus, settings } = this.ctx;
    // 檢視物品時隱藏準心與互動提示（不論 Interaction 是否清除）
    bus?.on?.('inspect:open', () => this.root.classList.add('bs-inspecting'));
    bus?.on?.('inspect:close', () => this.root.classList.remove('bs-inspecting'));
    // 光敏感模式：關閉呼吸動畫
    this.root.classList.toggle('bs-calm', !!settings?.get?.('reduceFlicker'));
    bus?.on?.('settings:change', ({ key, value } = {}) => {
      if (key === 'reduceFlicker') this.root.classList.toggle('bs-calm', !!value);
      this._syncSettingsViews();
    });
    try { this.ctx.audio?.setMasterVolume?.(Number(settings?.get?.('volume') ?? 0.8)); } catch (e) { /* audio 尚未就緒 */ }
  }

  // ===========================================================================
  // 建構
  // ===========================================================================
  _buildHud() {
    const r = this.root;
    // 電影黑邊
    this.lb = el('div', 'bs-lb');
    this.lbTop = el('div', 'bs-lb__bar bs-lb__bar--top');
    this.lbBottom = el('div', 'bs-lb__bar bs-lb__bar--bottom');
    this.lb.append(this.lbTop, this.lbBottom);
    // 準心
    this.cross = el('div', 'bs-cross is-hidden');
    this.cross.append(el('div', 'bs-cross__ring'), el('div', 'bs-cross__dot'));
    // 互動提示
    this.prompt = el('div', 'bs-prompt');
    this.prompt.hidden = true;
    this.promptKey = el('span', 'bs-key');
    this.promptVerb = el('span', 'bs-prompt__verb');
    this.promptLabel = el('span', 'bs-prompt__label');
    this.prompt.append(this.promptKey, this.promptVerb, this.promptLabel);
    // 目標（兩層交叉淡入淡出）
    this.obj = el('div', 'bs-obj');
    this.objItems = [0, 1].map(() => {
      const it = el('div', 'bs-obj__item');
      it.append(el('div', 'bs-obj__stamp'), el('div', 'bs-obj__text'));
      this.obj.append(it);
      return it;
    });
    // 暫時提示
    this.hintEl = el('div', 'bs-hint');
    this.hintEl.hidden = true;
    this.hintEl.setAttribute('role', 'status');

    r.append(this.lb, this.cross, this.prompt, this.obj, this.hintEl);

    if (this.ctx.debug) {
      this.debugEl = el('div', 'bs-debug');
      r.append(this.debugEl);
    }
  }

  /** 「滑鼠：環顧　WASD：移動…」→ 鍵帽＋說明 */
  _buildControls() {
    const line = this.ctx.SCRIPT?.title?.controls || '';
    const wrap = el('p', 'bs-controls');
    for (const part of line.split(/[　]+|\s{2,}/).map((s) => s.trim()).filter(Boolean)) {
      const item = el('span', 'bs-controls__item');
      const i = part.indexOf('：');
      if (i > 0) item.append(el('span', 'bs-key', part.slice(0, i)), el('span', '', part.slice(i + 1)));
      else item.textContent = part;
      wrap.append(item);
    }
    return wrap;
  }

  /** 設定控制項（標題與暫停各一組，彼此同步）。variant: 'row' | 'stack' */
  _buildSettings(variant) {
    const S = this.ctx.SCRIPT?.title?.settings || {};
    const st = this.ctx.settings;
    const wrap = el('div', `bs-settings bs-settings--${variant}`);
    const view = { wrap, inputs: {} };

    const mkRange = (key, label, min, max, step, fmt, def) => {
      const row = el('label', 'bs-set bs-set--range');
      const name = el('span', 'bs-set__label', label);
      const input = document.createElement('input');
      input.type = 'range'; input.className = 'bs-range';
      input.min = String(min); input.max = String(max); input.step = String(step);
      const val = el('span', 'bs-set__value');
      const paint = (v) => {
        val.textContent = fmt(v);
        input.style.setProperty('--p', `${((v - min) / (max - min)) * 100}%`);
      };
      const cur = Number(st?.get?.(key) ?? def);
      input.value = String(Number.isFinite(cur) ? cur : def);
      paint(Number(input.value));
      input.addEventListener('input', () => {
        const v = Number(input.value);
        paint(v);
        this._applySetting(key, v);
      });
      row.append(name, input, val);
      view.inputs[key] = { input, paint };
      return row;
    };

    wrap.append(
      mkRange('sensitivity', S.sensitivity || 'sensitivity', 0.3, 2.5, 0.05, (v) => `${Number(v).toFixed(2)}×`, 1),
      mkRange('volume', S.volume || 'volume', 0, 1, 0.01, (v) => `${Math.round(Number(v) * 100)}%`, 0.8),
    );
    const chk = el('label', 'bs-set bs-set--check');
    const box = document.createElement('input');
    box.type = 'checkbox'; box.className = 'bs-check';
    box.checked = !!st?.get?.('reduceFlicker');
    box.addEventListener('change', () => this._applySetting('reduceFlicker', !!box.checked));
    chk.append(box, el('span', 'bs-set__label', S.reduceFlicker || 'reduceFlicker'));
    view.inputs.reduceFlicker = { input: box, check: true };
    wrap.append(chk);

    this._settingsViews.push(view);
    return wrap;
  }

  _applySetting(key, value) {
    const { settings, bus, audio } = this.ctx;
    try { settings?.set?.(key, value); } catch (e) { /* ignore */ }
    if (key === 'volume') { try { audio?.setMasterVolume?.(value); } catch (e) { /* ignore */ } }
    if (key === 'reduceFlicker') this.root.classList.toggle('bs-calm', !!value);
    bus?.emit?.('settings:change', { key, value });
  }

  _syncSettingsViews() {
    const st = this.ctx.settings;
    for (const v of this._settingsViews) {
      for (const [key, it] of Object.entries(v.inputs)) {
        const val = st?.get?.(key);
        if (it.check) { if (it.input.checked !== !!val) it.input.checked = !!val; }
        else if (val != null && document.activeElement !== it.input && Number(it.input.value) !== Number(val)) {
          it.input.value = String(val); it.paint(Number(val));
        }
      }
    }
  }

  // ===========================================================================
  // 標題
  // ===========================================================================
  /** 標題畫面：標題、注意事項、操作說明、設定（靈敏度/音量/光敏感模式）、開始按鈕。
   *  onStart 必須在 click 事件處理函式內同步呼叫（使用者手勢：AudioContext 與 Pointer Lock 需要）。 */
  showTitle({ onStart } = {}) {
    const T = this.ctx.SCRIPT?.title || {};
    if (!this.titleEl) {
      const t = el('div', 'bs-title');
      t.hidden = true;
      t.setAttribute('role', 'dialog');
      t.setAttribute('aria-label', `${T.zh || ''} ${T.en || ''}`.trim());
      const main = el('div', 'bs-title__main');
      main.append(el('div', 'bs-title__stamp', this.ctx.CLOCK?.start || '02:00'));
      let coarse = false;
      try { coarse = !!window.matchMedia?.('(pointer: coarse)').matches; } catch (e) { /* ignore */ }
      if (coarse) main.append(el('div', 'bs-title__touch', T.touchNotice || TOUCH_NOTICE));
      main.append(el('h1', 'bs-title__zh', T.zh || ''), el('p', 'bs-title__en', T.en || ''));
      const notes = el('ul', 'bs-title__notes');
      for (const n of T.notes || []) notes.append(el('li', '', n));
      main.append(notes);
      const actions = el('div', 'bs-title__actions');
      this.titleStart = el('button', 'bs-title__start');
      this.titleStart.type = 'button';
      this.titleStart.append(el('i', 'bs-tick'), el('span', '', T.start || ''));
      this.titleLoop = el('span', 'bs-title__loop');
      actions.append(this.titleStart, this.titleLoop);
      main.append(actions);
      // 右下角：CAM-03 的頻道說明（淡淡的，只是預告；文字全部來自 SCRIPT.cams）
      const cam = this.ctx.SCRIPT?.cams?.[3];
      if (cam) {
        const feed = el('div', 'bs-title__feed');
        feed.setAttribute('aria-hidden', 'true');
        feed.append(el('div', 'bs-title__feed-head', `${cam.id}  ${cam.place}`), el('div', 'bs-title__feed-rule'), el('div', '', cam.ld));
        main.append(feed);
      }
      const bar = el('footer', 'bs-title__bar');
      bar.append(this._buildControls(), this._buildSettings('row'));
      t.append(main, bar);
      this.root.append(t);
      this.titleEl = t;
      this.titleStart.addEventListener('click', (e) => {
        e.preventDefault();
        if (this._titleStarted) return;
        this._titleStarted = true;
        const fn = this._onStart;
        this._onStart = null;
        try { fn?.(); } catch (err) { console.error('[ui] onStart failed', err); }
        this.hideTitle();
      });
    }
    this._onStart = onStart;
    this._titleStarted = false;
    const n = Number(this.ctx.flags?.loopCount) || 0;
    const loopFn = this.ctx.SCRIPT?.endChoice?.loop;
    this.titleLoop.textContent = n > 0 && typeof loopFn === 'function' ? loopFn(n) : '';
    this.titleLoop.hidden = !(n > 0);
    this._syncSettingsViews();
    reveal(this.titleEl, true, 900);
    setTimeout(() => { try { if (!this.titleEl.hidden) this.titleStart.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
  }

  hideTitle() {
    if (!this.titleEl || this.titleEl.hidden) return;
    this.titleEl.style.pointerEvents = 'none';
    reveal(this.titleEl, false, 900).then(() => { if (this.titleEl) this.titleEl.style.pointerEvents = ''; });
  }

  // ===========================================================================
  // HUD
  // ===========================================================================
  /** 畫面下方中央互動提示：「[E] 檢視　黃色便利貼」。text = null 隱藏。 */
  setPrompt(text, { verb = '檢視', key = 'E' } = {}) {
    const k = text == null || text === '' ? null : `${text}\u0000${verb ?? ''}\u0000${key ?? ''}`;
    if (k === this._prompt.key) return;
    this._prompt.key = k;
    if (k == null) { reveal(this.prompt, false, 400); return; }
    this.promptKey.textContent = key ?? '';
    this.promptKey.hidden = !key;
    this.promptVerb.textContent = verb ?? '';
    this.promptVerb.hidden = !verb;
    // 括號內補充說明以較暗的字呈現；含「警告」時用低彩度警示紅
    this.promptLabel.innerHTML = renderMarkup(String(text), { sfx: true })
      .replace(/<span class="bs-sfx">(（[^<]*警告[^<]*）)<\/span>/g, '<span class="bs-sfx bs-sfx--alert">$1</span>');
    reveal(this.prompt, true, 400);
  }

  /** 準心：'dot'（預設微小點）| 'active'（瞄準可互動物時的細環）| 'hidden' */
  setCrosshair(mode) {
    const m = mode === 'active' || mode === 'hidden' ? mode : 'dot';
    if (m === this._crossMode) return;
    this._crossMode = m;
    this.cross.classList.toggle('is-active', m === 'active');
    this.cross.classList.toggle('is-hidden', m === 'hidden');
  }

  /** 左上角目前目標（淡入淡出）。null 隱藏。 */
  setObjective(text) {
    const t = text == null || text === '' ? null : String(text);
    if (t === this._objective.text) return;
    this._objective.text = t;
    const old = this.objItems[this._objective.flip];
    const wasOn = old.classList.contains('is-on');
    old.style.transitionDelay = '0s';
    old.classList.remove('is-on');
    if (t == null) return;
    this._objective.flip ^= 1;
    const it = this.objItems[this._objective.flip];
    const clock = String(this.ctx.flags?.clockText ?? '');
    it.children[0].textContent = /^\d{1,2}:\d{2}$/.test(clock) ? clock : '';
    it.children[1].innerHTML = renderMarkup(t);
    void it.offsetWidth;
    // 新目標在舊目標淡出一段後才淡入，避免兩行文字重疊
    it.style.transitionDelay = wasOn ? '0.35s' : '0s';
    it.classList.add('is-on');
  }

  /** 暫時提示（操作說明等），seconds 後淡出。 */
  hint(text, seconds = 4) {
    if (text == null || text === '') { this._hint.left = 0; this._hint.on = false; reveal(this.hintEl, false, 700); return; }
    this.hintEl.innerHTML = renderMarkup(String(text));
    this._hint.left = Math.max(0.5, Number(seconds) || 4);
    this._hint.on = true;
    reveal(this.hintEl, true, 600);
  }

  // ===========================================================================
  // 暫停
  // ===========================================================================
  /** 暫停覆蓋層；點擊時 emit 'pause:resume'（PlayerController 會在同一手勢內重新鎖定指標）。 */
  showPause(on) {
    if (on && (this._endVisible || this._creditsVisible)) {
      // 結局選擇 / 名單本身就是需要游標的選單：不顯示暫停層，下一幀自動恢復
      this._autoResume = true;
      return;
    }
    if (!this.pauseEl) {
      const P = this.ctx.SCRIPT?.pause || {};
      const p = el('div', 'bs-pause');
      p.hidden = true;
      p.setAttribute('role', 'dialog');
      p.setAttribute('aria-label', P.title || '');
      const panel = el('div', 'bs-pause__panel');
      panel.append(el('h2', 'bs-pause__title', P.title || ''), el('p', 'bs-pause__resume', P.resume || ''),
        el('div', 'bs-pause__rule'), this._buildSettings('stack'), el('div', 'bs-pause__rule'), this._buildControls());
      p.append(panel);
      let downInControls = false;
      p.addEventListener('mousedown', (e) => { downInControls = !!e.target.closest?.('.bs-settings'); });
      p.addEventListener('click', (e) => {
        if (e.target.closest?.('.bs-settings') || downInControls) { downInControls = false; return; }
        if (!this._pauseOn) return;
        this.ctx.bus?.emit?.('pause:resume');
      });
      this.root.append(p);
      this.pauseEl = p;
    }
    this._pauseOn = !!on;
    if (on) this._syncSettingsViews();
    // 暫停幕的明暗變化與其他亮度變化同一規則（≥ 1.3 秒、對數等速）；光敏感模式再慢 1.5 倍
    const calm = !!this.ctx.settings?.get?.('reduceFlicker');
    reveal(this.pauseEl, !!on, Math.round(PAUSE_FADE_MS * (calm ? 1.5 : 1)));
  }

  // ===========================================================================
  // 過場
  // ===========================================================================
  /** 電影黑邊 0..1（過場用）。 */
  setLetterbox(amount, seconds = 1) {
    const a = Math.min(1, Math.max(0, Number(amount) || 0));
    const L = this._lb;
    L.from = L.cur; L.to = a; L.t = 0; L.dur = Math.max(0, Number(seconds) || 0);
    if (L.dur === 0) { L.cur = a; L.t = 1; this._paintLetterbox(); }
  }

  _paintLetterbox() {
    const s = this._lb.cur.toFixed(4);
    this.lbTop.style.transform = `scaleY(${s})`;
    this.lbBottom.style.transform = `scaleY(${s})`;
  }

  /** 終幕選擇：再次交接（重置循環）/ 工作人員名單。loop = 已完成的循環次數。 */
  showEndChoice({ loop = 1, onRestart, onCredits } = {}) {
    const E = this.ctx.SCRIPT?.endChoice || {};
    // 釋放指標（狀態通常已呼叫 player.unlock()，這裡再保險一次）
    try { this.ctx.player?.unlock?.(); } catch (e) { /* ignore */ }
    try { if (document.pointerLockElement) document.exitPointerLock?.(); } catch (e) { /* ignore */ }

    if (this.endEl) this.endEl.remove();
    const d = el('div', 'bs-end');
    d.hidden = true;
    d.setAttribute('role', 'dialog');
    const inner = el('div', 'bs-end__loop', typeof E.loop === 'function' ? E.loop(loop) : '');
    const rule = el('div', 'bs-end__rule');
    const choices = el('div', 'bs-end__choices');
    const bRestart = el('button', 'bs-btn', E.restart || '');
    const bCredits = el('button', 'bs-btn', E.credits || '');
    bRestart.type = bCredits.type = 'button';
    choices.append(bRestart, bCredits);
    d.append(el('div', 'bs-end__stamp', this.ctx.CLOCK?.start || ''), inner, rule, choices);
    this.root.append(d);
    this.endEl = d;
    this._endVisible = true;
    this._syncMenuClass();
    const shownAt = performance.now();
    let used = false;
    const pick = (fn) => (e) => {
      e.preventDefault();
      if (used || performance.now() - shownAt < 700) return; // 淡入初期的誤觸不算
      used = true;
      this.hideEndChoice();
      try { fn?.(); } catch (err) { console.error('[ui] end choice handler failed', err); }
    };
    bRestart.addEventListener('click', pick(onRestart));
    bCredits.addEventListener('click', pick(onCredits));
    reveal(d, true, 1400);
  }

  hideEndChoice() {
    this._endVisible = false;
    this._syncMenuClass();
    const d = this.endEl;
    if (!d) return;
    d.style.pointerEvents = 'none';
    reveal(d, false, 700).then(() => { if (this.endEl === d) { d.remove(); this.endEl = null; } });
  }

  /** 緩慢淡入淡出的工作人員名單（ctx.SCRIPT.credits），結束後呼叫 onDone。點擊可跳到下一張。 */
  showCredits(credits, { onDone } = {}) {
    const list = Array.isArray(credits) && credits.length ? credits : (this.ctx.SCRIPT?.credits || []);
    const token = ++this._creditsToken;
    try { this.ctx.player?.unlock?.(); } catch (e) { /* ignore */ }
    if (this.creditsEl) this.creditsEl.remove();
    const c = el('div', 'bs-credits');
    c.hidden = true;
    this.root.append(c);
    this.creditsEl = c;
    this._creditsVisible = true;
    this._syncMenuClass();
    let skip = null;
    c.addEventListener('click', () => { skip?.(); });
    const clock = this.ctx.clock;
    const wait = (s) => new Promise((res) => {
      skip = res;
      (clock?.wait ? clock.wait(s) : new Promise((r) => setTimeout(r, s * 1000))).then(res);
    });
    const alive = () => token === this._creditsToken;

    (async () => {
      await reveal(c, true, 1200);
      await new Promise((r) => { const w = clock?.wait ? clock.wait(0.8) : new Promise((q) => setTimeout(q, 800)); w.then(r); });
      for (let i = 0; i < list.length && alive(); i++) {
        const item = list[i] || {};
        const card = el('div', 'bs-credit');
        card.hidden = true;
        if (i === 0) card.classList.add('bs-credit--title');
        if (!item.h) card.classList.add('bs-credit--dedication');
        if (item.h) card.append(el('div', 'bs-credit__h', item.h));
        if (i > 0 && item.h && item.s) card.append(el('div', 'bs-credit__rule'));
        if (item.s) card.append(el('div', 'bs-credit__s', item.s));
        c.append(card);
        reveal(card, true, 1600);
        await wait(1.6 + (i === 0 || !item.h ? 3.8 : 3.0));
        if (!alive()) return;
        reveal(card, false, 1500).then(() => card.remove());
        await wait(1.9);
      }
      if (!alive()) return;
      this._creditsVisible = false;
      this._syncMenuClass();
      try { onDone?.(); } catch (err) { console.error('[ui] credits onDone failed', err); }
      if (this.creditsEl === c) {
        c.style.pointerEvents = 'none';
        reveal(c, false, 1400).then(() => { if (this.creditsEl === c) { c.remove(); this.creditsEl = null; } });
      }
    })();
  }

  /** 全螢幕錯誤訊息（WebGL 失敗等）。 */
  showError(msg) {
    if (!this.errorEl) {
      this.errorEl = el('div', 'bs-error');
      this.errorEl.hidden = true;
      this.errorEl.setAttribute('role', 'alert');
      this.errorBox = el('div', 'bs-error__box');
      this.errorEl.append(this.errorBox);
      this.root.append(this.errorEl);
    }
    this.errorBox.textContent = String(msg ?? '');
    reveal(this.errorEl, true, 600);
  }

  hideAll() {
    this.hideTitle();
    this.setPrompt(null);
    this.setCrosshair('hidden');
    this.setObjective(null);
    this.hint(null);
    if (this.pauseEl && !this.pauseEl.hidden) { this._pauseOn = false; reveal(this.pauseEl, false, 400); }
    this.setLetterbox(0, 0.6);
    this.hideEndChoice();
    if (this.creditsEl) {
      this._creditsToken++;
      this._creditsVisible = false;
      this._syncMenuClass();
      const c = this.creditsEl;
      c.style.pointerEvents = 'none';
      reveal(c, false, 700).then(() => { if (this.creditsEl === c) { c.remove(); this.creditsEl = null; } });
    }
  }

  _syncMenuClass() { this.root.classList.toggle('bs-menu', !!(this._endVisible || this._creditsVisible)); }

  /** 除錯資訊（?debug=1 時右上角顯示）。 */
  debugText(str) {
    if (!this.ctx.debug || !this.debugEl) return;
    this.debugEl.textContent = String(str ?? '');
  }

  update(dt, t) {
    // 暫時提示（遊戲時間；暫停時凍結）
    if (this._hint.on) {
      this._hint.left -= dt;
      if (this._hint.left <= 0) { this._hint.on = false; reveal(this.hintEl, false, 900); }
    }
    // 電影黑邊
    const L = this._lb;
    if (L.t < 1) {
      L.t = L.dur > 0 ? Math.min(1, L.t + dt / L.dur) : 1;
      const k = L.t < 0.5 ? 2 * L.t * L.t : 1 - Math.pow(-2 * L.t + 2, 2) / 2;
      L.cur = L.from + (L.to - L.from) * k;
      this._paintLetterbox();
    }
    // 結局選擇/名單期間被要求暫停 → 自動恢復（不顯示暫停層、不重新鎖定指標）
    if (this._autoResume) {
      this._autoResume = false;
      if (this.ctx.clock?.paused && (this._endVisible || this._creditsVisible)) {
        try { this.ctx.setPaused?.(false); } catch (e) { /* ignore */ }
      }
    }
  }
}
