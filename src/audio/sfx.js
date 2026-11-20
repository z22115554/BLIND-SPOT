// =============================================================================
// sfx.js — 全部 one-shot 音效（程式化）＋ 腳步 ＋ 廊道隨機環境事件
// 每個函式簽名：(v: Voice, t: 開始時間, o: opts, E: AudioEngine) → 持續秒數（含尾音）
// 聲音都輸出到 v.out（Voice 會處理定位與匯流排）。音量在 AudioEngine.SFX_GAIN 統一校準。
// =============================================================================
import { perc, asr, rand, chance, periodicWave, clamp } from './dsp.js';
import { click, tone, ring, thud, hiss, stickSlip, coughGroup, axeHit, knockSet } from './synth.js';

/** 'door' IR 的能量集中在低頻：經過它的打擊聲要先壓低（量測校準）。 */
export const DOOR_IR_GAIN = 0.35;

/** 依玩家所在區域選殘響空間。 */
const space = (E) => E.space();

/** 60 Hz 電流嗡聲的諧波波形（tubeStart / powerUp / breaker / crtBoot 共用）。 */
function humWave(v, amps = [0.5, 1, 0.45, 0.3, 0.14]) {
  const key = amps.join(',');
  v.E._waves = v.E._waves || {};
  if (!v.E._waves[key]) v.E._waves[key] = periodicWave(v.ac, amps);
  return v.E._waves[key];
}

