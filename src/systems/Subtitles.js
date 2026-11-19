// =============================================================================
// Subtitles — 字幕系統（對講機、獨白、舞台指示）
// 【API 骨架 / CONTRACT STUB】
// 樣式：
//   'normal'    畫面下方，說話者標籤＋文字（對講機）
//   'monologue' 畫面中下方置中、較大、緩慢淡入淡出（終幕獨白）
//   'direction' 括號舞台指示，較暗、較小（「右手握著筆……」）
// 文字支援 **粗體** 與 *斜體* 標記。
// =============================================================================
export class Subtitles {
  constructor(ctx) { this.ctx = ctx; this.visible = false; this.text = ''; }
  init() {}
  /** 顯示一行字幕。duration = null → 一直顯示直到 clear()/下一次 show()。 */
  show(text, { speaker = null, duration = null, style = 'normal' } = {}) { this.text = text; this.visible = true; }
  /** 在目前字幕後面追加文字（對講機逐段累加，最終字串 = 原企劃全文）。 */
  append(text) { this.text += text; }
  /** 淡出清除。 */
  clear(fade = 0.6) { this.visible = false; this.text = ''; }
  /** 依序播放多行：[{ text, dur, speaker?, style?, gap? }]，回傳 Promise（使用遊戲時間，暫停時凍結）。 */
  async play(lines) { for (const l of lines) { this.show(l.text, l); await this.ctx.clock.wait(l.dur ?? 3); } this.clear(); }
  update(dt, t) {}
}
