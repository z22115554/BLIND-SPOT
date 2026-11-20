// =============================================================================
// 牆／地／天花／隧道／道路貼圖。每個產生器回傳 { map, bump?, rough? }（皆為 canvas）。
// 貼圖皆可平鋪（corridorWall / tunnelTiles 只在水平方向平鋪，垂直方向對應實際高度）。
// =============================================================================
import {
  rng, clamp, TAU, smooth, field, offsetField, batcher, qz, wormPoints, grain, worley, fieldToCanvas, Pix, rgba,
  wrapDraw, drip, crackPath, hash3,
} from './core.js';

// -----------------------------------------------------------------------------
// 混凝土底層（顏色/高度 Float32），供 concrete / concreteDark / corridorWall 共用
// -----------------------------------------------------------------------------
function concreteLayer(W, H, { seed = 11, base = [136, 134, 127], dark = false, scale = 1 } = {}) {
  const N = W * H;
  const mott = field(W, H, { cells: Math.round(3 * scale), octaves: 5, seed }, 4);
  const cloud = field(W, H, { cells: Math.round(10 * scale), octaves: 3, seed: seed + 1 }, 2);
  const fine = field(W, H, { cells: Math.round(64 * scale), octaves: 2, seed: seed + 2 }, 2);
  const board = field(W, H, { cells: 2, cellsY: Math.round(36 * scale * (H / W)), octaves: 3, seed: seed + 3 }, 2);
  const damp = dark ? field(W, H, { cells: 2, octaves: 5, seed: seed + 4 }, 4) : null;
  const gr = grain(W, H, seed + 5);
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), Hh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let k = 0.85 + 0.24 * mott[i];
    k *= 0.94 + 0.12 * cloud[i];
    k *= 0.965 + 0.07 * fine[i];
    k *= 0.98 + 0.04 * board[i];
    let r = base[0] * k, g = base[1] * k, b = base[2] * k;
    if (dark) {
      const w = smooth(0.42, 0.78, damp[i]);
      r *= 1 - 0.3 * w; g *= 1 - 0.26 * w; b *= 1 - 0.25 * w;
    }
    // 微弱的暖/冷色偏
    const tint = (cloud[i] - 0.5) * 4;
    const n = (gr[i] - 0.5) * 13;
    R[i] = r + n + tint; G[i] = g + n; B[i] = b + n - tint;
    Hh[i] = 0.55 + 0.16 * (fine[i] - 0.5) + 0.08 * (cloud[i] - 0.5) + 0.06 * (gr[i] - 0.5);
  }
  return { R, G, B, Hh, mott };
}

