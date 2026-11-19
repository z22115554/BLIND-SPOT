// =============================================================================
// InspectView — 物件檢視（「低頭檢視物品」）
// 【API 骨架 / CONTRACT STUB】
// 開啟時：背景變暗（postfx.params.dim），右/下方顯示標題＋內文（支援 **粗體** *斜體*，段落陣列），
// 若提供 object，於畫面中央以獨立小場景渲染其 clone（自身燈光），可用滑鼠拖曳/移動旋轉。
// 開啟期間：玩家無法移動與環顧、GazeSystem 視為「沒有在看監視器」（這是盲區機制的關鍵）。
// 關閉：E、滑鼠左/右鍵（開啟後 0.4 秒內忽略，避免同一次點擊立刻關閉）。
// 事件：'inspect:open' { id } / 'inspect:close' { id }
// =============================================================================
export class InspectView {
  constructor(ctx) { this.ctx = ctx; this.isOpen = false; }
  init() {}
  /** @param {{ id?: string, title: string, body: string[], object?: import('three').Object3D, scale?: number, onClose?: Function }} o
   *  @returns {Promise<void>} 關閉時 resolve */
  open(o) { this.isOpen = true; this.ctx.bus.emit('inspect:open', { id: o.id }); return new Promise((res) => { this._resolve = res; }); }
  close() { if (!this.isOpen) return; this.isOpen = false; this.ctx.bus.emit('inspect:close', {}); this._resolve?.(); }
  update(dt, t) {}
  /** 主畫面渲染之後呼叫：疊加渲染檢視物件（renderer.autoClear 需自行處理）。 */
  renderOverlay(renderer) {}
}
