// =============================================================================
// 主控室專用的小型程式化貼圖（TextureFactory 契約沒有涵蓋的細節：鍵盤、玻璃裂痕、
// 鐵絲網玻璃、值班白板、儀表刻度盤、公佈欄紙張、活頁夾書背、杯身裂紋、咖啡漬等）。
// 只有環境標示性文字（無劇情文字）。
// =============================================================================
import * as THREE from 'three';
import { rng } from '../../core/util.js';
import { makeCanvas, canvasTexture, fillNoise, speckle, stain, FONTS } from '../../gfx/canvasUtil.js';

/** 螢幕碎裂黑玻璃：黑底＋淺灰裂紋（從撞擊點放射＋同心弧）。 */
export function crackTexture(seed = 5, w = 512, h = 384) {
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = '#060606'; g.fillRect(0, 0, w, h);
  const r = rng(seed);
  const cx = w * (0.3 + r() * 0.4), cy = h * (0.3 + r() * 0.4);
  // 煙燻斑
  for (let i = 0; i < 6; i++) stain(g, r() * w, r() * h, 60 + r() * 120, { seed: seed + i, color: [22, 20, 18], alpha: 0.6 });
  g.lineCap = 'round';
  const rays = 11 + Math.floor(r() * 6);
  const ends = [];
  for (let i = 0; i < rays; i++) {
    let a = (i / rays) * Math.PI * 2 + (r() - 0.5) * 0.4;
    let x = cx, y = cy;
    const len = 120 + r() * Math.max(w, h) * 0.7;
    g.beginPath(); g.moveTo(x, y);
    for (let d = 0; d < len; d += 14) {
      a += (r() - 0.5) * 0.28;
      x += Math.cos(a) * 14; y += Math.sin(a) * 14;
      g.lineTo(x, y);
    }
    g.strokeStyle = `rgba(190,196,200,${0.35 + r() * 0.3})`;
    g.lineWidth = 0.8 + r() * 1.4;
    g.stroke();
    ends.push([a, len]);
  }
  for (let ring = 1; ring <= 3; ring++) {
    const rad = ring * (26 + r() * 30);
    g.beginPath();
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      const rr = rad * (0.85 + r() * 0.3);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (k === 0 || r() < 0.25) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(170,175,180,0.35)'; g.lineWidth = 0.8; g.stroke();
  }
  // 撞擊點碎屑
  g.fillStyle = 'rgba(200,205,210,0.5)';
  for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = r() * 18; g.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 1.5, 1.5); }
  return canvasTexture(canvas, { wrap: false });
}

/** 鍵盤鍵帽（俯視）。 */
export function keyboardTexture(seed = 3) {
  const w = 512, h = 168;
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = '#2a2b2b'; g.fillRect(0, 0, w, h);
  const r = rng(seed);
  const rows = [
    [15, 1], [15, 1], [14, 1.07], [13, 1.15], [12, 1.25],
  ];
  const kh = 26, gap = 4, x0 = 10, y0 = 12;
  const glyphs = 'QWERTYUIOPASDFGHJKLZXCVBNM1234567890';
  for (let ri = 0; ri < rows.length; ri++) {
    const [count] = rows[ri];
    const total = w * 0.78 - x0;
    const kw = (total - gap * (count - 1)) / count;
    for (let k = 0; k < count; k++) {
      let ww = kw;
      if (ri === 4 && k === 5) ww = kw * 4; // 空白鍵
      if (ri === 4 && k > 5 && k < 9) continue;
      const x = x0 + k * (kw + gap), y = y0 + ri * (kh + gap);
      const shade = 70 + Math.floor(r() * 10);
      const grd = g.createLinearGradient(0, y, 0, y + kh);
      grd.addColorStop(0, `rgb(${shade + 26},${shade + 26},${shade + 24})`);
      grd.addColorStop(1, `rgb(${shade - 10},${shade - 10},${shade - 12})`);
      g.fillStyle = grd;
      g.fillRect(x, y, ww, kh);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + kh - 3, ww, 3);
      g.fillStyle = 'rgba(220,220,210,0.55)';
      g.font = `10px ${FONTS.mono}`;
      g.fillText(glyphs[Math.floor(r() * glyphs.length)], x + 4, y + 12);
    }
  }
  // 數字鍵區
  for (let ri = 0; ri < 5; ri++) for (let k = 0; k < 4; k++) {
    const x = w * 0.8 + k * 24, y = y0 + ri * (kh + gap);
    g.fillStyle = '#5d5e5c'; g.fillRect(x, y, 20, kh);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + kh - 3, 20, 3);
  }
  speckle(g, w, h, { seed: seed + 9, count: 300, color: 'rgba(0,0,0,0.25)', min: 0.4, max: 1.2 });
  return canvasTexture(canvas, { wrap: false });
}