/** 混凝土的向量細節：模板接縫、繫桿孔、氣孔 */
function concreteDetails(g, hg, W, H, rnd, { seamsY = [0, 0.5], seamX = true, ties = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]], pores = 260, rustTies = 0.6, region = null } = {}) {
  const inRegion = (y) => !region || (y >= region[0] && y <= region[1]);
  // 模板接縫（細微的漿料滲出凸邊＋暗線）
  for (const sy of seamsY) {
    const y = Math.round(sy * H);
    if (!inRegion(y)) continue;
    for (const yy of y === 0 ? [0, H] : [y]) {
      g.fillStyle = 'rgba(30,30,28,0.22)'; g.fillRect(0, yy - 1, W, 1.2);
      g.fillStyle = 'rgba(255,255,250,0.09)'; g.fillRect(0, yy + 0.5, W, 1);
      hg.fillStyle = 'rgba(70,70,70,0.9)'; hg.fillRect(0, yy - 1, W, 1.2);
      hg.fillStyle = 'rgba(200,200,200,0.6)'; hg.fillRect(0, yy + 0.4, W, 1);
      // 漿料滲漏的斑塊
      for (let i = 0; i < 26; i++) {
        const x = rnd() * W, len = 8 + rnd() * 40;
        g.fillStyle = `rgba(60,58,52,${0.05 + rnd() * 0.07})`;
        g.beginPath(); g.ellipse(x, yy + (rnd() - 0.3) * 3, len, 1.5 + rnd() * 2.5, 0, 0, TAU); g.fill();
      }
    }
  }
  if (seamX) {
    for (const xx of [0, W]) {
      g.fillStyle = 'rgba(30,30,28,0.12)'; g.fillRect(xx - 0.6, 0, 1.2, H);
      hg.fillStyle = 'rgba(90,90,90,0.6)'; hg.fillRect(xx - 0.6, 0, 1.2, H);
    }
  }
  // 繫桿孔（模板螺桿拆除後留下的圓孔，部分以砂漿填補，偶有鏽水）
  const tr = Math.max(4, W / 80);
  for (const [u, v] of ties) {
    const x = u * W + (rnd() - 0.5) * 3, y = v * H + (rnd() - 0.5) * 3;
    if (!inRegion(y)) continue;
    const rr = tr * (0.9 + rnd() * 0.25);
    const dimple = g.createRadialGradient(x, y, rr * 0.8, x, y, rr * 2.1);
    dimple.addColorStop(0, 'rgba(40,40,38,0.18)'); dimple.addColorStop(1, 'rgba(40,40,38,0)');
    g.fillStyle = dimple; g.beginPath(); g.arc(x, y, rr * 2.1, 0, TAU); g.fill();
    const plugged = rnd() < 0.5;
    g.fillStyle = plugged ? 'rgba(150,147,138,0.75)' : 'rgba(22,21,20,0.9)';
    g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(15,15,14,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke();
    if (plugged) { g.fillStyle = 'rgba(40,38,34,0.5)'; g.beginPath(); g.arc(x + rr * 0.15, y + rr * 0.1, rr * 0.4, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(255,255,250,0.14)'; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, rr + 0.8, 0.2 * Math.PI, 0.9 * Math.PI); g.stroke();
    if (rnd() < rustTies) drip(g, x, y + rr * 0.6, 20 + rnd() * 70, rr * 0.9, [110, 66, 34], 0.2, rnd, 1);
    const hgr = hg.createRadialGradient(x, y, rr * 0.5, x, y, rr * 1.8);
    hgr.addColorStop(0, plugged ? 'rgba(110,110,110,1)' : 'rgba(10,10,10,1)'); hgr.addColorStop(1, 'rgba(128,128,128,0)');
    hg.fillStyle = hgr; hg.beginPath(); hg.arc(x, y, rr * 1.8, 0, TAU); hg.fill();
  }
  // 氣孔（bug holes）— 批次繪製
  const bc = batcher(), bh = batcher();
  for (let i = 0; i < pores; i++) {
    const x = rnd() * W, y = rnd() * H;
    if (!inRegion(y)) continue;
    const r = 0.5 + Math.pow(rnd(), 3) * 2.6;
    const al = qz(0.4 + rnd() * 0.35, 8);
    wrapDraw(W, H, x, y, 4, (xx, yy) => {
      bc.dot(`rgba(38,36,33,${al})`, xx, yy, r);
      bc.stroke('rgba(255,255,250,0.12)', 0.8, (c) => { const a0 = 0.15 * Math.PI; c.moveTo(xx + Math.cos(a0) * (r + 0.4), yy + Math.sin(a0) * (r + 0.4)); c.arc(xx, yy, r + 0.4, a0, 0.85 * Math.PI); });
      bh.dot('rgba(30,30,30,0.9)', xx, yy, r);
    });
  }
  bc.flush(g); bh.flush(hg);
}

function layerToCanvases(L, W, H) {
  const pix = new Pix(W, H);
  for (let i = 0; i < W * H; i++) pix.set(i, L.R[i], L.G[i], L.B[i]);
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(L.Hh, W, H);
  return { canvas, g, bump, hg: bump.getContext('2d') };
}

// -----------------------------------------------------------------------------
export function concrete({ dark = false } = {}) {
  const W = 512, H = 512;
  const seed = dark ? 23 : 11;
  const L = concreteLayer(W, H, { seed, base: dark ? [88, 89, 86] : [138, 136, 129], dark });
  const { canvas, g, bump, hg } = layerToCanvases(L, W, H);
  const rnd = rng(seed + 100);
  concreteDetails(g, hg, W, H, rnd, { pores: dark ? 200 : 280, rustTies: dark ? 0.9 : 0.5 });
  if (dark) {
    // 潮濕：滲水流痕與白華
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W, y = rnd() * H * 0.6;
      wrapDraw(W, H, x, y, 20, (xx, yy) => drip(g, xx, yy, 60 + rnd() * 220, 3 + rnd() * 9, [30, 32, 28], 0.18, rnd, 1));
    }
    for (let i = 0; i < 6; i++) {
      const x = rnd() * W, y = rnd() * H;
      wrapDraw(W, H, x, y, 20, (xx, yy) => drip(g, xx, yy, 30 + rnd() * 90, 2 + rnd() * 4, [200, 200, 190], 0.1, rnd, 1));
    }
  }
  return { map: canvas, bump };
}

// -----------------------------------------------------------------------------
// 60cm 塑膠地磚（512 = 2×2 片）：灰綠色斑點、接縫、鞋印刮痕、椅輪磨損
// -----------------------------------------------------------------------------
export function floorTiles() {
  const W = 512, H = 512, T = 256, N = W * H;
  const streakH = field(W, H, { cells: 3, cellsY: 28, octaves: 4, seed: 31 }, 2);
  const streakV = field(W, H, { cells: 28, cellsY: 3, octaves: 4, seed: 32 }, 2);
  const mott = field(W, H, { cells: 3, octaves: 4, seed: 33 }, 4);
  const dirt = field(W, H, { cells: 4, octaves: 5, seed: 34 }, 4);
  const gr = grain(W, H, 35);
  const pix = new Pix(W, H);
  const Hh = new Float32Array(N), Rf = new Float32Array(N);
  const base = [124, 133, 122];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const tx = (x / T) | 0, ty = (y / T) | 0;
      const lx = x % T, ly = y % T;
      const tileTone = 0.95 + 0.1 * hash3(tx, ty, 7);
      const horiz = (tx + ty) % 2 === 0; // 地磚交錯 90° 鋪設
      const s = horiz ? streakH[i] : streakV[i];
      let k = tileTone * (0.9 + 0.2 * s) * (0.95 + 0.1 * mott[i]);
      // 接縫附近積灰
      const de = Math.min(lx, ly, T - 1 - lx, T - 1 - ly);
      const seamDirt = 1 - smooth(0, 7, de);
      k *= 1 - 0.18 * seamDirt - 0.12 * smooth(0.55, 0.9, dirt[i]);
      const n = (gr[i] - 0.5) * 10;
      let r = base[0] * k + n, gg = base[1] * k + n, b = base[2] * k + n;
      const groove = de < 1.2;
      if (groove) { r = 50; gg = 54; b = 52; }
      pix.set(i, r, gg, b);
      Hh[i] = groove ? 0.25 : 0.72 - 0.15 * (1 - smooth(1, 3, de)) + 0.03 * (gr[i] - 0.5);
      Rf[i] = groove ? 0.95 : 0.42 + 0.22 * dirt[i] + 0.1 * seamDirt + 0.04 * gr[i];
    }
  }
  const { canvas, g } = pix.toCanvas();
  const rnd = rng(36);
  // 斑點碎片（VCT 地磚的雜色顆粒，方向隨鋪設方向）
  const chipCols = [[72, 78, 76], [86, 96, 88], [176, 182, 172], [200, 202, 192], [104, 124, 108], [60, 66, 64]];
  const chips = batcher();
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const horiz = (tx + ty) % 2 === 0;
    for (let i = 0; i < 1900; i++) {
      const x = tx * T + 2 + rnd() * (T - 4), y = ty * T + 2 + rnd() * (T - 4);
      const c = chipCols[(rnd() * chipCols.length) | 0];
      const l = 0.6 + Math.pow(rnd(), 1.5) * 3.4, w = 0.45 + rnd() * 0.85;
      const rx = horiz ? l : w, ry = horiz ? w : l, rot = (rnd() - 0.5) * 0.5;
      chips.fill(rgba(c, qz(0.3 + rnd() * 0.5, 4)), (cg) => { cg.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx); cg.ellipse(x, y, rx, ry, rot, 0, TAU); });
    }
  }
  chips.flush(g);
  // 鞋跟黑色刮痕
  const rough = fieldToCanvas(Rf, W, H);
  const rgx = rough.getContext('2d');
  for (let i = 0; i < 34; i++) {
    const x = rnd() * W, y = rnd() * H, a = rnd() * TAU, L = 6 + rnd() * 26;
    wrapDraw(W, H, x, y, 40, (xx, yy) => {
      g.strokeStyle = `rgba(22,22,22,${0.18 + rnd() * 0.32})`; g.lineWidth = 0.8 + rnd() * 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + Math.cos(a) * L * 0.5 + (rnd() - 0.5) * 6, yy + Math.sin(a) * L * 0.5 + (rnd() - 0.5) * 6, xx + Math.cos(a) * L, yy + Math.sin(a) * L); g.stroke();
      rgx.strokeStyle = 'rgba(200,200,200,0.6)'; rgx.lineWidth = 2;
      rgx.beginPath(); rgx.moveTo(xx, yy); rgx.lineTo(xx + Math.cos(a) * L, yy + Math.sin(a) * L); rgx.stroke();
    });
  }
  // 椅輪磨損：同心弧（較亮、較光滑）＋細黑輪痕
  for (let k = 0; k < 2; k++) {
    const cx = rnd() * W, cy = rnd() * H, R0 = 90 + rnd() * 80;
    const a0 = rnd() * TAU, span = 0.8 + rnd() * 1.2;
    for (let j = 0; j < 40; j++) {
      const r = R0 + (rnd() - 0.5) * 50;
      const s0 = a0 + (rnd() - 0.5) * 0.4, s1 = s0 + span * (0.5 + rnd() * 0.5);
      wrapDraw(W, H, cx, cy, R0 + 40, (xx, yy) => {
        g.strokeStyle = j % 3 === 0 ? `rgba(30,32,30,${0.05 + rnd() * 0.08})` : `rgba(215,222,212,${0.03 + rnd() * 0.04})`;
        g.lineWidth = 0.6 + rnd() * 2.5;
        g.beginPath(); g.arc(xx, yy, r, s0, s1); g.stroke();
        rgx.strokeStyle = 'rgba(60,60,60,0.06)'; rgx.lineWidth = 3;
        rgx.beginPath(); rgx.arc(xx, yy, r, s0, s1); rgx.stroke();
      });
    }
  }
  const bump = fieldToCanvas(Hh, W, H);
  return { map: canvas, bump, rough };
}

