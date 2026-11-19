// =============================================================================
// layers.js — 持續音層（冪等、全部以 setTargetAtTime 平滑過渡）
//   每一層在 level > 0 時才建立節點；level 歸零並淡出完畢後自動拆除（省 CPU）。
//   排程型的層（心跳、對講機鈴聲、廊道隨機事件、日光燈劈啪）在 tick(now) 以
//   AudioContext 時間做 look-ahead 排程：暫停（suspend）時自然凍結。
// =============================================================================
import { Voice } from './Voice.js';
import { glide, rand, clamp, periodicWave, perc } from './dsp.js';

// ---------------------------------------------------------------------------
export class Layer {
  constructor(E, busName, scale) {
    this.E = E;
    this.busName = busName;
    this.scale = scale;
    this.target = 0;
    this.on = false;
    this.v = null;
    this._killAt = 0;
  }
  /** 對外：設定目標音量（0..~1.5），ramp 秒內平滑到達。 */
  set(level, ramp = 1) {
    this.target = clamp(Number(level) || 0, 0, 1.5);
    this.ramp = Math.max(0.15, Number(ramp) || 0.15);
    if (!this.E.ready) return;
    const now = this.E.now();
    if (this.target > 0 && !this.on) this._start(now);
    if (!this.on) return;
    glide(this.v.gainParam, this.target * this.scale, now, this.ramp);
    this._killAt = this.target > 0 ? 0 : now + this.ramp * 1.8 + 0.25;
    this.onSet?.(now);
  }
  get active() { return this.on && (this.target > 0 || this._killAt > 0); }
  tick(now) {
    if (this.on && this._killAt && now >= this._killAt) this._teardown();
  }
  _start(now) {
    const dest = this.destNode ? this.destNode() : this.E.bus[this.busName];
    this.v = new Voice(this.E, dest, { gain: 0, bus: this.busName });
    this.build(this.v, now);
    this.on = true;
  }
  _teardown() {
    this.on = false;
    this._killAt = 0;
    try { this.v?.kill(); } catch { /* ignore */ }
    this.v = null;
    this.onTeardown?.();
  }
  /** 兩個去相關的單聲道噪音 → 立體聲。 */
  stereoNoise(v, color, now) {
    const m = v.merger(2);
    v.noise(color, now).connect(m, 0, 0);
    v.noise(color, now).connect(m, 0, 1);
    return m;
  }
  build() {}
}

// ---------------------------------------------------------------------------
// 日光燈電流嗡鳴：60/120/180/240 Hz ＋ 120 Hz 調幅的 2–4 kHz 細微蜂鳴 ＋ 稀疏劈啪
// ---------------------------------------------------------------------------
export class HumLayer extends Layer {
  constructor(E) { super(E, 'ambience', 0.0133); this._nextCrackle = 0; }
  build(v, now) {
    const ac = v.ac;
    const wave = periodicWave(ac, [1, 0.62, 0.34, 0.2]);
    // 左右聲道相差 0.06 Hz → 極緩慢的空間游移（像整排燈管）
    const m = v.merger(2);
    const oL = v.osc(wave, 60, now), oR = v.osc(wave, 60.06, now);
    this.oL = oL; this.oR = oR;
    oL.connect(m, 0, 0); oR.connect(m, 0, 1);
    const tone = v.g(1);
    const wander = v.osc('sine', 0.13, now), wg = v.g(0.07);
    wander.connect(wg).connect(tone.gain);
    m.connect(tone).connect(v.out);
    // 2–4 kHz 蜂鳴：被 120 Hz 調幅
    const n = v.noise('white', now);
    const bp = v.bq('bandpass', 3000, 1.1), hp = v.bq('highpass', 1900, 0.7);
    const am = v.g(0.5);
    const mod = v.osc('sine', 120, now), md = v.g(0.5);
    mod.connect(md).connect(am.gain);
    const buzz = v.g(0.16);
    this.buzz = buzz;
    v.chain(n, bp, hp, am, buzz, v.out);
    this._nextCrackle = now + rand(1.5, 5);
  }
  tick(now) {
    super.tick(now);
    if (!this.on || this.target <= 0) return;
    if (now >= this._nextCrackle) {
      this._nextCrackle = now + rand(2.2, 9);
      this.E.spawn((v, t) => {
        // 細小的鎮流器劈啪：1–3 個極短的高頻顆粒
        const k = 1 + ((Math.random() * 3) | 0);
        for (let i = 0; i < k; i++) {
          const tt = t + i * rand(0.012, 0.05);
          const s = v.noise('white', tt, tt + 0.02);
          const f = v.bq('bandpass', rand(2500, 5200), 1.4);
          const g = v.g(0);
          perc(g.gain, tt, rand(0.25, 0.6), 0.0006, rand(0.0015, 0.004));
          v.chain(s, f, g, v.out);
        }
        return 0.25;
      }, { bus: 'ambience', gain: 0.05 * Math.min(1, this.target) });
    }
  }
}

