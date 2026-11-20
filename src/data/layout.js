// =============================================================================
// 世界座標佈局（唯一座標來源）— 單位：公尺，Y 軸朝上，右手座標系。
// 主控室玩家面向控制台時面向 -Z（北）。+X 為東。
//
//                       N (-Z)
//        ┌──────── 控制台 / 主 CRT / 電子鐘 ────────┐
//        │                                          │  ← 東牆：通風面板、手電筒箱、側門(→維修廊道)
//  西牆：│ 對講機                                   │
//  防爆門│              主控室 CONTROL ROOM          │════════ 地下公務維修廊道 (往 +X) ═══════╗
//        │                                          │                      ┃防火門(北側玻璃)  ║
//        └──────────────────────────────────────────┘                                         ║轉角
//                                                                                          電閘室
// =============================================================================

export const EYE = { standing: 1.62, seated: 1.2, radius: 0.26 };

// ---- 主控室 -----------------------------------------------------------------
export const CONTROL_ROOM = {
  minX: -4, maxX: 4, minZ: -3.5, maxZ: 3.5, height: 3.0,
  // 控制台桌面
  desk: { minX: -2.6, maxX: 2.6, minZ: -3.1, maxZ: -2.2, topY: 0.78 },
  // 主 CRT：螢幕平面中心與尺寸（螢幕朝 +Z）
  mainScreen: { x: 0, y: 1.32, z: -2.54, w: 0.72, h: 0.54 },
  // 側邊系統監視器（螢幕中心；略為朝內轉 yaw 弧度）
  sideScreens: [
    { x: -1.08, y: 1.22, z: -2.62, w: 0.42, h: 0.32, yaw: 0.28 },  // 左：SYS LOG
    { x: 1.08, y: 1.22, z: -2.62, w: 0.42, h: 0.32, yaw: -0.28 },  // 右：機電狀態
  ],
  // 主 CRT 外殼前緣在 z ≈ -2.52；便利貼貼在外殼右下角
  stickyNote: { x: 0.33, y: 1.0, z: -2.505, size: 0.09, rotZ: -0.06 },
  // 頻道切換按鈕（CAM-01..04），位於桌面前緣的斜面按鈕座上
  camButtons: { y: 0.82, z: -2.36, xs: [-0.36, -0.12, 0.12, 0.36] },
  coffee: { x: 0.78, y: 0.78, z: -2.45 },
  // 終幕：平放在桌面上、正在被寫的便利貼與筆
  endingNote: { x: -0.62, y: 0.781, z: -2.33, size: 0.09 },   // 主 CRT 左側、鍵盤與筆筒之間的空桌面
  // 防爆門緊急解鎖按鈕（控制台左翼，靠防爆門那側）
  unlockButton: { x: -2.05, y: 0.8, z: -2.42 },
  // 牆上 LED 電子鐘（北牆、主 CRT 上方，朝 +Z）
  clock: { x: -0.3, y: 2.3, z: -3.46, w: 0.62, h: 0.22 },   // 略偏左上：趴桌視角才不會被主 CRT 擋住
  chair: { x: 0, z: -1.55 },
  // 防爆門：西牆 x = -4，中心 z、寬、高；開啟時沿 +Z 滑入牆內
  blastDoor: { x: -4, z: -0.2, width: 1.7, height: 2.3, slide: 1.85 },
  // 防爆門旁的緊急對講機（西牆，朝 +X）
  intercom: { x: -3.96, y: 1.45, z: -1.55 },
  // 通風控制面板（東牆，朝 -X）
  ventPanel: { x: 3.96, y: 1.4, z: -1.6 },
  // 側門：東牆 x = 4，門洞 z ∈ [1.4, 2.4]，鉸鏈在 z = 1.4，向外（+X）開
  sideDoor: { x: 4, z: 1.9, width: 1.0, height: 2.1, hingeZ: 1.4 },
  // 緊急手電筒壁掛箱（東牆，朝 -X）
  flashlightBox: { x: 3.96, y: 1.3, z: 0.75 },
  // 天花板日光燈（燈具中心）
  fluorescents: [{ x: -1.7, z: -1.2 }, { x: 1.7, z: -1.2 }, { x: 0, z: 1.8 }],
  // 緊急紅燈
  emergencyLights: [{ x: -3.7, y: 2.82, z: -3.2 }, { x: 3.7, y: 2.82, z: -3.2 }, { x: 0, y: 2.82, z: 3.2 }],
};