/** 吸音板布面（細緻織紋、輕微不均、邊緣略髒）。 */
export function acousticTexture(seed = 11) {
  const w = 256, h = 256;
  const { canvas, g } = makeCanvas(w, h);
  fillNoise(g, w, h, { seed, scale: 4, c0: [96, 101, 106], c1: [116, 120, 124], contrast: 0.9 });
  // 極淡的織紋（避免遠看出現摩爾紋）
  g.globalAlpha = 0.05;
  for (let y = 0; y < h; y += 2) { g.fillStyle = '#000'; g.fillRect(0, y, w, 1); }
  g.globalAlpha = 0.035;
  for (let x = 0; x < w; x += 2) { g.fillStyle = '#fff'; g.fillRect(x, 0, 1, h); }
  g.globalAlpha = 1;
  speckle(g, w, h, { seed: seed + 1, count: 260, color: 'rgba(40,40,40,0.12)', min: 0.4, max: 1.2 });
  return canvasTexture(canvas);
}

/** 鐵絲網玻璃的網格（透明底，暗色鐵絲）。 */
export function wireGlassTexture() {
  const w = 128, h = 128;
  const { canvas, g } = makeCanvas(w, h);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(40,42,40,0.9)'; g.lineWidth = 1.6;
  for (let i = 0; i <= w; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
  }
  return canvasTexture(canvas);
}

/** 值班白板（格線＋看不清的白板筆塗寫＋擦拭殘影；只有表頭為環境標示）。 */
export function rosterTexture() {
  const w = 512, h = 336;
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = '#e9eae6'; g.fillRect(0, 0, w, h);
  const r = rng(77);
  // 擦拭殘影
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = `rgba(120,130,140,${0.05 + r() * 0.06})`; g.lineWidth = 10 + r() * 20;
    g.beginPath(); const y = r() * h; g.moveTo(r() * w * 0.3, y); g.bezierCurveTo(w * 0.4, y + 20, w * 0.6, y - 20, w * (0.6 + r() * 0.4), y + 10); g.stroke();
  }
  // 表頭
  g.fillStyle = '#1d3f7a'; g.font = `bold 30px ${FONTS.ui}`; g.fillText('值班表', 22, 44);
  g.fillStyle = '#7a1d1d'; g.font = `18px ${FONTS.mono}`; g.fillText('NIGHT SHIFT', 140, 42);
  // 格線（藍色膠帶）
  g.fillStyle = 'rgba(40,70,140,0.75)';
  const cols = [20, 120, 230, 340, 492];
  for (const x of cols) g.fillRect(x, 64, 3, 250);
  for (let i = 0; i < 6; i++) g.fillRect(20, 64 + i * 50, 472, 3);
  g.font = `16px ${FONTS.mono}`; g.fillStyle = '#233';
  ['00-08', '08-16', '16-24'].forEach((t, i) => g.fillText(t, cols[i + 1] + 12, 88));
  // 看不清的筆跡（隨機曲線）
  const scrib = (x, y, len, col) => {
    g.strokeStyle = col; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, y);
    let cx = x;
    while (cx < x + len) {
      const nx = cx + 6 + r() * 10;
      g.quadraticCurveTo(cx + (nx - cx) / 2, y - 8 - r() * 8, nx, y + (r() - 0.5) * 6);
      cx = nx;
    }
    g.stroke();
  };
  for (let row = 1; row < 5; row++) {
    for (let c = 0; c < 4; c++) {
      if (r() < 0.2) continue;
      scrib(cols[c] + 12, 64 + row * 50 + 32, 50 + r() * 40, c === 3 ? 'rgba(160,30,30,0.85)' : 'rgba(25,35,60,0.85)');
    }
  }
  // 圈起來的一格（紅筆）
  g.strokeStyle = 'rgba(170,25,25,0.85)'; g.lineWidth = 3;
  g.beginPath(); g.ellipse(cols[3] + 55, 64 + 3 * 50 + 26, 58, 20, -0.05, 0, Math.PI * 2); g.stroke();
  // 磁鐵
  [[470, 30, '#c33'], [440, 300, '#2a6'], [70, 310, '#33a']].forEach(([x, y, c]) => {
    const grd = g.createRadialGradient(x - 3, y - 3, 1, x, y, 10);
    grd.addColorStop(0, '#fff'); grd.addColorStop(0.3, c); grd.addColorStop(1, '#111');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill();
  });
  // 邊緣髒污
  stain(g, w * 0.9, h * 0.1, 70, { seed: 4, color: [120, 115, 100], alpha: 0.12 });
  stain(g, w * 0.1, h * 0.9, 80, { seed: 6, color: [120, 115, 100], alpha: 0.1 });
  return canvasTexture(canvas, { wrap: false });
}

