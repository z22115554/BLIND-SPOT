// =============================================================================
// PostFX — EffectComposer 後期處理
// 【API 骨架 / CONTRACT STUB】
// 管線：RenderPass(scene, camera) → 自訂 ShaderPass（暈影 vignette、底片顆粒 film grain、
//       微弱色差 chromatic、淡入淡出 fade、背景變暗 dim、去飽和 desaturate、濃煙 smoke、色調 tint）→ OutputPass
// （場景本身使用 FogExp2 指數霧，由各區域設定 scene.fog.density / color。）
// 光敏感模式（ctx.settings.get('reduceFlicker')）：顆粒改為低振幅、低更新率；色差關閉。
// =============================================================================
import * as THREE from 'three';

export class PostFX {
  constructor(ctx) {
    this.ctx = ctx;
    /** 全部 0..1（tint 為顏色乘數）。直接改值即生效；要平滑請用 to()。 */
    this.params = { vignette: 0.42, grain: 0.07, chromatic: 0.4, fade: 1, dim: 0, desaturate: 0, smoke: 0, tint: new THREE.Color(1, 1, 1), exposure: 1 };
  }
  init() {}
  /** 平滑改變參數（遊戲時間）。@returns {Promise<void>} */
  to(param, value, duration = 1, ease = 'inOut') {
    const from = this.params[param];
    return this.ctx.clock.tween(duration, (k) => { this.params[param] = from + (value - from) * k; }, ease);
  }
  /** fade 1 = 全黑，0 = 正常。@returns {Promise<void>} */
  fadeTo(value, duration = 1, ease = 'inOut') { return this.to('fade', value, duration, ease); }
  setSize(w, h) {}
  render(dt, t) { this.ctx.renderer.render(this.ctx.scene, this.ctx.camera); }
}