export const SFX = {
  // 日光燈啟動器（輝光啟動器）的喀噠聲 → 燈管點亮的微弱嗡聲（交給 setHum 接手）
  tubeStart(v, t) {
    const o = v.out;
    const starts = [0.05, 0.05 + rand(0.35, 0.55), 0.95 + rand(0, 0.25), 1.42 + rand(0, 0.12)];
    starts.forEach((dt, i) => {
      click(v, o, t + dt, { f: rand(3200, 4300), Q: 2.4, peak: 0.2 + 0.07 * i, tc: 0.0018 });
      tone(v, o, t + dt, rand(2250, 2750), 0.05, 0.012);
    });
    const ts = t + 1.62;
    tone(v, o, ts, 140, 0.24, 0.06, { f1: 70, glideT: 0.08, a: 0.004 });
    tone(v, o, ts, 8200, 0.012, 0.16, { a: 0.01 });
    const b = v.osc(humWave(v), 60, t + 0.05, t + 4.2);
    const lp = v.bq('lowpass', 900, 0.7);
    const g = v.g(0);
    const p = g.gain;
    p.setValueAtTime(0, t + 0.05);
    for (const dt of starts) { p.setTargetAtTime(0.07, t + dt, 0.03); p.setTargetAtTime(0.01, t + dt + 0.12, 0.08); }
    p.setTargetAtTime(0.34, ts, 0.1);
    p.setTargetAtTime(0.26, ts + 0.5, 0.25);
    p.setTargetAtTime(0, ts + 1.1, 0.45);
    v.chain(b, lp, g, o);
    v.send(g, 'room', 0.2);
    return 4.3;
  },

  // 遠處繼電器跳脫的悶響 ＋ 電力下降的嗚咽（不可大聲）
  relayTrip(v, t, o, E) {
    const far = v.bq('lowpass', 950, 0.7);
    far.connect(v.out);
    thud(v, far, t, { f: 96, f1: 52, peak: 0.85, tc: 0.08, noise: 0.5, noiseLp: 600, noiseTc: 0.02 });
    click(v, far, t, { f: 1500, Q: 0.8, peak: 0.45, tc: 0.004 });
    thud(v, far, t + 0.075, { f: 110, f1: 70, peak: 0.35, tc: 0.04, noise: 0.25, noiseTc: 0.012 });
    v.send(far, space(E), 0.65);
    // 變壓器 / 風機的嗚咽：音高下滑
    const w = v.osc('sawtooth', 330, t + 0.05, t + 3.5);
    w.frequency.setValueAtTime(330, t + 0.05);
    w.frequency.exponentialRampToValueAtTime(36, t + 3.1);
    const wl = v.bq('lowpass', 1300, 1.3);
    wl.frequency.setValueAtTime(1300, t + 0.05);
    wl.frequency.exponentialRampToValueAtTime(170, t + 3.1);
    const wg = v.g(0);
    wg.gain.setValueAtTime(0, t + 0.05);
    wg.gain.linearRampToValueAtTime(0.13, t + 0.2);
    wg.gain.setTargetAtTime(0, t + 0.45, 0.75);
    v.chain(w, wl, wg, v.out);
    const h = v.osc(humWave(v), 60, t, t + 3.2);
    h.frequency.setValueAtTime(60, t + 0.02);
    h.frequency.exponentialRampToValueAtTime(21, t + 2.6);
    const hg = v.g(0);
    hg.gain.setValueAtTime(0.22, t);
    hg.gain.setTargetAtTime(0, t + 0.1, 0.6);
    v.chain(h, v.bq('lowpass', 700, 0.7), hg, v.out);
    for (let i = 0; i < 4; i++) click(v, v.out, t + rand(0.01, 0.16), { f: rand(3000, 6000), Q: 1.5, peak: rand(0.03, 0.08), tc: 0.0012 });
    return 4.0;
  },

  // 多個繼電器依序吸合 ＋ 電流嗡聲回升
  powerUp(v, t, o, E) {
    const times = [0, 0.24, 0.43, 0.78, 0.96, 1.38].map((x) => x + rand(-0.03, 0.04));
    times.forEach((dt, i) => {
      const tt = t + dt;
      const distant = i % 2 === 1;
      // 較遠的繼電器：先經過低通再接到輸出
      const inp = distant ? v.bq('lowpass', rand(1400, 2200), 0.7) : null;
      if (inp) inp.connect(v.out);
      const d = inp || v.out;
      const k = distant ? 0.55 : 1;
      click(v, d, tt, { f: rand(2500, 4000), Q: 1.6, peak: 0.5 * k, tc: 0.0025 });
      tone(v, d, tt, rand(900, 1400), 0.06 * k, 0.012);
      thud(v, d, tt, { f: 125, f1: 82, peak: 0.28 * k, tc: 0.03, noise: 0.15 * k, noiseTc: 0.01 });
      if (distant) v.send(d, space(E), 0.4);
    });
    const tc = t + 1.65;
    thud(v, v.out, tc, { f: 70, f1: 44, peak: 0.7, tc: 0.12, noise: 0.4, noiseLp: 320, noiseTc: 0.05 });
    v.send(v.out, space(E), 0.25);
    const h = v.osc(humWave(v), 60, tc, t + 4.6);
    const hg = v.g(0);
    hg.gain.setValueAtTime(0, tc);
    hg.gain.linearRampToValueAtTime(0.3, tc + 0.9);
    hg.gain.setTargetAtTime(0, t + 3.1, 0.45);
    v.chain(h, v.bq('lowpass', 700, 0.7), hg, v.out);
    return 4.8;
  },

  // 控制台按鈕（按下＋放開）
  button(v, t) {
    const o = v.out;
    click(v, o, t, { f: 2600, Q: 1.4, peak: 0.45, tc: 0.0018 });
    tone(v, o, t, 1850, 0.08, 0.012);
    tone(v, o, t, 165, 0.16, 0.015, { a: 0.002 });
    const r = t + rand(0.085, 0.12);
    click(v, o, r, { f: 3200, Q: 1.6, peak: 0.24, tc: 0.0015 });
    tone(v, o, r, 2100, 0.04, 0.008);
    v.send(o, 'room', 0.16);
    return 0.45;
  },

  // 頻道切換：繼電器喀噠 ＋ CRT 高頻微響
  camSwitch(v, t) {
    const o = v.out;
    click(v, o, t, { f: 3400, Q: 1.6, peak: 0.42, tc: 0.0022 });
    tone(v, o, t, 1250, 0.07, 0.01);
    tone(v, o, t, 180, 0.2, 0.02, { f1: 120, glideT: 0.03, a: 0.002 });
    click(v, o, t + 0.013, { f: 2900, Q: 1.4, peak: 0.18, tc: 0.0018 });
    hiss(v, o, t + 0.02, { f: 4200, Q: 0.6, peak: 0.05, a: 0.005, hold: 0.04, r: 0.09 });
    tone(v, o, t + 0.03, 92, 0.18, 0.04, { a: 0.004 });
    const w = v.osc('sine', 15625, t + 0.02, t + 0.9);
    const wg = v.g(0);
    wg.gain.setValueAtTime(0, t + 0.02);
    wg.gain.linearRampToValueAtTime(0.012, t + 0.08);
    wg.gain.setTargetAtTime(0, t + 0.2, 0.12);
    v.chain(w, wg, o);
    v.send(o, 'room', 0.12);
    return 0.95;
  },

  // 金屬拉桿：棘輪 → 重重卡入定位
  lever(v, t, o, E) {
    const L = v.bq('lowpass', 6000, 0.7); L.connect(v.out);
    const rt = [0, 0.065, 0.12, 0.168, 0.21];
    rt.forEach((dt, i) => {
      click(v, L, t + dt, { f: 2800, Q: 3, peak: 0.22 + 0.04 * i, tc: 0.0025 });
      tone(v, L, t + dt, 1600 * rand(0.95, 1.05), 0.05, 0.014);
    });
    const cr = stickSlip(v, t, 0.26, { fLo: 26, fHi: 40, res: [[650, 9, 1], [1180, 12, 0.4]], grit: 0.05 });
    const cg = v.g(0); asr(cg.gain, t, 0.05, 0.05, 0.13, 0.08);
    v.chain(cr, cg, L);
    const tc = t + 0.31;
    thud(v, L, tc, { f: 118, f1: 72, peak: 0.72, tc: 0.06, noise: 0.45, noiseLp: 900, noiseTc: 0.02, color: 'white' });
    ring(v, L, tc, [[340, 0.12, 0.12], [872, 0.08, 0.08], [1571, 0.05, 0.05], [2440, 0.03, 0.035]]);
    v.send(L, space(E), 0.3);
    return 1.5;
  },

  // 門閂/電磁鎖解除
  unlatch(v, t, o, E) {
    const out = v.out;
    click(v, out, t, { f: 2200, Q: 1, peak: 0.45, tc: 0.003 });
    tone(v, out, t, 140, 0.42, 0.03, { f1: 90, glideT: 0.04, a: 0.002 });
    ring(v, out, t, [[620, 0.08, 0.05], [1480, 0.05, 0.03]]);
    // 門栓滑動
    const n = v.noise('white', t + 0.06, t + 0.5);
    const bp = v.bq('bandpass', 1400, 2);
    bp.frequency.setValueAtTime(1400, t + 0.06);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.32);
    const g = v.g(0); asr(g.gain, t + 0.06, 0.2, 0.03, 0.18, 0.06);
    const am = v.g(0.7); const fo = v.osc('square', 62, t + 0.06, t + 0.5); const fd = v.g(0.3); fo.connect(fd).connect(am.gain);
    v.chain(n, bp, g, am, out);
    const te = t + 0.34;
    tone(v, out, te, 180, 0.46, 0.035, { f1: 110, glideT: 0.03, a: 0.002 });
    click(v, out, te, { f: 1600, Q: 1, peak: 0.3, tc: 0.003 });
    hiss(v, out, te + 0.02, { f: 2600, Q: 0.8, peak: 0.1, a: 0.02, hold: 0.05, r: 0.3 });
    v.send(out, space(E), 0.3);
    return 1.4;
  },

  // 厚重鐵門緩慢的鉸鏈聲（低沉、長）
  doorCreak(v, t, o, E) {
    const d = Math.max(1.2, o.duration || 3.2);
    const mix = stickSlip(v, t, d, { fLo: 15, fHi: 44, step: [0.16, 0.36], grit: 0.12 });
    const lp = v.bq('lowpass', 2400, 0.7);
    const env = v.g(0);
    const p = env.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(0.7, t + 0.35);
    let tt = t + 0.35;
    while (tt < t + d - 0.5) { tt += rand(0.15, 0.3); p.linearRampToValueAtTime(rand(0.45, 1), tt); }
    p.setTargetAtTime(0, t + d - 0.45, 0.15);
    v.chain(mix, lp, env, v.out);
    // 門本體的低頻重量感
    const br = v.noise('brown', t, t + d + 0.3);
    const bg = v.g(0); asr(bg.gain, t, 0.3, 0.4, d - 0.9, 0.5);
    v.chain(br, v.bq('lowpass', 95, 0.7), bg, v.out);
    v.send(env, space(E), 0.45);
    return d + 1.0;
  },

  // 氣壓閥洩壓
  pneumaticHiss(v, t, o, E) {
    const d = Math.max(1, o.duration || 2.6);
    const out = v.out;
    click(v, out, t, { f: 1800, Q: 1, peak: 0.28, tc: 0.004 });
    tone(v, out, t, 260, 0.15, 0.03, { a: 0.002 });
    const n = v.noise('white', t, t + d + 0.6);
    const hp = v.bq('highpass', 900, 0.6);
    const bp = v.bq('bandpass', 4200, 0.6);
    bp.frequency.setValueAtTime(4200, t);
    bp.frequency.exponentialRampToValueAtTime(1700, t + d);
    const lp = v.bq('lowpass', 6500, 0.6);
    const g = v.g(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.15);
    g.gain.setTargetAtTime(0, t + 0.28, d * 0.22);
    v.chain(n, hp, bp, lp, g, out);
    hiss(v, out, t, { color: 'brown', type: 'lowpass', f: 350, Q: 0.6, peak: 0.45, a: 0.05, hold: 0.05, r: 0.45 });
    v.send(g, space(E), 0.35);
    return d + 0.8;
  },

  // 防爆門滑動的低頻摩擦（持續 opts.duration 秒）
  heavySlide(v, t, o, E) {
    const d = Math.max(1, o.duration || 4.5);
    const out = v.out;
    const br = v.noise('brown', t, t + d + 0.8);
    const rg = v.g(0);
    asr(rg.gain, t, 1, 0.45, d - 0.9, 0.5);
    const wob = v.osc('sine', 1.7, t, t + d + 0.8), wd = v.g(0.15); wob.connect(wd).connect(rg.gain);
    v.chain(br, v.bq('lowpass', 170, 0.8), rg, out);
    // 滾輪：低頻脈動
    const roll = v.osc('sawtooth', 5, t, t + d + 0.3);
    roll.frequency.setValueAtTime(5, t);
    roll.frequency.linearRampToValueAtTime(10.5, t + Math.min(1.2, d * 0.3));
    roll.frequency.setValueAtTime(10.5, t + d - 0.6);
    roll.frequency.linearRampToValueAtTime(4, t + d);
    const rlg = v.g(0); asr(rlg.gain, t, 0.5, 0.4, d - 0.8, 0.4);
    v.chain(roll, v.bq('lowpass', 110, 3), rlg, out);
    // 刮擦與極輕的嘯聲
    const sc = v.noise('pink', t, t + d + 0.5);
    const sg = v.g(0); asr(sg.gain, t, 0.2, 0.5, d - 1, 0.5);
    const sl = v.osc('sine', 0.6, t, t + d + 0.5), sd = v.g(0.07); sl.connect(sd).connect(sg.gain);
    v.chain(sc, v.bq('bandpass', 640, 3), sg, out);
    const sq = v.noise('white', t, t + d + 0.5);
    const qg = v.g(0); asr(qg.gain, t + 0.3, 0.035, 0.8, d - 2, 0.6);
    v.chain(sq, v.bq('bandpass', 1320, 14), qg, out);
    // 液壓馬達
    const m = v.osc('sine', 48, t, t + d + 0.5), m2 = v.osc('sine', 96, t, t + d + 0.5);
    const mg = v.g(0); asr(mg.gain, t, 0.22, 0.3, d - 0.6, 0.4);
    const m2g = v.g(0.35); m2.connect(m2g).connect(mg);
    m.connect(mg); mg.connect(out);
    // 到底的悶響
    const te = t + d - 0.05;
    thud(v, out, te, { f: 62, f1: 40, peak: 0.75, tc: 0.15, glideT: 0.2, noise: 0.45, noiseLp: 300, noiseTc: 0.06 });
    ring(v, out, te, [[180, 0.08, 0.3], [410, 0.05, 0.2]]);
    v.send(out, space(E), 0.3);
    return d + 1.8;
  },

  // 翻動紙張
  paper(v, t) {
    const out = v.out;
    const k = 4 + ((Math.random() * 3) | 0);
    let tt = t;
    for (let i = 0; i < k; i++) {
      const len = rand(0.04, 0.14);
      const n = v.noise('white', tt, tt + len + 0.05);
      const g = v.g(0);
      g.gain.setValueAtTime(0, tt);
      let x = tt;
      while (x < tt + len) { g.gain.setTargetAtTime(rand(0.05, 0.42), x, 0.002); x += rand(0.006, 0.014); }
      g.gain.setTargetAtTime(0, tt + len, 0.006);
      v.chain(n, v.bq('highpass', 1500, 0.7), v.bq('bandpass', rand(2800, 5200), 0.6), g, out);
      tt += len + rand(0.01, 0.07);
    }
    hiss(v, out, t + 0.12, { color: 'pink', type: 'lowpass', f: 500, Q: 0.6, peak: 0.12, a: 0.05, hold: 0.05, r: 0.12 });
    v.send(out, 'room', 0.15);
    return tt - t + 0.4;
  },

  // 馬克杯放回桌面
  mug(v, t) {
    const out = v.out;
    const hit = (tt, a) => {
      tone(v, out, tt, 190, 0.5 * a, 0.025, { f1: 120, glideT: 0.04, a: 0.0015 });
      click(v, out, tt, { f: 2500, Q: 0.6, peak: 0.32 * a, tc: 0.004, type: 'lowpass' });
      ring(v, out, tt, [[1180, 0.12, 0.06], [2710, 0.08, 0.04], [4290, 0.05, 0.025]], { scale: a });
    };
    hit(t, 1);
    hit(t + rand(0.035, 0.055), 0.35);
    v.send(out, 'room', 0.15);
    return 0.7;
  },

  // 管線熱脹冷縮的輕響
  metalTick(v, t, o, E) {
    const out = v.out;
    click(v, out, t, { f: 4200, Q: 2, peak: 0.3, tc: 0.0015 });
    ring(v, out, t, [[2150, 0.1, 0.03], [3480, 0.07, 0.022], [5600, 0.04, 0.012]], { detune: 0.05 });
    if (chance(0.35)) {
      const t2 = t + rand(0.12, 0.4);
      click(v, out, t2, { f: 3900, Q: 2, peak: 0.16, tc: 0.0015 });
      ring(v, out, t2, [[2050, 0.06, 0.025], [3300, 0.04, 0.018]]);
    }
    v.send(out, space(E), 0.6);
    return 0.9;
  },

  // 防火門外車輛呼嘯而過（隔著玻璃悶住，物理都卜勒）
  carPass(v, t, o, E) {
    const d = 4.2;
    const C = E.ctx.LAYOUT?.CORRIDOR, R = E.ctx.LAYOUT?.ROADWAY;
    const center = o.position ? { x: o.position.x, y: o.position.y ?? 1.4, z: o.position.z } : { x: C?.fireDoor?.x ?? 20, y: 1.45, z: C?.fireDoor?.z ?? 1.2 };
    const laneZ = R?.laneZ ?? -4.5;
    const L = E.listenerPos();
    const speed = 22, c = 343, dir = chance(0.5) ? 1 : -1;
    const N = 48;
    const fac = new Float32Array(N), amp = new Float32Array(N), px = new Float32Array(N);
    const pos = (tau) => ({ x: center.x + dir * speed * (tau - d * 0.5), y: 0.8, z: laneZ });
    const dist = (p) => Math.hypot(p.x - L.x, p.y - L.y, p.z - L.z);
    const dmin = Math.max(2, Math.abs(laneZ - L.z));
    for (let i = 0; i < N; i++) {
      const tau = (i / (N - 1)) * d;
      const r0 = dist(pos(tau)), r1 = dist(pos(tau + 0.01));
      const vr = (r1 - r0) / 0.01;
      fac[i] = c / (c + vr);
      const fade = Math.min(1, tau / 0.4, (d - tau) / 0.5);
      amp[i] = Math.max(0, Math.pow(Math.min(1, dmin / r0), 1.25) * fade);
      // 聲音從防火門的玻璃滲進來：方位只在門附近 ±6 m 移動
      px[i] = center.x + clamp(pos(tau).x - center.x, -6, 6);
    }
    const engF = new Float32Array(N), tyreF = new Float32Array(N);
    for (let i = 0; i < N; i++) { engF[i] = 88 * fac[i]; tyreF[i] = 520 * fac[i]; }
    const glass = v.bq('lowpass', 680, 0.8);
    const res = v.bq('peaking', 230, 1.2, 4);
    const env = v.g(0);
    env.gain.setValueCurveAtTime(amp, t, d);
    v.chain(env, res, glass);
    // 方位：自行建立 panner（rolloff 0：距離衰減由上面的包絡負責）
    const p = v.track(E.makePanner({ x: px[0], y: 1.3, z: center.z }, { rolloff: 0 }));
    if (p.positionX) p.positionX.setValueCurveAtTime(px, t, d);
    glass.connect(p); p.connect(v.out);
    const e1 = v.osc('sawtooth', engF[0], t, t + d + 0.1);
    e1.frequency.setValueCurveAtTime(engF, t, d);
    const e2 = v.osc('sawtooth', engF[0] * 2.01, t, t + d + 0.1);
    const e2f = new Float32Array(N); for (let i = 0; i < N; i++) e2f[i] = engF[i] * 2.01;
    e2.frequency.setValueCurveAtTime(e2f, t, d);
    const eg = v.g(0.32), e2g = v.g(0.14);
    v.chain(e1, eg, v.bq('lowpass', 420, 0.8), env); v.chain(e2, e2g, eg);
    const ty = v.noise('pink', t, t + d + 0.1);
    const tbp = v.bq('bandpass', 520, 0.6);
    tbp.frequency.setValueCurveAtTime(tyreF, t, d);
    v.chain(ty, tbp, v.g(1.1), env);
    const wh = v.noise('white', t, t + d + 0.1);
    v.chain(wh, v.bq('bandpass', 1300, 0.7), v.g(0.25), env);
    v.send(glass, 'corridor', 0.35);
    return d + 0.6;
  },

  // 總開關推上：巨大但被包住的金屬聲 → 電流回升
  breaker(v, t, o, E) {
    const out = v.out;
    const cr = stickSlip(v, t, 0.18, { fLo: 24, fHi: 36, res: [[520, 8, 1], [990, 10, 0.4]], grit: 0.05 });
    const cg = v.g(0); asr(cg.gain, t, 0.08, 0.04, 0.08, 0.06);
    v.chain(cr, cg, out);
    const tc = t + 0.18;
    const body = v.bq('lowpass', 1500, 0.7); body.connect(out);
    thud(v, body, tc, { f: 56, f1: 38, peak: 1.0, tc: 0.18, glideT: 0.25, noise: 0.7, noiseLp: 350, noiseTc: 0.05 });
    tone(v, body, tc, 112, 0.4, 0.08, { f1: 80, glideT: 0.1 });
    click(v, body, tc, { f: 2200, Q: 0.6, peak: 0.35, tc: 0.006, type: 'lowpass' });
    ring(v, body, tc, [[187, 0.24, 0.5], [452, 0.16, 0.35], [968, 0.09, 0.2], [1712, 0.05, 0.12]]);
    for (let i = 0; i < 5; i++) click(v, out, tc + rand(0.04, 0.32), { f: rand(2000, 3200), Q: 2, peak: rand(0.03, 0.07), tc: 0.002 });
    v.send(body, 'corridor', 0.6);
    const h = v.osc(humWave(v), 60, tc + 0.5, t + 3.6);
    const hg = v.g(0);
    hg.gain.setValueAtTime(0, tc + 0.5);
    hg.gain.linearRampToValueAtTime(0.26, tc + 1.6);
    hg.gain.setTargetAtTime(0, tc + 2.0, 0.5);
    v.chain(h, v.bq('lowpass', 600, 0.7), hg, out);
    return 4.2;
  },

  fanSpinUp(v, t, o) { return fan(v, t, Math.max(1, o.duration || 4), true); },
  fanSpinDown(v, t, o) { return fan(v, t, Math.max(0.6, o.duration || 5), false); },

  // 筆尖在紙上書寫（持續 opts.duration 秒）
  penScratch(v, t, o) {
    const d = Math.max(0.3, o.duration || 2);
    const out = v.out;
    const n = v.noise('white', t, t + d + 0.2);
    const sg = v.g(0);
    v.chain(n, v.bq('highpass', 2200, 0.7), v.bq('bandpass', 4300, 0.9), sg, out);
    const body = v.g(0.32);
    v.chain(sg, v.bq('bandpass', 1200, 0.7), body, out);
    const p = sg.gain;
    p.setValueAtTime(0, t);
    let x = t + rand(0.02, 0.08);
    while (x < t + d - 0.08) {
      const len = Math.min(rand(0.07, 0.32), t + d - x - 0.04);
      const pk = rand(0.35, 0.6);
      let y = x;
      while (y < x + len) { p.setTargetAtTime(pk * rand(0.35, 1), y, 0.003); y += rand(0.009, 0.016); }
      p.setTargetAtTime(0, x + len, 0.006);
      if (chance(0.4)) click(v, out, x, { f: 900, Q: 1, peak: 0.12, tc: 0.003 });
      x += len + rand(0.03, 0.16);
    }
    return d + 0.25;
  },

  // 趴倒在桌上
  bodySlump(v, t) {
    const out = v.out;
    hiss(v, out, t, { color: 'pink', f: 1100, Q: 0.6, peak: 0.3, a: 0.18, hold: 0.15, r: 0.3 });
    const cr = stickSlip(v, t + 0.05, 0.25, { fLo: 30, fHi: 44, res: [[720, 10, 1], [1310, 12, 0.35]], grit: 0.04 });
    const cg = v.g(0); asr(cg.gain, t + 0.05, 0.1, 0.05, 0.1, 0.12);
    v.chain(cr, cg, out);
    const th = t + 0.38;
    thud(v, out, th, { f: 78, f1: 48, peak: 0.7, tc: 0.09, noise: 0.42, noiseLp: 260, noiseTc: 0.04 });
    tone(v, out, th, 210, 0.15, 0.02, { f1: 160, glideT: 0.03 });
    thud(v, out, t + 0.57, { f: 90, f1: 55, peak: 0.35, tc: 0.06, noise: 0.22, noiseLp: 300, noiseTc: 0.03 });
    const exLp = v.bq('lowpass', 1400, 0.7); exLp.connect(out);
    hiss(v, exLp, t + 0.6, { f: 650, Q: 0.8, peak: 0.12, a: 0.08, hold: 0.1, r: 0.7 });
    v.send(out, 'room', 0.15);
    return 2.0;
  },

  // 手電筒開關
  flashlight(v, t) {
    const out = v.out;
    click(v, out, t, { f: 3300, Q: 1.8, peak: 0.4, tc: 0.0016 });
    tone(v, out, t, 2250, 0.05, 0.008);
    tone(v, out, t, 300, 0.08, 0.01);
    click(v, out, t + 0.022, { f: 2500, Q: 1.5, peak: 0.2, tc: 0.002 });
    return 0.35;
  },

  // CRT 啟動的消磁悶響（柔和）
  crtBoot(v, t) {
    const out = v.out;
    tone(v, out, t, 72, 0.5, 0.12, { f1: 52, glideT: 0.15, a: 0.006 });
    const h = v.osc(humWave(v, [1, 0.8, 0.5, 0.3, 0.2]), 60, t, t + 2.2);
    const hg = v.g(0);
    hg.gain.setValueAtTime(0, t);
    hg.gain.linearRampToValueAtTime(0.42, t + 0.05);
    hg.gain.setTargetAtTime(0, t + 0.12, 0.33);
    const am = v.g(0.75), wo = v.osc('sine', 7, t, t + 2.2), wd = v.g(0.25); wo.connect(wd).connect(am.gain);
    v.chain(h, v.bq('lowpass', 900, 0.7), hg, am, out);
    const w = v.osc('sine', 15734, t + 0.1, t + 3.4);
    const wg = v.g(0);
    wg.gain.setValueAtTime(0, t + 0.1);
    wg.gain.linearRampToValueAtTime(0.011, t + 1.3);
    wg.gain.setTargetAtTime(0, t + 2.3, 0.3);
    v.chain(w, wg, out);
    for (let i = 0; i < 6; i++) click(v, out, t + rand(0.3, 1.1), { f: 6000, Q: 0.8, peak: rand(0.03, 0.06), tc: 0.0015, type: 'highpass' });
    v.send(out, 'room', 0.12);
    return 3.6;
  },

  // 中等音量的雜訊爆音（快速淡出）
  staticBurst(v, t) {
    const out = v.out;
    const n = v.noise('white', t, t + 1.3);
    const g = v.g(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.12);
    g.gain.setTargetAtTime(0, t + 0.16, 0.2);
    v.chain(n, v.bq('bandpass', 1800, 0.5), v.bq('highpass', 300, 0.7), g, out);
    let x = t + 0.02;
    while (x < t + 0.6) { click(v, out, x, { f: 3500, Q: 0.7, peak: rand(0.05, 0.25) * (1 - (x - t) / 0.7), tc: 0.002, type: 'highpass' }); x += rand(0.02, 0.07); }
    return 1.4;
  },

  // 悶在面罩裡的咳嗽
  cough(v, t) {
    const d = coughGroup(v, v.out, t, {});
    v.send(v.out, 'room', 0.1);
    return d + 0.2;
  },

  // 門外破門斧劈在鋼門上的悶響（隔著厚鋼門，低沉、被包住）
  doorThud(v, t) {
    const c = v.conv('door');
    const pre = v.g(1);
    v.chain(pre, c, v.g(DOOR_IR_GAIN), v.out);
    axeHit(v, pre, t, 1);
    tone(v, v.out, t + 0.004, 48, 0.22, 0.16, { a: 0.006 });
    v.send(v.out, 'room', 0.14);
    return 1.8;
  },

  // 監視系統「動態偵測」提示（docs/pacing/spec.md §3.2 / §6.5）：控制台 CAM 按鈕上的輕微繼電器喀噠，
  // 接兩個低通過的柔和正弦短音（1046 → 784 Hz，起音 12 ms）。已知的設備 UI 音，不是驚嚇音；座位上峰值 ≤ -28 dBFS。
  vmdTone(v, t) {
    const lp = v.bq('lowpass', 2400, 0.7);
    v.chain(lp, v.out);
    click(v, lp, t, { f: 1800, Q: 1.2, peak: 0.12, tc: 0.003 });
    tone(v, lp, t + 0.09, 1046, 0.05, 0.035, { a: 0.012 });
    tone(v, lp, t + 0.25, 784, 0.045, 0.045, { a: 0.012 });
    v.send(v.out, 'room', 0.12);
    return 0.8;
  },

  // 02:05：隔著防爆門、戴手套的拳頭輕輕敲門（低通 520 Hz ＋ 'door' 捲積；第一下較輕 0.7×）。
  // o: { count = 3, amp = 1 }。只有這個聲音，不疊任何提示音；座位上峰值 ≤ -28 dBFS。
  doorKnock(v, t, o = {}) {
    const amp = Number.isFinite(Number(o.amp)) ? Number(o.amp) : 1;
    const count = Math.max(1, Math.round(Number(o.count) || 3));
    const pre = v.g(1);
    v.chain(pre, v.bq('lowpass', 520, 0.7), v.conv('door'), v.g(DOOR_IR_GAIN), v.out);
    knockSet(v, pre, t, { count: 1, amp: 0.7 * amp });
    if (count > 1) knockSet(v, pre, t + 0.3, { count: count - 1, spacing: 0.3, amp });
    v.send(v.out, 'room', 0.12);
    return 2.2;
  },
};

