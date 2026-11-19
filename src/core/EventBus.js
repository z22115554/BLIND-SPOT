// 極簡事件匯流排：模組之間的鬆耦合溝通。
export class EventBus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }
  once(type, fn) {
    const off = this.on(type, (p) => { off(); fn(p); });
    return off;
  }
  off(type, fn) { this.map.get(type)?.delete(fn); }
  emit(type, payload) {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error(`[bus] handler for "${type}" threw`, err); }
    }
  }
  // 等待某事件（可選擇過濾條件）
  wait(type, filter = null) {
    return new Promise((resolve) => {
      const off = this.on(type, (p) => { if (!filter || filter(p)) { off(); resolve(p); } });
    });
  }
}
