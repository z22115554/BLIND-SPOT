// =============================================================================
// Subtitles — 字幕系統（對講機、獨白、舞台指示）
// 【API 骨架 / CONTRACT STUB】
// 樣式：
//   'normal'    畫面下方，說話者標籤＋文字（對講機）
//   'monologue' 畫面中下方置中、較大、緩慢淡入淡出（終幕獨白）
//   'direction' 括號舞台指示，較暗、較小（「右手握著筆……」）
// 文字支援 **粗體** 與 *斜體* 標記。
// -----------------------------------------------------------------------------
// 實作說明：
//   * 每次 show() 建立一個新的「字幕行」元素；舊行先淡出、新行稍後淡入（同一格位疊放，不會跳版）。
//   * append() 追加的片段以 0.6 秒淡入（對講機逐段累加，最終畫面字串 = 原企劃全文）。
//   * 全形括號內的聲音描述（例如「（急促且沉重的喘息聲）」）以較暗的字呈現，像隱藏式字幕的音效說明。
//   * 'normal' 有柔邊半透明底，亮場景與暗場景都看得清楚；'monologue' 用 FONTS.serif、1.2 秒淡入淡出、無說話者。
//   * 所有計時用 ctx.clock.wait（遊戲時間，暫停時凍結）。
// =============================================================================
import { FONTS } from '../gfx/canvasUtil.js';
import { injectStyle, uiRoot, el, renderMarkup, baseCss } from './uiCommon.js';

const FADE = { normal: 0.45, direction: 0.6, monologue: 1.2 };

const CSS = `
.bs-subs { position: absolute; left: 50%; bottom: calc(max(2.4em, 7.5vh) + 3.4em); transform: translateX(-50%); z-index: 3;
  display: grid; justify-items: center; align-items: end; width: min(42em, 92vw); pointer-events: none; }
.bs-mono { position: absolute; left: 50%; top: 62%; transform: translate(-50%, -50%); z-index: 3;
  display: grid; justify-items: center; align-items: center; width: min(40em, 90vw); pointer-events: none; }
.bs-sub { grid-area: 1 / 1; position: relative; isolation: isolate; max-width: 100%; text-align: center; opacity: 0;
  transition-property: opacity; transition-timing-function: ease; }
.bs-sub.is-on { opacity: 1; }
/* 柔邊暗幕：不是裝飾，是讓字幕在亮場景（日光燈下的控制台）與暗場景都讀得清楚 */
.bs-sub::before { content: ''; position: absolute; z-index: -1; inset: -1.1em -2.6em; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(3, 3, 3, 0.7), rgba(3, 3, 3, 0.55) 50%, rgba(3, 3, 3, 0.2) 80%, rgba(3, 3, 3, 0) 100%); }
.bs-sub--normal { padding: 0.55em 1.35em 0.7em; }
.bs-sub__speaker { display: flex; align-items: center; justify-content: center; gap: 0.75em; margin-bottom: 0.45em;
  font-size: 0.74em; letter-spacing: 0.32em; color: var(--bs-amber); text-shadow: 0 0 0.4em rgba(0, 0, 0, 0.9); }
.bs-sub__speaker::before, .bs-sub__speaker::after { content: ''; width: 1.5em; height: 1px; background: rgba(216, 176, 74, 0.42); }
.bs-sub__text { font-size: 1.22em; line-height: 1.7; letter-spacing: 0.06em; color: var(--bs-fg); text-wrap: balance;
  text-shadow: 0 0 0.2em rgba(0, 0, 0, 0.95), 0 0 0.8em rgba(0, 0, 0, 0.7); }
.bs-sub__text strong { font-weight: 700; color: var(--bs-bright); }
.bs-sub__text em { font-style: italic; }
.bs-sub .bs-sfx { color: #a29c8f; font-size: 0.86em; letter-spacing: 0.1em; }
.bs-seg--new { animation: bs-seg-in 0.6s ease both; }
@keyframes bs-seg-in { from { opacity: 0; } to { opacity: 1; } }

.bs-sub--monologue { padding: 0.5em 1.2em; }
.bs-sub--monologue::before { inset: -1.4em -3.2em; }
.bs-sub--monologue .bs-sub__text { font-family: var(--bs-serif); font-size: 1.72em; line-height: 1.85; letter-spacing: 0.16em;
  color: #e6e1d4; text-shadow: 0 0 0.35em rgba(0, 0, 0, 0.92), 0 0 1.4em rgba(0, 0, 0, 0.65); }
.bs-sub--monologue .bs-sfx { color: var(--bs-dim); }

.bs-sub--direction { padding: 0.45em 1.2em; }
.bs-sub--direction::before { inset: -1.2em -2.4em; }
.bs-sub--direction .bs-sub__text { font-size: 1.02em; font-style: italic; letter-spacing: 0.14em; color: #b3ad9f;
  text-shadow: 0 0 0.3em rgba(0, 0, 0, 0.95), 0 0 0.9em rgba(0, 0, 0, 0.75); }
.bs-sub--direction .bs-sfx { color: inherit; font-size: 1em; }

@media (max-width: 640px) {
  .bs-subs { width: 94vw; }
  .bs-sub::before { inset: -0.5em -0.8em; }
  .bs-sub__text { font-size: 1.12em; }
  .bs-sub--monologue .bs-sub__text { font-size: 1.42em; letter-spacing: 0.1em; }
}
`;