/** 風扇啟動/停止（獨立 one-shot；與 setVent 層互補）。 */
function fan(v, t, d, up) {
  const out = v.out;
  const lo = 1.8, hi = 26;
  const f0 = up ? lo : hi, f1 = up ? hi : lo;
  const bl = v.osc('sawtooth', f0, t, t + d + 1);
  bl.frequency.setValueAtTime(f0, t);
  bl.frequency.exponentialRampToValueAtTime(f1, t + d);
  const blg = v.g(0);
  const n = v.noise('pink', t, t + d + 1);
  const lp = v.bq('lowpass', up ? 150 : 1900, 0.5);
  lp.frequency.setValueAtTime(up ? 150 : 1900, t);
  lp.frequency.exponentialRampToValueAtTime(up ? 1900 : 120, t + d);
  const am = v.g(0.8);
  const ao = v.osc('sine', f0, t, t + d + 1);
  ao.frequency.setValueAtTime(f0, t);
  ao.frequency.exponentialRampToValueAtTime(f1, t + d);
  const ad = v.g(0.2); ao.connect(ad).connect(am.gain);
  const ng = v.g(0);
  const wh = v.osc('sine', up ? 180 : 620, t, t + d + 1);
  wh.frequency.setValueAtTime(up ? 180 : 620, t);
  wh.frequency.exponentialRampToValueAtTime(up ? 620 : 110, t + d);
  const whg = v.g(0);
  if (up) {
    blg.gain.setValueAtTime(0, t); blg.gain.linearRampToValueAtTime(0.5, t + d);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.75, t + d);
    whg.gain.setValueAtTime(0, t); whg.gain.linearRampToValueAtTime(0.03, t + d * 0.7);
    for (const g of [blg, ng, whg]) g.gain.setTargetAtTime(0, t + d, 0.3);
  } else {
    blg.gain.setValueAtTime(0, t); blg.gain.linearRampToValueAtTime(0.5, t + 0.3); blg.gain.linearRampToValueAtTime(0.0001, t + d);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.75, t + 0.3); ng.gain.setTargetAtTime(0, t + 0.4, d * 0.28);
    whg.gain.setValueAtTime(0, t); whg.gain.linearRampToValueAtTime(0.03, t + 0.3); whg.gain.setTargetAtTime(0, t + 0.4, d * 0.25);
  }
  v.chain(bl, v.bq('lowpass', 180, 1.5), blg, out);
  v.chain(n, lp, am, ng, out);
  v.chain(wh, whg, out);
  return d + 1.2;
}

