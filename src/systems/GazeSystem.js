// =============================================================================
// GazeSystem — 「玩家是否正在看著某物」判定（盲區機制核心）
// 【API 骨架 / CONTRACT STUB】
// isObserved(object) 必須同時滿足：
//   1. 物件的世界包圍盒與相機視錐相交（THREE.Frustum.setFromProjectionMatrix + intersectsBox）
//      ——單純視錐判定太寬鬆（畫面邊緣也算），所以再加：
//   2. 相機前方向量與「相機→物件中心」夾角 ≤ maxAngleDeg（預設 34°，約為視線中央區）
//   3. 距離 ≤ maxDistance
//   4. occlusion：由相機向物件中心射線，第一個命中的網格必須是該物件（或其子孫）——被門/牆擋住不算
//   5. inspect 未開啟、postfx.params.fade < 0.6、玩家相機面向螢幕正面（螢幕法線與視線反向）
// 每幀計算 mainScreenObserved（對 ctx.controlRoom.objects.mainScreen）以及連續觀看/未觀看的秒數。
// =============================================================================
export class GazeSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.mainScreenObserved = false;
    this.observedFor = 0;     // 連續注視主螢幕秒數
    this.unobservedFor = 0;   // 連續未注視主螢幕秒數
  }
  init() {}
  /** @returns {boolean} */
  isObserved(object, { maxAngleDeg = 34, maxDistance = 12, occlusion = true } = {}) { return false; }
  update(dt, t) {}
}
