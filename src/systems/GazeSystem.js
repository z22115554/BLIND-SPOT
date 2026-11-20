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
// -----------------------------------------------------------------------------
// 實作補充：
// * 遮蔽物集合：ctx.controlRoom.group、ctx.corridor.group（加上目標本身）。忽略 userData.hitbox / noOcclude、
//   隱藏物件、Points、Sprite、Line、透明度 < 0.5 的透明材質、colorWrite=false 的隱形網格；
//   緊貼目標前方 8 cm 內的命中（螢幕玻璃、外框）不算遮蔽。
// * 主控室牆面的結構性遮蔽（raycastUtil.roomWallBlocks）：從廊道隔牆「看」螢幕永遠不算，即使牆網格缺漏。
// * 遮蔽射線結果依相機/物件位置快取（移動 < 2 cm 且 < 0.25 秒內重用），坐著不動時幾乎零成本。
// * 螢幕正面判定：PlaneGeometry（本地 +Z）、或 userData.screenNormal（本地向量）、或 options.normal。
// * mainScreenObserved 有 +4° 的釋放遲滯；observedFor / unobservedFor 以遊戲時間累計（暫停時凍結）。
// * 額外成員：explain(object, opts) → { observed, reason, angle, distance }、lastReason、mainScreenAngle、addOccluder()
// =============================================================================
import * as THREE from 'three';
import { raycastTree, sortHits, visibleInHierarchy, attachedToScene, isDescendantOf, roomWallBlocks } from './raycastUtil.js';

const RELEASE_HYSTERESIS_DEG = 4;
const GLASS_TOLERANCE = 0.08;

