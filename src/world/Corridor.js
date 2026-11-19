// =============================================================================
// Corridor — 地下公務維修廊道＋防火門外主車道＋電閘室（第二幕）
// 【API 骨架 / CONTRACT STUB】實作者必須保留 objects 的所有鍵與所有公開方法。
// 位置一律取自 ctx.LAYOUT.CORRIDOR / SWITCH_ROOM / ROADWAY。
//
// 氛圍要求：狹長、低矮、濃霧（場景 FogExp2 由狀態設定，約 0.10–0.14）、潮濕混凝土、管線、排水溝、
//   失效的緊急出口燈、牆面區段編號（例如「B2-07」）。停電時廊道沒有任何燈；只能靠手電筒。
// 防火門幻影（triggerHeadlights）：
//   主車道上一道車燈由遠而近掃過（SpotLight 由 ROADWAY.laneZ 車道、低角度射向防火門玻璃），
//   透過玻璃把玩家的影子（ctx.player.shadowProxy）拉長投射在廊道南牆上。
//   亮度變化必須是 0.6 秒以上的漸強與 1 秒以上的漸弱（「一閃而過」但不是頻閃），整段約 2.5–3 秒，
//   同時播放 audio.sfx('carPass')。結束後主車道上只有緩慢飄落的灰燼。
// =============================================================================
import * as THREE from 'three';

export class Corridor {
  constructor(ctx) {
    this.ctx = ctx;
    const C = ctx.LAYOUT.CORRIDOR, S = ctx.LAYOUT.SWITCH_ROOM;
    this.group = new THREE.Group();
    this.group.name = 'corridor';
    ctx.scene.add(this.group);
    const ph = (w, h, d, x, y, z, color = 0x444444) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
      m.position.set(x, y, z); this.group.add(m); return m;
    };
    const fd = C.fireDoor;
    /** 可互動物件（States 會對它們註冊互動） */
    this.objects = {
      fireDoorGlass: ph(fd.glass.w, fd.glass.h, 0.03, fd.x, fd.glass.y, fd.z, 0x334455), // 防火門強化玻璃
      watch: ph(0.05, 0.012, 0.05, C.watch.x, C.watch.y, C.watch.z, 0xcccccc),            // 碎裂機械錶
      logbook: ph(0.22, 0.03, 0.3, C.logbook.x, C.logbook.y, C.logbook.z, 0x3a2a1a),      // 燒焦巡檢日誌
      coat: ph(0.5, 1.0, 0.15, S.coatRack.x - 0.15, 1.1, S.coatRack.z, 0xb59a3a),         // 黃色雨衣（掛在鐵架上）
      breaker: ph(0.6, 0.8, 0.12, S.breaker.x, S.breaker.y, S.breaker.z, 0x4a5a4a),         // 總開關面板
      breakerLever: ph(0.06, 0.3, 0.06, S.breaker.x + 0.15, S.breaker.y, S.breaker.z - 0.08, 0xaa2222), // 總開關拉桿
    };
  }
  init() {}
  /** @returns {{minX,maxX,minZ,maxZ}[]} 廊道內的障礙物（管線支架、鐵架、配電箱等） */
  getObstacles() { return []; }
  /** 廊道/電閘室照明。停電：全暗（可保留極微弱的綠色緊急出口牌，或連那個也壞了）。復電：昏暗、不穩但不頻閃的日光燈。 */
  setPower(on, { duration = 2 } = {}) {}
  /** 防火門外的車燈幻影（見檔頭）。只會在每次呼叫時播放一次。@returns {Promise<void>} */
  triggerHeadlights() { return this.ctx.clock.wait(3); }
  /** 主車道上的灰燼粒子。 */
  setAsh(on) {}
  /** 總開關拉桿推上的動畫（含 audio 'breaker'）。@returns {Promise<void>} */
  pullBreaker() { return this.ctx.clock.wait(1.2); }
  /** 物件被拿起/檢視後的狀態（例如錶的反光點消失）。key: 'watch' | 'logbook' | 'coat' */
  markInspected(key) {}
  reset() {}
  update(dt, t) {}
}
