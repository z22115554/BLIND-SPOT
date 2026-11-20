// =============================================================================
// Interaction — 準心射線互動系統
// 【API 骨架 / CONTRACT STUB】
// * 每幀由相機中心發出 Raycaster（只對已註冊的物件，recursive），取距離 ≤ distance 的最近目標。
// * 有目標時：ui.setPrompt(label, { verb })、ui.setCrosshair('active')；否則清除。
// * E 鍵或（指標鎖定時的）滑鼠左鍵 → onUse()；emit 'interact:use' { id }。
// * locked = true（過場中）或 inspect 開啟或 player.enabled = false 時，不偵測也不觸發。
// * label / verb / enabled 可以是函式（每幀求值），讓同一物件依劇情狀態改變提示。
// -----------------------------------------------------------------------------
// 實作補充：
// * 隱藏（自身或祖先 visible=false）的物件不會被命中；userData.hitbox 的網格例外（可為隱形材質/隱藏的判定盒）。
// * 結構性遮蔽：視線穿過主控室牆面（且不在開啟的門洞內）時不可互動（避免隔牆拿到手電筒）。
// * 拖曳環顧模式（無指標鎖定）：左鍵按下→放開且位移 < 5 px 視為點擊。
// * 0.25 秒防連點；InspectView 關閉後 / 暫停恢復後 0.3 秒內忽略輸入（同一次點擊不會立刻再觸發）。
// * 目標邊緣有 0.12 秒的保留時間，避免準心落在物件邊緣時提示忽隱忽現。
// * 額外成員：currentItem、currentHit { distance, point }、isBlocked()
// * 觸控（TouchControls）：tapAt(clientX, clientY) 從點擊位置發射射線（含 ±12／24 px 的容錯環），
//   命中可互動物件（距離 ≤ 該物件的互動距離；目前的準心目標再放寬 0.5 m）就觸發；useCurrent() 觸發準心目標
//   （底部提示按鈕）。兩者都走同一套防連點／阻擋規則。
// =============================================================================
import * as THREE from 'three';
import { raycastTree, sortHits, visibleInHierarchy, attachedToScene, roomWallBlocks } from './raycastUtil.js';

const CENTER = new THREE.Vector2(0, 0);
const DEBOUNCE_MS = 250;
const AFTER_CLOSE_MS = 300;
const CLICK_SLOP_PX = 5;
const TARGET_GRACE = 0.12;
const TAP_SLACK = 0.5;         // 觸控點到「目前的準心目標」時，互動距離放寬（m）
// 觸控點擊的容錯取樣（CSS px）：先試正中央，再試 12 px 環（6 點）、24 px 環（8 點）
const TAP_RINGS = [[[0, 0]],
  Array.from({ length: 6 }, (_, i) => [Math.cos(i * Math.PI / 3) * 12, Math.sin(i * Math.PI / 3) * 12]),
  Array.from({ length: 8 }, (_, i) => [Math.cos((i + 0.5) * Math.PI / 4) * 24, Math.sin((i + 0.5) * Math.PI / 4) * 24])];
const isTypingTarget = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ''));
const val = (v, it) => (typeof v === 'function' ? v(it) : v);

export class Interaction {
  constructor(ctx) {
    this.ctx = ctx; this.items = new Map(); this.current = null; this.locked = false;
    this.currentItem = null;
    this.currentHit = null;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line.threshold = 0.01;
    this.raycaster.params.Points.threshold = 0.02;
    this._hits = [];
    this._ui = { label: null, verb: null, active: false };
    this._uiDirty = false;
    this._grace = 0;
    this._lastUse = -1e9;
    this._ignoreUntil = 0;
    this._ignoreFrames = 0;
    this._down = null;
  }

