// =============================================================================
// synth.js — 共用的小型合成積木（喀噠、衰減音、悶響、金屬泛音、咳嗽、斧劈、敲門…）
// 全部以 Voice 建立節點，時間一律為 AudioContext 時間。
// =============================================================================
import { perc, asr, rand } from './dsp.js';

/** 濾波噪音的極短顆粒（喀噠聲）。 */
export function click(v, dest, t, { f = 3000, Q = 1.2, peak = 0.5, tc = 0.0025, a = 0.0004, color = 'white', type = 'bandpass' } = {}) {
  const n = v.noise(color, t, t + a + tc * 9 + 0.004);
  const fl = v.bq(type, f, Q);
  const g = v.g(0);
  perc(g.gain, t, peak, a, tc);
  v.chain(n, fl, g, dest);
  return g;
}

/** 指數衰減的正弦（可帶音高下滑）。 */
export function tone(v, dest, t, f, peak, tc, { a = 0.0015, f1 = null, glideT = 0.1, type = 'sine' } = {}) {
  const end = t + a + tc * 8 + 0.01;
  const o = v.osc(type, f, t, end);
  if (f1) { o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + glideT); }
  const g = v.g(0);
  perc(g.gain, t, peak, a, tc);
  v.chain(o, g, dest);
  return g;
}

/** 一組不和諧泛音（金屬、陶瓷）。partials: [[f, amp, tc], ...] */
export function ring(v, dest, t, partials, { scale = 1, detune = 0.02, a = 0.001 } = {}) {
  for (const [f, amp, tc] of partials) tone(v, dest, t, f * rand(1 - detune, 1 + detune), amp * scale, tc, { a });
}

/** 低頻悶響：正弦下滑 + 低通噪音。 */
export function thud(v, dest, t, { f = 90, f1 = 55, peak = 0.8, tc = 0.07, glideT = 0.12, noise = 0.45, noiseLp = 450, noiseTc = 0.02, color = 'brown' } = {}) {
  tone(v, dest, t, f, peak, tc, { f1, glideT, a: 0.002 });
  if (noise > 0) click(v, dest, t, { f: noiseLp, Q: 0.6, peak: noise, tc: noiseTc, a: 0.001, color, type: 'lowpass' });
}

/** 一段濾波噪音的起-持-放。 */
export function hiss(v, dest, t, { color = 'white', type = 'bandpass', f = 2000, Q = 0.7, peak = 0.3, a = 0.02, hold = 0.1, r = 0.2, f1 = null } = {}) {
  const end = t + a + hold + r * 2 + 0.05;
  const n = v.noise(color, t, end);
  const fl = v.bq(type, f, Q);
  if (f1) { fl.frequency.setValueAtTime(f, t); fl.frequency.exponentialRampToValueAtTime(f1, t + a + hold + r); }
  const g = v.g(0);
  asr(g.gain, t, peak, a, hold, r);
  v.chain(n, fl, g, dest);
  return g;
}

/** 摩擦/鉸鏈的「黏滑」激發：低頻鋸齒波 → 一組共振帶通。回傳輸出增益節點（呼叫者自行做包絡）。 */
export function stickSlip(v, t, dur, { fLo = 16, fHi = 46, res = [[205, 14, 1], [463, 16, 0.7], [828, 18, 0.45], [1290, 22, 0.25]], step = [0.16, 0.34], grit = 0.15 } = {}) {
  const end = t + dur;
  const o = v.osc('sawtooth', rand(fLo, fHi), t, end + 0.05);
  let tt = t;
  o.frequency.setValueAtTime(rand(fLo, fHi), t);
  while (tt < end) { tt += rand(step[0], step[1]); o.frequency.linearRampToValueAtTime(rand(fLo, fHi), Math.min(end, tt)); }
  const ex = v.g(1);
  o.connect(ex);
  if (grit > 0) {
    const n = v.noise('white', t, end + 0.05);
    v.chain(n, v.bq('bandpass', 1700, 0.8), v.g(grit), ex);
  }
  const mix = v.g(1);
  for (const [f, Q, amp] of res) v.chain(ex, v.bq('bandpass', f * rand(0.97, 1.03), Q), v.g(amp), mix);
  return mix;
}

