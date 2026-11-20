// =============================================================================
// 劇情狀態註冊
//   TITLE ─click→ PROLOGUE ─讀便利貼→ MONITORING ─02:14→ BLACKOUT_CORRIDOR
//     ─復電後回主控室→ REVELATION ─聽完錄音→ ENDING_LOOP ─選擇→ PROLOGUE（循環）／名單
// 每個狀態的 enter() 都能直接進入（?state=NAME）：先套用 common.applyPreset 的世界預設。
// =============================================================================
import { STATES } from '../core/StateMachine.js';
import { registerCommonInteractables } from './common.js';
import { TitleState } from './TitleState.js';
import { PrologueState } from './PrologueState.js';
import { MonitoringState } from './MonitoringState.js';
import { BlackoutCorridorState } from './BlackoutCorridorState.js';
import { RevelationState } from './RevelationState.js';
import { EndingLoopState } from './EndingLoopState.js';

export function registerStates(ctx) {
  ctx.fsm.register(STATES.TITLE, new TitleState());
  ctx.fsm.register(STATES.PROLOGUE, new PrologueState());
  ctx.fsm.register(STATES.MONITORING, new MonitoringState());
  ctx.fsm.register(STATES.BLACKOUT_CORRIDOR, new BlackoutCorridorState());
  ctx.fsm.register(STATES.REVELATION, new RevelationState());
  ctx.fsm.register(STATES.ENDING_LOOP, new EndingLoopState());
  try { registerCommonInteractables(ctx); } catch (e) { console.error('[states] registerCommonInteractables failed', e); }
}
