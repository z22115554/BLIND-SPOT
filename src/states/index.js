// =============================================================================
// 劇情狀態註冊
// 【API 骨架 / CONTRACT STUB】由 States 實作者完成各狀態檔案。
// =============================================================================
import { BaseState, STATES } from '../core/StateMachine.js';

class StubState extends BaseState {
  enter(data) { console.info('[stub state]', this.name, data); }
}

class TitleStub extends BaseState {
  enter({ next } = {}) {
    const ctx = this.ctx;
    const start = () => { ctx.audio.unlock(); ctx.player.lock(); ctx.fsm.go(next || STATES.PROLOGUE); };
    if (ctx.params.has('autostart')) { start(); return; }
    ctx.ui.showTitle({ onStart: start });
  }
}

export function registerStates(ctx) {
  ctx.fsm.register(STATES.TITLE, new TitleStub());
  for (const s of [STATES.PROLOGUE, STATES.MONITORING, STATES.BLACKOUT_CORRIDOR, STATES.REVELATION, STATES.ENDING_LOOP]) {
    ctx.fsm.register(s, new StubState());
  }
}
