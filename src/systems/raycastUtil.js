// =============================================================================
// raycastUtil — Interaction / GazeSystem 共用的射線工具（玩家模組的輔助檔）
// * three.js 的 Raycaster 不理會 visible；這裡改用自訂遍歷，直接略過隱藏的子樹。
// * 兩種遍歷模式：
//     'target'   互動/被注視的目標本身：隱藏子樹略過，但 userData.hitbox 的節點即使 visible=false 也能被命中。
//     'occluder' 遮蔽物：略過隱藏、userData.noOcclude（整個子樹）、userData.hitbox（僅自身）、
//                Points / Sprite / Line、透明且 opacity < 0.5、colorWrite=false 或 material.visible=false 的網格。
// * 主控室牆面的結構性遮蔽（不依賴其他模組是否真的建了牆網格）：
//     視線若穿越主控室邊界，交點必須落在「開著的」門洞內，否則視為被牆擋住。
// =============================================================================

/** obj 與所有祖先都 visible。allowSelfHidden：obj 本身隱藏也算（hitbox 用）。 */
export function visibleInHierarchy(obj, allowSelfHidden = false) {
  let o = obj;
  if (allowSelfHidden && o) o = o.parent;
  for (; o; o = o.parent) if (o.visible === false) return false;
  return true;
}

/** obj 是否為 root 本身或其子孫。 */
export function isDescendantOf(obj, root) {
  for (let o = obj; o; o = o.parent) if (o === root) return true;
  return false;
}

/** obj 是否掛在某個 Scene 底下（被移出場景的物件不參與判定）。 */
export function attachedToScene(obj) {
  let o = obj;
  while (o && o.parent) o = o.parent;
  return !!(o && o.isScene);
}

function materialInvisible(material) {
  const list = Array.isArray(material) ? material : [material];
  let any = false;
  for (const m of list) {
    if (!m) continue;
    any = true;
    const see = m.visible !== false && m.colorWrite !== false && !(m.transparent && m.opacity < 0.5) && m.opacity > 0;
    if (see) return false;
  }
  return any;
}

/**
 * 以自訂遍歷做 raycast，結果 push 進 out（未排序）。每個命中附帶 .root（遍歷起點）。
 * @param {import('three').Raycaster} raycaster
 * @param {import('three').Object3D} root
 * @param {object[]} out
 * @param {'target'|'occluder'} mode
 * @param {import('three').Object3D|null} skip 不參與遍歷的子樹（例如目標本身，避免重複）
 */
export function raycastTree(raycaster, root, out, mode = 'target', skip = null) {
  const start = out.length;
  walk(raycaster, root, out, mode, skip);
  for (let i = start; i < out.length; i++) out[i].root = root;
  return out;
}

function walk(raycaster, node, out, mode, skip) {
  if (!node || node === skip) return;
  const ud = node.userData || {};
  if (mode === 'target') {
    if (node.visible === false) {
      // 隱形 hitbox 仍可被瞄準（但它底下的子物件視為隱藏）
      if (ud.hitbox && (node.isMesh || node.isSprite) && node.layers.test(raycaster.layers)) node.raycast(raycaster, out);
      return;
    }
    if ((node.isMesh || node.isSprite) && node.layers.test(raycaster.layers)) node.raycast(raycaster, out);
  } else {
    if (node.visible === false || ud.noOcclude) return;
    const testable = node.isMesh && !ud.hitbox && !node.isPoints && !node.isLine && !node.isSprite
      && node.layers.test(raycaster.layers) && !materialInvisible(node.material);
    if (testable) node.raycast(raycaster, out);
  }
  const ch = node.children;
  for (let i = 0; i < ch.length; i++) walk(raycaster, ch[i], out, mode, skip);
}

/** 依距離排序（就地）。 */
export function sortHits(hits) { hits.sort((a, b) => a.distance - b.distance); return hits; }

