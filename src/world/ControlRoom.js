// =============================================================================
// ControlRoom — 主控室（3D 場景、燈光、可互動物件、漸進式環境腐化）
// 【API 骨架 / CONTRACT STUB】實作者必須保留 objects 的所有鍵與所有公開方法。
// 位置一律取自 ctx.LAYOUT.CONTROL_ROOM / BLAST_STUB。
//
// 腐化（setCorruption c: 0..1，可連續）：
//   牆角水漬、天花板煙燻、螢幕外殼焦痕的不透明度隨 c 增加；
//   日光燈色溫隨 c 「降低」＝ 由冷白 (≈6500K, #dfe9ff) 漸變為髒琥珀色 (≈3000K, #ffc58a)，亮度下降；
//   c 高時加入輕微燈管不穩（緩慢的亮度起伏，週期 ≥ 0.4 秒，振幅 ≤ 15%，不可頻閃）。
// 焦黑（setBurnt b: 0..1）：終幕的「貼圖剝落為焦黑廢墟」，牆面/桌面/設備混合為 charred 材質、螢幕全黑破裂。
// 所有 set* 都必須平滑過渡（update 中 damp），而且可以在任何時候重複呼叫。
// =============================================================================
import * as THREE from 'three';

export class ControlRoom {
  constructor(ctx) {
    this.ctx = ctx;
    const L = ctx.LAYOUT.CONTROL_ROOM;
    this.group = new THREE.Group();
    this.group.name = 'controlRoom';
    ctx.scene.add(this.group);

    const ph = (w, h, d, x, y, z, color = 0x444444) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
      m.position.set(x, y, z); this.group.add(m); return m;
    };
    const ms = L.mainScreen;
    const mainScreen = new THREE.Mesh(new THREE.PlaneGeometry(ms.w, ms.h), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    mainScreen.position.set(ms.x, ms.y, ms.z); this.group.add(mainScreen);
    const sideScreens = L.sideScreens.map((s) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      m.position.set(s.x, s.y, s.z); m.rotation.y = s.yaw; this.group.add(m); return m;
    });
    const screenLight = new THREE.PointLight(0x9fb4c8, 0.6, 0, 2);
    screenLight.position.set(ms.x, ms.y, ms.z + 0.5); this.group.add(screenLight);