// ---------------------------------------------------------------------------
// 通風扇：粉紅噪音（轉速→濾波截止）＋ 葉片音（鋸齒波×低通）＋ 葉片頻率的調幅；detune → 不穩、下滑
// ---------------------------------------------------------------------------
export class VentLayer extends Layer {
  constructor(E) { super(E, 'ambience', 0.104); this.rate = 1; this.detune = 0; }
  bladeHz(rate = this.rate, detune = this.detune) { return 26 * Math.max(0.04, rate) * (1 - 0.3 * detune); }
  build(v, now) {
    const bf = this.bladeHz();
    // 氣流噪音（立體聲）
    const nz = this.stereoNoise(v, 'pink', now);
    this.lp = v.bq('lowpass', this.cutoff(), 0.5);
    const hp = v.bq('highpass', 38, 0.7);
    this.am = v.g(0.8);
    this.noiseG = v.g(0.55 + 0.45 * this.rate);
    v.chain(nz, this.lp, hp, this.am, this.noiseG, v.out);
    // 馬達低頻
    const br = this.stereoNoise(v, 'brown', now);
    const blp = v.bq('lowpass', 150, 0.6);
    this.rumbleG = v.g(0.55);
    v.chain(br, blp, this.rumbleG, v.out);
    // 葉片音：兩個鋸齒波（低轉速時產生拍頻）
    this.b1 = v.osc('sawtooth', bf, now);
    this.b2 = v.osc('sawtooth', bf + this.beat(), now);
    const blp2 = v.bq('lowpass', 170, 1.6);
    this.bladeG = v.g(this.bladeLevel());
    this.b1.connect(blp2); this.b2.connect(blp2);
    v.chain(blp2, this.bladeG, v.out);
    // 葉片頻率調幅
    this.amOsc = v.osc('sine', bf, now);
    this.amDepth = v.g(0.2);
    v.chain(this.amOsc, this.amDepth, this.am.gain);
    // 變調：兩個不相干的慢速 LFO → 頻率與濾波搖擺
    const l1 = v.osc('sine', 0.29, now), l2 = v.osc('sine', 0.47, now);
    const lmix = v.g(1); const l2g = v.g(0.6);
    l1.connect(lmix); l2.connect(l2g).connect(lmix);
    this.wobF = v.g(this.detune * bf * 0.14);
    this.wobC = v.g(this.detune * 240);
    lmix.connect(this.wobF);
    this.wobF.connect(this.b1.frequency); this.wobF.connect(this.b2.frequency); this.wobF.connect(this.amOsc.frequency);
    lmix.connect(this.wobC).connect(this.lp.frequency);
  }
  cutoff() { return 260 + 1650 * Math.pow(clamp(this.rate, 0, 1.4), 1.2); }
  beat() { return 0.15 + (1 - clamp(this.rate, 0, 1)) * 1.7; }
  bladeLevel() { return 0.42 * (0.7 + 0.8 * (1 - clamp(this.rate, 0, 1))); }
  setParams({ level = 0.5, rate = 1, detune = 0 } = {}, ramp = 2) {
    const lv = clamp(Number(level) || 0, 0, 1.5);
    if (lv <= 0 && this.on) {
      // 停機：保持目前的變調，轉速隨淡出一起往下掉（不會因為預設 rate=1 而在淡出時升高）
      this.rate = Math.min(this.rate, 0.2);
      this.detune = Math.max(this.detune, clamp(Number(detune) || 0, 0, 1));
    } else {
      this.rate = clamp(Number(rate) || 0, 0, 1.4);
      this.detune = clamp(Number(detune) || 0, 0, 1);
    }
    this.set(lv, ramp);
  }
  onSet(now) {
    const r = this.ramp, bf = this.bladeHz();
    glide(this.b1.frequency, bf, now, r);
    glide(this.b2.frequency, bf + this.beat(), now, r);
    glide(this.amOsc.frequency, bf, now, r);
    glide(this.lp.frequency, this.cutoff(), now, r);
    glide(this.noiseG.gain, 0.55 + 0.45 * Math.min(1, this.rate), now, r);
    glide(this.bladeG.gain, this.bladeLevel(), now, r);
    glide(this.wobF.gain, this.detune * bf * 0.14, now, r);
    glide(this.wobC.gain, this.detune * 240, now, r);
    glide(this.amDepth.gain, 0.14 + 0.16 * this.detune, now, r);
  }
}