// -----------------------------------------------------------------------------
// 礦纖吸音天花板（512 = 2×2 片 60cm）＋ T-bar 輕鋼架
// -----------------------------------------------------------------------------
export function ceilingTiles() {
  const W = 512, H = 512, T = 256, N = W * H;
  const mott = field(W, H, { cells: 4, octaves: 4, seed: 41 }, 4);
  const fine = field(W, H, { cells: 96, octaves: 2, seed: 42 }, 2);
  const gr = grain(W, H, 43);
  const bar = 5; // T-bar 半寬（像素）
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const lx = x % T, ly = y % T;
      const dx = Math.min(lx, T - lx), dy = Math.min(ly, T - ly);
      const de = Math.min(dx, dy);
      const tx = (x + bar) / T | 0, ty = (y + bar) / T | 0;
      if (de < bar) {
        // T-bar：烤漆白鋼，中間有細溝，略髒
        const c = de < 0.8 ? 150 : 214 - (de > bar - 1.2 ? 26 : 0);
        const n = (gr[i] - 0.5) * 6;
        pix.set(i, c + n, c - 1 + n, c - 6 + n);
        Hh[i] = de < 0.8 ? 0.8 : 0.95;
        continue;
      }
      const tone = 0.96 + 0.06 * hash3(tx % 2, ty % 2, 3);
      const yellow = 0.6 * smooth(0.6, 0.95, mott[i]) * (hash3(tx % 2, ty % 2, 9) > 0.6 ? 1 : 0.35);
      let k = tone * (0.93 + 0.1 * mott[i]) * (0.94 + 0.12 * fine[i]);
      // 板材凹入 → 靠近 T-bar 有陰影
      k *= 1 - 0.22 * (1 - smooth(bar, bar + 7, de));
      const n = (gr[i] - 0.5) * 16;
      pix.set(i, 208 * k + n, 205 * k + n - yellow * 6, 196 * k + n - yellow * 22);
      Hh[i] = 0.55 + 0.08 * (fine[i] - 0.5) + 0.02 * (gr[i] - 0.5) - 0.15 * (1 - smooth(bar, bar + 3, de));
    }
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H); const hg = bump.getContext('2d');
  const rnd = rng(44);
  // 蟲蛀狀裂紋（fissures）＋針孔
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const ox = tx * T + bar + 3, oy = ty * T + bar + 3, S = T - 2 * bar - 6;
    g.save(); g.beginPath(); g.rect(ox, oy, S, S); g.clip();
    hg.save(); hg.beginPath(); hg.rect(ox, oy, S, S); hg.clip();
    const bc = batcher(), bh = batcher();
    for (let i = 0; i < 300; i++) {
      const x = ox + rnd() * S, y = oy + rnd() * S;
      const steps = 2 + (rnd() * 5) | 0;
      const v = 120 + qz(rnd(), 3) * 30;
      const col = `rgba(${v | 0},${(v - 4) | 0},${(v - 14) | 0},${qz(0.16 + rnd() * 0.22, 6)})`;
      const pts = wormPoints(rnd, x, y, steps, 1.2 + rnd() * 1.0, 1.3);
      bc.poly(col, qz(0.6 + rnd() * 0.9, 2), pts);
      bh.poly('rgba(105,105,105,0.35)', 1, pts);
    }
    for (let i = 0; i < 420; i++) {
      const x = ox + rnd() * S, y = oy + rnd() * S, r = 0.4 + rnd() * 0.8;
      bc.dot(`rgba(110,106,96,${qz(0.2 + rnd() * 0.3, 6)})`, x, y, r);
      bh.dot('rgba(100,100,100,0.45)', x, y, r);
    }
    bc.flush(g); bh.flush(hg);
    g.restore(); hg.restore();
  }
  // 一片板材上淡淡的黃褐色水痕環
  g.strokeStyle = 'rgba(150,120,70,0.12)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(T + 140, 120, 52, 40, 0.3, 0, TAU); g.stroke();
  g.fillStyle = 'rgba(170,140,90,0.06)'; g.beginPath(); g.ellipse(T + 140, 120, 50, 38, 0.3, 0, TAU); g.fill();
  return { map: canvas, bump };
}

