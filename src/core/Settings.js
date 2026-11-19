// 玩家設定（localStorage 失敗時退回預設值，不影響遊戲運作）
const KEY = 'blindspot.settings.v1';
const DEFAULTS = { sensitivity: 1.0, volume: 0.8, reduceFlicker: false, loopCount: 0 };

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch { /* 私密模式或被封鎖：使用預設值 */ }
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    this.data[k] = v;
    try { window.localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
  }
}
