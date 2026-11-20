// =============================================================================
// 第二幕的三件線索：碎裂機械錶、燒焦的交接日誌、消防救援外套。
// 每件都是「標準 Mesh＋標準材質」組成的 Group，以自身原點為中心、
// 標準朝向（正面朝 +Z、上方 +Y），方便 InspectView clone(true) 後直接預覽。
// 世界中的擺放（平躺、轉向）由外層的 mount Group 負責。
// =============================================================================
import * as THREE from 'three';
import { paramSurface, taperTube, hash, vnoise, normalizeGeo } from './geo.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as TX from './tex.js';

const PI = Math.PI;

/** 把 group 的子物件平移，使整體包圍盒中心落在原點。回傳尺寸。 */
export function recenter(group) {
  group.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(group);
  const c = bb.getCenter(new THREE.Vector3());
  for (const ch of group.children) ch.position.sub(c);
  return bb.getSize(new THREE.Vector3());
}

/**
 * 把 group 的直接子網格依材質合併（減少 draw call）。多重材質、隱形判定盒、有 renderOrder 的透明件保持原樣。
 */
export function mergeByMaterial(group) {
  const byMat = new Map(), keep = [];
  group.updateMatrix();
  for (const ch of [...group.children]) {
    if (!ch.isMesh || Array.isArray(ch.material) || ch.userData.hitbox || ch.children.length || ch.renderOrder) { keep.push(ch); continue; }
    ch.updateMatrix();
    const g = ch.geometry.clone().applyMatrix4(ch.matrix);
    normalizeGeo(g);
    if (!byMat.has(ch.material)) byMat.set(ch.material, []);
    byMat.get(ch.material).push(g);
    group.remove(ch); ch.geometry.dispose();
  }
  for (const [mat, list] of byMat) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

/** 隱形的互動判定盒（Raycaster 不檢查 visible；渲染時不可見）。 */
function hitbox(w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  m.visible = false; m.name = 'hitbox'; m.userData.hitbox = true;
  return m;
}

// =============================================================================
// 機械錶：錶面朝 +Z、12 點朝 +Y（標準朝向）。
// =============================================================================
export function buildWatch(ctx) {
  const T = ctx.textures;
  const group = new THREE.Group(); group.name = 'watch';
  const steel = new THREE.MeshStandardMaterial({ color: 0xd2d5d8, metalness: 0.55, roughness: 0.26 });
  steel.name = 'watchSteel';
  const steelBrushed = new THREE.MeshStandardMaterial({ color: 0xb9bcbf, metalness: 0.5, roughness: 0.42 });
  const R = 0.0205;
  // 錶殼：車削輪廓（錶背 → 腰 → 錶圈）
  const prof = [
    [0.0, -0.0056], [0.0165, -0.0056], [0.0185, -0.0048], [0.0198, -0.0032], [R, -0.001], [R, 0.0015],
    [0.0199, 0.0032], [0.0193, 0.0046], [0.018, 0.0056], [0.0172, 0.0056], [0.0171, 0.0049],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const caseG = new THREE.LatheGeometry(prof, 56);
  caseG.rotateX(PI / 2); // 車削軸 Y → Z（錶面朝 +Z）
  const caseM = new THREE.Mesh(caseG, steel); group.add(caseM);
  // 錶圈刻紋：細環
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0186, 0.0009, 6, 56), steel);
  bezel.position.z = 0.0052; group.add(bezel);
  // 錶盤
  const dialMat = new THREE.MeshStandardMaterial({ map: T.createWatchFace(), roughness: 0.5, metalness: 0.25 });
  const dial = new THREE.Mesh(new THREE.CircleGeometry(0.0171, 56), dialMat);
  dial.position.z = 0.0034; group.add(dial);
  // 錶鏡（碎裂的藍寶石玻璃：半透明、亮面）
  const crystalMat = new THREE.MeshStandardMaterial({ color: 0xe6eef0, transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.1, depthWrite: false });
  const crystal = new THREE.Mesh(new THREE.CircleGeometry(0.0173, 56), crystalMat);
  crystal.position.z = 0.0048; crystal.renderOrder = 1; group.add(crystal);
  // 碎片：幾片微微翹起的三角形，讓手電筒照到時反光錯落
  const shardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.02, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
  const shards = new THREE.BufferGeometry();
  const sp = [], c0 = [-0.006, -0.008]; // 撞擊點（約 7–8 點鐘）
  for (let k = 0; k < 7; k++) {
    const a0 = (k / 7) * PI * 2 + 0.2, a1 = a0 + PI * 2 / 7 * 0.9;
    const r0 = 0.016;
    const p0 = [c0[0], c0[1], 0.0049];
    const p1 = [Math.cos(a0) * r0, Math.sin(a0) * r0, 0.0049 + (k % 3) * 0.00035];
    const p2 = [Math.cos(a1) * r0, Math.sin(a1) * r0, 0.0049 + ((k + 1) % 3) * 0.00035];
    sp.push(...p0, ...p1, ...p2);
  }
  shards.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); shards.computeVertexNormals();
  const sh = new THREE.Mesh(shards, shardMat); sh.renderOrder = 2; group.add(sh);
  // 錶背（朝 -Z）
  const backMat = new THREE.MeshStandardMaterial({ map: T.createWatchBack(), roughness: 0.35, metalness: 0.5 });
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.0166, 48), backMat);
  back.rotation.y = PI; back.position.z = -0.0057; group.add(back);
  // 錶冠（3 點鐘 = +X）
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, 0.0042, 16), steelBrushed);
  crown.rotation.z = PI / 2; crown.position.set(R + 0.0019, 0, 0); group.add(crown);
  const crownNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 0.002, 8), steel);
  crownNeck.rotation.z = PI / 2; crownNeck.position.set(R + 0.0002, 0, 0); group.add(crownNeck);
  // 錶耳（12/6 點方向 = ±Y）
  for (const sy of [1, -1]) for (const sx of [1, -1]) {
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.0034, 0.0075, 0.0055), steel);
    lug.position.set(sx * 0.0094, sy * 0.0205, -0.0005); lug.rotation.x = sy * 0.12; group.add(lug);
  }
  // 三排式鋼鍊（圓角鍊節）：兩段鬆鬆地攤在格柵上，末端略為捲起
  const linkC = new THREE.CylinderGeometry(0.0031, 0.0031, 0.0072, 10); linkC.rotateZ(PI / 2); linkC.scale(1, 1, 0.55);
  const linkS = new THREE.CylinderGeometry(0.0029, 0.0029, 0.0052, 10); linkS.rotateZ(PI / 2); linkS.scale(1, 1, 0.5);
  const endLink = new THREE.BoxGeometry(0.0185, 0.0045, 0.0034);
  const gC = [], gS = [], gE = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const put = (arr, geo, x, y, z, rz, rx = 0) => { e.set(rx, 0, rz); q.setFromEuler(e); m4.compose(new THREE.Vector3(x, y, z), q, one); arr.push(geo.clone().applyMatrix4(m4)); };
  const strap = (sy, n, bend, clasp) => {
    let x = 0, y = sy * 0.0262, ang = sy > 0 ? PI / 2 : -PI / 2;
    put(gE, endLink, 0, sy * 0.0232, -0.0025, 0);
    for (let i = 0; i < n; i++) {
      const step = 0.0064;
      if (i > 2) ang += bend * (sy > 0 ? -1 : 1) * (0.7 + 0.6 * hash(i, sy));
      x += Math.cos(ang) * step; y += Math.sin(ang) * step;
      const zz = -0.0034 - Math.min(i, 4) * 0.0003 + (i > n - 3 ? (i - n + 3) * 0.0012 : 0);   // 末端略翹
      const rz = ang - PI / 2 + (hash(i * 3, sy) - 0.5) * 0.08, rx = (hash(i, sy * 7) - 0.5) * 0.12;
      const px = Math.cos(ang + PI / 2), py = Math.sin(ang + PI / 2);
      put(gC, linkC, x, y, zz, rz, rx);
      put(gS, linkS, x + px * 0.0064, y + py * 0.0064, zz - 0.0002, rz, rx);
      put(gS, linkS, x - px * 0.0064, y - py * 0.0064, zz - 0.0002, rz, rx);
    }
    if (clasp) {
      const cl = new THREE.Mesh(new THREE.BoxGeometry(0.0175, 0.024, 0.0042), steelBrushed);
      cl.position.set(x + Math.cos(ang) * 0.0145, y + Math.sin(ang) * 0.0145, -0.0028); cl.rotation.z = ang - PI / 2; cl.rotation.x = 0.1;
      group.add(cl);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.003, 0.0015), steel);
      lip.position.set(cl.position.x + Math.cos(ang) * 0.011, cl.position.y + Math.sin(ang) * 0.011, -0.0008); lip.rotation.z = ang - PI / 2;
      group.add(lip);
    }
  };
  strap(1, 11, 0.075, false);
  strap(-1, 9, 0.1, true);
  group.add(new THREE.Mesh(mergeGeometries(gC), steel));
  group.add(new THREE.Mesh(mergeGeometries(gS), steelBrushed));
  group.add(new THREE.Mesh(mergeGeometries(gE), steel));
  linkC.dispose(); linkS.dispose(); endLink.dispose();
  for (const ch of group.children) { ch.castShadow = true; ch.receiveShadow = true; }
  mergeByMaterial(group);
  recenter(group);
  const ws = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  group.add(hitbox(Math.max(0.07, ws.x * 1.1), ws.y * 1.05, Math.max(0.03, ws.z * 1.4)));
  return group;
}