export class Subtitles {
  constructor(ctx) {
    this.ctx = ctx;
    this.visible = false;
    this.text = '';
    this.style = 'normal';
    this.speaker = null;
    this._line = null;         // 目前的字幕行 { el, textEl, style }
    this._showToken = 0;
    this._playToken = 0;

    const root = uiRoot();
    injectStyle('bs-ui-base', baseCss(FONTS));
    injectStyle('bs-subs-style', CSS);
    this.box = el('div', 'bs-subs');
    this.box.setAttribute('aria-live', 'polite');
    this.monoBox = el('div', 'bs-mono');
    this.monoBox.setAttribute('aria-live', 'polite');
    root.append(this.box, this.monoBox);
  }

  init() {}

  /** 顯示一行字幕。duration = null → 一直顯示直到 clear()/下一次 show()。 */
  show(text, { speaker = null, duration = null, style = 'normal' } = {}) {
    const st = FADE[style] != null ? style : 'normal';
    const hadVisible = this._retire();
    const line = this._makeLine(st, st === 'monologue' ? null : speaker);
    this._line = line;
    this.text = String(text ?? '');
    this.style = st;
    this.speaker = st === 'monologue' ? null : speaker;
    this.visible = true;
    if (this.text) this._addSegment(this.text, false);

    // 舊行淡出一段時間後才淡入新行，避免兩行字重疊
    const fade = FADE[st];
    const delay = hadVisible ? Math.min(0.9, (st === 'monologue' ? 0.85 : 0.6) * fade + 0.05) : 0;
    line.el.style.transitionDuration = `${fade}s`;
    line.el.style.transitionDelay = `${delay}s`;
    void line.el.offsetWidth;
    line.el.classList.add('is-on');

    const tok = ++this._showToken;
    if (duration != null && Number(duration) > 0) {
      this.ctx.clock.wait(Number(duration)).then(() => { if (tok === this._showToken) this.clear(); });
    }
  }

  /** 在目前字幕後面追加文字（對講機逐段累加，最終字串 = 原企劃全文）。 */
  append(text) {
    const s = String(text ?? '');
    if (!this._line || !this.visible) { this.show(s, { speaker: this.speaker, style: this.style }); return; }
    if (!s) return;
    this.text += s;
    this._addSegment(s, true);
  }

  /** 淡出清除。 */
  clear(fade = 0.6) {
    this._showToken++;
    const f = Number(fade);
    this._retire(Number.isFinite(f) ? f : 0.6);
    this._line = null;
    this.visible = false;
    this.text = '';
  }

  /** 依序播放多行：[{ text, dur, speaker?, style?, gap? }]，回傳 Promise（使用遊戲時間，暫停時凍結）。 */
  async play(lines) {
    const tok = ++this._playToken;
    const clock = this.ctx.clock;
    for (const l of lines || []) {
      if (tok !== this._playToken) return;
      this.show(l.text, { speaker: l.speaker ?? null, style: l.style ?? 'normal' });
      await clock.wait(l.dur ?? 3);
      if (tok !== this._playToken) return;
      if (l.gap) {
        this.clear(l.style === 'monologue' ? FADE.monologue : 0.6);
        await clock.wait(l.gap);
      }
    }
    if (tok === this._playToken) this.clear(this.style === 'monologue' ? FADE.monologue : 0.6);
  }

  /** 中止進行中的 play()（不清除畫面上的字幕）。 */
  stop() { this._playToken++; }

  update(dt, t) {}

  // ---------------------------------------------------------------------------
  _makeLine(style, speaker) {
    const node = el('div', `bs-sub bs-sub--${style}`);
    if (style === 'normal' && speaker) node.append(el('div', 'bs-sub__speaker', String(speaker)));
    const textEl = el('div', 'bs-sub__text');
    node.append(textEl);
    (style === 'monologue' ? this.monoBox : this.box).append(node);
    return { el: node, textEl, style };
  }

  _addSegment(s, animate) {
    const span = el('span', animate ? 'bs-seg bs-seg--new' : 'bs-seg');
    span.innerHTML = renderMarkup(s, { sfx: true });
    this._line.textEl.append(span);
  }

  /** 讓目前的字幕行淡出並移除。回傳是否有可見的字幕行。 */
  _retire(fade = null) {
    const line = this._line;
    if (!line) return false;
    const wasOn = line.el.classList.contains('is-on');
    let f = fade == null ? FADE[line.style] * 0.9 : fade;
    if (line.style === 'monologue' && fade != null && fade > 0) f = Math.max(fade, FADE.monologue);
    f = Math.max(0, f);
    line.el.style.transitionDelay = '0s';
    line.el.style.transitionDuration = `${f}s`;
    line.el.classList.remove('is-on');
    const node = line.el;
    setTimeout(() => node.remove(), f * 1000 + 60);
    this._line = null;
    return wasOn;
  }
}