/** 轉速表刻度盤（0–100，綠/琥珀/紅區）。 */
export function dialTexture() {
  const s = 256;
  const { canvas, g } = makeCanvas(s, s);
  const c = s / 2;
  g.fillStyle = '#e6e2d6'; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; // 由左下（135°）順時針到右下
  const arc = (from, to, col) => {
    g.strokeStyle = col; g.lineWidth = 14;
    g.beginPath(); g.arc(c, c, c * 0.72, a0 + (a1 - a0) * from, a0 + (a1 - a0) * to); g.stroke();
  };
  arc(0.0, 0.35, 'rgba(120,120,120,0.6)');
  arc(0.35, 0.7, '#2f8a3c');
  arc(0.7, 0.86, '#d69a1c');
  arc(0.86, 1.0, '#b52a1e');
  g.strokeStyle = '#1b1b1b';
  for (let i = 0; i <= 50; i++) {
    const a = a0 + (a1 - a0) * (i / 50);
    const big = i % 5 === 0;
    const r0 = c * (big ? 0.6 : 0.66), r1 = c * 0.8;
    g.lineWidth = big ? 3 : 1.4;
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
  }
  g.fillStyle = '#1b1b1b'; g.font = `bold 20px ${FONTS.mono}`; g.textAlign = 'center';
  for (let i = 0; i <= 10; i += 2) {
    const a = a0 + (a1 - a0) * (i / 10);
    g.fillText(String(i * 10), c + Math.cos(a) * c * 0.45, c + Math.sin(a) * c * 0.45 + 7);
  }
  g.font = `14px ${FONTS.mono}`; g.fillText('RPM ×10', c, c * 1.55);
  g.textAlign = 'left';
  // 錶框陰影
  const grd = g.createRadialGradient(c, c, c * 0.8, c, c, c);
  grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = grd; g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.fill();
  return canvasTexture(canvas, { wrap: false });
}