// -----------------------------------------------------------------------------
// 維修廊道牆面：V 軸 0 = 地面、1 = 2.5 m。下半部 1.15 m 灰綠油漆＋深色腰帶，上半部清水混凝土。
// -----------------------------------------------------------------------------
export function corridorWall() {
  const W = 512, H = 1024, N = W * H;
  const pxm = H / 2.5;
  const L = concreteLayer(W, H, { seed: 51, base: [126, 125, 119] });
  const peel = field(W, H, { cells: 7, octaves: 5, seed: 52 }, 2);
  const roller = field(W, H, { cells: 40, cellsY: 3, octaves: 3, seed: 53 }, 4);
  const dust = offsetField(L.mott, W, H, W >> 1, H >> 2);
  const tide = offsetField(peel, W, H, W >> 2, H >> 1);
  const gr = grain(W, H, 56);
  const pix = new Pix(W, H);
  const paint = [94, 111, 101], stripe = [46, 56, 53], primer = [150, 148, 134];
  const paintTop = 1.15, stripeBot = 1.07;
  for (let y = 0; y < H; y++) {
    const hm = (H - 0.5 - y) / pxm; // 距地高度（m）
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let r = L.R[i], g = L.G[i], b = L.B[i];
      let h = L.Hh[i];
      const wob = (tide[i] - 0.5) * 0.004;
      if (hm < paintTop + wob) {
        // 油漆剝落遮罩：靠近地面（返潮）與腰帶上緣較嚴重
        const th = 0.86 - 0.2 * smooth(0.55, 0.0, hm) - 0.06 * smooth(1.0, 1.15, hm);
        const p = peel[i];
        const peeled = smooth(th, th + 0.012, p);
        const lift = smooth(th - 0.035, th, p) * (1 - peeled);
        const isStripe = hm > stripeBot + wob;
        const pc = isStripe ? stripe : paint;
        let k = (0.9 + 0.12 * roller[i]) * (0.94 + 0.1 * dust[i]);
        let pr = pc[0] * k, pg = pc[1] * k, pb = pc[2] * k;
        // 灰塵讓油漆變淡、去飽和
        const d = 0.18 * smooth(0.3, 1, dust[i]);
        pr += (150 - pr) * d; pg += (150 - pg) * d; pb += (146 - pb) * d;
        // 剝落區：外圈露出舊底漆，內側為混凝土
        const under = smooth(th + 0.012, th + 0.05, p);
        const ur = primer[0] + (r - primer[0]) * under, ug = primer[1] + (g - primer[1]) * under, ub = primer[2] + (b - primer[2]) * under;
        r = pr + (ur - pr) * peeled; g = pg + (ug - pg) * peeled; b = pb + (ub - pb) * peeled;
        // 翹起的漆邊：亮邊
        r += 26 * lift; g += 26 * lift; b += 23 * lift;
        h = 0.62 + 0.03 * (roller[i] - 0.5) + 0.1 * lift;
        h = h + (L.Hh[i] - 0.08 - h) * peeled;
      }
      // 返潮帶：0.42 m 以下顏色變深，邊界有白色鹽析線＋褐色水線
      const dampLine = 0.4 + (tide[i] - 0.5) * 0.12;
      if (hm < dampLine) {
        const wet = 0.2 + 0.1 * smooth(dampLine, 0, hm);
        r *= 1 - wet; g *= 1 - wet * 0.95; b *= 1 - wet * 0.9;
      }
      const dl = hm - dampLine;
      if (dl > -0.05 && dl < 0.03) {
        const s1 = dl / 0.006, s2 = (dl + 0.012) / 0.008;
        const salt = Math.exp(-s1 * s1), brown = Math.exp(-s2 * s2);
        r += (205 - r) * 0.3 * salt; g += (202 - g) * 0.3 * salt; b += (190 - b) * 0.3 * salt;
        r += (70 - r) * 0.22 * brown; g += (56 - g) * 0.22 * brown; b += (40 - b) * 0.22 * brown;
      }
      // 牆腳污垢
      const grime = smooth(0.16, 0.0, hm + (dust[i] - 0.5) * 0.06) * (0.55 + 0.25 * gr[i]);
      r *= 1 - grime * 0.62; g *= 1 - grime * 0.64; b *= 1 - grime * 0.66;
      const n = (gr[i] - 0.5) * 6;
      pix.set(i, r + n, g + n, b + n);
      L.Hh[i] = h;
    }
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(L.Hh, W, H); const hg = bump.getContext('2d');
  const rnd = rng(57);
  const yAt = (m) => H - m * pxm;
  // 上半部混凝土的繫桿孔與接縫
  concreteDetails(g, hg, W, H, rnd, {
    seamsY: [(H - 1.8 * pxm) / H], seamX: false,
    ties: [[0.25, (H - 2.15 * pxm) / H], [0.75, (H - 2.15 * pxm) / H], [0.25, (H - 1.55 * pxm) / H], [0.75, (H - 1.55 * pxm) / H]],
    pores: 220, rustTies: 0.85, region: [0, yAt(paintTop) - 4],
  });
  // 腰帶上緣的細陰影線
  g.fillStyle = 'rgba(20,24,22,0.35)'; g.fillRect(0, yAt(paintTop) - 1, W, 1.5);
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, yAt(stripeBot), W, 1);
  // 滲水流痕：集中在幾處漏水點（天花接縫），從上往下流、長短粗細不一
  const sources = [0.12, 0.47, 0.8].map((u) => u * W + (rnd() - 0.5) * 40);
  for (const sx of sources) {
    const n = 3 + (rnd() * 5 | 0);
    // 漏水點上方的大片潮濕暈染
    const wet = g.createRadialGradient(sx, 0, 4, sx, 0, 70 + rnd() * 50);
    wet.addColorStop(0, 'rgba(48,46,38,0.32)'); wet.addColorStop(1, 'rgba(48,46,38,0)');
    g.fillStyle = wet; g.fillRect(sx - 130, 0, 260, 130);
    for (let k = 0; k < n; k++) {
      const x = sx + (rnd() - 0.5) * 70, y0 = rnd() * 50;
      const len = 120 + Math.pow(rnd(), 0.7) * 700;
      wrapDraw(W, H, x, y0, 24, (xx, yy) => {
        drip(g, xx, yy, len, 3 + rnd() * 12, [58, 52, 40], 0.1 + rnd() * 0.16, rnd, 1);
        if (rnd() < 0.3) drip(g, xx + (rnd() - 0.5) * 6, yy + rnd() * 40, len * 0.4, 2 + rnd() * 3, [206, 204, 192], 0.1, rnd, 1);
      });
    }
  }
  for (let i = 0; i < 5; i++) { // 零星細流痕
    const x = rnd() * W, y0 = rnd() * 300;
    wrapDraw(W, H, x, y0, 10, (xx, yy) => drip(g, xx, yy, 40 + rnd() * 160, 1.5 + rnd() * 3, [58, 52, 40], 0.12, rnd, 1));
  }
  // 腰帶下緣的白華結晶
  for (let i = 0; i < 9; i++) {
    const x = rnd() * W, y = yAt(stripeBot) + rnd() * 6;
    wrapDraw(W, H, x, y, 24, (xx, yy) => drip(g, xx, yy, 20 + rnd() * 70, 3 + rnd() * 8, [214, 212, 200], 0.16, rnd, 1));
  }
  // 推車／扶手刮痕（油漆刮掉露出灰底）與黑色橡膠擦痕
  g.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const x = rnd() * W, y = yAt(0.22 + rnd() * 0.75), L2 = 30 + rnd() * 150;
    const light = rnd() < 0.45;
    wrapDraw(W, H, x, y, L2 + 4, (xx, yy) => {
      g.strokeStyle = light ? `rgba(170,168,158,${0.12 + rnd() * 0.18})` : `rgba(18,18,18,${0.12 + rnd() * 0.2})`;
      g.lineWidth = 0.8 + rnd() * (light ? 1.8 : 3.5);
      g.beginPath(); g.moveTo(xx, yy); g.lineTo(xx + L2, yy + (rnd() - 0.5) * 6); g.stroke();
      if (light) { hg.strokeStyle = 'rgba(60,60,60,0.5)'; hg.lineWidth = 1.2; hg.beginPath(); hg.moveTo(xx, yy); hg.lineTo(xx + L2, yy); hg.stroke(); }
    });
  }
  // 牆腳的泥水濺點
  const sp = batcher();
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = H - Math.pow(rnd(), 2) * 0.3 * pxm;
    sp.dot(`rgba(30,26,20,${qz(0.1 + rnd() * 0.25, 6)})`, x, y, 0.6 + rnd() * 2.2);
  }
  sp.flush(g);
  return { map: canvas, bump, layout: { heightMeters: 2.5, tileWidthMeters: 1.25, paintTopMeters: paintTop, stripeMeters: [stripeBot, paintTop] } };
}