// ---------------------------------------------------------------------------
// 腳步
// ---------------------------------------------------------------------------
const SURF = {
  vinyl: { lp: 1500, thump: 0.6, heel: 0.55, scuffF: 950, scuffQ: 0.8, scuff: 0.26, verb: ['room', 0.1] },
  concrete: { lp: 2500, thump: 0.5, heel: 0.75, scuffF: 1700, scuffQ: 0.7, scuff: 0.34, grit: true, damp: true, verb: ['corridor', 0.13] },
  metal: { lp: 3200, thump: 0.45, heel: 0.68, scuffF: 2100, scuffQ: 0.9, scuff: 0.24, ring: true, verb: ['corridor', 0.16] },
};

/** 每一步隨機化的參數（回音會重用同一組 → 「同一步」）。 */
export function makeStepParams(surface = 'concrete', intensity = 1, foot = 0) {
  const s = SURF[surface] ? surface : 'concrete';
  const S = SURF[s];
  const p = {
    surface: s, intensity: clamp(Number(intensity) || 1, 0.3, 1.5),
    gain: rand(0.82, 1.12), lp: S.lp * rand(0.85, 1.15), heelTc: rand(0.012, 0.02),
    thumpF: rand(80, 104), scuffDelay: rand(0.035, 0.085), scuffDur: rand(0.07, 0.15), scuffF: S.scuffF * rand(0.85, 1.2),
    grit: [], squeak: s === 'vinyl' && chance(0.15), ringJ: rand(0.94, 1.06), pan: foot ? 0.07 : -0.07,
  };
  if (S.grit) { const n = 3 + ((Math.random() * 5) | 0); for (let i = 0; i < n; i++) p.grit.push([rand(0, 0.12), rand(2500, 5200), rand(0.05, 0.18)]); }
  return p;
}