    /**
     * 可互動/可被其他模組引用的物件（States 會對它們註冊互動）。
     * mainScreen / sideScreens 為 PlaneGeometry（朝 +Z / 依 yaw），材質由 CameraFeeds.init() 指派。
     */
    this.objects = {
      mainScreen,                                   // THREE.Mesh — 主 CRT 螢幕（0.72×0.54）
      sideScreens,                                  // [THREE.Mesh, THREE.Mesh] — 左 SYS LOG / 右 機電狀態
      screenLight,                                  // THREE.PointLight — 螢幕光（CameraFeeds 依模式調整顏色/強度）
      camButtons: L.camButtons.xs.map((x) => ph(0.09, 0.03, 0.06, x, L.camButtons.y, L.camButtons.z, 0x333333)), // CAM-01..04
      stickyNote: ph(0.09, 0.09, 0.002, L.stickyNote.x, L.stickyNote.y, L.stickyNote.z, 0xe8d24a),            // 主 CRT 外殼上的便利貼
      endingNote: ph(0.09, 0.002, 0.09, L.endingNote.x, L.endingNote.y, L.endingNote.z, 0xe8d24a),           // 終幕平放桌上的便利貼（預設隱藏）
      pen: ph(0.01, 0.01, 0.14, L.endingNote.x + 0.05, L.endingNote.y + 0.01, L.endingNote.z, 0x111111),      // 終幕的筆（預設隱藏）
      coffee: ph(0.09, 0.1, 0.09, L.coffee.x, L.coffee.y + 0.05, L.coffee.z, 0xdddddd),                       // 馬克杯（Group/Mesh）
      clock: ph(L.clock.w, L.clock.h, 0.05, L.clock.x, L.clock.y, L.clock.z, 0x110000),                        // 牆上 LED 鐘
      intercom: ph(0.05, 0.36, 0.26, L.intercom.x, L.intercom.y, L.intercom.z, 0x555555),                     // 對講機面板
      ventPanel: ph(0.05, 0.5, 0.4, L.ventPanel.x, L.ventPanel.y, L.ventPanel.z, 0x556655),                   // 通風控制面板
      ventLever: ph(0.06, 0.18, 0.03, L.ventPanel.x - 0.05, L.ventPanel.y - 0.1, L.ventPanel.z, 0xaa2222),    // 通風拉桿
      blastDoor: ph(0.25, L.blastDoor.height, L.blastDoor.width, L.blastDoor.x, L.blastDoor.height / 2, L.blastDoor.z, 0x667066), // 防爆門
      sideDoor: ph(0.08, L.sideDoor.height, L.sideDoor.width, L.sideDoor.x, L.sideDoor.height / 2, L.sideDoor.z, 0x556070),      // 側門
      flashlightBox: ph(0.12, 0.3, 0.22, L.flashlightBox.x, L.flashlightBox.y, L.flashlightBox.z, 0xaa3322),  // 手電筒壁掛箱
      unlockButton: ph(0.1, 0.05, 0.1, L.unlockButton.x, L.unlockButton.y, L.unlockButton.z, 0x661111),       // 防爆門緊急解鎖鈕
      chair: ph(0.5, 0.9, 0.5, L.chair.x, 0.45, L.chair.z, 0x222222),
    };
    this.objects.endingNote.visible = false;
    this.objects.pen.visible = false;
    /** 終幕便利貼的手寫動畫貼圖（TextureFactory.createStickyNote 的回傳物件）；stickyNoteTex 為主 CRT 上那張 */
    this.stickyNoteTex = null;
    this.endingNoteTex = null;
  }
  init() {}

  /** 玩家碰撞用的障礙物（XZ 平面 AABB）：控制台、椅子、櫃子等。@returns {{minX,maxX,minZ,maxZ}[]} */
  getObstacles() {
    const d = this.ctx.LAYOUT.CONTROL_ROOM.desk;
    return [{ minX: d.minX, maxX: d.maxX, minZ: d.minZ, maxZ: d.maxZ }];
  }

  /** mode: 'off' | 'normal' | 'emergency'（紅色緊急照明）| 'restored'（第三幕：昏暗暖色）| 'ending'（濃煙中的殘光） */
  setLighting(mode, { duration = 1 } = {}) {}
  /** 序幕：日光燈啟動（幾次緩慢、低振幅的明暗起伏後穩定點亮；不可頻閃）。含 audio 'tubeStart'。@returns {Promise<void>} */
  lightsStartup(duration = 3.5) { return this.ctx.clock.wait(duration); }
  setCorruption(c, { duration = 2 } = {}) {}
  setBurnt(b, { duration = 3 } = {}) {}
  /** 0 熱咖啡（冒蒸氣粒子）/ 1 冷掉浮灰 / 2 乾涸龜裂的杯子 */
  setCoffeeStage(stage) {}
  /** LED 鐘顯示 'HH:MM'（冒號每秒閃爍由本模組處理；blank = true 顯示 '--:--'）。 */
  setClock(text) {}
  /** 'off' | 'ringing'（緩慢脈動的琥珀燈，週期 1.2 秒）| 'talking'（穩定綠燈） */
  setIntercomLed(mode) {}
  /** 'ok' | 'fault'（琥珀）| 'off' */
  setVentLed(mode) {}
  /** 拉桿動畫，回傳 Promise。 */
  pullVentLever() { return this.ctx.clock.wait(0.6); }
  /** 按鈕按下動畫（0..3）。 */
  pressCamButton(index) {}
  /** 解鎖鈕發出緩慢呼吸的紅光（週期 ≥ 1.5 秒，不可閃爍）。 */
  setUnlockGlow(on) {}
  pressUnlockButton() { return this.ctx.clock.wait(0.4); }
  /** 手電筒從箱子取下（隱藏箱內手電筒）。 */
  takeFlashlight() {}
  /** 側門向外（+X）旋開；回傳 Promise。 */
  openSideDoor(duration = 2.4) { return this.ctx.clock.wait(duration); }
  /** 防爆門沿 +Z 滑入牆內；回傳 Promise。 */
  openBlastDoor(duration = 4.5) { return this.ctx.clock.wait(duration); }
  /** 濃煙（0..1）：從防爆門湧入的煙霧粒子＋提高 scene.fog 密度、轉為黑灰色。 */
  setSmoke(amount, { duration = 4 } = {}) {}
  /** 'monitor'（主 CRT 上那張）/ 'ending'（桌上那張＋筆）可見性 */
  setNoteVisible(which, on) {}
  /** 終幕寫字：0..1，同步更新 endingNote 的貼圖與筆的位置。 */
  setEndingWriting(p) {}
  /** 便利貼角落的「正」字記號（循環次數）。 */
  setLoopTallies(n) {}
  /** 重置為序幕初始狀態（循環重來時呼叫）：門關、腐化 0、焦黑 0、咖啡 0、煙 0。 */
  reset() {}
  update(dt, t) {}
}