// ---------------------------------------------------------------------------
// 人聲類（面罩裡的咳嗽、喘息）與門外的打擊（敲門、斧劈）— 對講機與 sfx 共用
// ---------------------------------------------------------------------------
/** 3–4 聲悶在面罩裡的咳嗽。回傳持續秒數。 */
export function coughGroup(v, dest, t, { count = 3 + (Math.random() < 0.5 ? 1 : 0), amp = 1, muffle = 1300, f0 = 150 } = {}) {
  const lp = v.bq('lowpass', muffle, 0.7);
  const cav = v.bq('peaking', 860, 1.4, 4);
  v.chain(cav, lp, dest);
  let tt = t;
  for (let i = 0; i < count; i++) {
    const a = amp * (i === 0 ? 1 : rand(0.62, 0.92));
    const n = v.noise('white', tt, tt + 0.45);
    const bp = v.bq('bandpass', rand(950, 1350), 0.7);
    const g = v.g(0);
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(a, tt + 0.008);
    g.gain.setTargetAtTime(a * 0.32, tt + 0.03, 0.03);
    g.gain.setTargetAtTime(0, tt + 0.13, 0.05);
    v.chain(n, bp, g, cav);
    const o = v.osc('sawtooth', f0 * rand(1.0, 1.15), tt, tt + 0.32);
    o.frequency.setValueAtTime(f0 * rand(1.0, 1.15), tt);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.74, tt + 0.2);
    const og = v.g(0);
    perc(og.gain, tt, 0.42 * a, 0.01, 0.05);
    v.chain(o, v.bq('bandpass', 640, 2.4), og, cav);
    tone(v, cav, tt, 125, 0.32 * a, 0.03, { f1: 80, glideT: 0.08 });
    tt += rand(0.27, 0.44);
  }
  // 咳完後嘶啞的吸氣
  hiss(v, cav, tt + 0.04, { f: 1600, Q: 1.1, peak: 0.22 * amp, a: 0.16, hold: 0.08, r: 0.14, f1: 2000 });
  return tt - t + 0.5;
}

/** 斧頭劈在鋼門上（由呼叫者決定是否經過 'door' 捲積）。 */
export function axeHit(v, dest, t, amp = 1) {
  tone(v, dest, t, 72, 1.0 * amp, 0.12, { f1: 50, glideT: 0.16, a: 0.002 });
  click(v, dest, t, { f: 520, Q: 0.6, peak: 0.75 * amp, tc: 0.04, a: 0.001, color: 'brown', type: 'lowpass' });
  ring(v, dest, t, [[231, 0.22, 0.24], [547, 0.14, 0.17], [1183, 0.08, 0.09], [1934, 0.04, 0.05]], { scale: amp });
  click(v, dest, t, { f: 1800, Q: 0.8, peak: 0.28 * amp, tc: 0.003 });
  return 1.0;
}

/** 三下悶悶的金屬敲擊（拳頭敲鋼門）。回傳持續秒數。 */
export function knockSet(v, dest, t, { count = 3, spacing = 0.27, amp = 1 } = {}) {
  let tt = t;
  for (let i = 0; i < count; i++) {
    const a = amp * (i === count - 1 ? 1.08 : rand(0.82, 1));
    ring(v, dest, tt, [[180, 1, 0.085], [430, 0.6, 0.05], [890, 0.35, 0.03], [1460, 0.15, 0.018]], { scale: a, detune: 0.03 });
    click(v, dest, tt, { f: 1400, Q: 0.7, peak: 0.5 * a, tc: 0.003 });
    tone(v, dest, tt, 96, 0.55 * a, 0.035, { a: 0.002 });
    tt += spacing * rand(0.88, 1.14);
  }
  return tt - t + 0.35;
}
