// =============================================================================
// 防火門玻璃外的主車道（只透過玻璃看得到）：柏油、標線、步道與路緣、磁磚隧道壁、
// 拱頂、射流風機、一盞很暗的遠處鈉燈、反光標記，以及緩慢飄落的灰燼。
// 另外包含「幻影車燈」的光源、眩光精靈與穿窗光束。
// =============================================================================
import * as THREE from 'three';
import { box, boxC, tube, xform, Batch, paramSurface, GeoBuilder } from './geo.js';
import * as TX from './tex.js';
import { particleMaterial, beamMaterial, reflectorMaterial } from './fx.js';
import { rng } from '../../core/util.js';

const PI = Math.PI;

export function roadwayDims(LAYOUT) {
  const R = LAYOUT.ROADWAY, C = LAYOUT.CORRIDOR;
  const wallFace = C.fireDoor.z - 0.25;              // 主車道南牆面（廊道北牆的另一面）
  return {
    R, x0: R.minX, x1: R.maxX, zN: R.minZ, zS: wallFace,
    walkS: { z0: wallFace - 0.95, h: 0.18 }, walkN: { z1: R.minZ + 1.0, h: 0.18 },
    laneZ: R.laneZ, wallTop: 3.4, crown: R.height,
    lanes: { z0: R.minZ + 1.05, z1: R.minZ + 1.05 + 7.4 },
    sodium: new THREE.Vector3(26.5, 4.55, R.minZ + 0.45),
  };
}

