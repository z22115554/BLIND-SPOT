// =============================================================================
// TitleState — 標題畫面
// 點擊（使用者手勢）→ audio.unlock() + player.lock() + 隱藏標題 → 下一個狀態（預設 PROLOGUE）。
// ?autostart=1 直接開始。標題期間：畫面保持全黑（postfx.fade = 1）、玩家停用、不可互動。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import { StoryState, T } from './common.js';

export class TitleState extends StoryState {
  enter(data = {}) {
    const ctx = this.ctx;
    const next = data.next && [...Object.values(STATES)].includes(data.next) && data.next !== STATES.TITLE ? data.next : STATES.PROLOGUE;
    this._hold();
    let started = false;
    const start = () => {
      if (started || !this.alive) return;
      started = true;
      // 必須在 click 的同步呼叫堆疊內：AudioContext 與 Pointer Lock 都需要使用者手勢
      try {
        const r = ctx.audio?.unlock?.();
        if (r && typeof r.catch === 'function') r.catch((e) => console.warn('[title] audio unlock', e));
      } catch (e) { console.warn('[title] audio unlock', e); }
      T(() => ctx.player?.lock?.(), 'player.lock');
      T(() => ctx.ui?.hideTitle?.(), 'hideTitle');
      ctx.fsm.go(next);
    };
    /** 公開的開始函式（UI 的 onStart；自動化測試也可直接呼叫） */
    this.start = start;
    if (ctx.params?.has?.('autostart')) { start(); return; }
    T(() => ctx.ui?.showTitle?.({ onStart: start }), 'showTitle');
  }
  _hold() {
    const ctx = this.ctx;
    if (ctx.postfx?.params) ctx.postfx.params.fade = 1;
    if (ctx.player) ctx.player.enabled = false;
  }
  tick() { this._hold(); }
}