// ---------------------------------------------------------------------------
// 房間底噪：極低頻空氣感＋淡淡的空調殘響
// ---------------------------------------------------------------------------
export class RoomToneLayer extends Layer {
  constructor(E) { super(E, 'ambience', 0.024); }
  build(v, now) {
    const br = this.stereoNoise(v, 'brown', now);
    v.chain(br, v.bq('lowpass', 240, 0.6), v.g(1), v.out);
    const pk = this.stereoNoise(v, 'pink', now);
    v.chain(pk, v.bq('bandpass', 170, 0.6), v.g(0.32), v.out);
    const air = this.stereoNoise(v, 'pink', now);
    v.chain(air, v.bq('highpass', 1800, 0.6), v.bq('lowpass', 5500, 0.6), v.g(0.035), v.out);
  }
}

// ---------------------------------------------------------------------------
// 廊道環境：暗沉的空氣＋極遠處的低頻隆隆＋隨機排程（滴水、管線輕響、遠處金屬呻吟）
// ---------------------------------------------------------------------------
export class CorridorLayer extends Layer {
  constructor(E) { super(E, 'ambience', 0.033); this._next = {}; }
  build(v, now) {
    const br = this.stereoNoise(v, 'brown', now);
    v.chain(br, v.bq('lowpass', 115, 0.6), v.g(1), v.out);
    const far = this.stereoNoise(v, 'brown', now);
    const fl = v.bq('lowpass', 48, 0.9);
    const fg = v.g(0.9);
    const lfo = v.osc('sine', 0.045, now), ld = v.g(0.6);
    lfo.connect(ld).connect(fg.gain);
    v.chain(far, fl, fg, v.out);
    const air = this.stereoNoise(v, 'pink', now);
    v.chain(air, v.bq('bandpass', 420, 0.5), v.g(0.12), v.out);
    this._next = { drip: now + rand(0.8, 2.5), tick: now + rand(3, 8), groan: now + rand(14, 26), drip2: now + rand(4, 9) };
  }
  tick(now) {
    super.tick(now);
    if (!this.on || this.target <= 0) return;
    const L = this.target;
    const N = this._next;
    if (now >= N.drip) { N.drip = now + rand(1.5, 6); this.E.ambientEvent('drip', L); }
    if (now >= N.drip2) { N.drip2 = now + rand(3.5, 11); this.E.ambientEvent('drip', L * 0.7); }
    if (now >= N.tick) { N.tick = now + rand(4, 12); this.E.ambientEvent('pipeTick', L); }
    if (now >= N.groan) { N.groan = now + rand(18, 40); this.E.ambientEvent('groan', L); }
  }
}

// ---------------------------------------------------------------------------
// 隧道深處低頻轟鳴：棕噪音低通 ~80 Hz ＋ 緩慢 LFO
// ---------------------------------------------------------------------------
export class RumbleLayer extends Layer {
  constructor(E) { super(E, 'ambience', 0.094); }
  build(v, now) {
    const a = this.stereoNoise(v, 'brown', now);
    const g1 = v.g(0.62);
    const l1 = v.osc('sine', 0.06, now), d1 = v.g(0.34);
    l1.connect(d1).connect(g1.gain);
    v.chain(a, v.bq('lowpass', 80, 0.8), g1, v.out);
    const b = this.stereoNoise(v, 'brown', now);
    const g2 = v.g(0.5);
    const l2 = v.osc('sine', 0.11, now), d2 = v.g(0.3);
    l2.connect(d2).connect(g2.gain);
    v.chain(b, v.bq('lowpass', 38, 0.9), g2, v.out);
  }
}