// =============================================================================
// 燒焦的交接日誌：封面朝 +Z、上緣 +Y（標準朝向，像拿在手上看封面）。
// =============================================================================
export function buildLogbook(ctx) {
  const T = ctx.textures;
  const lb = T.createLogbook();
  const group = new THREE.Group(); group.name = 'logbook';
  const W = 0.235, Hh = 0.305, TH = 0.03;
  const coverMat = new THREE.MeshStandardMaterial({ map: lb.cover, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  coverMat.name = 'logbookCover';
  const charMat = new THREE.MeshStandardMaterial({ color: 0x120e0b, roughness: 0.95 });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x2c2722, roughness: 0.9 });
  const pageTex = lb.page;
  const pageMat = new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.92, side: THREE.DoubleSide });
  const edgeMat = new THREE.MeshStandardMaterial({ map: TX.pageEdgeTexture(), roughness: 0.95 });

  // 燒掉的右下角：不規則焦邊輪廓（以 UV 0..1 描述）
  const burnt = (u, v) => {
    // 回傳該點是否被燒掉（右下角往內被吃掉，邊緣鋸齒）
    const n = vnoise(u * 9, v * 9) * 0.12 + vnoise(u * 23 + 7, v * 23) * 0.05;
    return (u - 0.42) * 0.9 + (0.58 - v) * 1.1 + n > 0.62;
  };
  // 封面：細分的平面，用 burnt 決定的三角形保留，並往上翹曲
  const NU = 34, NV = 44;
  const coverG = paramSurface((u, v, t) => {
    const curl = Math.pow(Math.max(0, (u - 0.5) * 1.4 + (0.5 - v) * 1.2), 2) * 0.03;  // 焦掉的那一角翹起
    const bow = Math.sin(u * PI) * 0.003;
    t.set((u - 0.5) * W, (v - 0.5) * Hh, TH / 2 + bow + curl);
  }, NU, NV);
  // 把被燒掉的三角形移除
  {
    const idx = coverG.index.array, keep = [], uvA = coverG.attributes.uv;
    for (let i = 0; i < idx.length; i += 3) {
      let cu = 0, cv = 0;
      for (let k = 0; k < 3; k++) { cu += uvA.getX(idx[i + k]) / 3; cv += uvA.getY(idx[i + k]) / 3; }
      if (!burnt(cu, cv)) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    coverG.setIndex(keep);
  }
  const cover = new THREE.Mesh(coverG, coverMat); group.add(cover);
  // 焦黑邊緣：被燒掉邊界的三角形（略大一圈）畫成炭黑
  {
    const g2 = paramSurface((u, v, t) => {
      const curl = Math.pow(Math.max(0, (u - 0.5) * 1.4 + (0.5 - v) * 1.2), 2) * 0.03;
      const bow = Math.sin(u * PI) * 0.003;
      t.set((u - 0.5) * W, (v - 0.5) * Hh, TH / 2 + bow + curl - 0.0006);
    }, NU, NV);
    const idx = g2.index.array, keep = [], uvA = g2.attributes.uv;
    for (let i = 0; i < idx.length; i += 3) {
      let cu = 0, cv = 0;
      for (let k = 0; k < 3; k++) { cu += uvA.getX(idx[i + k]) / 3; cv += uvA.getY(idx[i + k]) / 3; }
      const n = vnoise(cu * 9, cv * 9) * 0.12 + vnoise(cu * 23 + 7, cv * 23) * 0.05;
      const f = (cu - 0.42) * 0.9 + (0.58 - cv) * 1.1 + n;
      if (f > 0.56 && f <= 0.69) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    g2.setIndex(keep);
    group.add(new THREE.Mesh(g2, charMat));
  }
  // 書背（左側，圓弧）
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(TH / 2, TH / 2, Hh, 14, 1, true, PI, PI), backMat);
  spine.position.set(-W / 2, 0, 0); group.add(spine);
  // 內頁塊：外形同樣被燒掉右下角（比封面少燒一點，露出焦黑的紙緣）
  {
    const Wp = W - 0.012, Hp = Hh - 0.012, D = TH - 0.006, thr = 0.69;
    const fAt = (u, v) => (u - 0.42) * 0.9 + (0.58 - v) * 1.1 + vnoise(u * 9, v * 9) * 0.12 + vnoise(u * 23 + 7, v * 23) * 0.05;
    const vOf = (u) => { let v = 0.4; for (let k = 0; k < 6; k++) v = ((u - 0.42) * 0.9 + 0.638 + vnoise(u * 9, v * 9) * 0.12 + vnoise(u * 23 + 7, v * 23) * 0.05 - thr) / 1.1; return v; };
    let u0 = 0.3; for (let k = 0; k < 40 && fAt(u0, 0) < thr; k++) u0 += 0.01;
    const shape = new THREE.Shape();
    const P = (u, v) => [(u - 0.5) * Wp, (v - 0.5) * Hp];
    shape.moveTo(...P(0, 0)); shape.lineTo(...P(u0, 0));
    for (let k = 1; k <= 16; k++) { const u = u0 + (1 - u0) * (k / 16); const v = Math.min(0.98, Math.max(0, vOf(u))); shape.lineTo(...P(u, v)); }
    shape.lineTo(...P(1, 1)); shape.lineTo(...P(0, 1)); shape.closePath();
    const bg = new THREE.ExtrudeGeometry(shape, { depth: D, bevelEnabled: false, curveSegments: 1 });
    bg.translate(0.002, 0, -D / 2);
    const pos = bg.attributes.position, uv = bg.attributes.uv;
    const caps = bg.groups[0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (i >= caps.start && i < caps.start + caps.count) uv.setXY(i, (x - 0.002) / Wp + 0.5, y / Hp + 0.5);
      else uv.setXY(i, (x + y) * 6, (z + D / 2) / D);
    }
    group.add(new THREE.Mesh(bg, [pageMat, edgeMat]));
  }
  // 封底
  const backC = new THREE.Mesh(new THREE.BoxGeometry(W, Hh, 0.003), backMat);
  backC.position.z = -TH / 2; group.add(backC);
  for (const ch of group.children) { ch.castShadow = true; ch.receiveShadow = true; }
  mergeByMaterial(group);
  recenter(group);
  return group;
}

