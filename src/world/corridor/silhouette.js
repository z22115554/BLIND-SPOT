// =============================================================================
// 防火門車燈幻影用的「玩家剪影」投影體：頭、頸、肩、軀幹、垂下的左臂、
// 往前舉著手電筒的右臂。只在車燈（hl[0]）的陰影貼圖中繪製——
// 主畫面看不到它（colorWrite/depthWrite 關閉、事件以外 visible = false），其他光源也不會被它擋住。
// 比 PlayerController 的膠囊更像一個人：牆上的影子讀得出「頭與肩膀」。
// 局部座標：原點在腳底，-Z 為面向，+X 為右手。
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function capsuleBetween(a, b, r, segs = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 4, segs);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  const m = A.clone().add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

export function buildSilhouette(eyeHeight = 1.62) {
  const parts = [];
  const hy = eyeHeight + 0.02;
  // 頭（略在眼睛後方）
  const head = new THREE.SphereGeometry(0.105, 14, 10); head.scale(0.92, 1.08, 1); head.translate(0, hy, 0.06); parts.push(head);
  // 頸
  parts.push(capsuleBetween([0, hy - 0.2, 0.07], [0, hy - 0.08, 0.06], 0.052));
  // 肩線（兩端圓）
  const sy = hy - 0.25;
  parts.push(capsuleBetween([-0.17, sy - 0.02, 0.06], [0.17, sy - 0.02, 0.06], 0.07));
  // 軀幹（扁一點的膠囊）
  const torso = new THREE.CapsuleGeometry(0.15, 0.42, 4, 10); torso.scale(1.18, 1, 0.72); torso.translate(0, sy - 0.33, 0.07); parts.push(torso);
  // 腰臀＋腿（車燈從低處往上斜射，通常照不到，但保留以免角度變化時影子「斷頭」）
  const hips = new THREE.CapsuleGeometry(0.14, 0.2, 4, 8); hips.scale(1.15, 1, 0.75); hips.translate(0, 0.86, 0.07); parts.push(hips);
  parts.push(capsuleBetween([-0.09, 0.08, 0.07], [-0.09, 0.78, 0.07], 0.07));
  parts.push(capsuleBetween([0.09, 0.08, 0.07], [0.09, 0.78, 0.07], 0.07));
  // 左臂垂下
  parts.push(capsuleBetween([-0.22, sy - 0.04, 0.07], [-0.25, sy - 0.32, 0.09], 0.048));
  parts.push(capsuleBetween([-0.25, sy - 0.32, 0.09], [-0.23, sy - 0.6, 0.04], 0.042));
  // 右臂往前舉著手電筒（肩 → 肘 → 手）
  const elbow = [0.24, sy - 0.24, -0.08], hand = [0.17, sy - 0.12, -0.36];
  parts.push(capsuleBetween([0.21, sy - 0.04, 0.05], elbow, 0.047));
  parts.push(capsuleBetween(elbow, hand, 0.042));
  // 手電筒
  parts.push(capsuleBetween(hand, [hand[0] - 0.01, hand[1] + 0.02, hand[2] - 0.2], 0.026));
  for (const p of parts) { p.deleteAttribute('uv'); p.deleteAttribute('normal'); }
  const geo = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  for (const p of parts) p.dispose();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  mat.name = 'headlightSilhouette';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'headlightSilhouette';
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = -10;
  mesh.userData.noOcclude = true;
  return mesh;
}

/**
 * 讓 mesh 在某一個陰影相機的陰影貼圖中「不繪製」（或「只在它之中繪製」）。
 * three r170 的 WebGLShadowMap 會在每個物件繪製前後呼叫 onBeforeShadow/onAfterShadow；
 * 這裡把 drawRange 暫時設成 0，畫完再還原。會串接（保留）物件原本的 callback。
 * @param {THREE.Mesh} mesh  @param {() => THREE.Camera} getCam  @param {'skip'|'only'} mode
 */
export function filterShadowPass(mesh, getCam, mode = 'skip') {
  const prevB = mesh.onBeforeShadow, prevA = mesh.onAfterShadow;
  let saved = null;
  mesh.onBeforeShadow = function (renderer, object, camera, shadowCamera, geometry, depthMaterial, group) {
    const hit = shadowCamera === getCam();
    if (mode === 'skip' ? hit : !hit) {
      saved = [geometry.drawRange.start, geometry.drawRange.count];
      geometry.setDrawRange(0, 0);
      return;
    }
    saved = null;
    if (prevB) prevB.call(this, renderer, object, camera, shadowCamera, geometry, depthMaterial, group);
  };
  mesh.onAfterShadow = function (renderer, object, camera, shadowCamera, geometry, depthMaterial, group) {
    if (saved) { geometry.setDrawRange(saved[0], saved[1]); saved = null; return; }
    if (prevA) prevA.call(this, renderer, object, camera, shadowCamera, geometry, depthMaterial, group);
  };
}