// ---------------------------------------------------------------------------
// 濃煙湧入：迴旋的帶通噪音（濾波器上有 LFO）＋ 低頻湧動
// ---------------------------------------------------------------------------
export class SmokeLayer extends Layer {
  constructor(E) { super(E, 'ambience', 0.12); }
  build(v, now) {
    const pk1 = this.stereoNoise(v, 'pink', now);
    const bp1 = v.bq('bandpass', 380, 0.9);
    const lfo1 = v.osc('sine', 0.13, now), d1 = v.g(190);
    lfo1.connect(d1).connect(bp1.frequency);
    v.chain(pk1, bp1, v.g(1), v.out);
    const pk2 = v.noise('pink', now);
    const bp2 = v.bq('bandpass', 1150, 1.1);
    const lfo2 = v.osc('sine', 0.21, now), d2 = v.g(430);
    lfo2.connect(d2).connect(bp2.frequency);
    const g2 = v.g(0.42);
    let tail = v.chain(pk2, bp2, g2);
    if (typeof v.ac.createStereoPanner === 'function') {
      const sp = v.track(v.ac.createStereoPanner());
      const lp = v.osc('sine', 0.085, now), dp = v.g(0.65);
      lp.connect(dp).connect(sp.pan);
      tail = v.chain(tail, sp);
    }
    tail.connect(v.out);
    const br = this.stereoNoise(v, 'brown', now);
    const g3 = v.g(0.85);
    const lfo3 = v.osc('sine', 0.07, now), d3 = v.g(0.3);
    lfo3.connect(d3).connect(g3.gain);
    v.chain(br, v.bq('lowpass', 130, 0.7), g3, v.out);
    const hs = this.stereoNoise(v, 'white', now);
    v.chain(hs, v.bq('highpass', 2800, 0.6), v.bq('lowpass', 6500, 0.6), v.g(0.05), v.out);
  }
}

// ---------------------------------------------------------------------------
// 低沉雙音警報：方波 ~220/277 Hz 每 0.6 秒交替 → 低通 900 Hz（壓迫、絕不尖銳）
// ---------------------------------------------------------------------------
export class AlarmLayer extends Layer {
  constructor(E) { super(E, 'ambience', 0.08); }
  build(v, now) {
    this.oA = v.osc('square', 248.5, now);
    this.oB = v.osc('square', 248.5, now, null, 7);
    // 0.8333 Hz 方波 LFO → 25 Hz 平滑 → ±28.5 Hz（220 ↔ 277）
    const lfo = v.osc('square', 1 / 1.2, now);
    const smooth = v.bq('lowpass', 25, 0.5);
    this.depth = v.g(28.5);
    v.chain(lfo, smooth, this.depth);
    this.depth.connect(this.oA.frequency); this.depth.connect(this.oB.frequency);
    this.lp = v.bq('lowpass', 900, 0.6);
    const mix = v.g(0.5);
    this.oA.connect(mix); this.oB.connect(mix);
    // 每次換音時極輕微的音量凹陷，讓兩個音像機械警報器般「推」出來
    const env = v.g(1);
    const amLfo = v.osc('sine', 2 / 1.2, now), amD = v.g(0.08);
    amLfo.connect(amD).connect(env.gain);
    v.chain(mix, this.lp, env, v.out);
    v.send(env, 'room', 0.35, 'ambience');
  }
  /** 終幕：音高滑落到 60/120 Hz 並淡出（同時引擎把 hum 淡入）。 */
  morph(duration, now) {
    if (!this.on) return;
    const d = Math.max(0.5, duration);
    for (const [o, f] of [[this.oA, 60], [this.oB, 120]]) {
      o.frequency.cancelScheduledValues(now);
      o.frequency.setValueAtTime(o.frequency.value, now);
      o.frequency.exponentialRampToValueAtTime(f, now + d * 0.85);
    }
    this.depth.gain.cancelScheduledValues(now);
    this.depth.gain.setValueAtTime(this.depth.gain.value, now);
    this.depth.gain.linearRampToValueAtTime(0, now + d * 0.6);
    this.lp.frequency.cancelScheduledValues(now);
    this.lp.frequency.setValueAtTime(this.lp.frequency.value, now);
    this.lp.frequency.exponentialRampToValueAtTime(360, now + d * 0.85);
    // 前半保持音量，後半淡出
    const g = this.v.gainParam;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(this.target * this.scale * 0.8, now, d * 0.2);
    g.setTargetAtTime(0, now + d * 0.45, d * 0.17);
    this.target = 0;
    this._killAt = now + d * 1.3 + 0.6;
  }
}