// 防爆門外（終幕開門時看得見的漆黑空間；CAM-03 拍攝的 B 區廊道在另一個獨立場景）
export const BLAST_STUB = { minX: -8, maxX: -4, minZ: -1.4, maxZ: 1.0, height: 2.5 };

// ---- 地下公務維修廊道 ---------------------------------------------------------
export const CORRIDOR = {
  // 主廊道：由側門往東延伸
  main: { minX: 4.2, maxX: 40, minZ: 1.2, maxZ: 2.8, height: 2.5 },   // x 4.0~4.2 為共用牆厚
  // 轉角後往南的短廊道（電閘室前轉角）
  leg: { minX: 38.4, maxX: 40, minZ: 2.8, maxZ: 8.0, height: 2.5 },
  // 南側牆腳的排水溝
  ditch: { z: 2.62, width: 0.3 },
  // 防火門：主廊道北牆（z = 1.2），門中心 x；玻璃窗尺寸
  fireDoor: { x: 20, z: 1.2, width: 1.2, height: 2.1, glass: { w: 0.62, h: 0.8, y: 1.45 } },
  // 車燈幻影觸發：玩家第一次走到 x > triggerX（門前約 1.6 m；光斑要先花 ~1.7 秒慢慢亮起，
  // 玩家走過門後約 1.3 m 時才剛好站進光束 → 自己的影子落在右前方南牆的光斑裡）
  headlightTriggerX: 18.4,
  // 關鍵線索位置
  watch: { x: 12.5, y: 0.03, z: 2.6 },                 // 排水溝旁
  logbook: { x: 39.15, y: 0.02, z: 3.6 },              // 電閘室前轉角地上
};

export const SWITCH_ROOM = {
  minX: 36.4, maxX: 42, minZ: 8, maxZ: 13, height: 2.6,
  breaker: { x: 39.2, y: 1.3, z: 12.94 },            // 南牆總開關（朝 -Z）
  coatRack: { x: 41.75, y: 0, z: 10.4 },              // 東牆鐵架（雨衣掛在上面）
};

// 防火門玻璃外的主車道（不可行走，只透過玻璃看見）
export const ROADWAY = { minX: 6, maxX: 36, minZ: -11, maxZ: 1.2, height: 6.5, laneZ: -4.5 };

// ---- 玩家可行走區域（矩形聯集）與門口通道 -------------------------------------
export const WALKABLE = [
  { name: 'controlRoom', minX: -4, maxX: 4, minZ: -3.5, maxZ: 3.5 },
  { name: 'corridor', minX: 4.5, maxX: 40, minZ: 1.2, maxZ: 2.8 },   // 從 4.5 起算，避免穿牆（門口由 PORTALS 銜接）
  { name: 'corridor', minX: 38.4, maxX: 40, minZ: 2.6, maxZ: 8.2 },
  { name: 'switchRoom', minX: 36.4, maxX: 42, minZ: 8, maxZ: 13 },
];
// 門口通道：open = true 時加入可行走聯集
export const PORTALS = {
  sideDoor: { name: 'doorway', minX: 3.4, maxX: 4.8, minZ: 1.4, maxZ: 2.4, open: false },
};

// 玩家出生點
export const SPAWN = {
  // 序幕/終幕：趴在桌上，頭側枕在手臂上（相機位置 / 視線目標 / 側傾）。
  // 視線斜斜望向主 CRT 與其上方的 LED 電子鐘 —— 序幕醒來第一眼、終幕倒下最後一眼都是「02:00」。
  slumped: { x: -0.85, y: 0.95, z: -2.02, lookAt: { x: -0.2, y: 1.8, z: -3.4 }, roll: 0.36 },
  // 終幕寫字時的坐姿（俯視 endingNote），之後無力趴倒成 slumped
  writing: { x: -0.62, z: -1.72, lookAt: { x: -0.62, y: 0.78, z: -2.29 } },
  // 坐姿：面對主 CRT
  seated: { x: 0, z: -1.6, yaw: 0, pitch: -0.05 },
};

// 依位置判斷區域名稱
export function zoneAt(x, z) {
  for (const r of WALKABLE) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.name;
  }
  for (const r of Object.values(PORTALS)) {
    if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return r.name;
  }
  return 'outside';
}