// -----------------------------------------------------------------------------
// 維修廊道地面：深色潮濕混凝土＋積水（roughnessMap：積水處光滑）
// -----------------------------------------------------------------------------
export function corridorFloor() {
  const W = 512, H = 512, N = W * H;
  const wet = field(W, H, { cells: 4, octaves: 6, seed: 61 }, 2);
  const mott = field(W, H, { cells: 5, octaves: 4, seed: 62 }, 4);
  const fine = field(W, H, { cells: 80, octaves: 2, seed: 63 }, 2);
  const wl = worley(256, 256, { cells: 70, seed: 64 });
  const agg = (x, y) => { const j = ((y >> 1) * 256 + (x >> 1)); return wl.f1[j] < 0.22 && hash3(wl.id[j], 0, 5) < 0.5 ? hash3(wl.id[j], 1, 5) : -1; };
  const gr = grain(W, H, 65);
  const pix = new Pix(W, H); const Hh = new Float32Array(N), Rf = new Float32Array(N);
  const th = 0.72;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const w = wet[i];
      const puddle = smooth(th, th + 0.018, w);
      const damp = smooth(th - 0.16, th, w);
      let k = (0.82 + 0.3 * mott[i]) * (0.94 + 0.12 * fine[i]);
      let r = 70 * k, g = 70 * k, b = 67 * k;
      const a = agg(x, y);
      if (a >= 0) { const s = 0.55 + a * 0.5; r += 40 * s; g += 39 * s; b += 36 * s; }
      const n = (gr[i] - 0.5) * 12;
      r += n; g += n; b += n;
      // 潮濕 → 變暗、略偏冷
      const dk = 0.38 * damp;
      r *= 1 - dk; g *= 1 - dk * 0.96; b *= 1 - dk * 0.9;
      // 積水邊緣的淤泥線
      const silt = Math.exp(-Math.pow((w - th) / 0.01, 2));
      r += (64 - r) * 0.35 * silt; g += (54 - g) * 0.35 * silt; b += (40 - b) * 0.35 * silt;
      // 積水：深、平、帶一點藍灰
      r += (34 - r) * 0.6 * puddle; g += (36 - g) * 0.6 * puddle; b += (38 - b) * 0.6 * puddle;
      pix.set(i, r, g, b);
      const hd = 0.5 + 0.2 * (fine[i] - 0.5) + (a >= 0 ? 0.12 : 0) + 0.05 * (gr[i] - 0.5);
      Hh[i] = hd + (0.47 - hd) * puddle;
      Rf[i] = (0.86 + 0.1 * gr[i] - 0.06 * mott[i]) * (1 - 0.42 * damp) * (1 - puddle) + 0.05 * puddle;
    }
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H); const hg = bump.getContext('2d');
  const rough = fieldToCanvas(Rf, W, H);
  const rnd = rng(66);
  // 細裂縫
  for (let i = 0; i < 5; i++) {
    const x = rnd() * W, y = rnd() * H;
    wrapDraw(W, H, x, y, 120, (xx, yy) => {
      const s = rnd();
      crackPath(g, rng(900 + i), xx, yy, 40 + (s * 40 | 0), 3, { wander: 0.7, color: 'rgba(14,14,14,0.55)', width: 1.4, branch: 0.06 });
      crackPath(hg, rng(900 + i), xx, yy, 40 + (s * 40 | 0), 3, { wander: 0.7, color: 'rgba(0,0,0,0.8)', width: 1.4, branch: 0.06 });
    });
  }
  // 伸縮縫（切割縫）沿貼圖上緣
  g.fillStyle = 'rgba(10,10,10,0.75)'; g.fillRect(0, 0, W, 2); g.fillRect(0, H - 1, W, 1);
  hg.fillStyle = 'rgb(20,20,20)'; hg.fillRect(0, 0, W, 2); hg.fillRect(0, H - 1, W, 1);
  // 碎屑、小石
  for (let i = 0; i < 160; i++) {
    const x = rnd() * W, y = rnd() * H, r = 0.6 + rnd() * 1.6;
    g.fillStyle = `rgba(${100 + rnd() * 50},${96 + rnd() * 46},${88 + rnd() * 40},${0.5 + rnd() * 0.4})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return { map: canvas, bump, rough };
}

// -----------------------------------------------------------------------------
// 隧道壁磁磚：V 0 = 路面、1 = 牆頂。下緣車輛濺起的污垢、上緣煤煙。
// -----------------------------------------------------------------------------
export function tunnelTiles() {
  const W = 256, H = 256, n = 16, T = W / n, N = W * H;
  const spray = field(W, H, { cells: 40, cellsY: 3, octaves: 4, seed: 71 }, 1);
  const wisp = field(W, H, { cells: 6, cellsY: 4, octaves: 5, seed: 72 }, 2);
  const mott = field(W, H, { cells: 8, octaves: 3, seed: 73 }, 2);
  const gr = grain(W, H, 74);
  const pix = new Pix(W, H); const Hh = new Float32Array(N), Rf = new Float32Array(N);
  const missing = new Set([11 + 12 * n, 3 + 14 * n]);
  for (let y = 0; y < H; y++) {
    const hm = 1 - y / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const tx = (x / T) | 0, ty = (y / T) | 0, lx = x - tx * T, ly = y - ty * T;
      const de = Math.min(lx, ly, T - 1 - lx, T - 1 - ly);
      const grout = de < 1;
      const miss = missing.has(tx + ty * n);
      let r, g, b, h, ro;
      if (miss) {
        const k = 0.8 + 0.3 * gr[i];
        r = 74 * k; g = 72 * k; b = 68 * k; h = 0.15; ro = 0.95;
      } else if (grout) {
        r = 128; g = 126; b = 118; h = 0.35; ro = 0.92;
      } else {
        const tone = 0.93 + 0.08 * hash3(tx, ty, 11);
        const pillow = 1 - 0.08 * (1 - smooth(1, 3, de));
        const k = tone * pillow * (0.97 + 0.05 * mott[i]);
        r = 216 * k; g = 214 * k; b = 203 * k; h = 0.7 - 0.12 * (1 - smooth(1, 2.5, de)); ro = 0.2 + 0.06 * gr[i];
      }
      // 車輛濺起的污垢（下緣 ~35%，帶垂直條紋）
      const gm = smooth(0.36, 0.0, hm + (spray[i] - 0.5) * 0.22) * (0.7 + 0.3 * spray[i]);
      r += (56 - r) * gm * 0.92; g += (51 - g) * gm * 0.92; b += (44 - b) * gm * 0.92;
      // 上緣煤煙
      const so = smooth(0.7, 1.0, hm + (wisp[i] - 0.5) * 0.25) * (0.75 + 0.25 * wisp[i]);
      r += (30 - r) * so * 0.9; g += (29 - g) * so * 0.9; b += (28 - b) * so * 0.9;
      const nn = (gr[i] - 0.5) * 7;
      pix.set(i, r + nn, g + nn, b + nn);
      Hh[i] = h; Rf[i] = clamp(ro + gm * 0.6 + so * 0.6);
    }
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H);
  const rough = fieldToCanvas(Rf, W, H);
  const rnd = rng(75);
  // 破裂的磁磚
  for (let i = 0; i < 6; i++) {
    const tx = (rnd() * n) | 0, ty = 4 + ((rnd() * (n - 6)) | 0);
    g.save(); g.beginPath(); g.rect(tx * T + 1, ty * T + 1, T - 2, T - 2); g.clip();
    crackPath(g, rnd, tx * T + rnd() * T, ty * T, 10, 1.8, { angle: Math.PI / 2 + (rnd() - 0.5), wander: 0.6, color: 'rgba(40,38,34,0.7)', width: 0.8, branch: 0.15 });
    g.restore();
  }
  // 下緣向上噴濺的點
  const sp = batcher();
  for (let i = 0; i < 260; i++) {
    const x = rnd() * W, y = H - Math.pow(rnd(), 2.2) * H * 0.45;
    sp.dot(`rgba(40,36,30,${qz(0.06 + rnd() * 0.2, 6)})`, x, y, 0.4 + rnd() * 0.9);
  }
  sp.flush(g);
  return { map: canvas, bump, rough };
}

// -----------------------------------------------------------------------------
// 柏油路面：深色瀝青＋骨材石粒、填縫、油漬
// -----------------------------------------------------------------------------
export function asphalt() {
  const W = 256, H = 256, N = W * H;
  const wl = worley(W, H, { cells: 44, seed: 81, jitter: 0.95 });
  const mott = field(W, H, { cells: 4, octaves: 5, seed: 82 }, 2);
  const gr = grain(W, H, 83);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const id = wl.id[i];
    const pres = hash3(id, 3, 1), rad = 0.18 + 0.28 * hash3(id, 4, 1), tone = hash3(id, 5, 1);
    const k = 0.85 + 0.3 * mott[i];
    let r = 40 * k, g = 40 * k, b = 42 * k, h = 0.35 + 0.1 * gr[i];
    if (pres < 0.62 && wl.f1[i] < rad) {
      const e = 1 - wl.f1[i] / rad;
      const c = 70 + tone * 80;
      const shade = 0.75 + 0.35 * e;
      r = c * shade; g = (c - 2) * shade; b = (c - 4 + tone * 6) * shade;
      h = 0.5 + 0.4 * e;
    }
    const nn = (gr[i] - 0.5) * 14;
    pix.set(i, r + nn, g + nn, b + nn); Hh[i] = h;
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H); const hg = bump.getContext('2d');
  const rnd = rng(84);
  // 填縫的瀝青黑線
  for (let i = 0; i < 4; i++) {
    const x = rnd() * W, y = rnd() * H;
    wrapDraw(W, H, x, y, 80, (xx, yy) => {
      crackPath(g, rng(300 + i), xx, yy, 30, 2.5, { wander: 0.5, color: 'rgba(12,12,13,0.85)', width: 2, taper: false });
      crackPath(hg, rng(300 + i), xx, yy, 30, 2.5, { wander: 0.5, color: 'rgba(60,60,60,1)', width: 2, taper: false });
    });
  }
  // 油漬
  for (let i = 0; i < 5; i++) {
    const x = rnd() * W, y = rnd() * H, R = 10 + rnd() * 25;
    wrapDraw(W, H, x, y, R, (xx, yy) => {
      const rg = g.createRadialGradient(xx, yy, 0, xx, yy, R);
      rg.addColorStop(0, 'rgba(10,10,12,0.4)'); rg.addColorStop(1, 'rgba(10,10,12,0)');
      g.fillStyle = rg; g.beginPath(); g.ellipse(xx, yy, R, R * 0.7, rnd() * TAU, 0, TAU); g.fill();
    });
  }
  return { map: canvas, bump };
}

// -----------------------------------------------------------------------------
// 道路標線（RGBA，透明底）：U 橫跨兩車道路面（左右邊線＋中央白實線），V 沿道路方向平鋪。
// -----------------------------------------------------------------------------
export function roadLines() {
  const W = 256, H = 256;
  const wear = field(W, H, { cells: 8, cellsY: 8, octaves: 5, seed: 91 }, 2);
  const gr = grain(W, H, 92);
  const lines = [[0.03, 0.055], [0.49, 0.51], [0.945, 0.97]];
  const pix = new Pix(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x; const u = (x + 0.5) / W;
      let a = 0;
      for (let k = 0; k < lines.length; k++) {
        const e = Math.min(u - lines[k][0], lines[k][1] - u) * W; // 距離線邊緣的像素
        if (e > -1) a = Math.max(a, smooth(-0.6, 0.8, e));
      }
      if (a <= 0) { pix.set(i, 230, 230, 222, 0); continue; }
      // 磨耗：輪跡、骨材露出
      const w = smooth(0.25, 0.7, wear[i]);
      const holes = gr[i] < 0.18 + 0.3 * (1 - w) ? 0.35 : 1;
      a *= (0.45 + 0.5 * w) * holes;
      pix.set(i, 232, 231, 222, a * 235);
    }
  }
  return { map: pix.toCanvas().canvas, layout: { linesU: lines.map((l) => l.slice()) } };
}
