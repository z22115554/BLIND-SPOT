// =============================================================================
// 畫質預設（ctx.quality）— 桌機＝原樣（不改任何東西）；手機／平板＝保守預設
// -----------------------------------------------------------------------------
// 判斷：looksLikeTouchDevice()（主要指標為 coarse 的手機／平板）。?quality=mobile / ?quality=desktop 可強制（測試用）。
// 旋鈕（全部只在 tier === 'mobile' 時生效；燈光數量不變、場景內容不變）：
//   pixelRatioCap     像素比上限（桌機 1.5）。自動解析度調整照常運作（最多再降到 ×0.6）。
//   governor          自動解析度的門檻：slowDt / fastDt（秒）。手機 30～45 fps 是常態，用較寬鬆的門檻，
//                     避免一開始就把解析度降到最低（大約 < 36 fps 才降、> 52 fps 才升）。
//   shadowType        'PCF'：比 PCFSoft 便宜的陰影濾波（只影響手電筒與車燈的陰影邊緣）。
//   shadowMax         陰影貼圖最大邊長（目前所有投影燈都是 512 → 不變；保留給之後新增的燈）。
//   composerSamples   主場景 MSAA 取樣數（PostFX 預設 2；手機維持 2：行動 GPU 的 tile 內解析成本很低）。
//   feedSamples       監視器畫面 render target 的 MSAA（桌機 4 → 手機 0；CCTV 畫面本來就有雜訊與低畫質處理）。
//   feedScale         監視器 render target 尺寸倍率（640×480 → 480×360；CRT 著色器仍以 640×480 的網格取樣）。
//   ashCount / dustCount / smokeCount   粒子上限：車道灰燼 800 → 480、廊道浮塵 320 → 200、終幕濃煙 52 → 40。
// applyQuality(ctx) 在所有模組 init 之後、shader 預先編譯之前呼叫（只做建構後的調整，不改其他模組的原始碼）。
// =============================================================================
import * as THREE from 'three';
import { looksLikeTouchDevice } from './input.js';

export function detectQuality(params) {
  const force = params?.get?.('quality');
  const mobile = force === 'mobile' ? true : force === 'desktop' ? false : looksLikeTouchDevice();
  if (!mobile) return { tier: 'desktop' };
  return {
    tier: 'mobile',
    pixelRatioCap: 1.25,
    governor: { slowDt: 1 / 36, fastDt: 1 / 52 },
    shadowType: 'PCF',
    shadowMax: 512,
    composerSamples: 2,
    feedSamples: 0,
    feedScale: 0.75,
    ashCount: 480,
    dustCount: 200,
    smokeCount: 40,
  };
}

/** 套用到已建構的模組（桌機什麼都不做）。回傳實際套用的項目（除錯用）。 */
export function applyQuality(ctx) {
  const q = ctx.quality;
  const done = [];
  if (!q || q.tier !== 'mobile') return done;
  const step = (name, fn) => { try { if (fn() !== false) done.push(name); } catch (e) { console.warn(`[quality] ${name} failed`, e); } };

  // 主場景 MSAA（composer 的場景目標＝readBuffer；還沒有被使用過才改得動，所以要在預先編譯之前）
  step('composerSamples', () => {
    const rt = ctx.postfx?.composer?.renderTarget2;
    if (!rt || q.composerSamples == null || rt.samples === 0 || rt.samples === q.composerSamples) return false;
    rt.samples = q.composerSamples; rt.dispose();
  });

  // 監視器 render target：MSAA 與尺寸（dispose 後下一次使用時以新設定重新配置；貼圖物件不變，CRT 材質不受影響）
  step('feeds', () => {
    const rts = ctx.feeds?.renderTargets;
    if (!Array.isArray(rts)) return false;
    for (const rt of rts) {
      if (q.feedSamples != null && rt.samples > q.feedSamples) rt.samples = q.feedSamples;
      if (q.feedScale && q.feedScale < 1) rt.setSize(Math.round(rt.width * q.feedScale), Math.round(rt.height * q.feedScale));
      rt.dispose();
    }
  });

  // 陰影貼圖上限
  step('shadowMax', () => {
    let n = 0;
    ctx.scene.traverse((o) => {
      if (!o.isLight || !o.castShadow || !o.shadow) return;
      const m = o.shadow.mapSize;
      if (m.x > q.shadowMax || m.y > q.shadowMax) {
        m.set(Math.min(m.x, q.shadowMax), Math.min(m.y, q.shadowMax));
        o.shadow.map?.dispose?.(); o.shadow.map = null;
        n++;
      }
    });
    return n > 0;
  });

  // 粒子上限（Points 用 drawRange 取前 N 個：位置是亂數生成的，前 N 個就是均勻的子集）
  const capPoints = (name, n) => step(name, () => {
    const o = ctx.scene.getObjectByName(name);
    const g = o?.geometry, total = g?.attributes?.position?.count;
    if (!g || !n || !(total > n)) return false;
    g.setDrawRange(0, n);
  });
  capPoints('ash', q.ashCount);
  capPoints('dustMotes', q.dustCount);
  step('smokeCount', () => {
    const sm = ctx.controlRoom?.smoke;
    if (!sm || !Array.isArray(sm.parts) || !(sm.parts.length > q.smokeCount)) return false;
    if (sm.parts.some((p) => p.alive)) return false;   // 只在還沒有任何煙的時候裁切
    sm.parts.length = q.smokeCount;
  });
  if (ctx.debug) console.info('[quality] mobile preset:', done.join(', ') || '(nothing)');
  return done;
}

/** renderer 建立時就要決定的項目（陰影濾波）。 */
export function rendererQuality(renderer, q) {
  if (q?.tier !== 'mobile') return;
  if (q.shadowType === 'PCF') renderer.shadowMap.type = THREE.PCFShadowMap;
}