/** 公佈欄：軟木底＋幾張釘著、看不清內容的紙。 */
export function bulletinTexture() {
  const w = 512, h = 320;
  const { canvas, g } = makeCanvas(w, h);
  fillNoise(g, w, h, { seed: 31, scale: 16, c0: [120, 84, 52], c1: [160, 118, 78], contrast: 1.2 });
  speckle(g, w, h, { seed: 32, count: 1600, color: 'rgba(60,35,15,0.35)', min: 0.5, max: 1.6 });
  const r = rng(33);
  const sheets = [[30, 30, 150, 200, -0.04], [200, 20, 140, 180, 0.03], [360, 40, 130, 170, -0.02], [190, 200, 170, 110, 0.05], [380, 220, 110, 90, -0.06]];
  for (const [x, y, sw, sh, rot] of sheets) {
    g.save(); g.translate(x + sw / 2, y + sh / 2); g.rotate(rot);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-sw / 2 + 4, -sh / 2 + 5, sw, sh);
    const tint = 228 + Math.floor(r() * 18);
    g.fillStyle = `rgb(${tint},${tint - 4},${tint - 16})`; g.fillRect(-sw / 2, -sh / 2, sw, sh);
    g.fillStyle = 'rgba(40,40,50,0.8)'; g.fillRect(-sw / 2 + 10, -sh / 2 + 12, sw * 0.6, 7);
    g.fillStyle = 'rgba(70,70,80,0.45)';
    for (let ly = -sh / 2 + 30; ly < sh / 2 - 12; ly += 9) g.fillRect(-sw / 2 + 10, ly, (sw - 20) * (0.5 + r() * 0.5), 3);
    // 圖釘
    g.fillStyle = ['#c22', '#24a', '#2a4', '#dd3'][Math.floor(r() * 4)];
    g.beginPath(); g.arc(0, -sh / 2 + 6, 5, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  return canvasTexture(canvas, { wrap: false });
}

/** 活頁夾書背（直書標籤，環境用）。 */
export function spineTexture(text, color = '#2c4a6e', seed = 1) {
  const w = 64, h = 320;
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  fillNoise(g, w, h, { seed, scale: 4, c0: [0, 0, 0], c1: [40, 40, 40], alpha: 50 });
  g.globalAlpha = 1;
  g.fillStyle = color; g.globalAlpha = 0.75; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
  // 標籤紙
  g.fillStyle = '#e8e3d2'; g.fillRect(8, 40, w - 16, 190);
  g.fillStyle = '#1a1a1a'; g.font = `24px ${FONTS.ui}`; g.textAlign = 'center';
  [...text].forEach((ch, i) => g.fillText(ch, w / 2, 72 + i * 30));
  g.textAlign = 'left';
  // 指孔
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.arc(w / 2, 270, 9, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(200,200,200,0.4)'; g.lineWidth = 2; g.stroke();
  return canvasTexture(canvas, { wrap: false });
}

/** 馬克杯身的裂紋（透明底）。lathe UV：u 繞圈、v 由下而上。 */
export function mugCrackTexture() {
  const w = 256, h = 128;
  const { canvas, g } = makeCanvas(w, h);
  g.clearRect(0, 0, w, h);
  const r = rng(91);
  g.strokeStyle = 'rgba(25,18,12,0.95)'; g.lineCap = 'round';
  const branch = (x, y, a, len, wd) => {
    g.lineWidth = wd; g.beginPath(); g.moveTo(x, y);
    for (let d = 0; d < len; d += 5) {
      a += (r() - 0.5) * 0.6; x += Math.cos(a) * 5; y += Math.sin(a) * 5; g.lineTo(x, y);
      if (wd > 0.8 && r() < 0.08) { g.stroke(); branch(x, y, a + (r() - 0.5) * 1.6, len * 0.4, wd * 0.6); g.beginPath(); g.moveTo(x, y); }
    }
    g.stroke();
  };
  branch(w * 0.42, h * 0.98, -Math.PI / 2 + 0.2, h * 0.95, 2.2);
  branch(w * 0.47, h * 0.02, Math.PI / 2 - 0.3, h * 0.5, 1.6);
  // 乾涸咖啡流痕
  g.fillStyle = 'rgba(60,35,18,0.35)';
  for (let i = 0; i < 6; i++) { const x = r() * w; g.fillRect(x, h * 0.75, 2 + r() * 3, h * 0.25 * r()); }
  return canvasTexture(canvas, { wrap: false });
}

/** 桌面咖啡漬（環形，透明底）。 */
export function ringStainTexture(seed = 5, dark = false) {
  const s = 128;
  const { canvas, g } = makeCanvas(s, s);
  g.clearRect(0, 0, s, s);
  const r = rng(seed);
  for (let k = 0; k < 3; k++) {
    const cx = s / 2 + (r() - 0.5) * 18, cy = s / 2 + (r() - 0.5) * 18;
    const rad = s * (0.3 + r() * 0.05);
    g.strokeStyle = dark ? `rgba(28,16,8,${0.55 - k * 0.12})` : `rgba(80,48,22,${0.42 - k * 0.1})`;
    g.lineWidth = 2 + r() * 3;
    g.beginPath(); g.arc(cx, cy, rad, r() * 0.5, Math.PI * 2 - r() * 0.8); g.stroke();
  }
  if (dark) stain(g, s / 2, s / 2, 40, { seed: seed + 3, color: [30, 26, 22], alpha: 0.35 });
  return canvasTexture(canvas, { wrap: false });
}

/** 日光燈稜鏡擴散板（細小菱格）。 */
export function prismTexture() {
  const s = 64;
  const { canvas, g } = makeCanvas(s, s);
  g.fillStyle = '#d9dcdc'; g.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 8) for (let x = 0; x < s; x += 8) {
    const grd = g.createLinearGradient(x, y, x + 8, y + 8);
    grd.addColorStop(0, '#f4f6f6'); grd.addColorStop(1, '#b9bdbd');
    g.fillStyle = grd; g.fillRect(x + 1, y + 1, 6, 6);
  }
  return canvasTexture(canvas);
}

/** 19 吋機櫃面板（配線面板、網路埠、風扇格柵）。 */
export function rackTexture() {
  const w = 256, h = 512;
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = '#1b1c1d'; g.fillRect(0, 0, w, h);
  const r = rng(13);
  let y = 8;
  while (y < h - 30) {
    const uh = [22, 22, 44, 66][Math.floor(r() * 4)];
    g.fillStyle = r() < 0.5 ? '#2a2c2e' : '#222426'; g.fillRect(12, y, w - 24, uh - 3);
    g.fillStyle = '#9a9c9e'; g.fillRect(4, y + 3, 6, 6); g.fillRect(w - 10, y + 3, 6, 6);
    if (uh === 22) {
      for (let x = 24; x < w - 30; x += 12) { g.fillStyle = '#0c0c0c'; g.fillRect(x, y + 6, 9, 8); }
    } else if (uh === 44) {
      g.fillStyle = '#111'; for (let x = 30; x < w - 40; x += 6) g.fillRect(x, y + 8, 3, uh - 18);
      g.fillStyle = '#58606a'; g.fillRect(w - 60, y + 10, 30, 8);
    } else {
      g.fillStyle = '#0e0f10'; g.fillRect(24, y + 8, w - 48, uh - 20);
      g.strokeStyle = '#3a3c3e'; for (let k = 0; k < 4; k++) { g.strokeRect(30 + k * 50, y + 14, 40, uh - 32); }
    }
    y += uh;
  }
  return canvasTexture(canvas, { wrap: false });
}

/** 地板上的磨損/膠帶標線（防爆門前的黃色停止線用 hazard 貼圖，這裡只給椅子周圍的磨痕）。 */
export function scuffTexture() {
  const s = 256;
  const { canvas, g } = makeCanvas(s, s);
  g.clearRect(0, 0, s, s);
  const r = rng(55);
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, rad = 30 + r() * 90;
    g.strokeStyle = `rgba(20,20,20,${0.04 + r() * 0.06})`; g.lineWidth = 1 + r() * 4;
    g.beginPath(); g.arc(s / 2, s / 2, rad, a, a + 0.3 + r() * 0.8); g.stroke();
  }
  return canvasTexture(canvas, { wrap: false });
}

