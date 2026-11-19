// =============================================================================
// Interaction — 準心射線互動系統
// 【API 骨架 / CONTRACT STUB】
// * 每幀由相機中心發出 Raycaster（只對已註冊的物件，recursive），取距離 ≤ distance 的最近目標。
// * 有目標時：ui.setPrompt(label, { verb })、ui.setCrosshair('active')；否則清除。
// * E 鍵或（指標鎖定時的）滑鼠左鍵 → onUse()；emit 'interact:use' { id }。
// * locked = true（過場中）或 inspect 開啟或 player.enabled = false 時，不偵測也不觸發。
// * label / verb / enabled 可以是函式（每幀求值），讓同一物件依劇情狀態改變提示。
// =============================================================================
export class Interaction {
  constructor(ctx) { this.ctx = ctx; this.items = new Map(); this.current = null; this.locked = false; }
  init() {}
  /** @param {{ id: string, object: import('three').Object3D, label: string|Function, verb?: string|Function, enabled?: boolean|Function, distance?: number, onUse: Function }} o */
  add(o) { this.items.set(o.id, { verb: '檢視', enabled: true, distance: 2.3, ...o }); return o.id; }
  remove(id) { this.items.delete(id); if (this.current === id) this.current = null; }
  has(id) { return this.items.has(id); }
  setEnabled(id, on) { const it = this.items.get(id); if (it) it.enabled = on; }
  /** 測試/除錯：直接觸發。 */
  trigger(id) { const it = this.items.get(id); if (it) { it.onUse?.(); this.ctx.bus.emit('interact:use', { id }); } }
  update(dt, t) {}
}