/** 播放一步。opts.echo → 低通 1.2 kHz、大量廊道殘響（輸出接到「身後」的 panner）。 */
export function playStep(v, t, p, { echo = false, heavy = false } = {}) {
  const S = SURF[p.surface];
  const k = p.intensity;
  const pre = echo ? v.bq('lowpass', 1200, 0.7) : v.g(1);
  pre.connect(v.out);
  // 鞋跟撞擊
  click(v, pre, t, { f: p.lp, Q: 0.7, peak: S.heel * k, tc: p.heelTc, a: 0.0015, type: 'lowpass' });
  tone(v, pre, t, p.thumpF * (heavy ? 0.82 : 1), S.thump * k * (heavy ? 1.25 : 1), heavy ? 0.04 : 0.03, { f1: p.thumpF * 0.62, glideT: 0.05, a: 0.002 });
  // 腳掌滾動摩擦
  hiss(v, pre, t + p.scuffDelay, { color: 'pink', f: p.scuffF, Q: S.scuffQ, peak: S.scuff * k, a: 0.018, hold: p.scuffDur * 0.4, r: p.scuffDur * 0.6 });
  for (const [dt, f, a] of p.grit) click(v, pre, t + dt, { f, Q: 1.5, peak: a * k, tc: 0.0012 });
  if (S.damp) hiss(v, pre, t + 0.01, { color: 'brown', f: 600, Q: 1, peak: 0.12 * k, a: 0.01, hold: 0.02, r: 0.06 });
  if (S.ring) {
    ring(v, pre, t, [[430, 0.07, 0.09], [1130, 0.05, 0.06], [2390, 0.03, 0.04], [3410, 0.02, 0.025]], { scale: k, detune: 0.01 });
    tone(v, pre, t, 170 * p.ringJ, 0.12 * k, 0.05);
  }
  if (p.squeak && !echo) {
    const ts = t + p.scuffDelay + 0.02;
    const o = v.osc('sine', 2300, ts, ts + 0.06);
    o.frequency.setValueAtTime(2300, ts); o.frequency.linearRampToValueAtTime(2900, ts + 0.03);
    const g = v.g(0); asr(g.gain, ts, 0.03, 0.006, 0.015, 0.012);
    v.chain(o, g, pre);
  }
  if (echo) v.send(pre, 'corridor', 0.22, 'footsteps');
  else v.send(pre, S.verb[0], S.verb[1], 'footsteps');
  return 0.45;
}

