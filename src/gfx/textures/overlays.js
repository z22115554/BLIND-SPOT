// =============================================================================
// 腐化疊層（RGBA，透明底，四邊羽化到 0，供 decal 使用）、全焦黑牆面、粒子精靈。
// =============================================================================
import { rng, clamp, TAU, smooth, fbmField, field, grain, worley, fieldToCanvas, Pix, hash3, sampleField, hyp } from './core.js';

const edgeWin = (x, y, W, H, m) => smooth(0, m, Math.min(x, y, W - 1 - x, H - 1 - y));

// -----------------------------------------------------------------------------
// 水漬：外緣銳利、往內漸淡的褐色潮線（主環＋兩圈內環）、內部淡黃褐、下緣往下流的水痕
// -----------------------------------------------------------------------------
function dripPoints(rnd, x, y, len) {
  const pts = []; let cx = x;
  const steps = Math.max(6, Math.round(len / 5));
  let drift = (rnd() - 0.5) * 0.3;
  for (let s = 0; s <= steps; s++) {
    pts.push([cx, y + (len * s) / steps]);
    drift += (rnd() - 0.5) * 0.5; drift *= 0.82;
    cx += drift;
  }
  return pts;
}
function strokeDrip(g, pts, w, col, a0, taper = 0.6) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const t = i / pts.length;
    g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${a0 * (1 - t * 0.85)})`;
    g.lineWidth = Math.max(0.6, w * (1 - t * taper));
    g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
  }
  g.restore();
}

export function waterStain() {
  const W = 512, H = 512;
  const dist = field(W, H, { cells: 3, octaves: 4, seed: 221 }, 4);
  const fine = field(W, H, { cells: 14, octaves: 3, seed: 222 }, 2);
  const gr = grain(W, H, 223);
  const cx = 256, cy = 168, rx = 182, ry = 122;
  const rings = [[1.0, 1.0], [0.8, 0.38], [0.62, 0.22]];
  const pix = new Pix(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const dx = (x - cx) / rx; let dy = (y - cy) / ry; if (dy > 0) dy *= 0.82;
    const d = Math.sqrt(dx * dx + dy * dy) + (dist[i] - 0.5) * 0.5 + (fine[i] - 0.5) * 0.06;
    if (d > 1.12) { pix.set(i, 120, 92, 56, 0); continue; }
    let ring = 0;
    for (let k = 0; k < 3; k++) {
      const t = d - rings[k][0], w = rings[k][1];
      if (t > 0) { if (t < 0.04) { const q = t / 0.009; ring += w * Math.exp(-q * q); } }
      else if (t > -0.25) ring += w * Math.exp(t / 0.05) * (0.85 + 0.15 * fine[i]);
    }
    const inside = smooth(1.0, 0.97, d);
    const fill = inside * (0.07 + 0.12 * smooth(-0.6, 0.9, dy) + 0.06 * fine[i]);
    let a = clamp(fill + ring * 0.45 * (0.78 + 0.22 * gr[i]));
    a *= edgeWin(x, y, W, H, 36);
    const t = ring / (fill + ring + 1e-4);
    pix.set(i, 104 + (66 - 104) * t, 80 + (44 - 80) * t, 50 + (22 - 50) * t, a * 255);
  }
  const { canvas, g } = pix.toCanvas();
  const rnd = rng(224);
  for (let k = 0; k < 11; k++) {
    const ux = (rnd() - 0.5) * 1.7;
    const x = cx + ux * rx * 0.8;
    const y0 = cy + ry * 0.85 * Math.sqrt(Math.max(0, 1 - ux * ux * 0.7)) - 20 - rnd() * 40;
    const len = Math.min(H - 40 - y0, 30 + Math.pow(rnd(), 1.4) * 300);
    const w = 4 + rnd() * 16;
    const pts = dripPoints(rnd, x, y0, len);
    strokeDrip(g, pts, w, [100, 76, 46], 0.08 + rnd() * 0.12);
    const off = (dx) => pts.map(([px, py], j) => [px + dx * (1 - (j / pts.length) * 0.6), py]);
    if (rnd() < 0.6) {
      strokeDrip(g, off(-w * 0.45), 0.9, [96, 66, 34], 0.2, 0.2);
      strokeDrip(g, off(w * 0.45), 0.9, [96, 66, 34], 0.2, 0.2);
    }
    const [ex, ey] = pts[pts.length - 1];
    g.fillStyle = 'rgba(110,80,44,0.12)'; g.beginPath(); g.ellipse(ex, ey - 2, w * 0.35, w * 0.45, 0, 0, TAU); g.fill();
  }
  return { map: canvas };
}

// -----------------------------------------------------------------------------
// 煤煙：由下緣（門框/通風口上緣）往上竄、呈扇形向外擴散的黑色煙燻，越往上越淡
// -----------------------------------------------------------------------------
export function soot() {
  const W = 256, H = 256;
  const turb = field(W, H, { cells: 3, octaves: 5, seed: 231 }, 2);
  const streak = field(W, H, { cells: 7, cellsY: 2, octaves: 4, seed: 232 }, 2);
  const wisp = field(W, H, { cells: 5, octaves: 5, seed: 233 }, 2);
  const gr = grain(W, H, 234);
  const pix = new Pix(W, H);
  for (let y = 0; y < H; y++) {
    const hn = (H - 0.5 - y) / H;
    // 扇形：下緣（源頭）較窄、往上展開；濃度往上遞減
    const width = 0.3 + 0.2 * Math.pow(hn, 0.7);
    const vert = Math.pow(1 - hn, 1.35) * 0.9 + 0.1 * (1 - hn);
    const stK = 0.75 * smooth(0.08, 0.55, hn); // 條紋只在上方出現；下緣是均勻的積碳帶
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W - 0.5 + (turb[i] - 0.5) * 0.24 * (0.2 + hn);
      // 依扇形寬度正規化後取樣條紋 → 煙痕條紋跟著往外張開
      const st = sampleField(streak, W, H, (0.5 + u / (width * 2.4)) * W, y);
      const fan = smooth(width, width * 0.2, Math.abs(u) + (st - 0.5) * 0.1 * stK);
      let dens = fan * vert * (1 - stK + stK * (0.3 + 1.1 * st)) * (0.65 + 0.5 * wisp[i]);
      dens += 0.18 * smooth(0.06, 0.0, hn) * smooth(0.38, 0.2, Math.abs(x / W - 0.5)); // 源頭積碳
      let a = clamp(dens * 1.2);
      a *= smooth(0, 0.025, hn) * smooth(0, 0.06, Math.min(x / W, 1 - x / W)) * smooth(0, 0.05, 1 - hn);
      a *= 0.92 + 0.08 * gr[i];
      const t = smooth(0.1, 0.7, a);
      pix.set(i, 54 + (12 - 54) * t, 46 + (10 - 46) * t, 38 + (9 - 38) * t, a * 255);
    }
  }
  return { map: pix.toCanvas().canvas };
}

// -----------------------------------------------------------------------------
// 焦痕：中心炭黑、起泡龜裂，往外漸層為褐色熱變色，邊緣不規則
// -----------------------------------------------------------------------------
export function scorch() {
  const W = 256, H = 256;
  const dist = field(W, H, { cells: 5, octaves: 5, seed: 241 }, 2);
  const fine = field(W, H, { cells: 20, octaves: 3, seed: 242 }, 2);
  const wl = worley(W, H, { cells: 22, seed: 243 });
  const gr = grain(W, H, 244);
  const R = 112;
  const pix = new Pix(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, j = i;
    const rr = hyp(x - W / 2, y - H / 2) / R;
    const d = rr + (dist[i] - 0.5) * 0.55 + (fine[i] - 0.5) * 0.14;
    const core = smooth(0.6, 0.3, d), mid = smooth(0.95, 0.5, d), halo = smooth(1.2, 0.85, d);
    let r = 96, g = 66, b = 38;
    r += (42 - r) * mid; g += (28 - g) * mid; b += (18 - b) * mid;
    r += (12 - r) * core; g += (10 - g) * core; b += (9 - b) * core;
    const edge = wl.f2[j] - wl.f1[j];
    const crack = smooth(0.07, 0.0, edge) * core;
    const blister = smooth(0.1, 0.25, edge) * smooth(0.35, 0.05, wl.f1[j]) * core;
    r += (88 - r) * crack * 0.7; g += (40 - g) * crack * 0.7; b += (16 - b) * crack * 0.7;
    r += 26 * blister; g += 24 * blister; b += 22 * blister;
    let a = clamp(halo * 0.32 + mid * 0.5 + core * 0.2) * (0.85 + 0.15 * gr[i]);
    a *= smooth(1.0, 0.9, hyp(x - W / 2, y - H / 2) / (W / 2));
    pix.set(i, r, g, b, a * 255);
  }
  return { map: pix.toCanvas().canvas };
}

// -----------------------------------------------------------------------------
// 全焦黑牆面（不透明，可平鋪）：起泡的漆、餘燼褐色裂縫、灰白灰燼
// -----------------------------------------------------------------------------
export function charred() {
  const W = 512, H = 512, N = W * H;
  const wl = worley(W, H, { cells: 13, seed: 251 });
  const wl2 = worley(256, 256, { cells: 34, seed: 252 });
  const ash = field(W, H, { cells: 4, octaves: 5, seed: 253 }, 4);
  const fine = field(W, H, { cells: 64, octaves: 2, seed: 254 }, 2);
  const gr = grain(W, H, 255);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, j = (y >> 1) * 256 + (x >> 1);
    const cell = wl.id[i];
    const isBlister = hash3(cell, 1, 3) < 0.62;
    const isPaint = hash3(cell, 2, 3) < 0.07;
    const f1 = wl.f1[i], edge = wl.f2[i] - wl.f1[i];
    const dome = isBlister ? clamp(1 - Math.pow(f1 / 0.55, 2)) : 0;
    const crack = smooth(0.055, 0.0, edge);
    const crackle = smooth(0.05, 0.0, wl2.f2[j] - wl2.f1[j]);
    let v = 16 + 16 * fine[i] + 18 * dome;
    let r = v, g = v * 0.96, b = v * 0.93;
    // 起泡頂端的灰色高光（乾掉的漆皮）
    const top = dome * smooth(0.5, 0.95, dome);
    r += 22 * top; g += 21 * top; b += 20 * top;
    if (isPaint) { r = r * 0.6 + 22; g = g * 0.6 + 26; b = b * 0.6 + 24; }
    // 餘燼褐色裂縫
    r += (84 - r) * crack * 0.75; g += (40 - g) * crack * 0.75; b += (17 - b) * crack * 0.75;
    const cc = crack * smooth(0.02, 0.0, edge); r *= 1 - 0.6 * cc; g *= 1 - 0.6 * cc; b *= 1 - 0.6 * cc;
    r *= 1 - 0.35 * crackle; g *= 1 - 0.35 * crackle; b *= 1 - 0.35 * crackle;
    // 灰燼
    const as = smooth(0.55, 0.85, ash[i]) * (0.6 + 0.4 * gr[i]) * (1 - crack);
    r += (98 - r) * as * 0.75; g += (95 - g) * as * 0.75; b += (90 - b) * as * 0.75;
    const n = (gr[i] - 0.5) * 9;
    pix.set(i, r + n, g + n, b + n);
    Hh[i] = 0.4 + 0.4 * dome - 0.3 * crack - 0.1 * crackle + 0.08 * (fine[i] - 0.5);
  }
  return { map: pix.toCanvas().canvas, bump: fieldToCanvas(Hh, W, H) };
}

// -----------------------------------------------------------------------------
// 粒子精靈（RGB 維持定值，只有 alpha 柔邊 → 不會出現黑邊）
// -----------------------------------------------------------------------------
export function ashSprite() {
  const S = 64, pix = new Pix(S, S);
  const r = rng(261);
  const harm = [[1, 0.06, r() * TAU], [2, 0.05, r() * TAU]];
  for (let k = 3; k <= 9; k++) harm.push([k, ((r() - 0.5) * 0.5) / Math.pow(k, 0.9), r() * TAU]);
  const spots = field(S, S, { cells: 5, octaves: 3, seed: 262 }, 1);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5 - S / 2) / (S / 2), dy = ((y + 0.5 - S / 2) / (S / 2)) * 1.2;
    const a = Math.atan2(dy, dx), d = hyp(dx, dy);
    let R = 0.52; for (const [k, amp, ph] of harm) R += amp * Math.sin(k * a + ph);
    R = Math.max(0.18, R);
    const sp = spots[y * S + x];
    const al = smooth(R, R - 0.06, d) * (0.72 + 0.28 * sp);
    const edge = smooth(R * 0.55, R, d);
    const v = 206 - 70 * edge * (0.5 + 0.5 * sp) - 30 * smooth(0.6, 0.9, sp);
    pix.set(y * S + x, v, v - 2, v - 6, al * 255);
  }
  return { map: pix.toCanvas().canvas };
}

export function smokeSprite() {
  const S = 128, pix = new Pix(S, S);
  const f = fbmField(S, S, { cells: 4, octaves: 5, seed: 271 });
  const f2 = fbmField(S, S, { cells: 8, octaves: 4, seed: 272 });
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const rr = hyp(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
    const d = rr + (f[i] - 0.5) * 0.5;
    let a = Math.pow(smooth(1.0, 0.2, d), 1.5) * (0.5 + 0.65 * f2[i]);
    a *= smooth(1.0, 0.82, rr);
    const v = 226 + 26 * f2[i];
    pix.set(i, v, v, v, clamp(a) * 255);
  }
  return { map: pix.toCanvas().canvas };
}

export function glowSprite() {
  const S = 128, pix = new Pix(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const rr = hyp(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
    const a = (Math.exp(-rr * rr * 7) * 0.85 + Math.exp(-rr * 3.2) * 0.25) * smooth(1.0, 0.75, rr);
    pix.set(y * S + x, 255, 255, 255, clamp(a) * 255);
  }
  return { map: pix.toCanvas().canvas };
}

export function glintSprite() {
  const S = 64, pix = new Pix(S, S), h = S / 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - h, dy = y + 0.5 - h;
    const rr = hyp(dx, dy);
    const core = Math.exp(-(rr * rr) / 18);
    const rx = Math.exp(-(dy * dy) / 1.4) * Math.pow(Math.max(0, 1 - Math.abs(dx) / h), 2.4);
    const ry = Math.exp(-(dx * dx) / 1.4) * Math.pow(Math.max(0, 1 - Math.abs(dy) / h), 2.4);
    const u = (dx + dy) / Math.SQRT2, v = (dx - dy) / Math.SQRT2;
    const diag = (Math.exp(-(v * v) / 1.0) * Math.pow(Math.max(0, 1 - Math.abs(u) / (h * 0.55)), 2) + Math.exp(-(u * u) / 1.0) * Math.pow(Math.max(0, 1 - Math.abs(v) / (h * 0.55)), 2)) * 0.3;
    const a = clamp(core + 0.9 * (rx + ry) + diag) * smooth(h, h * 0.8, rr);
    pix.set(y * S + x, 255, 255, 255, a * 255);
  }
  return { map: pix.toCanvas().canvas };
}
