// =============================================================================
// 主控室材質庫：共用材質（全部注入腐化/焦黑效果），依鍵延遲建立。
// UVS = 世界 UV 尺度（公尺 / 一個貼圖週期）。TextureFactory 的貼圖內容尺度若不同，調這裡即可。
// =============================================================================
import * as THREE from 'three';
import { patchSurface } from './surfaceFX.js';
import * as LT from './localTextures.js';

/** 公尺 / 貼圖週期（假設 floorTiles / ceilingTiles 的一張貼圖含 2×2 片 60 cm 天花板 / 4×4 片 30 cm 地磚）。 */
export const UVS = {
  floor: 1.2, chairMat: 1.4, wallLower: 2.2, wallUpper: 2.6, concrete: 2.0, concreteDark: 2.0, stub: 2.2,
  skirting: 1.0, trim: 1.0, acoustic: 1.25, ceiling: 1.2, tbar: 1.0,
  consoleBody: 1.1, consoleTop: 1.2, consoleDark: 1.0, crtHousing: 0.7, crtBezel: 0.7, crtInner: 1.0,
  blackPlastic: 1.0, greyPlastic: 1.0, chrome: 1.0, steelDoor: 1.8, sideDoor: 1.2, frameSteel: 1.0,
  hazard: 0.42, paintedRed: 0.8, panelGrey: 0.8, cabinet: 1.0, fabric: 0.6, pipe: 1.0, grate: 0.5,
  cable: 1.0, cableGrey: 1.0, paper: 1.0, cardboard: 0.6, rubber: 0.8, whiteEnamel: 1.0, darkMetal: 1.0, ceramic: 1.0,
  brass: 1.0, cork: 1.0, alu: 1.0, ledOff: 1.0, extRed: 1.0, plenum: 2.0,
};