// ---------------------------------------------------------------------------
// 主控室牆面的結構性遮蔽
// ---------------------------------------------------------------------------
function inRect(R, x, z, m) { return x >= R.minX - m && x <= R.maxX + m && z >= R.minZ - m && z <= R.maxZ + m; }

/** 2D 線段 a→b 與矩形邊界的交點參數（a 在內：離開點；a 在外：進入點）。找不到回傳 null。 */
function boundaryT(R, ax, az, bx, bz, aInside) {
  const dx = bx - ax, dz = bz - az;
  let t0 = 0, t1 = 1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
    return true;
  };
  if (!clip(-dx, ax - R.minX) || !clip(dx, R.maxX - ax) || !clip(-dz, az - R.minZ) || !clip(dz, R.maxZ - az)) return null;
  return aInside ? t1 : t0;
}

/**
 * 視線 from→to 是否被主控室牆面（結構上）擋住。
 * * 相機在室內：目標點超出房間矩形 innerMargin（牆厚＋外凸物）才算穿牆。
 * * 相機在室外：目標點只要在房間矩形（＋outerMargin）內就算穿牆——牆內側的面板/箱子即使貼著牆面也一樣。
 * 穿牆時，與房間邊界的交點必須落在「開著的」門洞內，否則視為被牆擋住。
 * @returns {boolean} true = 被牆擋住
 */
export function roomWallBlocks(ctx, from, to, { innerMargin = 0.25, outerMargin = 0.03 } = {}) {
  const L = ctx.LAYOUT;
  const R = L.CONTROL_ROOM;
  const camIn = inRect(R, from.x, from.z, 0);
  let crossing = false;
  if (camIn && !inRect(R, to.x, to.z, innerMargin)) crossing = true;
  else if (!camIn && inRect(R, to.x, to.z, outerMargin)) crossing = true;
  if (!crossing) return false;
  // 室外 → 室內：以「房間矩形＋outerMargin」計算進入點（目標可能正好貼在牆面上）
  const B = camIn ? R : { minX: R.minX - outerMargin, maxX: R.maxX + outerMargin, minZ: R.minZ - outerMargin, maxZ: R.maxZ + outerMargin };
  const t = boundaryT(B, from.x, from.z, to.x, to.z, camIn);
  if (t === null) return false;
  const px = from.x + (to.x - from.x) * t;
  const py = from.y + (to.y - from.y) * t;
  const pz = from.z + (to.z - from.z) * t;
  const eps = 0.02;
  // 東牆：側門門洞（側門開啟時）
  const sd = R.sideDoor;
  if (Math.abs(px - B.maxX) < eps && L.PORTALS?.sideDoor?.open) {
    if (pz >= sd.z - sd.width / 2 && pz <= sd.z + sd.width / 2 && py >= 0 && py <= sd.height) return false;
  }
  // 西牆：防爆門門洞（防爆門滑開時）
  const bd = R.blastDoor;
  if (Math.abs(px - B.minX) < eps && blastDoorOpen(ctx)) {
    if (pz >= bd.z - bd.width / 2 && pz <= bd.z + bd.width / 2 && py >= 0 && py <= bd.height) return false;
  }
  return true;
}

let _box = null;
function blastDoorOpen(ctx) {
  const cr = ctx.controlRoom;
  if (!cr) return false;
  if (typeof cr.blastDoorOpen === 'boolean') return cr.blastDoorOpen;
  if (typeof cr.blastDoorOpenAmount === 'number') return cr.blastDoorOpenAmount > 0.25;
  const door = cr.objects?.blastDoor;
  if (!door || !door.visible) return true; // 門不見了＝門洞空著
  const THREE = ctx.THREE;
  if (!_box) _box = new THREE.Box3();
  _box.setFromObject(door);
  if (_box.isEmpty()) return false;
  const bd = ctx.LAYOUT.CONTROL_ROOM.blastDoor;
  return (_box.min.z + _box.max.z) / 2 > bd.z + bd.width * 0.35;
}
