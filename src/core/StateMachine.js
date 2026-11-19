// 劇情狀態機。每次切換狀態都會遞增 epoch；BaseState 的 wait/tween/until
// 會在 epoch 改變後永遠不 resolve，藉此安全地「取消」舊狀態仍在跑的 async 腳本。
export const STATES = {
  TITLE: 'TITLE',
  PROLOGUE: 'STATE_PROLOGUE',
  MONITORING: 'STATE_MONITORING',
  BLACKOUT_CORRIDOR: 'STATE_BLACKOUT_CORRIDOR',
  REVELATION: 'STATE_REVELATION',
  ENDING_LOOP: 'STATE_ENDING_LOOP',
};

export class StateMachine {
  constructor(ctx) {
    this.ctx = ctx;
    this.states = new Map();
    this.current = null;
    this.currentName = null;
    this.epoch = 0;
    this.history = [];
  }
  register(name, state) { state.name = name; state.fsm = this; state.ctx = this.ctx; this.states.set(name, state); }
  go(name, data = {}) {
    const next = this.states.get(name);
    if (!next) throw new Error(`[fsm] unknown state ${name}`);
    const prev = this.current;
    this.epoch++;
    if (prev) {
      try { prev._cleanup(); prev.exit?.(name); } catch (e) { console.error('[fsm] exit error', e); }
    }
    this.current = next;
    this.currentName = name;
    this.history.push(name);
    next._epoch = this.epoch;
    this.ctx.bus.emit('state:change', { from: prev?.name ?? null, to: name, data });
    console.info(`[fsm] → ${name}`);
    try {
      const r = next.enter?.(data);
      if (r && typeof r.catch === 'function') r.catch((e) => console.error(`[fsm] ${name}.enter rejected`, e));
    } catch (e) { console.error(`[fsm] ${name}.enter error`, e); }
  }
  update(dt, t) { try { this.current?.update?.(dt, t); } catch (e) { console.error('[fsm] update error', e); } }
}

// 所有劇情狀態的基底類別
export class BaseState {
  constructor() { this.ctx = null; this.fsm = null; this.name = ''; this._epoch = -1; this._disposers = []; }
  get alive() { return this.fsm && this.fsm.epoch === this._epoch; }
  // 遊戲時間等待；狀態已切換則永不 resolve（腳本自然中止）
  wait(sec) { const ep = this._epoch; return this._guard(this.ctx.clock.wait(sec), ep); }
  tween(dur, fn, ease) {
    const ep = this._epoch;
    return this._guard(this.ctx.clock.tween(dur, (e, k) => { if (this.fsm.epoch === ep) fn(e, k); }, ease), ep);
  }
  // 每幀檢查條件，成立時 resolve
  until(pred, poll = 0) {
    const ep = this._epoch;
    return this._guard(new Promise((resolve) => {
      const check = async () => {
        while (this.fsm.epoch === ep) {
          let ok = false;
          try { ok = pred(); } catch (e) { console.error('[state] until predicate threw', e); }
          if (ok) return resolve();
          await this.ctx.clock.wait(poll);
        }
      };
      check();
    }), ep);
  }
  // 等待匯流排事件
  event(type, filter) { const ep = this._epoch; return this._guard(this.ctx.bus.wait(type, filter), ep); }
  // 包裝外部 promise（例如 audio.playIntercom().done）
  guard(promise) { return this._guard(promise, this._epoch); }
  _guard(promise, ep) {
    return new Promise((resolve, reject) => {
      promise.then((v) => { if (this.fsm.epoch === ep) resolve(v); }, (e) => { if (this.fsm.epoch === ep) reject(e); });
    });
  }
  // 登記離開狀態時要執行的清理（例如 bus.on 的 off 函式、interact.remove）
  own(disposer) { if (typeof disposer === 'function') this._disposers.push(disposer); return disposer; }
  _cleanup() { for (const d of this._disposers.splice(0)) { try { d(); } catch (e) { console.error(e); } } }
}
