// =============================================================================
// ResolutionGovernor — 像素比上限＋自動解析度（效能保護）
// * 像素比上限 1.5：高 DPI 筆電（175% 縮放）不會以 3360×1890 渲染整個 HDR + MSAA 管線。
// * 自動降階：畫面持續偏慢（平均幀時間 > 21.5 ms，約 46 fps 以下）3 秒 → 像素比降一階（×0.85 / ×0.72 / ×0.6）；
//   持續流暢（< 18.5 ms）10 秒 → 升回一階。任兩次變更至少相隔 4～6 秒；升階後很快又變慢（這台機器撐不住）
//   會讓下一次升階的冷卻時間加倍，避免畫面忽清忽糊。超過 0.25 秒的單幀（分頁切換、shader 編譯）不列入統計。
// * ?pr=<數字> 固定像素比（關閉自動調整）；?adaptive=0 關閉自動調整；自動化測試（navigator.webdriver）不調整，
//   讓截圖解析度固定。
// * 可選參數 { cap, slowDt, fastDt }（ctx.quality 的手機預設：像素比上限 1.25、較寬鬆的降階門檻）；省略＝桌機原值。
// =============================================================================
export const PIXEL_RATIO_CAP = 1.5;
const STEPS = [1, 0.85, 0.72, 0.6];
const SLOW_DT = 0.0215, FAST_DT = 0.0185;
const SLOW_HOLD = 3, FAST_HOLD = 10;

export class ResolutionGovernor {
  constructor({ params = null, cap = PIXEL_RATIO_CAP, slowDt = SLOW_DT, fastDt = FAST_DT } = {}) {
    const forced = Number(params?.get?.('pr'));
    this.forced = Number.isFinite(forced) && forced > 0 ? Math.min(3, Math.max(0.25, forced)) : null;
    let webdriver = false;
    try { webdriver = !!navigator.webdriver; } catch (e) { /* ignore */ }
    this.adaptive = !this.forced && !webdriver && params?.get?.('adaptive') !== '0';
    this.cap = cap;
    this.slowDt = slowDt;
    this.fastDt = fastDt;
    this.level = 0;
    this.avgDt = 1 / 60;
    this.onApply = null;      // main.js：重新套用 renderer / composer 尺寸
    this._slow = 0;
    this._fast = 0;
    this._cool = 2;
    this._upBlock = 0;
    this._upFails = 0;
    this._sinceUp = Infinity;
    this.changes = [];        // 除錯：{ at, level, pr }
  }

  /** 目前應使用的像素比。 */
  pixelRatio() {
    if (this.forced) return this.forced;
    const base = Math.min(window.devicePixelRatio || 1, this.cap);
    return Math.max(0.5, base * STEPS[this.level]);
  }

  onDprChange() { /* pixelRatio() 每次都重新讀 devicePixelRatio；保留給 main.js 呼叫 */ }

  /** 每幀（未暫停、分頁可見、畫面不是全黑時）回報真實幀時間。 */
  sample(realDt) {
    if (!this.adaptive || !(realDt > 0)) return;
    if (realDt > 0.25) return;                 // 卡頓/切換分頁：不列入
    const a = 1 - Math.exp(-realDt / 0.6);     // 約 0.6 秒的平均
    this.avgDt += (realDt - this.avgDt) * a;
    this._cool -= realDt;
    this._upBlock -= realDt;
    this._sinceUp += realDt;
    if (this.avgDt > this.slowDt) { this._slow += realDt; this._fast = 0; }
    else if (this.avgDt < this.fastDt) { this._fast += realDt; this._slow = 0; }
    else { this._slow = Math.max(0, this._slow - realDt); this._fast = Math.max(0, this._fast - realDt); }

    if (this._slow >= SLOW_HOLD && this._cool <= 0 && this.level < STEPS.length - 1) {
      if (this._sinceUp < 12) { this._upFails++; this._upBlock = 20 * Math.pow(2, this._upFails); }
      this._set(this.level + 1, 4);
    } else if (this._fast >= FAST_HOLD && this._cool <= 0 && this._upBlock <= 0 && this.level > 0) {
      this._sinceUp = 0;
      this._set(this.level - 1, 6);
    }
  }

  _set(level, cool) {
    this.level = level;
    this._cool = cool;
    this._slow = 0;
    this._fast = 0;
    this.changes.push({ at: Math.round(performance.now()), level, pr: +this.pixelRatio().toFixed(3) });
    try { this.onApply?.(); } catch (e) { console.warn('[resolution] apply failed', e); }
  }
}
