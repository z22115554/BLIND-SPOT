import { clamp, ease as EASE } from './util.js';

// 可暫停的遊戲時間。所有劇情計時（wait / tween）都必須使用遊戲時間，
// 讓「暫停」能凍結整個時間軸（音訊也會一起 suspend）。
export class GameClock {
  constructor() {
    this.time = 0;        // 累計遊戲秒數（暫停時不前進）
    this.dt = 0;          // 本幀遊戲 dt（暫停時為 0）
    this.realTime = 0;    // 累計真實秒數
    this.paused = false;
    this._timers = [];    // { at, resolve }
    this._tweens = [];    // { start, dur, fn, ease, resolve }
  }
  tick(realDt) {
    realDt = clamp(realDt, 0, 0.1 * (this.scale || 1)); // 分頁切回時避免巨大 dt
    this.realTime += realDt;
    this.dt = this.paused ? 0 : realDt;
    if (this.paused) return;
    this.time += realDt;
    // 計時器
    if (this._timers.length) {
      const due = this._timers.filter((t) => t.at <= this.time);
      if (due.length) {
        this._timers = this._timers.filter((t) => t.at > this.time);
        for (const t of due) t.resolve();
      }
    }
    // 補間
    if (this._tweens.length) {
      for (const tw of [...this._tweens]) {
        const k = tw.dur <= 0 ? 1 : clamp((this.time - tw.start) / tw.dur);
        try { tw.fn(tw.ease(k), k); } catch (e) { console.error('[clock] tween error', e); }
        if (k >= 1) { this._tweens.splice(this._tweens.indexOf(tw), 1); tw.resolve(); }
      }
    }
  }
  // 等待遊戲秒數
  wait(sec) {
    return new Promise((resolve) => this._timers.push({ at: this.time + Math.max(0, sec), resolve }));
  }
  // fn(easedT, rawT) 每幀呼叫，完成時 resolve。ease 可為名稱或函式。
  tween(dur, fn, ease = 'inOut') {
    const e = typeof ease === 'function' ? ease : (EASE[ease] || EASE.inOut);
    return new Promise((resolve) => {
      const tw = { start: this.time, dur, fn, ease: e, resolve };
      this._tweens.push(tw);
      fn(e(0), 0);
    });
  }
  cancelAll() { this._timers = []; this._tweens = []; }
}
