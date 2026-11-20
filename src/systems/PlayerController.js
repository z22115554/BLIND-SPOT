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
// -----------------------------------------------------------------------------
// 實作補充（公開 API 之外的額外成員，供除錯/其他模組選用）：
//   velocity (Vector3, m/s)、speed、eyeHeight、flashlightOn、headBob、refreshObstacles()、
//   addObstacles(list) 回傳移除函式、isValidPosition(x, z)、flashlightRig（光束延遲/補光/霧中光暈參數）、
//   setFlashlightDim(mult, durationSec)（手電筒亮度乘數，與開關無關）
// * 拖曳環顧模式（沒有指標鎖定）下按 Esc 也會 emit 'pause:request'（檢視畫面開啟時 Esc 優先關閉檢視）。
// * 觸控（ctx.input.touch）：lock() 不要求指標鎖定；TouchControls 以 lookBy(dYaw, dPitch) 環顧、
//   以 analog = { x: 右, z: 後 }（長度 0..1，類比速度）移動。坐著時推動搖桿＝按下移動鍵（平滑站起）。
//   混合裝置從觸控切回滑鼠後，第一次點擊畫布會重新要求指標鎖定。桌機（從未觸控）行為完全不變。
// =============================================================================
import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../core/util.js';
import { FlashlightRig, FLASHLIGHT_RAMP, FLASHLIGHT_RAMP_CALM } from './Flashlight.js';