/** 柔和的發光暈（LED/鐘面打在牆上的光暈，加法混合）。 */
export function spillTexture(color = [255, 40, 30]) {
  const s = 128;
  const { canvas, g } = makeCanvas(s, s);
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},0.9)`);
  grd.addColorStop(0.35, `rgba(${color[0]},${color[1]},${color[2]},0.35)`);
  grd.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return canvasTexture(canvas, { wrap: false });
}

export function solidTexture(css = '#888') {
  const { canvas, g } = makeCanvas(4, 4);
  g.fillStyle = css; g.fillRect(0, 0, 4, 4);
  return canvasTexture(canvas, { wrap: false });
}

/** 控制台翼板的開關標籤條（一排小標籤）。 */
export function labelStripTexture(labels, seed = 1) {
  const w = 1024, h = 48;
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = '#202224'; g.fillRect(0, 0, w, h);
  const cw = w / labels.length;
  labels.forEach((t, i) => {
    g.fillStyle = '#d9d6cc'; g.fillRect(i * cw + 10, 6, cw - 20, h - 12);
    g.fillStyle = '#151515'; g.font = `bold 24px ${FONTS.ui}`; g.textAlign = 'center';
    g.fillText(t, i * cw + cw / 2, h / 2 + 9);
  });
  g.textAlign = 'left';
  speckle(g, w, h, { seed, count: 200, color: 'rgba(0,0,0,0.2)', min: 0.4, max: 1.2 });
  return canvasTexture(canvas, { wrap: false });
}

/** 夾板上的巡檢表單（印刷格線＋看不清的手寫勾記）。 */
export function formTexture() {
  const w = 256, h = 340;
  const { canvas, g } = makeCanvas(w, h);
  g.fillStyle = '#ebe8dd'; g.fillRect(0, 0, w, h);
  const r = rng(21);
  g.fillStyle = '#333'; g.font = `bold 16px ${FONTS.ui}`; g.fillText('設備巡檢表', 16, 28);
  g.fillStyle = 'rgba(40,40,40,0.6)';
  for (let y = 48; y < h - 20; y += 18) { g.fillRect(14, y, w - 28, 1); }
  g.fillRect(150, 44, 1, h - 64); g.fillRect(200, 44, 1, h - 64);
  g.strokeStyle = 'rgba(30,40,110,0.85)'; g.lineWidth = 1.6;
  for (let y = 48; y < h - 60; y += 18) {
    g.fillStyle = 'rgba(60,60,60,0.5)'; g.fillRect(18, y + 7, 40 + r() * 80, 3);
    if (r() < 0.85) { g.beginPath(); g.moveTo(160, y + 9); g.lineTo(166, y + 14); g.lineTo(178, y + 3); g.stroke(); }
  }
  stain(g, w * 0.7, h * 0.8, 40, { seed: 3, color: [120, 90, 50], alpha: 0.18 });
  return canvasTexture(canvas, { wrap: false });
}

export { THREE };