  init() {
    const ctx = this.ctx;
    const el = ctx.renderer?.domElement;
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyE' || e.repeat || isTypingTarget(e.target)) return;
      this._use();
    });
    if (el) {
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const p = ctx.player;
        if (p?.isLocked) { this._use(); return; }
        if (p?.dragMode) this._down = { x: e.clientX, y: e.clientY, max: 0 };
      });
    }
    window.addEventListener('mousemove', (e) => {
      if (!this._down) return;
      this._down.max = Math.max(this._down.max, Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y));
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !this._down) return;
      const d = this._down; this._down = null;
      const moved = Math.max(d.max, Math.hypot(e.clientX - d.x, e.clientY - d.y));
      if (moved < CLICK_SLOP_PX && ctx.player?.dragMode && !ctx.player?.isLocked) this._use();
    });
    // 真實時間 300 ms 且至少經過 3 幀（低幀率時也不會讓同一次輸入穿透）
    const ignore = (ms) => { this._ignoreUntil = Math.max(this._ignoreUntil, performance.now() + ms); this._ignoreFrames = 3; this._down = null; };
    ctx.bus.on('inspect:close', () => ignore(AFTER_CLOSE_MS));
    ctx.bus.on('inspect:open', () => { this._down = null; });
    ctx.bus.on('game:resumed', () => ignore(AFTER_CLOSE_MS));
    ctx.bus.on('pause:resume', () => ignore(AFTER_CLOSE_MS));
  }

  /** @param {{ id: string, object: import('three').Object3D, label: string|Function, verb?: string|Function, enabled?: boolean|Function, distance?: number, onUse: Function }} o */
  add(o) {
    this.items.set(o.id, { verb: this.ctx.SCRIPT?.verbs?.inspect ?? '檢視', enabled: true, distance: 2.3, ...o });
    if (this.current === o.id) this._uiDirty = true;
    return o.id;
  }
  remove(id) {
    this.items.delete(id);
    if (this.current === id) this._setTarget(null);
  }
  has(id) { return this.items.has(id); }
  setEnabled(id, on) { const it = this.items.get(id); if (it) it.enabled = on; }
  /** 測試/除錯：直接觸發。 */
  trigger(id) { const it = this.items.get(id); if (it) { it.onUse?.(); this.ctx.bus.emit('interact:use', { id }); } }

  /** 目前是否不偵測也不觸發（過場、檢視中、玩家停用、暫停）。 */
  isBlocked() {
    const ctx = this.ctx;
    return this.locked || !!ctx.inspect?.isOpen || ctx.player?.enabled === false || !!ctx.clock?.paused;
  }

  /** 觸發目前的準心目標（觸控：底部提示按鈕）。@returns {boolean} 是否觸發 */
  useCurrent() { return this._use(); }

  /** 觸控：在螢幕座標 (clientX, clientY) 點擊。命中可互動物件就觸發。@returns {boolean} */
  tapAt(clientX, clientY) {
    if (this.isBlocked()) return false;
    const W = window.innerWidth || 1, H = window.innerHeight || 1;
    const ndc = this._tapNdc || (this._tapNdc = new THREE.Vector2());
    for (const ring of TAP_RINGS) {
      let best = null;
      for (const [ox, oy] of ring) {
        ndc.set(((clientX + ox) / W) * 2 - 1, -((clientY + oy) / H) * 2 + 1);
        const p = this._pick(ndc, TAP_SLACK);
        if (p && (!best || p.hit.distance < best.hit.distance)) best = p;
      }
      if (best) return this._use(best.item.id);
    }
    return false;
  }

  _use(id = this.current) {
    if (this.isBlocked()) return false;
    const now = performance.now();
    if (now < this._ignoreUntil || this._ignoreFrames > 0 || now - this._lastUse < DEBOUNCE_MS) return false;
    const it = id && this.items.get(id);
    if (!it) return false;
    let enabled = true;
    try { enabled = !!val(it.enabled, it); } catch (e) { console.error('[interact] enabled() threw', id, e); enabled = false; }
    if (!enabled) return false;
    this._lastUse = now;
    try { it.onUse?.(it); } catch (e) { console.error('[interact] onUse threw', id, e); }
    this.ctx.bus.emit('interact:use', { id });
    // onUse 可能開啟了檢視畫面 → 立刻收起提示（準心交給 InspectView）
    if (this.ctx.inspect?.isOpen) this._clearForInspect();
    return true;
  }

  // ---------------------------------------------------------------------------
  update(dt, t) {
    const ctx = this.ctx;
    if (this._ignoreFrames > 0) this._ignoreFrames--;
    if (this.isBlocked()) {
      if (ctx.inspect?.isOpen) this._clearForInspect();
      else if (this.current || this._ui.label) this._setTarget(null);
      this._grace = 0;
      return;
    }
    const pick = this._pick();
    if (pick) {
      this._grace = TARGET_GRACE;
      this.currentHit = { distance: pick.hit.distance, point: pick.hit.point };
      this._setTarget(pick.item, pick.label, pick.verb);
    } else if (this.current && this._grace > 0 && this.items.has(this.current) && this._stillValid(this.current)) {
      this._grace -= dt;
      // 保留目前目標（標籤可能隨劇情改變，仍要更新）
      const it = this.items.get(this.current);
      this._setTarget(it, this._label(it), this._verb(it));
    } else {
      this._setTarget(null);
    }
  }

  _label(it) { try { return val(it.label, it); } catch (e) { console.error('[interact] label() threw', it.id, e); return null; } }
  _verb(it) { try { return val(it.verb, it); } catch (e) { console.error('[interact] verb() threw', it.id, e); return null; } }
  _stillValid(id) {
    const it = this.items.get(id);
    if (!it) return false;
    try { if (!val(it.enabled, it)) return false; } catch { return false; }
    return !!this._label(it) && !!it.object && visibleInHierarchy(it.object, !!it.object.userData?.hitbox);
  }

  /** ndc：射線方向（預設＝畫面中央準心）；slack：目前目標的互動距離放寬量（觸控點擊用）。 */
  _pick(ndc = CENTER, slack = 0) {
    const ctx = this.ctx;
    const cam = ctx.camera;
    if (!cam || this.items.size === 0) return null;
    cam.updateMatrixWorld();
    const rc = this.raycaster;
    rc.setFromCamera(ndc, cam);
    const reach = (it) => (Number.isFinite(it.distance) ? it.distance : 2.3) + (slack && it.id === this.current ? slack : 0);
    const hits = this._hits; hits.length = 0;
    for (const it of this.items.values()) {
      const obj = it.object;
      if (!obj || !obj.isObject3D) continue;
      let enabled;
      try { enabled = val(it.enabled, it); } catch (e) { enabled = false; }
      if (!enabled) continue;
      if (!attachedToScene(obj) || !visibleInHierarchy(obj, !!obj.userData?.hitbox)) continue;
      const dist = reach(it);
      rc.near = 0; rc.far = Math.min(12, dist + 0.01);
      const start = hits.length;
      try { raycastTree(rc, obj, hits, 'target'); } catch (e) { console.warn('[interact] raycast failed', it.id, e); hits.length = start; }
      for (let i = start; i < hits.length; i++) hits[i].item = it;
    }
    if (!hits.length) return null;
    sortHits(hits);
    for (const h of hits) {
      const it = h.item;
      if (h.distance > reach(it)) continue;
      const label = this._label(it);
      if (!label) continue;
      // 結構性遮蔽：隔著主控室牆面不可互動
      if (roomWallBlocks(ctx, rc.ray.origin, h.point)) return null;
      return { item: it, hit: h, label, verb: this._verb(it) };
    }
    return null;
  }

  _setTarget(it, label = null, verb = null) {
    const ui = this.ctx.ui;
    const id = it ? it.id : null;
    this.current = id;
    this.currentItem = it || null;
    if (!it) this.currentHit = null;
    const want = it ? { label, verb: verb ?? this.ctx.SCRIPT?.verbs?.inspect ?? '檢視', active: true } : { label: null, verb: null, active: false };
    const s = this._ui;
    try {
      if (want.label !== s.label || want.verb !== s.verb || this._uiDirty) {
        if (want.label) ui?.setPrompt?.(want.label, { verb: want.verb });
        else ui?.setPrompt?.(null);
      }
      if (want.active !== s.active || this._uiDirty) ui?.setCrosshair?.(want.active ? 'active' : 'dot');
    } catch (e) { console.warn('[interact] ui call failed', e); }
    this._ui = want;
    this._uiDirty = false;
  }

  /** 檢視畫面開啟：只收起提示，準心狀態交給 InspectView；關閉後重新同步一次。 */
  _clearForInspect() {
    if (this._ui.label) { try { this.ctx.ui?.setPrompt?.(null); } catch { /* ignore */ } }
    this.current = null; this.currentItem = null; this.currentHit = null;
    this._ui = { label: null, verb: null, active: false };
    this._uiDirty = true;
  }
}
