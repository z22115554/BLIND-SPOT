// =============================================================================
// PlayerController — 第一人稱控制（PointerLockControls 概念 + WASD + 碰撞 + 腳步事件 + 手電筒）
// 【API 骨架 / CONTRACT STUB】
// * 指標鎖定：lock() 必須在使用者手勢中呼叫；鎖定失敗（pointerlockerror / iframe 沙箱）時
//   自動改為「按住左鍵拖曳環顧」模式並 ui.hint(SCRIPT.hints.pointerLockFallback)。
// * 指標鎖定被使用者解除（Esc）時 emit 'pause:request'；監聽 'pause:resume' 並在同一手勢內 lock()。
// * 碰撞：玩家為半徑 LAYOUT.EYE.radius 的圓，必須完全位於 LAYOUT.WALKABLE（＋已開啟的 PORTALS）聯集內，
//   且不與任何障礙物 AABB 相交；X、Z 分軸解算以便貼牆滑動。
// * 速度：走路 1.45 m/s，Shift 2.1 m/s（恐怖遊戲不給跑）。輕微頭部擺動（光敏感模式關閉）。
// * 每走約 0.72 公尺 emit 'player:step' { surface, x, z, speed }，surface 依 zone：
//   controlRoom → 'vinyl'、corridor → 'concrete'、switchRoom → 'metal'
// * 從移動中停下（速度歸零）時 emit 'player:stopped' { walkedFor }（持續行走秒數）。
// * 區域改變時 emit 'player:zone' { from, to }。
// * 相機 = position + (0, 眼高 + 擺動 + rig.height, 0)，旋轉 = yaw/pitch + rig.pitch/rig.roll（rotation.order 'YXZ'）。
// * 劇情控制：enabled=false 時忽略所有輸入（但 rig/腳本動畫仍生效）。
// * shadowProxy：與玩家同步的隱形膠囊（colorWrite:false、depthWrite:false、castShadow:true），
//   讓防火門車燈能投射玩家影子。
// =============================================================================
import * as THREE from 'three';

export class PlayerController {
  constructor(ctx) {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.position = new THREE.Vector3(0, 0, -1.6); // 腳底位置
    this.yaw = 0; this.pitch = 0;
    this.enabled = false;
    this.seated = true;
    this.zone = 'controlRoom';
    this.isMoving = false;
    this.isLocked = false;
    this.dragMode = false;
    this.hasFlashlight = false;
    /** 腳本用的疊加偏移（序幕趴桌醒來、終幕趴倒） */
    this.rig = { pitch: 0, roll: 0, height: 0, x: 0, z: 0 };
    this.flashlight = new THREE.SpotLight(0xfff1d6, 0, 18, 0.42, 0.55, 1.6);
    this.shadowProxy = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.1, 4, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  }
  init() {}
  lock() {}
  unlock() {}
  /** 瞬間移動。seated = true 時眼高 = EYE.seated。 */
  teleport({ x, z, yaw = this.yaw, pitch = this.pitch, seated = this.seated } = {}) {
    this.position.set(x, 0, z); this.yaw = yaw; this.pitch = pitch; this.seated = seated;
  }
  /** 坐下/站起（眼高平滑過渡）。@returns {Promise<void>} */
  setSeated(on, duration = 1.2) { this.seated = on; return this.ctx.clock.wait(duration); }
  /** 平滑轉向看某一點（世界座標）。@returns {Promise<void>} */
  lookAt(target, duration = 1.5) { return this.ctx.clock.wait(duration); }
  /** 腳本移動（不做碰撞）。@returns {Promise<void>} */
  moveTo({ x, z }, duration = 2) { this.position.x = x; this.position.z = z; return this.ctx.clock.wait(duration); }
  setPortal(name, open) { if (this.ctx.LAYOUT.PORTALS[name]) this.ctx.LAYOUT.PORTALS[name].open = open; }
  addObstacles(list) {}
  /** 手電筒（掛在相機上，帶一點延遲跟隨的 SpotLight）。 */
  setFlashlight(on) {}
  setHeadBob(on) {}
  update(dt, t) {
    const eye = this.seated ? this.ctx.LAYOUT.EYE.seated : this.ctx.LAYOUT.EYE.standing;
    this.camera.position.set(this.position.x + this.rig.x, eye + this.rig.height, this.position.z + this.rig.z);
    this.camera.rotation.set(this.pitch + this.rig.pitch, this.yaw, this.rig.roll, 'YXZ');
  }
}