// ---------------------------------------------------------------------------
// 廊道隨機環境事件（由 CorridorLayer 排程，定位在聽者周圍的隨機方向）
// ---------------------------------------------------------------------------
export const AMBIENT = {
  // 遠處滴水：上揚的「plink」＋ 細小水花，濕重的殘響
  drip(v, t) {
    const one = (tt, a) => {
      const f0 = rand(900, 1700);
      const o = v.osc('sine', f0, tt, tt + 0.12);
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f0 * rand(1.6, 2.4), tt + rand(0.012, 0.03));
      const g = v.g(0); perc(g.gain, tt, 0.5 * a, 0.001, rand(0.01, 0.024));
      v.chain(o, g, v.out);
      click(v, v.out, tt, { f: 3000, Q: 1, peak: 0.12 * a, tc: 0.001 });
    };
    one(t, 1);
    if (chance(0.3)) one(t + rand(0.08, 0.25), rand(0.4, 0.7));
    v.send(v.out, 'corridor', 1.1, 'ambience');
    return 0.6;
  },
  // 管線輕響
  pipeTick(v, t) {
    click(v, v.out, t, { f: rand(3500, 4800), Q: 2, peak: 0.3, tc: 0.0015 });
    ring(v, v.out, t, [[2150, 0.1, 0.03], [3480, 0.07, 0.022], [5600, 0.04, 0.012]], { detune: 0.06 });
    if (chance(0.3)) { const t2 = t + rand(0.1, 0.5); click(v, v.out, t2, { f: 4000, Q: 2, peak: 0.15, tc: 0.0015 }); }
    v.send(v.out, 'corridor', 0.9, 'ambience');
    return 0.8;
  },
  // 極遠處的金屬呻吟（鋼構件熱應力）
  groan(v, t) {
    const d = rand(2.2, 3.6);
    const mix = stickSlip(v, t, d, { fLo: 18, fHi: 34, res: [[180, 14, 1], [410, 16, 0.6], [690, 18, 0.25]], step: [0.25, 0.5], grit: 0.03 });
    const g = v.g(0);
    asr(g.gain, t, 0.35, d * 0.35, d * 0.25, d * 0.4);
    v.chain(mix, v.bq('lowpass', 700, 0.7), g, v.out);
    v.send(g, 'corridor', 1.3, 'ambience');
    return d + 0.6;
  },
};