// ---------------------------------------------------------------------------
// 低頻心跳（look-ahead 排程；被「感覺到」而非聽到）
// ---------------------------------------------------------------------------
export class HeartbeatLayer extends Layer {
  constructor(E) { super(E, 'heartbeat', 0.08); this.bpm = 64; this.bpmTarget = 64; this._next = 0; this._last = 0; }
  build(v, now) {
    this.inp = v.g(1);
    v.chain(this.inp, v.bq('lowpass', 150, 0.6), v.out);
    this._next = now + 0.15;
    this._last = now;
  }
  setBpm(bpm, ramp) { this.bpmTarget = clamp(Number(bpm) || 64, 40, 140); this.bpmRamp = Math.max(0.15, ramp); if (!this.on) this.bpm = this.bpmTarget; }
  tick(now) {
    super.tick(now);
    if (!this.on) return;
    const dt = Math.max(0, now - this._last); this._last = now;
    this.bpm += (this.bpmTarget - this.bpm) * (1 - Math.exp(-dt / Math.max(0.05, (this.bpmRamp || 2) / 3)));
    if (this._next < now) this._next = now + 0.04;
    while (this._next < now + 0.3) {
      this.beat(this._next);
      this._next += (60 / this.bpm) * rand(0.985, 1.015);
    }
  }
  beat(t) {
    const bpm = this.bpm;
    const s2 = 0.31 - (bpm - 60) * 0.0012;
    this.E.spawnInto(this.inp, (v) => {
      // lub
      const o1 = v.osc('sine', 58, t, t + 0.3);
      o1.frequency.setValueAtTime(58, t);
      o1.frequency.exponentialRampToValueAtTime(40, t + 0.11);
      const g1 = v.g(0); perc(g1.gain, t, 1, 0.014, 0.05);
      v.chain(o1, g1, v.out);
      const h1 = v.osc('sine', 96, t, t + 0.12);
      const hg1 = v.g(0); perc(hg1.gain, t, 0.22, 0.008, 0.02);
      v.chain(h1, hg1, v.out);
      // dub
      const t2 = t + s2;
      const o2 = v.osc('sine', 52, t2, t2 + 0.25);
      o2.frequency.setValueAtTime(52, t2);
      o2.frequency.exponentialRampToValueAtTime(39, t2 + 0.09);
      const g2 = v.g(0); perc(g2.gain, t2, 0.72, 0.012, 0.04);
      v.chain(o2, g2, v.out);
      return s2 + 0.35;
    }, t);
  }
}

// ---------------------------------------------------------------------------
// 對講機來電：柔和的週期性雙短音蜂鳴（每 ~2.5 秒），定位在對講機面板
// ---------------------------------------------------------------------------
export class RingLayer extends Layer {
  constructor(E) { super(E, 'voice', 0.09); this._next = 0; }
  destNode() { return this.E.intercomIn; }
  build(v, now) {
    this.inp = v.g(1);
    v.chain(this.inp, v.bq('lowpass', 2200, 0.6), v.out);
    this._next = now + 0.25;
  }
  tick(now) {
    super.tick(now);
    if (!this.on || this.target <= 0) return;
    if (this._next < now) this._next = now + 0.05;
    while (this._next < now + 0.3) {
      const t = this._next;
      this.blipPair(t);
      this._next = t + 2.5;
    }
  }
  blipPair(t) {
    this.E.spawnInto(this.inp, (v) => {
      for (const [dt, amp] of [[0, 1], [0.34, 0.9]]) {
        const tt = t + dt;
        const tri = v.osc('triangle', 587, tt, tt + 0.26);
        const sq = v.osc('square', 1174, tt, tt + 0.26);
        const sqg = v.g(0.08); sq.connect(sqg);
        const mix = v.g(1); tri.connect(mix); sqg.connect(mix);
        // 30 Hz 的「蜂鳴」顫動（像老式電話的振鈴線圈）
        const am = v.g(0.72), buzz = v.osc('square', 30, tt, tt + 0.26), bd = v.g(0.28);
        buzz.connect(bd).connect(am.gain);
        const env = v.g(0);
        env.gain.setValueAtTime(0, tt);
        env.gain.linearRampToValueAtTime(amp, tt + 0.025);
        env.gain.setValueAtTime(amp, tt + 0.17);
        env.gain.linearRampToValueAtTime(0, tt + 0.215);
        v.chain(mix, am, env, v.out);
      }
      return 0.8;
    }, t);
  }
}

