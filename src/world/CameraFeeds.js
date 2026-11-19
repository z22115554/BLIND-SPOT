// =============================================================================
// CameraFeeds — CCTV 監視系統（4 個獨立 THREE.Scene → WebGLRenderTarget → 主 CRT 螢幕）
// 【API 骨架 / CONTRACT STUB】實作者必須保留所有公開方法/屬性。
//
// 每個頻道是一個獨立的小場景（自有燈光/霧），有 LD（前期）與 HD（後期）兩種佈置：
//   CAM-01 北向隧道入口：LD 濃霧、能見度極低 ／ HD 濃煙全面阻斷、封閉柵欄、緊急燈
//   CAM-02 主車道中段：LD 遠處一團模糊的熱源亮斑 ／ HD 燃燒中的多車追撞殘骸＋翻覆油罐車、橘色火光緩慢搖曳
//   CAM-03 公務維修廊道 B區（攝影機裝在防爆門上方、俯視廊道）：反光雨衣人影（Figure.js）
//           LD：人影只在「沒有被看著」時推進（見下方盲區規則）
//           HD：看清楚是融化面罩、隧道救援隊制服、手握破門斧的消防員，正在劈砍/撬防爆門（此時有動作）
//   CAM-04 4號緊急停車彎：LD 一輛熄火的白色轎車（駕駛座車門開著）／ HD 沒有車，只有褪色的警方封鎖線與焦黑牆面
//
// CRT 螢幕材質（shaders/CRTShader.js）：
//   LD：低解析度（約 160×120 取樣）、黑白、強雜訊、掃描線、滾動干擾條、輕微桶形變形、OSD 疊字
//   HD：640×480 彩色、乾淨、僅保留極淡掃描線
//   STATIC：雪花雜訊（低對比、亮度穩定；光敏感模式下改為緩慢流動的噪點）
//   OFF：黑屏（極淡反光）
//   BOOT：開機（亮點→展開→頻寬限制解除字樣→HD）
// OSD：左上「CAM-0n 地點」、左下狀態標籤（ctx.SCRIPT.cams[n].ld / .hd）、右上「REC ●」與時間戳
//      （ctx.flags.clockText + 秒數）。字型 FONTS.mono / FONTS.ui。
//
// ★ 盲區規則（Frustum Culling 應用，於 update() 實作）：
//   observed03 = mode === 'LD' && channel === 3 && ctx.gaze.mainScreenObserved
//   * observed03 持續 ≥ 0.8 秒 → seenSinceMove = true
//   * observed03 為 false 持續 ≥ 0.5 秒，且 (seenSinceMove 或 figureIndex < limits.min)，
//     且 figureIndex < limits.max → figureIndex++（瞬間換位置與姿勢，沒有任何移動動畫），
//     seenSinceMove = false，emit 'feeds:figureMoved' { index }
//   * observed03 為 true 時，人影「不得有任何變化」：沒有呼吸、擺動、動畫。
//   * 只渲染目前頻道（LD 以約 10fps 更新 render target 營造 CCTV 頓挫感；HD 30fps）。
// =============================================================================
import * as THREE from 'three';

export const FIGURE_STEPS = 8; // CAM-03 人影的位置數（index 0 = 最遠，面壁；7 = 防爆門前）

export class CameraFeeds {
  constructor(ctx) {
    this.ctx = ctx;
    this.channel = 3;           // 1..4
    this.mode = 'OFF';          // 'OFF' | 'LD' | 'STATIC' | 'BOOT' | 'HD'
    this.figureIndex = 0;       // 0..FIGURE_STEPS-1
    this.limits = { min: 0, max: 0 };
    this.hdAction = false;
    this.hdSeen = new Set();    // 在 HD 模式下被注視累計 ≥ 1.5 秒的頻道
  }
  /** 指派 CRT 材質給 ctx.controlRoom.objects.mainScreen 與 sideScreens。 */
  init() {}
  /** 切換頻道（短暫的切換過場：0.25 秒滾動干擾，整體亮度不可突變）；emit 'feeds:channel' { channel } */
  setChannel(n) { this.channel = n; this.ctx.bus.emit('feeds:channel', { channel: n }); }
  setMode(mode) { this.mode = mode; }
  /** BOOT → HD 開機程序（含 audio 'crtBoot'、顯示 SCRIPT.status.bandwidth）。@returns {Promise<void>} */
  boot(duration = 3) { this.mode = 'BOOT'; return this.ctx.clock.wait(duration).then(() => { this.mode = 'HD'; }); }
  /** 人影推進上下限（MonitoringState 依節拍設定）。 */
  setFigureLimits({ min = 0, max = 0 } = {}) { this.limits = { min, max }; }
  /** 直接設定人影位置（跳關/重置用）。 */
  setFigureIndex(i) { this.figureIndex = i; }
  /** HD 下人影是否劈砍防爆門（有動作；每次斧頭擊中門的瞬間 emit 'feeds:axeHit'，約每 2.2–3 秒一次）。 */
  setHDAction(on) { this.hdAction = on; }
  /** 側邊螢幕內容。side: 'left' | 'right'；tone: 'normal' | 'warn' | 'alert'；lines: string[] */
  setStatus(side, { title = '', lines = [], tone = 'normal' } = {}) {}
  /** 目前主螢幕是否被玩家看著且正顯示頻道 n（LD 或 HD）。 */
  isChannelObserved(n) { return (this.mode === 'LD' || this.mode === 'HD') && this.channel === n && !!this.ctx.gaze?.mainScreenObserved; }
  /** 重置（循環重來）：頻道 3、人影 index 0、hdSeen 清空、模式 LD。 */
  reset() { this.channel = 3; this.figureIndex = 0; this.hdSeen.clear(); this.mode = 'LD'; this.hdAction = false; }
  update(dt, t) {}
  /** 每幀在主畫面渲染之前呼叫：把目前頻道渲染到 render target。 */
  renderFeeds(renderer) {}
}