export function createMaterials(ctx, U) {
  const tx = ctx.textures;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const tm = (name, o = {}) => {
    try { return tx.material(name, o); } catch (e) { console.warn('[ControlRoom] texture material failed', name, e); return std(o); }
  };
  const local = {};
  const acoustic = () => (local.acoustic ||= LT.acousticTexture());

  const defs = {
    floor: () => tm('floorTiles', { color: 0xc4c8c4, roughness: 0.58, metalness: 0.0 }),
    chairMat: () => tm('rubberMat', { color: 0x6b6d6e, roughness: 0.8 }),
    wallLower: () => tm('concrete', { color: 0x87918b, roughness: 0.9 }),
    wallUpper: () => tm('concrete', { color: 0xbcc0b8, roughness: 0.92 }),
    concrete: () => tm('concrete', { roughness: 0.95 }),
    concreteDark: () => tm('concreteDark', { roughness: 0.96 }),
    stub: () => tm('concreteDark', { color: 0x6a6a66, roughness: 0.97 }),
    skirting: () => tm('rubberMat', { color: 0x3a3b3b, roughness: 0.7 }),
    trim: () => tm('metalPanel', { color: 0x9aa09e, metalness: 0.45, roughness: 0.45 }),
    acoustic: () => std({ map: acoustic(), color: 0xc4cad0, roughness: 0.98 }),
    ceiling: () => tm('ceilingTiles', { roughness: 0.95 }),
    tbar: () => std({ color: 0xcfcfc6, roughness: 0.42, metalness: 0.35 }),
    consoleBody: () => tm('paintedMetal', { color: 0x9aa59f, roughness: 0.55, metalness: 0.25 }),
    consoleTop: () => tm('metalPanel', { color: 0x8c928f, roughness: 0.5, metalness: 0.05 }),
    consoleDark: () => std({ color: 0x26292a, roughness: 0.55, metalness: 0.2 }),
    crtHousing: () => tm('plasticBeige', { color: 0xc8c0aa, roughness: 0.62 }),
    crtBezel: () => tm('crtBezel', { color: 0xb8b2a0, roughness: 0.55 }),
    crtInner: () => std({ color: 0x141516, roughness: 0.45 }),
    blackPlastic: () => std({ color: 0x1d1e1f, roughness: 0.5, metalness: 0.05 }),
    greyPlastic: () => std({ color: 0x5c6063, roughness: 0.5, metalness: 0.05 }),
    chrome: () => std({ color: 0xc9cdd0, roughness: 0.28, metalness: 0.92 }),
    steelDoor: () => tm('steelDoor', { color: 0x9aa49d, roughness: 0.5, metalness: 0.3 }),
    // 側門有自己的門扇貼圖（沒有防爆門的「防爆門 / BLAST DOOR / B區」噴漆），UV 由 buildSideDoor 依門扇尺寸指定
    sideDoor: () => tm('steelDoorSide', { color: 0x8c98a4, roughness: 0.5, metalness: 0.3 }),
    frameSteel: () => tm('metalPanel', { color: 0x8a928e, roughness: 0.45, metalness: 0.35 }),
    hazard: () => tm('hazard', { roughness: 0.6, metalness: 0.1 }),
    paintedRed: () => tm('paintedMetal', { color: 0xb3281f, roughness: 0.5, metalness: 0.2 }),
    panelGrey: () => tm('metalPanel', { color: 0xa3aaa5, roughness: 0.5, metalness: 0.35 }),
    cabinet: () => tm('paintedMetal', { color: 0xa9a698, roughness: 0.55, metalness: 0.25 }),
    fabric: () => tm('fabricSeat', { color: 0x4a5463, roughness: 0.97 }),
    pipe: () => tm('pipe', { roughness: 0.5, metalness: 0.5 }),
    grate: () => tm('grate', { roughness: 0.55, metalness: 0.6 }),
    cable: () => std({ color: 0x18191a, roughness: 0.65 }),
    cableGrey: () => std({ color: 0x6e7174, roughness: 0.6 }),
    paper: () => std({ color: 0xe6e3d8, roughness: 0.92 }),
    cardboard: () => std({ color: 0x8a6e4c, roughness: 0.95 }),
    rubber: () => std({ color: 0x141414, roughness: 0.85 }),
    whiteEnamel: () => std({ color: 0xe4e6e2, roughness: 0.4, metalness: 0.1 }),
    darkMetal: () => std({ color: 0x2b2e2f, roughness: 0.45, metalness: 0.7 }),
    ceramic: () => std({ color: 0xe9e4d8, roughness: 0.32, metalness: 0.0 }),
    brass: () => std({ color: 0xb08d4a, roughness: 0.35, metalness: 0.9 }),
    cork: () => std({ map: (local.cork ||= LT.bulletinTexture()), roughness: 0.95 }),
    alu: () => std({ color: 0xaeb3b5, roughness: 0.35, metalness: 0.85 }),
    ledOff: () => std({ color: 0x1a1414, roughness: 0.3 }),
    extRed: () => std({ color: 0xa8150f, roughness: 0.3, metalness: 0.2 }),
    plenum: () => std({ color: 0x1b1c1c, roughness: 1, side: THREE.BackSide }),
    rack: () => std({ map: (local.rack ||= LT.rackTexture()), roughness: 0.6, metalness: 0.3 }),
  };
  const cache = {};
  const all = [];
  let envMap = null;
  const register = (m) => { if (envMap && !m.envMap) m.envMap = envMap; m.envMapIntensity = 0; all.push(m); return m; };
  const get = (key) => {
    if (!cache[key]) {
      const def = defs[key];
      const m = def ? def() : std({ color: 0x777777 });
      m.name = `cr:${key}`;
      patchSurface(m, U);
      register(m);
      cache[key] = m;
    }
    return cache[key];
  };
  /** 一次性材質（貼圖標籤、面板圖等），一樣注入表面效果。 */
  const make = (opts, name = 'cr:custom') => {
    const m = std(opts);
    m.name = name;
    patchSurface(m, U);
    return register(m);
  };
  /** 指定主控室專用的環境貼圖（只套在主控室材質上，不影響其他場景）。 */
  const setEnvMap = (tex) => { envMap = tex; for (const m of all) { m.envMap = tex; m.needsUpdate = true; } };
  return { get, make, cache, local, all, setEnvMap };
}