const SENS_BASE = 0.0022;     // rad / px
const PITCH_LIMIT = 1.45;
const WALK_SPEED = 1.45;
const BRISK_SPEED = 2.1;
const STRIDE = 0.72;          // m / 步
const BOB_V = 0.025;          // 垂直擺動（峰對峰，m）
const BOB_H = 0.012;          // 側向擺動（m）
const CIRCLE_SAMPLES = 12;
const MAX_MOUSE_DELTA = 600;  // 單一事件的滑鼠位移上限（擋掉瀏覽器偶發的上千像素跳動，但不影響快速甩鏡）
const SURFACE = { controlRoom: 'vinyl', corridor: 'concrete', switchRoom: 'metal', doorway: 'concrete' };
const MOVE_KEYS = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const isTypingTarget = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''));

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

    // ---- 實作狀態 -------------------------------------------------------------
    const EYE = ctx.LAYOUT.EYE;
    this.eyeHeight = EYE.seated;
    this.velocity = new THREE.Vector3();
    this.speed = 0;
    this.headBob = true;
    this.flashlightOn = false;
    this.obstacles = [];
    this._extraObstacles = [];
    this._keys = new Set();
    this._shift = false;
    this._standing = null;          // 站起中的 Promise
    this._standOffset = 0;          // 站起時頭部略低頭的額外 pitch
    this._lookTween = 0;            // lookAt 補間 token（>0 代表進行中）
    this._moveTween = 0;            // moveTo 補間 token
    this._lookSeq = 0;
    this._moveSeq = 0;
    this._eyeTween = 0;
    this._tv = new THREE.Vector3();
    this._stepAccum = 0;
    this._stridePhase = 0;          // 單位：步（整數 = 落腳）
    this._bobAmount = 0;            // 0..1（依速度平滑）
    this._walkedFor = 0;
    this._stepsThisWalk = 0;
    this._lastPos = new THREE.Vector3().copy(this.position);
    this._teleported = true;
    this._breath = 0;
    this._sensMul = 1;
    this._reduceFlicker = false;
    // 指標鎖定
    this._intentionalUnlock = false;
    this._everLocked = false;
    this._lockUnavailable = false;
    this._lockPending = false;
    this._hintShown = false;
    this._drag = null;              // { x, y }
    this._listeners = [];
    /** 觸控搖桿（TouchControls 每幀寫入）：x = 右、z = 後，長度 0..1 = 走路速度比例 */
    this.analog = { x: 0, z: 0 };

    // 手電筒：建構時就掛上相機（場景燈光數量從第一幀固定，避免拿起手電筒時整個場景重編譯 shader）
    this.flashlightRig = new FlashlightRig(ctx, this.flashlight);
    this.flashlightRig.attach(this.camera, ctx.scene);

    // 隱形膠囊：只投影、不顯示、不寫深度
    const sp = this.shadowProxy;
    sp.name = 'playerShadowProxy';
    sp.castShadow = true;
    sp.receiveShadow = false;
    sp.frustumCulled = false;
    sp.renderOrder = -10;
    sp.userData.noOcclude = true;
    sp.material.transparent = false;
    // 手電筒就在膠囊內：自己的身體不可擋住自己的手電筒（只在手電筒的陰影貼圖中跳過繪製）
    sp.onBeforeShadow = (renderer, object, camera, shadowCamera, geometry) => {
      if (shadowCamera === this.flashlight.shadow.camera) geometry.setDrawRange(0, 0);
    };
    sp.onAfterShadow = (renderer, object, camera, shadowCamera, geometry) => {
      if (shadowCamera === this.flashlight.shadow.camera) geometry.setDrawRange(0, Infinity);
    };
  }

  init() {
    const ctx = this.ctx;
    ctx.scene.add(this.shadowProxy);
    this.refreshObstacles();
    this.zone = this._zoneAt(this.position.x, this.position.z) || this.zone;
    this._readSettings();

    const el = ctx.renderer.domElement;
    const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); this._listeners.push(() => target.removeEventListener(type, fn, opts)); };
    on(document, 'pointerlockchange', () => this._onLockChange());
    on(document, 'pointerlockerror', () => this._onLockError(new Error('pointerlockerror')));
    on(document, 'mousemove', (e) => this._onMouseMove(e));
    on(el, 'mousedown', (e) => this._onMouseDown(e));
    on(window, 'mouseup', (e) => this._onMouseUp(e));
    on(window, 'keydown', (e) => this._onPauseKey(e));
    on(window, 'keydown', (e) => this._onKey(e, true));
    on(window, 'keyup', (e) => this._onKey(e, false));
    on(window, 'blur', () => { this._keys.clear(); this._shift = false; this._drag = null; });
    on(el, 'contextmenu', (e) => e.preventDefault());

    ctx.bus.on('pause:resume', () => { if (!this.isLocked) this.lock(); });
    // 遊戲暫停（例如切換分頁）時主動放開指標，讓玩家能點擊暫停畫面
    ctx.bus.on('game:paused', () => { if (this.isLocked) this.unlock(); this._keys.clear(); this._drag = null; });
    ctx.bus.on('settings:change', () => this._readSettings());
    // 觸控：放開指標鎖定（觸控與指標鎖定互斥）
    ctx.bus.on('input:mode', ({ touch } = {}) => {
      if (!touch) return;
      if (this.isLocked) this.unlock();
      this._drag = null;
    });
  }

  // ---------------------------------------------------------------------------
  // 指標鎖定
  // ---------------------------------------------------------------------------
  lock() {
    const el = this.ctx.renderer?.domElement;
    this._intentionalUnlock = false;
    if (this.isLocked) return;
    if (this.ctx.input?.touch) return;   // 觸控裝置：不鎖定指標（以拖曳環顧）
    if (!el || typeof el.requestPointerLock !== 'function' || this._lockUnavailable) { this._enterDragMode(); return; }
    if (this._lockPending) return;
    const gesture = navigator.userActivation ? navigator.userActivation.isActive : true;
    this._lockPending = true;
    this._lockGesture = gesture;
    const attempt = this._lockAttempt = (this._lockAttempt || 0) + 1;
    try {
      const p = el.requestPointerLock();
      if (p && typeof p.then === 'function') {
        p.then(() => { if (attempt === this._lockAttempt) this._lockPending = false; },
          (err) => this._onLockError(err, attempt));
      }
    } catch (err) {
      this._onLockError(err, attempt);
    }
  }

  unlock() {
    this._lockPending = false;
    if (document.pointerLockElement === this.ctx.renderer?.domElement) {
      this._intentionalUnlock = true;
      try { document.exitPointerLock(); } catch { /* ignore */ }
    }
    this.isLocked = false;
  }

  _onLockChange() {
    const el = this.ctx.renderer.domElement;
    const locked = document.pointerLockElement === el;
    this._lockPending = false;
    if (locked) {
      this.isLocked = true;
      this._everLocked = true;
      this.dragMode = false;
      this._drag = null;
      el.style.cursor = 'none';
      return;
    }
    const wasLocked = this.isLocked;
    this.isLocked = false;
    el.style.cursor = this.dragMode ? 'grab' : '';
    if (this._intentionalUnlock) { this._intentionalUnlock = false; return; }
    if (wasLocked && this.ctx.fsm?.currentName !== this.ctx.STATES.TITLE) this.ctx.bus.emit('pause:request');
  }

  _onLockError(err, attempt = this._lockAttempt) {
    // pointerlockerror 事件與 Promise rejection 可能同時到達：同一次嘗試只處理一次
    if (attempt !== this._lockAttempt || this._errHandled === attempt) return;
    this._errHandled = attempt;
    this._lockPending = false;
    if (this.isLocked) return;
    // 曾經鎖定成功：多半是 Esc 後的冷卻時間（瀏覽器拒絕太快重新鎖定）→ 回到暫停畫面讓玩家再點一次
    if (this._everLocked && !this.dragMode) {
      if (this.ctx.fsm?.currentName !== this.ctx.STATES.TITLE && !this.ctx.clock.paused) this.ctx.bus.emit('pause:request');
      return;
    }
    // 在使用者手勢中仍失敗 → 這個環境不支援（iframe 沙箱等），之後不再嘗試
    if (this._lockGesture) this._lockUnavailable = true;
    this._enterDragMode();
  }

  _enterDragMode() {
    const first = !this.dragMode;
    this.dragMode = true;
    const el = this.ctx.renderer?.domElement;
    if (el) el.style.cursor = 'grab';
    if (first && !this._hintShown) {
      this._hintShown = true;
      try { this.ctx.ui?.hint?.(this.ctx.SCRIPT.hints.pointerLockFallback, 6); } catch (e) { console.warn('[player] hint failed', e); }
    }
  }

  // ---------------------------------------------------------------------------
  // 輸入
  // ---------------------------------------------------------------------------
  _inputBlocked() {
    return !this.enabled || !!this.ctx.inspect?.isOpen || this.ctx.clock.paused;
  }

  _onMouseMove(e) {
    let dx = 0, dy = 0;
    if (this.isLocked) {
      dx = e.movementX || 0; dy = e.movementY || 0;
    } else if (this.dragMode && this._drag) {
      dx = e.clientX - this._drag.x; dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      this._drag.moved += Math.abs(dx) + Math.abs(dy);
    } else return;
    if (this._inputBlocked() || this._lookTween || this._standing) return;
    dx = clamp(dx, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
    dy = clamp(dy, -MAX_MOUSE_DELTA, MAX_MOUSE_DELTA);
    const s = SENS_BASE * this._sensMul;
    this.yaw = wrapAngle(this.yaw - dx * s);
    this.pitch = clamp(this.pitch - dy * s, -PITCH_LIMIT, PITCH_LIMIT);
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const ctx = this.ctx;
    // 後備：若暫停畫面沒有攔截點擊，點畫布也能繼續
    if (ctx.clock.paused) { if (ctx.fsm?.currentName !== ctx.STATES.TITLE) ctx.bus.emit('pause:resume'); return; }
    if (this.isLocked) return;
    // 混合裝置：從觸控切回滑鼠後第一次點擊畫布 → 這次點擊就是手勢，重新要求指標鎖定
    if (!this.dragMode && ctx.input?.everTouch && !ctx.input.touch && !this._lockPending && ctx.fsm?.currentName !== ctx.STATES.TITLE) {
      this.lock();
      return;
    }
    if (this.dragMode) {
      this._drag = { x: e.clientX, y: e.clientY, moved: 0 };
      e.target.style.cursor = 'grabbing';
      // 先前因為沒有使用者手勢而失敗：這次點擊就是手勢，再試一次（成功就切回指標鎖定）
      if (!this._lockUnavailable && !this._everLocked && ctx.fsm?.currentName !== ctx.STATES.TITLE) this.lock();
    }
  }

  /** 觸控環顧（弧度）。與滑鼠相同的阻擋條件與俯仰限制；沒有慣性。 */
  lookBy(dYaw, dPitch) {
    if (this._inputBlocked() || this._lookTween || this._standing) return;
    if (!Number.isFinite(dYaw) || !Number.isFinite(dPitch)) return;
    this.yaw = wrapAngle(this.yaw - dYaw);
    this.pitch = clamp(this.pitch - dPitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** 目前能否以搖桿移動（TouchControls 決定是否顯示搖桿）。 */
  canMove() { return !this._inputBlocked() && !this._moveTween; }

  _onMouseUp(e) {
    if (e.button !== 0) return;
    if (this._drag) {
      this._drag = null;
      const el = this.ctx.renderer.domElement;
      if (this.dragMode) el.style.cursor = 'grab';
    }
  }

  /** 拖曳環顧模式（沒有指標鎖定）時 Esc 一樣可以暫停。指標鎖定時 Esc 由瀏覽器解除鎖定 → _onLockChange 發出暫停。
   *  檢視畫面開啟時 Esc 優先關閉檢視；標題畫面、已暫停時不處理（暫停畫面以點擊繼續）。 */
  _onPauseKey(e) {
    if (e.code !== 'Escape' && e.key !== 'Escape') return;
    if (e.repeat || this.isLocked || isTypingTarget(e.target)) return;
    const ctx = this.ctx;
    if (ctx.inspect?.isOpen || ctx.clock.paused) return;
    if (!ctx.fsm || ctx.fsm.currentName === ctx.STATES.TITLE) return;
    ctx.bus.emit('pause:request');
  }

  _onKey(e, down) {
    if (isTypingTarget(e.target)) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this._shift = down; return; }
    const k = MOVE_KEYS[e.code];
    if (!k) return;
    if (e.code.startsWith('Arrow')) e.preventDefault();
    if (down) this._keys.add(e.code); else this._keys.delete(e.code);
  }

  _readSettings() {
    const s = this.ctx.settings;
    const sens = Number(s?.get?.('sensitivity'));
    this._sensMul = Number.isFinite(sens) && sens > 0 ? sens : 1;
    this._reduceFlicker = !!s?.get?.('reduceFlicker');
  }

  // ---------------------------------------------------------------------------
  // 腳本 API
  // ---------------------------------------------------------------------------
  /** 瞬間移動。seated = true 時眼高 = EYE.seated。 */
  teleport({ x, z, yaw = this.yaw, pitch = this.pitch, seated = this.seated } = {}) {
    const EYE = this.ctx.LAYOUT.EYE;
    this.position.set(x ?? this.position.x, 0, z ?? this.position.z);
    this.yaw = wrapAngle(yaw); this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT); this.seated = seated;
    this.eyeHeight = seated ? EYE.seated : EYE.standing;
    this._eyeTween++; this._lookTween = 0; this._moveTween = 0;
    this._standing = null; this._standOffset = 0;
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this._bobAmount = 0;
    this._stepAccum = 0;
    this._teleported = true;
    if (this.isMoving) this._finishWalk(false);
    this.flashlightRig.snap();
  }

  /** 坐下/站起（眼高平滑過渡）。@returns {Promise<void>} */
  setSeated(on, duration = 1.2) {
    const EYE = this.ctx.LAYOUT.EYE;
    this.seated = on;
    return this._tweenEye(on ? EYE.seated : EYE.standing, duration);
  }

  _tweenEye(to, duration) {
    const token = ++this._eyeTween;
    // 取代進行中的自動起身（否則它的完成回呼因 token 不符而不會清掉 _standing，玩家會被卡住）
    this._standing = null; this._standOffset = 0;
    const from = this.eyeHeight;
    if (duration <= 0) { this.eyeHeight = to; return Promise.resolve(); }
    return this.ctx.clock.tween(duration, (k) => {
      if (token === this._eyeTween) this.eyeHeight = from + (to - from) * k;
    }, 'inOut');
  }

  /** 平滑轉向看某一點（世界座標）。@returns {Promise<void>} */
  lookAt(target, duration = 1.5) {
    const cx = this.position.x + this.rig.x;
    const cz = this.position.z + this.rig.z;
    const cy = this.eyeHeight + this.rig.height;
    const tx = target?.x ?? cx, tz = target?.z ?? cz, ty = target?.y ?? cy;
    const dx = tx - cx, dy = ty - cy, dz = tz - cz;
    const h = Math.hypot(dx, dz);
    if (h < 1e-5 && Math.abs(dy) < 1e-5) return this.ctx.clock.wait(0);
    const toYaw = h < 1e-5 ? this.yaw : Math.atan2(-dx, -dz);
    const toPitch = clamp(Math.atan2(dy, Math.max(h, 1e-5)), -PITCH_LIMIT, PITCH_LIMIT);
    const fromYaw = this.yaw, fromPitch = this.pitch;
    const dYaw = wrapAngle(toYaw - fromYaw);
    const token = ++this._lookSeq;
    this._lookTween = token;
    if (duration <= 0) {
      this.yaw = wrapAngle(toYaw); this.pitch = toPitch; this._lookTween = 0;
      return Promise.resolve();
    }
    return this.ctx.clock.tween(duration, (k, raw) => {
      if (this._lookTween !== token) return;
      this.yaw = wrapAngle(fromYaw + dYaw * k);
      this.pitch = fromPitch + (toPitch - fromPitch) * k;
      if (raw >= 1) this._lookTween = 0;
    }, 'inOut');
  }

  /** 腳本移動（不做碰撞）。@returns {Promise<void>} */
  moveTo({ x, z }, duration = 2) {
    const fx = this.position.x, fz = this.position.z;
    const tx = x ?? fx, tz = z ?? fz;
    const token = ++this._moveSeq;
    this._moveTween = token;
    this.velocity.set(0, 0, 0);
    if (duration <= 0) { this.position.x = tx; this.position.z = tz; this._moveTween = 0; return Promise.resolve(); }
    return this.ctx.clock.tween(duration, (k, raw) => {
      if (this._moveTween !== token) return;
      this.position.x = fx + (tx - fx) * k;
      this.position.z = fz + (tz - fz) * k;
      if (raw >= 1) this._moveTween = 0;
    }, 'inOut');
  }

  setPortal(name, open) {
    const p = this.ctx.LAYOUT.PORTALS[name];
    if (p) p.open = !!open;
  }

  /** 追加障礙物 AABB（XZ）。回傳移除函式（額外功能）。 */
  addObstacles(list) {
    const arr = (Array.isArray(list) ? list : [list]).filter((o) => o && Number.isFinite(o.minX) && Number.isFinite(o.maxX) && Number.isFinite(o.minZ) && Number.isFinite(o.maxZ));
    this._extraObstacles.push(...arr);
    this.refreshObstacles(false);
    return () => {
      this._extraObstacles = this._extraObstacles.filter((o) => !arr.includes(o));
      this.refreshObstacles(false);
    };
  }

  /** 重新向 ControlRoom / Corridor 收集障礙物（額外功能：場景物件改變後可呼叫）。 */
  refreshObstacles(fromModules = true) {
    if (fromModules || !this._moduleObstacles) {
      const list = [];
      for (const m of [this.ctx.controlRoom, this.ctx.corridor]) {
        try {
          const o = m?.getObstacles?.();
          if (Array.isArray(o)) list.push(...o);
        } catch (e) { console.warn('[player] getObstacles failed', e); }
      }
      this._moduleObstacles = list.filter((o) => o && Number.isFinite(o.minX) && Number.isFinite(o.maxX) && Number.isFinite(o.minZ) && Number.isFinite(o.maxZ));
    }
    this.obstacles = [...this._moduleObstacles, ...this._extraObstacles];
  }

  /** 手電筒（掛在相機上，帶一點延遲跟隨的 SpotLight）。
   *  duration：開/關過渡秒數。省略 = 預設（1.1 秒；光敏感模式 1.6 秒）；比預設短的值會被拉長到預設
   *  （舒適規則：0.25 秒內亮度變化 ≤ 30%）；0 = 立即（只用在全黑畫面下的重置）。 */
  setFlashlight(on, duration) {
    on = !!on;
    if (on) this.hasFlashlight = true;
    const changed = on !== this.flashlightOn;
    this.flashlightOn = on;
    const base = this._reduceFlicker ? FLASHLIGHT_RAMP_CALM : FLASHLIGHT_RAMP;
    const d = duration != null && Number(duration) <= 0 ? 0 : Math.max(base, Number(duration) || 0);
    this.flashlightRig.setOn(on, d);
    if (changed) { try { this.ctx.audio?.sfx?.('flashlight'); } catch (e) { console.warn('[player] sfx failed', e); } }
  }

  /** 手電筒亮度乘數（0..1，與開關無關），以同一條舒適曲線在 durationSec 秒內過渡（光敏感模式 ×1.5）。
   *  手電筒關到全黑後自動回到 1。例：車燈事件 setFlashlightDim(0.3, 1.0)，結束後 setFlashlightDim(1, 1.5)。 */
  setFlashlightDim(mult = 1, durationSec = 0.8) {
    const m = clamp(Number(mult), 0, 1);
    const d = Math.max(0, Number(durationSec) || 0) * (this._reduceFlicker ? 1.5 : 1);
    this.flashlightRig.setDim(Number.isFinite(m) ? m : 1, d);
  }

  setHeadBob(on) { this.headBob = !!on; }

  // ---------------------------------------------------------------------------
  // 碰撞
  // ---------------------------------------------------------------------------
  _rects() {
    const L = this.ctx.LAYOUT;
    const rects = L.WALKABLE.slice();
    for (const p of Object.values(L.PORTALS)) if (p.open) rects.push(p);
    return rects;
  }

  /** 違規程度：圓周取樣點落在可行走區外的數量 + 與障礙物的重疊深度。0 = 合法位置。 */
  _penalty(x, z, rects = this._rects()) {
    const r = this.ctx.LAYOUT.EYE.radius;
    let bad = 0;
    const inAny = (px, pz) => {
      for (let i = 0; i < rects.length; i++) {
        const R = rects[i];
        if (px >= R.minX && px <= R.maxX && pz >= R.minZ && pz <= R.maxZ) return true;
      }
      return false;
    };
    if (!inAny(x, z)) bad += 2;
    for (let i = 0; i < CIRCLE_SAMPLES; i++) {
      const a = (i / CIRCLE_SAMPLES) * Math.PI * 2;
      if (!inAny(x + Math.cos(a) * r, z + Math.sin(a) * r)) bad += 1;
    }
    const obs = this.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const cx = clamp(x, o.minX, o.maxX), cz = clamp(z, o.minZ, o.maxZ);
      const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d2 < r * r) bad += 1 + (r - Math.sqrt(d2)) * 10;
    }
    return bad;
  }

  /** 位置是否合法（額外功能，測試/腳本用）。 */
  isValidPosition(x, z) { return this._penalty(x, z) === 0; }

  _tryMove(dx, dz) {
    const rects = this._rects();
    const p = this.position;
    let cur = this._penalty(p.x, p.z, rects);
    // 卡在不合法位置（瞬移進障礙物、門口在腳下關上）時：只要不更糟就允許移動，讓玩家能走出來
    const ok = (nx, nz) => { const n = this._penalty(nx, nz, rects); if (n === 0 || (cur > 0 && n <= cur)) { cur = n; return true; } return false; };
    if (dx !== 0 && ok(p.x + dx, p.z)) p.x += dx;
    if (dz !== 0 && ok(p.x, p.z + dz)) p.z += dz;
  }

  _zoneAt(x, z) {
    const zn = this.ctx.LAYOUT.zoneAt(x, z);
    return zn === 'outside' ? null : zn;
  }

  // ---------------------------------------------------------------------------
  // 每幀
  // ---------------------------------------------------------------------------
  update(dt, t) {
    const ctx = this.ctx;
    const EYE = ctx.LAYOUT.EYE;
    this._readSettings(); // 每幀讀取（設定面板即使沒有發出 'settings:change' 也會即時生效）
    const blocked = this._inputBlocked();

    // ---- 輸入方向 ------------------------------------------------------------
    let ix = 0, iz = 0, mag = 1;
    if (!blocked && !this._moveTween) {
      for (const code of this._keys) {
        const k = MOVE_KEYS[code];
        if (k === 'f') iz -= 1; else if (k === 'b') iz += 1; else if (k === 'l') ix -= 1; else if (k === 'r') ix += 1;
      }
      // 觸控搖桿（沒有按鍵時）：方向＋類比速度
      if (ix === 0 && iz === 0) {
        const a = this.analog, m = Math.hypot(a.x || 0, a.z || 0);
        if (m > 1e-3) { ix = a.x; iz = a.z; mag = Math.min(1, m); }
      }
    }
    const wantsMove = ix !== 0 || iz !== 0;

    // 坐著時按下移動鍵 → 平滑站起（約 0.8 秒），站好之後才開始走
    if (wantsMove && this.seated && !this._standing && dt > 0) this._standUp();
    const canWalk = !this.seated && !this._standing && !this._moveTween;

    // ---- 速度（平滑加減速）-----------------------------------------------------
    const tv = this._tv.set(0, 0, 0);
    if (wantsMove && canWalk) {
      const len = Math.hypot(ix, iz);
      ix /= len; iz /= len;
      const sp = (this._shift ? BRISK_SPEED : WALK_SPEED) * mag;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // 前方 = (-sin, -cos)，右方 = (cos, -sin)
      tv.set((ix * cos + iz * sin) * sp, 0, (-ix * sin + iz * cos) * sp);
    }
    const lambda = tv.lengthSq() > 0 ? 9 : 11;
    this.velocity.x = damp(this.velocity.x, tv.x, lambda, dt);
    this.velocity.z = damp(this.velocity.z, tv.z, lambda, dt);
    if (Math.abs(this.velocity.x) < 1e-4) this.velocity.x = 0;
    if (Math.abs(this.velocity.z) < 1e-4) this.velocity.z = 0;

    // ---- 移動 + 碰撞（分軸解算以貼牆滑動）--------------------------------------------
    if (dt > 0 && (this.velocity.x !== 0 || this.velocity.z !== 0) && canWalk) {
      // 大 dt 時分段，避免穿牆
      const total = Math.hypot(this.velocity.x, this.velocity.z) * dt;
      const n = Math.max(1, Math.ceil(total / 0.08));
      for (let i = 0; i < n; i++) this._tryMove(this.velocity.x * dt / n, this.velocity.z * dt / n);
    }

    // ---- 實際位移 → 速度、腳步、停下 --------------------------------------------------
    const moved = this._teleported ? 0 : Math.hypot(this.position.x - this._lastPos.x, this.position.z - this._lastPos.z);
    this._teleported = false;
    this._lastPos.copy(this.position);
    if (dt > 0) {
      const inst = moved / dt;
      this.speed = damp(this.speed, inst, 14, dt);
      if (this.speed < 0.02 && inst === 0) this.speed = 0;
    }
    this._updateZone();
    if (dt > 0) this._updateSteps(moved, dt);

    // ---- 頭部擺動 ------------------------------------------------------------------
    const bobOn = this.headBob && !this._reduceFlicker;
    const bobTarget = bobOn && !this.seated ? clamp(this.speed / WALK_SPEED, 0, 1.25) : 0;
    this._bobAmount = damp(this._bobAmount, bobTarget, bobTarget > this._bobAmount ? 6 : 4, dt);
    if (!bobOn) this._bobAmount = 0;
    const ph = this._stridePhase;
    // 落腳（整數相位）時頭最低；兩步一個側向週期
    const bobY = -Math.cos(ph * Math.PI * 2) * 0.5 * BOB_V * this._bobAmount;
    const bobX = Math.cos(ph * Math.PI) * BOB_H * this._bobAmount;
    // 極輕微的呼吸起伏（光敏感模式關閉）
    this._breath += dt;
    const breath = bobOn ? Math.sin(this._breath * 1.35) * 0.0035 * (1 - this._bobAmount * 0.8) : 0;
    const breathPitch = bobOn ? Math.sin(this._breath * 1.35 - 0.6) * 0.0016 : 0;

    // ---- 相機 ----------------------------------------------------------------------
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const cam = this.camera;
    cam.position.set(
      this.position.x + this.rig.x + cos * bobX,
      this.eyeHeight + bobY + breath + this.rig.height,
      this.position.z + this.rig.z - sin * bobX,
    );
    cam.rotation.set(this.pitch + this.rig.pitch + this._standOffset + breathPitch, this.yaw, this.rig.roll, 'YXZ');
    cam.updateMatrixWorld();

    // ---- 隱形膠囊（影子替身）--------------------------------------------------------
    const hs = clamp(this.eyeHeight / EYE.standing, 0.4, 1.2);
    this.shadowProxy.position.set(this.position.x + this.rig.x, 0.85 * hs, this.position.z + this.rig.z);
    this.shadowProxy.scale.set(1, hs, 1);
    this.shadowProxy.updateMatrixWorld();

    // ---- 手電筒 ----------------------------------------------------------------------
    this.flashlightRig.update(dt, t, {
      camera: cam,
      moveAmount: this._bobAmount,
      stridePhase: this._stridePhase,
      reduceFlicker: this._reduceFlicker,
    });
  }

  _standUp() {
    const EYE = this.ctx.LAYOUT.EYE;
    const dur = 0.8;
    this.seated = false;
    const token = ++this._eyeTween;
    const from = this.eyeHeight;
    this._standing = this.ctx.clock.tween(dur, (k, raw) => {
      if (token !== this._eyeTween) return;
      this.eyeHeight = from + (EYE.standing - from) * k;
      // 起身時頭略往前低一下再抬起
      this._standOffset = -Math.sin(raw * Math.PI) * 0.07;
    }, 'inOut').then(() => {
      if (token === this._eyeTween) { this._standing = null; this._standOffset = 0; }
    });
  }

  _updateZone() {
    const zn = this._zoneAt(this.position.x, this.position.z);
    if (zn && zn !== this.zone) {
      const from = this.zone;
      this.zone = zn;
      this.ctx.bus.emit('player:zone', { from, to: zn });
    }
  }

  _updateSteps(moved, dt) {
    const startTh = 0.25, stopTh = 0.08;
    if (!this.isMoving) {
      if (this.speed > startTh && !this.seated) {
        this.isMoving = true;
        this._walkedFor = 0;
        this._stepsThisWalk = 0;
        // 起步後約 0.4 m 第一次落腳
        this._stepAccum = STRIDE * 0.42;
        this._stridePhase = Math.round(this._stridePhase) + 0.42;
      }
    }
    if (this.isMoving) {
      this._walkedFor += dt;
      this._stepAccum += moved;
      this._stridePhase += moved / STRIDE;
      if (this._stepAccum >= STRIDE) {
        this._stepAccum -= STRIDE;
        if (this._stepAccum > STRIDE) this._stepAccum = 0;
        this._stridePhase = Math.round(this._stridePhase);
        this._stepsThisWalk++;
        this.ctx.bus.emit('player:step', {
          surface: SURFACE[this.zone] || 'concrete',
          x: this.position.x, z: this.position.z, speed: this.speed,
        });
      }
      if (this.speed < stopTh) this._finishWalk(true);
    } else if (this._bobAmount < 0.02) {
      // 靜止時讓擺動相位慢慢回到中性
      const target = Math.round(this._stridePhase * 2) / 2;
      this._stridePhase += (target - this._stridePhase) * Math.min(1, dt * 3);
    }
  }

  _finishWalk(emit) {
    const walkedFor = this._walkedFor;
    this.isMoving = false;
    this._walkedFor = 0;
    if (emit && walkedFor >= 0.2) this.ctx.bus.emit('player:stopped', { walkedFor, steps: this._stepsThisWalk });
    this._stepsThisWalk = 0;
  }
}