export class GazeSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.mainScreenObserved = false;
    this.observedFor = 0;     // 連續注視主螢幕秒數
    this.unobservedFor = 0;   // 連續未注視主螢幕秒數
    this.lastReason = 'init';
    this.mainScreenAngle = 180;
    this.occluders = [];
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._frustumKey = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._center = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.01;
    this.raycaster.params.Points.threshold = 0.01;
    this._hits = [];
    this._occCache = new WeakMap();
  }

  init() {
    const ctx = this.ctx;
    for (const g of [ctx.controlRoom?.group, ctx.corridor?.group]) if (g && !this.occluders.includes(g)) this.occluders.push(g);
  }

  /** 額外功能：加入額外的遮蔽物群組。 */
  addOccluder(obj) { if (obj && !this.occluders.includes(obj)) this.occluders.push(obj); }

  /** @returns {boolean} */
  isObserved(object, { maxAngleDeg = 34, maxDistance = 12, occlusion = true } = {}) {
    return this.explain(object, { maxAngleDeg, maxDistance, occlusion }).observed;
  }

  /** 與 isObserved 相同，但回傳原因（除錯/測試用）。 */
  explain(object, { maxAngleDeg = 34, maxDistance = 12, occlusion = true, normal = null, minFacing = 0 } = {}) {
    const ctx = this.ctx;
    const res = { observed: false, reason: 'ok', angle: 180, distance: Infinity };
    const fail = (reason) => { res.reason = reason; return res; };
    if (!object || !object.isObject3D) return fail('none');
    if (ctx.inspect?.isOpen) return fail('inspect');
    const fade = ctx.postfx?.params?.fade;
    if (typeof fade === 'number' && fade >= 0.6) return fail('fade');
    if (!attachedToScene(object) || !visibleInHierarchy(object)) return fail('hidden');

    const cam = ctx.camera;
    cam.updateMatrixWorld();
    const camPos = cam.getWorldPosition(this._camPos);
    object.updateWorldMatrix(true, false);
    const box = this._box.setFromObject(object);
    if (box.isEmpty()) return fail('empty');
    const center = box.getCenter(this._center);

    // 3. 距離
    const to = this._to.subVectors(center, camPos);
    const dist = to.length();
    res.distance = dist;
    if (dist > maxDistance) return fail('distance');

    // 2. 中央視角錐
    cam.getWorldDirection(this._fwd);
    const angle = dist < 1e-6 ? 0 : THREE.MathUtils.radToDeg(this._fwd.angleTo(to));
    res.angle = angle;
    if (angle > maxAngleDeg) return fail('angle');

    // 5. 螢幕正面朝向
    const n = this._facingNormal(object, normal);
    if (n) {
      const facing = -n.dot(to) / Math.max(dist, 1e-6); // n · (camera - object)（單位化）
      if (!(facing > minFacing)) return fail('facing');
    }

    // 1. 視錐
    if (!this._frustumFor(cam).intersectsBox(box)) return fail('frustum');

    // 4. 遮蔽
    if (occlusion) {
      if (roomWallBlocks(ctx, camPos, center)) return fail('wall');
      if (this._occluded(object, camPos, center, dist)) return fail('occluded');
    }
    res.observed = true;
    return res;
  }

  _facingNormal(object, normal) {
    let local = normal || object.userData?.screenNormal || null;
    if (!local && object.isMesh && object.geometry?.type === 'PlaneGeometry') local = { x: 0, y: 0, z: 1 };
    if (!local) return null;
    return this._n.set(local.x, local.y, local.z).transformDirection(object.matrixWorld);
  }

  _frustumFor(cam) {
    this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (!this._pv.equals(this._frustumKey)) {
      this._frustumKey.copy(this._pv);
      this._frustum.setFromProjectionMatrix(this._pv);
    }
    return this._frustum;
  }

  _occluded(object, camPos, center, dist) {
    const now = performance.now() / 1000;
    const c = this._occCache.get(object);
    if (c && now - c.time < 0.25 && c.cam.distanceToSquared(camPos) < 0.0004 && c.center.distanceToSquared(center) < 0.0004) return c.value;

    const rc = this.raycaster;
    this._dir.copy(center).sub(camPos).normalize();
    rc.set(camPos, this._dir);
    rc.near = 0;
    rc.far = dist + 0.05;
    rc.camera = this.ctx.camera;
    const hits = this._hits; hits.length = 0;
    try {
      for (const g of this.occluders) raycastTree(rc, g, hits, 'occluder', object);
      raycastTree(rc, object, hits, 'target');
    } catch (e) {
      console.warn('[gaze] occlusion raycast failed', e);
    }
    sortHits(hits);
    let value = false;
    for (const h of hits) {
      if (isDescendantOf(h.object, object)) break;          // 先打到目標本身 → 沒被擋住
      if (h.distance >= dist - GLASS_TOLERANCE) break;     // 貼在目標前面的玻璃/外框
      value = true; break;
    }
    if (c) { c.time = now; c.cam.copy(camPos); c.center.copy(center); c.value = value; }
    else this._occCache.set(object, { time: now, cam: camPos.clone(), center: center.clone(), value });
    return value;
  }

  update(dt, t) {
    const ctx = this.ctx;
    const ms = ctx.controlRoom?.objects?.mainScreen;
    let obs = false;
    if (ms) {
      const maxAngleDeg = 34 + (this.mainScreenObserved ? RELEASE_HYSTERESIS_DEG : 0);
      let r;
      try { r = this.explain(ms, { maxAngleDeg }); } catch (e) { console.warn('[gaze] explain failed', e); r = { observed: false, reason: 'error', angle: 180 }; }
      obs = r.observed;
      this.lastReason = r.reason;
      this.mainScreenAngle = r.angle;
    } else this.lastReason = 'none';
    if (obs !== this.mainScreenObserved) {
      this.mainScreenObserved = obs;
      if (obs) this.observedFor = 0; else this.unobservedFor = 0;
    }
    if (obs) { this.observedFor += dt; this.unobservedFor = 0; }
    else { this.unobservedFor += dt; this.observedFor = 0; }
  }
}