/** 散落的焦黑紙頁（在 InspectView 群組之外）。 */
export function buildLoosePage(ctx, seed = 1) {
  const lb = ctx.textures.createLogbook();
  const mat = new THREE.MeshStandardMaterial({ map: lb.page, roughness: 0.95, side: THREE.DoubleSide });
  const W = 0.21, Hh = 0.29;
  const g = paramSurface((u, v, t) => {
    const curl = Math.pow(Math.max(0, u - 0.6), 2) * 0.18 * (seed % 2 ? 1 : 0.5) + Math.pow(Math.max(0, 0.25 - v), 2) * 0.25;
    t.set((u - 0.5) * W, curl + Math.sin(v * 7 + seed) * 0.002, (0.5 - v) * Hh);
  }, 12, 16);
  // 隨機焦缺
  const idx = g.index.array, keep = [], uvA = g.attributes.uv;
  for (let i = 0; i < idx.length; i += 3) {
    let cu = 0, cv = 0;
    for (let k = 0; k < 3; k++) { cu += uvA.getX(idx[i + k]) / 3; cv += uvA.getY(idx[i + k]) / 3; }
    const f = (cu + (1 - cv)) * 0.5 + vnoise(cu * 8 + seed, cv * 8) * 0.25;
    if (f < 0.82) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex(keep);
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = true;
  return m;
}

// =============================================================================
// 消防救援外套（掛起來的空外套）：正面朝 +Z、上 +Y。
// =============================================================================
export function buildCoat(ctx) {
  const T = ctx.textures;
  const group = new THREE.Group(); group.name = 'coat';
  const fab = TX.coatFabricTextures();
  const fabricMat = new THREE.MeshStandardMaterial({
    map: fab.map, roughness: 0.86, metalness: 0, side: THREE.DoubleSide,
    emissive: new THREE.Color(0xe9f2dc), emissiveMap: fab.emissive, emissiveIntensity: 0,
  });
  fabricMat.name = 'coatFabric';
  const backMat = new THREE.MeshStandardMaterial({ map: T.createCoatBack(), roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
  backMat.name = 'coatBack';
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.9, side: THREE.DoubleSide });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x8c8f8c, roughness: 0.4, metalness: 0.7 });

  const Y0 = -0.43, Y1 = 0.42, HH = Y1 - Y0, YS = 0.235;     // YS：肩線（只用後領掛環吊著，肩膀往下塌）
  // 截面半寬 a(y)、半深 b(y)：下擺略外擴、肩膀從領口斜斜塌下
  const a = (y) => {
    if (y > YS) { const t = (y - YS) / (Y1 - YS); return 0.25 - (0.25 - 0.102) * Math.pow(t, 0.9); }
    return 0.252 + (YS - y) * 0.035 + Math.max(0, -0.28 - y) * 0.12;
  };
  const b = (y) => {
    if (y > YS) { const t = (y - YS) / (Y1 - YS); return 0.1 - 0.03 * t; }
    return 0.097 + (YS - y) * 0.022;
  };
  // 皺褶：吊掛造成的 V 形垂褶（上方）＋下襬的縱向褶＋細碎雜訊；θ = 0 前中心，θ = π 後中心
  const wrinkle = (th, y) => {
    const drape = Math.max(0, y - 0.0) * 0.03 * Math.sin(th * 5 + 0.6) * (0.6 + 0.4 * vnoise(th * 3, y * 4));
    const hang = Math.max(0, (0.2 - y)) * 0.024 * Math.sin(th * 7 + vnoise(th * 2, y * 3) * 3);
    const n = (vnoise(th * 4 + 3, y * 9) - 0.5) * 0.012 + (vnoise(th * 11, y * 21 + 5) - 0.5) * 0.004;
    const pinch = y > 0.34 ? -0.012 * Math.cos(th) * (y - 0.34) / 0.08 : 0;      // 掛環把後領往上拉
    const hem = y < Y0 + 0.04 ? (vnoise(th * 6, 1.3) - 0.5) * 0.01 : 0;
    return drape + hang + n + pinch + hem;
  };
  const bodyUV = (th0, th1, y0, y1) => (u, v) => {
    const th = th0 + u * (th1 - th0), y = y0 + v * (y1 - y0);
    return [(th + PI / 2) / PI, (y - Y0) / HH];
  };
  const P = (th, y, off, t) => {
    // 超橢圓截面（較方正，空外套的形狀）
    const s = Math.sin(th), c = Math.cos(th);
    const sx = Math.sign(s) * Math.pow(Math.abs(s), 0.75), cz = Math.sign(c) * Math.pow(Math.abs(c), 0.75);
    const w = wrinkle(th, y) + off;
    t.set(sx * (a(y) + w), y, cz * (b(y) + w * 0.8));
  };
  // 正面（θ -π/2..π/2）與背面（θ π/2..3π/2）
  const front = paramSurface((u, v, t) => P(-PI / 2 + u * PI, Y0 + v * HH, 0, t), 40, 44);
  // 背面貼圖只鋪在較平的背中央，兩側（貼圖邊緣像素）延伸到側縫
  const backG = paramSurface((u, v, t) => P(PI / 2 + u * PI, Y0 + v * HH, 0, t), 40, 44,
    { uvFn: (u, v) => [Math.min(1, Math.max(0, (u * PI - 0.48) / (PI - 0.96))), v] });
  group.add(new THREE.Mesh(front, fabricMat));
  group.add(new THREE.Mesh(backG, backMat));
  // 立領（前方開口，被掛環拉得有點歪）
  const collar = paramSurface((u, v, t) => {
    const th = -PI * 0.84 + u * PI * 1.68 + PI;                   // 從前左繞到前右（開口在正前方）
    const y = Y1 - 0.02 + v * (0.075 - 0.02 * Math.cos(th));
    const r = 1 + v * 0.16;                                              // 領口往外翻開
    t.set(Math.sin(th) * 0.108 * r, y, Math.cos(th) * 0.084 * r - 0.006);
  }, 24, 3);
  group.add(new THREE.Mesh(collar, darkMat));
  // 前襟擋風片＋拉鍊（沿正面中心的薄片）
  const flap = paramSurface((u, v, t) => P(-0.1 + u * 0.2, Y0 + 0.02 + v * (HH - 0.06), 0.009, t), 4, 30,
    { uvFn: bodyUV(-0.1, 0.1, Y0 + 0.02, Y1 - 0.04) });
  group.add(new THREE.Mesh(flap, fabricMat));
  // 下方兩個風箱口袋＋袋蓋
  for (const side of [-1, 1]) {
    const th0 = side > 0 ? 0.42 : -1.02, th1 = th0 + 0.6;
    const pocket = paramSurface((u, v, t) => P(th0 + u * (th1 - th0), -0.36 + v * 0.2, 0.014, t), 8, 8,
      { uvFn: bodyUV(th0, th1, -0.36, -0.16) });
    group.add(new THREE.Mesh(pocket, fabricMat));
    const lid = paramSurface((u, v, t) => P(th0 - 0.03 + u * (th1 - th0 + 0.06), -0.165 + v * 0.055, 0.022, t), 8, 3);
    group.add(new THREE.Mesh(lid, darkMat));
    // 口袋側邊厚度（把口袋縫回身上的「牆」）
    const wall = paramSurface((u, v, t) => {
      const th = th0 + (side > 0 ? 0 : 1) * (th1 - th0);
      P(th, -0.36 + u * 0.2, v * 0.014, t);
    }, 4, 1);
    group.add(new THREE.Mesh(wall, darkMat));
  }
  // 袖子：從肩頭垂下、手肘微彎、略往前
  for (const side of [-1, 1]) {
    const pts = [
      new THREE.Vector3(side * 0.19, YS - 0.005, -0.01),
      new THREE.Vector3(side * 0.262, 0.1, 0.004),
      new THREE.Vector3(side * 0.282, -0.06, 0.03),
      new THREE.Vector3(side * 0.275, -0.22, 0.062),
      new THREE.Vector3(side * 0.258, -0.39, 0.078),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const sleeve = taperTube(curve, {
      segs: 28, radial: 14, flat: 0.74, flatAxis: [0, 0, 1],
      radiusFn: (t) => 0.074 - 0.018 * t + 0.007 * Math.sin(t * 19) * (1 - t) + (t < 0.1 ? (0.1 - t) * 0.12 : 0),
    });
    // 袖子皺褶
    const p = sleeve.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = (vnoise(x * 40 + y * 30, z * 40) - 0.5) * 0.006;
      p.setXYZ(i, x + side * n, y, z + n);
    }
    sleeve.computeVertexNormals();
    group.add(new THREE.Mesh(sleeve, fabricMat));
    // 袖口（深色內襯手腕套）
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.053, 0.03, 16, 1, true), darkMat);
    cuff.position.copy(pts[4]).add(new THREE.Vector3(-side * 0.003, -0.012, 0.004));
    cuff.rotation.z = side * 0.12; cuff.rotation.x = 0.15;
    group.add(cuff);
  }
  // 後領的掛環
  const loop = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 16, PI), darkMat);
  loop.position.set(0, Y1 + 0.045, -0.055); group.add(loop);
  // 前襟扣環（D 環）
  for (const y of [0.15, -0.05, -0.25]) {
    const d = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0025, 6, 14), metalMat);
    d.position.set(0.03, y, b(y) + wrinkle(0.15, y) + 0.022); group.add(d);
  }
  mergeByMaterial(group);
  recenter(group);
  return { group, fabricMat };
}
