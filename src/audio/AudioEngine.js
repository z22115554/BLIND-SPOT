// =============================================================================
// AudioEngine — Web Audio API 程式化音效引擎（零外部音檔）
// 【API 骨架 / CONTRACT STUB】實作者必須保留下列所有公開方法與回傳型別。
// 所有方法在 unlock() 之前被呼叫都必須安全地無作用（不可丟例外）。
//
// 響度紀律（零跳臉）：
//   * master → DynamicsCompressor（限幅）→ destination；任何單一音效峰值 ≤ 約 -10 dBFS。
//   * 任何層的音量變化都要用 ramp（≥ 0.15 秒），禁止瞬間大音量。
//   * 「恐怖」來自聲音的缺席與錯位（通風停止的真空感、延遲半拍的腳步），而非音量。
// =============================================================================

/**
 * one-shot 音效名稱（sfx(name)）：
 *  'tubeStart'     日光燈啟動器的喀噠聲＋燈管點亮的微弱嗡聲
 *  'relayTrip'     遠處繼電器跳脫的悶響＋電力下降的嗚咽（不可大聲）
 *  'powerUp'       多個繼電器依序吸合＋電流嗡聲回升
 *  'button'        控制台按鈕
 *  'camSwitch'     頻道切換的繼電器喀噠＋CRT 高頻微響
 *  'lever'         金屬拉桿
 *  'unlatch'       門閂/電磁鎖解除
 *  'doorCreak'     厚重鐵門緩慢鉸鏈聲（低沉、長）
 *  'pneumaticHiss' 氣壓閥洩壓
 *  'heavySlide'    防爆門滑動的低頻摩擦（持續 opts.duration 秒）
 *  'paper'         翻動紙張
 *  'mug'           馬克杯放回桌面
 *  'metalTick'     管線熱脹冷縮的輕響
 *  'carPass'       防火門外車輛呼嘯而過（隔著玻璃悶住，多普勒）
 *  'breaker'       總開關推上的巨大但被包住的金屬聲
 *  'fanSpinUp' / 'fanSpinDown'
 *  'penScratch'    筆尖在紙上書寫（持續 opts.duration 秒）
 *  'bodySlump'     趴倒在桌上
 *  'flashlight'    手電筒開關
 *  'crtBoot'       CRT 啟動的消磁悶響（柔和）
 *  'staticBurst'   中等音量的雜訊爆音（快速淡出）
 *  'cough'         悶在面罩裡的咳嗽
 *  'doorThud'      門外破門斧劈在鋼門上的悶響（隔著厚鋼門，低沉、被包住，不可尖銳）
 * opts: { position?: THREE.Vector3（3D 定位，HRTF）, gain?: number, duration?: number }
 */
export class AudioEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.ac = null;      // AudioContext（unlock 後建立）
    this.ready = false;
  }

  /** 必須在使用者手勢（click）的同步呼叫堆疊中呼叫。建立 AudioContext 與整個節點圖。回傳 Promise。 */
  async unlock() { this.ready = true; }
  suspend() {}
  resume() {}
  setMasterVolume(v) {}

  /** 每幀：listener 跟隨 ctx.camera；處理自動化（隨機滴水、管線聲等）。 */
  update(dt, t) {}

  // ---- 持續音層（全部冪等，ramp 秒數內平滑過渡）----------------------------------
  /** 日光燈電流嗡鳴（60Hz 基頻＋諧波＋細微劈啪）。level 0..1 */
  setHum(level, ramp = 1) {}
  /** 通風扇白噪音。level 音量、rate 轉速 0..1（低轉速 = 更低沉、出現拍頻）、detune 變調程度 0..1（音高不穩地下滑）。level 0 = 停止。 */
  setVent({ level = 0.5, rate = 1, detune = 0 } = {}, ramp = 2) {}
  /** 房間底噪（空調殘響、極低頻空氣感）。 */
  setRoomTone(level, ramp = 2) {}
  /** 廊道環境：遠處滴水、管線輕響、極遠處低頻隆隆（隨機排程）。 */
  setCorridorAmbience(level, ramp = 2) {}
  /** 隧道深處低頻轟鳴（火場/車道）。 */
  setTunnelRumble(level, ramp = 3) {}
  /** 低頻心跳（被「感覺到」而非聽到）。bpm 50..110 */
  setHeartbeat(bpm, level, ramp = 2) {}
  /** 聽覺真空：0..1。對除了腳步/心跳/對講機以外的所有層做低通＋壓低，製造耳壓感。 */
  setSilence(amount, ramp = 3) {}
  /** 低沉雙音警報（不可尖銳）。 */
  setAlarm(on, { level = 0.25 } = {}) {}
  /** 終幕：警報音高滑動、變形成日光燈電流聲。回傳 Promise（duration 秒後完成）。 */
  morphAlarmToHum(duration = 6) { return Promise.resolve(); }
  /** 濃煙湧入的呼嘯（濾波噪音）。 */
  setSmokeRoar(level, ramp = 2) {}
  /** 對講機來電：柔和的週期性蜂鳴（定位在對講機面板）。 */
  setIntercomRing(on) {}

  /**
   * 播放對講機語音：stageIndex 0..3 對應 ctx.SCRIPT.intercom[stageIndex]。
   * 依 segments 的 dur 與 kind 合成（static / breath / speech / knock / cough / axe / burst）。
   * speech = 共振峰濾波噪音模擬的人聲呢喃（音節數 ≈ 該段中文字數），clean=false 時再經對講機頻帶（300–3000Hz）與雜訊。
   * @returns {{ duration: number, done: Promise<void> }}
   */
  playIntercom(stageIndex) {
    const segs = this.ctx.SCRIPT.intercom[stageIndex]?.segments || [];
    const duration = segs.reduce((a, s) => a + s.dur, 0);
    return { duration, done: this.ctx.clock.wait(duration) };
  }

  /** 腳步聲（由 'player:step' 事件自動觸發，也可直接呼叫）。surface: 'vinyl' | 'concrete' | 'metal' */
  footstep({ surface = 'concrete', intensity = 1 } = {}) {}
  /** 廊道延遲回音：每步在 delay 秒後播放微弱、低通的鞋底摩擦回音；停下時（'player:stopped'）再多播一步。 */
  setFootstepEcho({ enabled = false, delay = 0.45, gain = 0.35, extraStep = true } = {}) {}

  /** one-shot 音效，見檔頭清單。回傳 { stop() }。 */
  sfx(name, opts = {}) { return { stop() {} }; }
}