export function buildRoadway(ctx, root, mats, d) {
  const T = ctx.textures;
  const B = new Batch({ chunk: 100, origin: 0 });
  const { x0, x1, zN, zS } = d;
  const out = {};
  const ws = d.walkS, wn = d.walkN;
  const roadZ0 = wn.z1, roadZ1 = ws.z0;
  // 柏油
  {
    const g = new GeoBuilder();
    g.quad([x0, 0, roadZ1], [x1, 0, roadZ1], [x1, 0, roadZ0], [x0, 0, roadZ0], [0, 1, 0], [x0, -roadZ1], [x1, -roadZ1], [x1, -roadZ0], [x0, -roadZ0]);
    B.add(mats.asphalt, g.build(), { cast: false });
  }
  // 標線（RGBA 疊層：U 橫跨兩車道、V 沿路）
  {
    const g = new GeoBuilder(), y = 0.004, a = d.lanes.z0, b = d.lanes.z1;
    g.quad([x0, y, b], [x1, y, b], [x1, y, a], [x0, y, a], [0, 1, 0], [1, x0 / 6], [1, x1 / 6], [0, x1 / 6], [0, x0 / 6]);
    B.add(mats.roadLines, g.build(), { cast: false, receive: true });
  }
  // 步道＋路緣
  B.add(mats.walk, box(x0, x1, 0, ws.h, ws.z0, zS, { faces: 'py nz' }), { cast: false });
  B.add(mats.walk, box(x0, x1, 0, wn.h, zN, wn.z1, { faces: 'py pz' }), { cast: false });
  B.add(mats.curbPaint, box(x0, x1, 0.0, ws.h + 0.002, ws.z0 - 0.002, ws.z0 + 0.06, { faces: 'nz py' }), { cast: false });
  B.add(mats.curbPaint, box(x0, x1, 0.0, wn.h + 0.002, wn.z1 - 0.06, wn.z1 + 0.002, { faces: 'pz py' }), { cast: false });
  // 磁磚牆（V 0 = 步道面、1 = 牆頂）
  const tileH = d.wallTop - ws.h;
  {
    const g = new GeoBuilder(), y0 = ws.h, y1 = d.wallTop;
    // 南牆（面向 -Z）：u 隨 -x 增加
    g.quad([x1, y0, zS], [x0, y0, zS], [x0, y1, zS], [x1, y1, zS], [0, 0, -1], [-x1 / tileH, 0], [-x0 / tileH, 0], [-x0 / tileH, 1], [-x1 / tileH, 1]);
    // 北牆（面向 +Z）
    g.quad([x0, y0, zN], [x1, y0, zN], [x1, y1, zN], [x0, y1, zN], [0, 0, 1], [x0 / tileH, 0], [x1 / tileH, 0], [x1 / tileH, 1], [x0 / tileH, 1]);
    B.add(mats.tiles, g.build(), { cast: false });
  }
  // 拱頂（半橢圓，法線朝內）
  {
    const zc = (zN + zS) / 2, ah = (zS - zN) / 2, bh = d.crown - d.wallTop;
    const g = paramSurface((u, v, t) => {
      const th = PI * v;                                 // 0 = 南側牆頂 … π = 北側
      t.set(x0 + (x1 - x0) * u, d.wallTop + Math.sin(th) * bh, zc + Math.cos(th) * ah);
    }, 8, 22, { uvFn: (u, v) => [(x0 + (x1 - x0) * u) / 1.2, v * 12 / 1.2], flip: true });
    B.add(mats.arch, g, { cast: false });
  }
  // 兩端黑色封板（避免從玻璃斜看到盡頭的空洞）。不投影：車燈的光形由遮罩決定，封板不能把車燈擋掉。
  B.add(mats.black, box(x0 - 0.05, x0, 0, d.crown, zN, zS, { faces: 'px' }), { cast: false });
  B.add(mats.black, box(x1, x1 + 0.05, 0, d.crown, zN, zS, { faces: 'nx' }), { cast: false });
  // 牆頂隧道燈具（一整排都壞了，只有一盞遠處的鈉燈還亮著）
  for (let x = x0 + 1.5; x < x1; x += 4) {
    B.add(mats.lampHousing, boxC(x, d.wallTop + 0.75, zN + 0.18, 1.0, 0.16, 0.22), { cast: false });
    if (Math.abs(x - d.sodium.x) > 0.6) B.add(mats.lampDead, boxC(x, d.wallTop + 0.665, zN + 0.2, 0.86, 0.012, 0.15), { cast: false });
  }
  // 射流風機（成對吊掛）
  for (const fz of [-7.4, -2.6]) {
    const fx = 23.5, fy = 5.25, L = 3.6, r = 0.5;
    B.add(mats.fan, tube([fx - L / 2, fy, fz], [fx + L / 2, fy, fz], r, { segs: 24, caps: false, vLen: 1 }), { cast: false });
    B.add(mats.fanDark, tube([fx - L / 2 + 0.3, fy, fz], [fx + L / 2 - 0.3, fy, fz], r * 0.98, { segs: 24, caps: true, vLen: 1 }), { cast: false });
    for (const s of [-1, 1]) {
      const bell = new THREE.CylinderGeometry(r, r * 1.12, 0.25, 24, 1, true);
      bell.rotateZ(s * PI / 2); bell.translate(fx + s * (L / 2 + 0.12), fy, fz);
      B.add(mats.fan, bell, { cast: false });
      B.add(mats.fanDark, boxC(fx + s * 0.9, fy + r + 0.35, fz, 0.08, 0.7, 0.08), { cast: false });
    }
    for (const xx of [fx - 1.1, fx - 0.1, fx + 0.9]) {
      const rg = new THREE.TorusGeometry(r + 0.01, 0.018, 6, 28); xform(rg, { pos: [xx, fy, fz], rot: [0, PI / 2, 0] });
      B.add(mats.fanDark, rg, { cast: false });
    }
  }
  // 緊急電話箱（北牆）
  B.add(mats.lampHousing, boxC(17.5, 1.3, zN + 0.06, 0.6, 0.9, 0.12), { cast: false });
  B.add(mats.black, boxC(17.5, 1.3, zN + 0.121, 0.48, 0.74, 0.002), { cast: false });
  B.build(root);   // 車道幾何都不投影

  // 反光標記：路面貓眼（沿兩條邊線與中線）＋北牆反光片
  {
    const refl = reflectorMaterial(0xffd890);
    const g = new GeoBuilder();
    const addR = (x, y, z, w, h, n) => {
      if (n === 'up') g.quad([x - w, y, z + h], [x + w, y, z + h], [x + w, y, z - h], [x - w, y, z - h], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1]);
      else g.quad([x - w, y - h, z], [x + w, y - h, z], [x + w, y + h, z], [x - w, y + h, z], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
    };
    const lanes = d.lanes, lw = lanes.z1 - lanes.z0;
    for (let x = x0 + 2; x < x1; x += 6) {
      for (const f of [0.042, 0.5, 0.957]) addR(x, 0.012, lanes.z0 + lw * f, 0.06, 0.035, 'up');
      addR(x + 3, 0.95, zN + 0.004, 0.05, 0.05, 'side');
    }
    const geo = g.build();
    // 貓眼凸起用一點厚度：直接把頂點拉高即可（平面已足夠）
    const mesh = new THREE.Mesh(geo, refl); mesh.name = 'roadReflectors';
    root.add(mesh);
    out.reflectors = refl;
  }

  // 鈉燈：發光燈罩＋煙霧中的橘色光暈（光暈不受霧影響，代表空氣中的散射）
  {
    const s = d.sodium;
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.03, 0.15), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.5, 0.14).multiplyScalar(5) }));
    lamp.position.set(s.x, d.wallTop + 0.665, zN + 0.2); root.add(lamp);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TX.haloTexture([255, 160, 70], { falloff: 4.2 }), color: 0xffa050, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    halo.scale.set(5.0, 3.8, 1); halo.position.set(s.x, d.wallTop + 0.6, zN + 1.7); root.add(halo);
    // 鈉燈投在北牆與路面的光（加算光斑；只有靜態的一盞，不必用真實光源）
    const poolMat = new THREE.MeshBasicMaterial({ map: TX.haloTexture([255, 140, 50], { falloff: 3.2 }), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const wallPool = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.3), poolMat);
    wallPool.position.set(s.x, d.wallTop - 1.45, zN + 0.01); root.add(wallPool);
    const roadPool = new THREE.Mesh(new THREE.PlaneGeometry(7, 6), poolMat);
    roadPool.rotation.x = -PI / 2; roadPool.position.set(s.x, 0.01, zN + 3.4); root.add(roadPool);
    out.sodium = { lamp, halo, poolMat };
  }

  // 灰燼：集中在玻璃看得到的範圍，近處較密
  {
    const N = 500, r = rng(4242);
    const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
    const yMin = 0.0, yMax = 5.6, fdx = (ctx.LAYOUT.CORRIDOR.fireDoor.x);
    for (let i = 0; i < N; i++) {
      const depth = Math.pow(r(), 1.4) * 7.4 + 0.15;              // 距玻璃的深度（更遠的都被霧吃掉了）
      const z = zS - depth;
      const spread = 0.9 + depth * 0.95;
      pos[i * 3] = fdx + (r() - 0.5) * 2 * spread;
      pos[i * 3 + 1] = yMin + r() * (yMax - yMin);
      pos[i * 3 + 2] = z;
      seed[i * 4] = r(); seed[i * 4 + 1] = 0.12 + r() * 0.2; seed[i * 4 + 2] = 0.55 + r() * 0.9; seed[i * 4 + 3] = (r() - 0.5) * 1.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = particleMaterial({ map: T.get('ash'), size: 0.042, ambient: 0x6a6660, fall: 1, fogMax: 0.55 });
    mat.uniforms.uBoxMin.value.set(0, yMin, 0); mat.uniforms.uBoxSize.value.set(1, yMax - yMin, 1);
    mat.uniforms.uSodiumPos.value.copy(d.sodium); mat.uniforms.uSodium.value = 2.4;
    const pts = new THREE.Points(g, mat);
    pts.name = 'ash'; pts.frustumCulled = false; pts.renderOrder = 1;
    root.add(pts);
    out.ash = pts;
  }

  // 幻影車燈：近側那盞投射陰影（只在事件期間更新陰影貼圖），遠側那盞只照亮車道
  // 近側那盞帶一張「光斑遮罩」（SpotLight.map，每幀由 Corridor 依車子位置重繪）：
  // 柔邊的窗形光斑——左右邊緣很寬、很柔（光斑在牆上滑動時，牆上任一點由暗到亮都要 ≥ 0.5 秒），
  // 上下邊緣較利落。光斑形狀完全由遮罩決定，所以防火門門扇不參與這盞燈的陰影（見 Corridor 的陰影篩選）。
  {
    const N = 64;
    const data = new Uint8Array(N * N * 4);
    const cookie = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    cookie.magFilter = THREE.LinearFilter; cookie.minFilter = THREE.LinearFilter; cookie.generateMipmaps = false;
    cookie.wrapS = cookie.wrapT = THREE.ClampToEdgeWrapping;
    cookie.needsUpdate = true;
    cookie.name = 'headlightCookie';
    out.hlCookie = { tex: cookie, data, N };
    const mk = (shadow) => {
      const l = new THREE.SpotLight(0xffeedd, 0, shadow ? 30 : 6.2, 0.3, shadow ? 0 : 0.5, 2);
      l.position.set(0, -50, d.laneZ);
      l.castShadow = shadow;
      if (shadow) {
        // 光錐很窄（只罩住窗戶＋柔邊），512² 已遠超所需
        l.shadow.mapSize.set(512, 512);
        l.shadow.camera.near = 1.0; l.shadow.camera.far = 30;
        l.shadow.bias = -0.0006; l.shadow.normalBias = 0.02;
        l.shadow.autoUpdate = false; l.shadow.needsUpdate = true;
        l.map = cookie;     // 從建構起就固定掛著（避免事件中途改變 shader 定義而重新編譯）
      }
      root.add(l); root.add(l.target);
      return l;
    };
    out.hl = [mk(true), mk(false)];
    // hl[1]：不再當作第二盞車燈，而是常駐的「遠處鈉燈」——從北牆那盞還亮著的鈉燈往下照，
    // 讓防火門玻璃外的車道（柏油、標線、路緣）在煙霧裡隱約可見。距離截止 12.2 m：照不到廊道（z ≥ 1.2）。
    // （燈數不變：場景裡始終是這兩盞 SpotLight。）
    {
      const sl = out.hl[1], s = d.sodium;
      sl.color.setRGB(1.0, 0.5, 0.17);
      sl.position.set(s.x, d.wallTop + 0.55, zN + 0.6);
      sl.target.position.set(s.x - 5.9, 0, zS - 3.4);
      sl.angle = 0.7; sl.penumbra = 0.85; sl.distance = 12.2; sl.decay = 2;
      sl.intensity = 330;
      sl.name = 'roadSodium';
      out.sodiumLight = sl;
    }
    const glareTex = TX.glareTexture();
    out.hlSprites = out.hl.map(() => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTex, color: 0xfff1dc, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
      s.scale.set(1.5, 1.5, 1); s.position.set(0, -50, 0); s.renderOrder = 1; root.add(s);
      return s;
    });
  }
  return out;
}

/** 玻璃上的散射光＋穿窗光束（加在廊道裡）。 */
export function buildWindowFx(root, glass) {
  const scatterMat = new THREE.MeshBasicMaterial({ map: TX.glassScatterTexture(), color: 0xfff0da, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  const scatter = new THREE.Mesh(glass.geometry.clone(), scatterMat);
  scatter.position.copy(glass.position); scatter.position.z += 0.004; scatter.renderOrder = 3;
  root.add(scatter);
  const beamMat = beamMaterial(0xfff0dc);
  const beam = new THREE.Group(); beam.name = 'windowBeam';
  const bw = 0.95, bl = 1;
  for (let k = 0; k < 3; k++) {
    const g = new THREE.PlaneGeometry(bw, bl);
    g.translate(0, bl / 2, 0);                    // 沿 +Y 延伸（之後把 +Y 對準光線方向）
    const m = new THREE.Mesh(g, beamMat);
    m.rotation.y = (k / 3) * PI;
    m.frustumCulled = false; m.renderOrder = 4;
    beam.add(m);
  }
  beam.visible = false;
  root.add(beam);
  return { scatterMat, beam, beamMat };
}
