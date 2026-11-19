# 《盲區交接》BLIND SPOT — 架構與模組契約

> 這份文件是所有模組實作者的共同契約。每個模組的**公開 API 以 `src/` 內的骨架檔（CONTRACT STUB）為準**，
> 這裡補充設計規則、事件、劇情節拍與測試方式。

## 1. 技術選型

| 項目 | 選擇 | 原因 |
|---|---|---|
| 3D | three.js **0.170.0**（npm，打包進單檔） | 不依賴 CDN；`file://` 可直接開啟 |
| 打包 | esbuild → `dist/blind-spot.html`（單一自足 HTML，JS 內嵌） | 「貼上即可玩」 |
| 音訊 | Web Audio API 即時合成 | 零音檔 |
| 貼圖 | HTML5 Canvas → `THREE.CanvasTexture` | 零圖檔 |
| 後期 | `EffectComposer` + 自訂 ShaderPass（暈影/顆粒/色差/淡出/濃煙）+ `OutputPass` | 規格要求 |
| 監視器 | 4 個獨立 `THREE.Scene` → `WebGLRenderTarget` → CRT `ShaderMaterial` | 規格要求 |

three r170 慣例：**物理正確光照**（`PointLight(color, intensity[cd], distance=0, decay=2)`）、
`texture.colorSpace = SRGBColorSpace`（顏色貼圖）、`MeshStandardMaterial`。renderer 已設 `ACESFilmicToneMapping`，
`OutputPass` 會套用 tone mapping 與 sRGB 轉換，所以**自訂 ShaderMaterial 一律輸出線性色彩**。

## 2. 目錄

```
src/
  main.js                 進入點：renderer、ctx、模組、主迴圈（不要改模組建構順序）
  index.html              單檔 HTML 模板（build 時內嵌 bundle）
  core/  EventBus.js  GameClock.js（可暫停的遊戲時間）  StateMachine.js（+BaseState）  Settings.js  util.js
  data/  script.js（全部文案，唯一文字來源）  layout.js（全部座標，唯一座標來源）
  gfx/   canvasUtil.js（噪音/污漬/手寫字等 Canvas 工具）  TextureFactory.js  PostFX.js  shaders/CRTShader.js
  audio/ AudioEngine.js（可拆 audio/*.js 輔助檔）
  world/ ControlRoom.js  Corridor.js  CameraFeeds.js  Figure.js  （可拆輔助檔）
  systems/ PlayerController.js  Interaction.js  GazeSystem.js  InspectView.js  Subtitles.js  UI.js
  states/ index.js  common.js  TitleState.js  PrologueState.js  MonitoringState.js
          BlackoutCorridorState.js  RevelationState.js  EndingLoopState.js
scripts/ build.mjs  dev.mjs  shot.mjs（headless 截圖/錯誤檢查）  smoke-test.mjs
```

**檔案所有權**：每個實作者只改自己負責的檔案（可新增同目錄的輔助檔）。`main.js`、`core/*`、`data/*`、
`canvasUtil.js`、`index.html`、`scripts/*` 為共用檔，**不得修改**；若真的需要，請在最終回報中說明。

## 3. 黃金規則（零跳臉・純氣氛恐怖）

1. **沒有突發巨響**：AudioEngine master 經限幅器；任何音效峰值 ≤ 約 -10 dBFS；所有音量變化 ramp ≥ 0.15 秒。
2. **沒有閃爍驚嚇**：任何光源/畫面亮度變化 ≥ 0.4 秒；0.25 秒內整體亮度變化不可超過 30%；
   「不穩的燈管」只能是週期 ≥ 0.4 秒、振幅 ≤ 15% 的緩慢起伏。CRT 雪花雜訊必須低對比、平均亮度穩定。
3. **沒有貼臉模型**：人影只存在於監視器畫面中，永遠不會出現在玩家面前。終幕開門後門外只有黑暗與濃煙。
4. **光敏感模式** `ctx.settings.get('reduceFlicker')`：關閉頭部擺動、降低顆粒與雜訊、雪花改為緩慢流動。
5. **恐懼來源**：視覺盲區（看不到的時候他在動）、聲學錯位（環境音消失、延遲 0.45 秒的腳步回音、多出來的一步）、
   以及「我才是加害者」的揭露。
6. **零外部資源**：不得載入任何 URL（圖片、字型、音檔、CDN）。
7. **所有畫面文字來自 `ctx.SCRIPT`**；【原企劃文案】逐字使用。

## 4. 共用 ctx

```js
ctx = {
  THREE, renderer, scene, camera,        // camera.rotation.order = 'YXZ'，已 scene.add(camera)
  bus: EventBus, clock: GameClock, settings: Settings, util, SCRIPT, CLOCK, LAYOUT, STATES,
  debug: bool, params: URLSearchParams,
  flags: { clockText, corruption, returnsFromCorridor, hasFlashlight, powerRestored,
           itemsFound:{watch,logbook,coat}, coffeeStage, loopCount, ...狀態自行增加 },
  textures, audio, ui, subtitles, postfx, controlRoom, corridor, feeds, player, interact, gaze, inspect, fsm,
  setPaused(bool),
}
```

* 建構子只能使用**已建立的**模組（順序見 `main.js`）；跨模組連結放在 `init()`（全部建構完才呼叫）。
* 所有計時用 `ctx.clock.wait / tween`（遊戲時間，暫停會凍結）。**不要用 setTimeout 做劇情計時**。
* 主迴圈每幀順序：`fsm → player → interact → gaze → feeds → controlRoom → corridor → audio → subtitles → ui → inspect`，
  然後 `feeds.renderFeeds(renderer)` → `postfx.render()` → `inspect.renderOverlay(renderer)`。

## 5. 事件（bus）

| 事件 | payload | 發出者 |
|---|---|---|
| `state:change` | `{from,to,data}` | StateMachine |
| `pause:request` / `pause:resume` | – | Player（指標鎖定被解除）/ UI（點擊繼續） |
| `game:paused` / `game:resumed` | – | main |
| `player:step` | `{surface,x,z,speed}` | Player（每 ~0.72 m） |
| `player:stopped` | `{walkedFor}` | Player |
| `player:zone` | `{from,to}` | Player |
| `interact:use` | `{id}` | Interaction |
| `inspect:open` / `inspect:close` | `{id}` | InspectView |
| `feeds:channel` | `{channel}` | CameraFeeds |
| `feeds:figureMoved` | `{index}` | CameraFeeds |
| `feeds:hdSeen` | `{channel}` | CameraFeeds |
| `feeds:axeHit` | `{}` | CameraFeeds（HD 劈砍動作擊中門的瞬間；狀態據此播放隔門悶響） |
| `resize` | `{w,h}` | main |
| 劇情用（States 自訂）| `intercom:answer`、`vent:restart`、`flashlight:take`、`sideDoor:open`、`breaker:pull`、`unlock:press` | states/common.js |

## 6. 空間配置（詳見 `src/data/layout.js`）

* 主控室 8×7×3 m。玩家坐在控制台前面向 -Z（北）。主 CRT 在正前方；LED 電子鐘在其上方牆面。
* **西牆**：防爆門（通往 B 區廊道＝CAM-03 拍攝的地方）＋門邊的緊急對講機（接聽時必須轉身背對監視器）。
* **東牆**：通風控制面板、緊急手電筒箱、側門（停電後手動開啟 → 地下公務維修廊道）。
* 維修廊道沿 +X 延伸 36 m，北牆 x=20 處有強化玻璃防火門（外面是主車道），x≈12.5 排水溝旁有錶，
  x≈39 轉角地上有日誌，往南進入電閘室（雨衣掛在東牆鐵架、總開關在南牆）。
* 玩家碰撞 = 「可行走矩形聯集」（`WALKABLE` + 已開啟的 `PORTALS`）減去各模組 `getObstacles()` 回傳的 AABB。
* CAM-01～04 是**獨立場景**（不在主場景座標系內），由 CameraFeeds 自行配置。

## 7. 盲區機制（Frustum Culling 應用）

* `GazeSystem.isObserved()`：視錐相交（`Frustum.intersectsBox`）＋視線夾角 ≤ 34°＋距離＋射線遮蔽＋螢幕正面朝向
  ＋檢視畫面未開啟。單純視錐太寬鬆（畫面邊角也算「看著」），所以必須加上中央視角錐與遮蔽判定。
* `CameraFeeds.update()` 依 `gaze.mainScreenObserved` 執行人影推進（規則見 `CameraFeeds.js` 檔頭）。
* 推進上下限由 `MonitoringState` 依節拍設定（`setFigureLimits`），保證 02:13 人影一定抵達防爆門前，
  且每一次推進都發生在玩家「先看見他、再移開視線」之後。

## 8. 劇情狀態機與節拍

```
TITLE ─click→ STATE_PROLOGUE ─讀便利貼→ STATE_MONITORING ─02:14→ STATE_BLACKOUT_CORRIDOR
   ─復電後回主控室→ STATE_REVELATION ─聽完錄音→ STATE_ENDING_LOOP ─選擇→ STATE_PROLOGUE（循環）／名單
```

每個狀態的 `enter()` 必須能**直接進入**（`?state=REVELATION` 跳關）：自行把世界設成該狀態該有的樣子。

### STATE_PROLOGUE（02:00）
1. 全黑、無聲 1 秒 → `audio.sfx('tubeStart')` + `controlRoom.lightsStartup()`（緩慢、低振幅，非頻閃）＋ `postfx.fadeTo(0)`。
2. 日光燈嗡鳴、通風白噪音、房間底噪淡入；主 CRT 亮起 CAM-03（LD）：反光雨衣人影背對鏡頭面壁而立（index 0）。
3. 玩家由 `SPAWN.slumped`（趴桌、側頭望向監視器與電子鐘 02:00）以 `player.rig` 補間抬頭坐起 → 可操作。
4. 檢視便利貼（關閉後）或 50 秒後 → MONITORING。

### STATE_MONITORING（02:00 → 02:14）
* 時鐘：每 `CLOCK.secondsPerMinute` 遊戲秒 +1 分；遇到「閘門」分鐘時**停住**直到事件完成（冒號照常閃）。
* 閘門與人影上下限（index 0..7）：

| 時間 | 事件 | 完成條件 | figure {min,max} 之後 |
|---|---|---|---|
| 02:00 | 開始 | – | {0,2} |
| 02:03 | 對講機 1 響（`stage 0`）| 接聽並播完 | {1,3} |
| 02:05 | 通風轉速異常（琥珀燈、白噪音變調）| 拉下通風拉桿 | {2,4} |
| 02:08 | 對講機 2 響（`stage 1`，有金屬敲擊）| 接聽並播完 | {4,5} |
| 02:10 | 通風開始衰弱（40 秒內音高下滑） | 自動 | – |
| 02:12 | 通風停止 → 聽覺真空（`setSilence`）、心跳出現 | 自動 | {5,6} |
| 02:13 | 對講機 3 響（`stage 2`）| 接聽（響起時 {6,7}，接聽中 min=7）| 播完即跳電 |
| 02:14 | 中段繼電器跳脫 | → BLACKOUT_CORRIDOR | |

* 對講機字幕：`subtitles.show('', {speaker})`，再依 `segments` 逐段 `append(text)` 並等待 `dur`；最終畫面字串 = 原企劃全文。
* 側邊螢幕：左＝SYS LOG（`SCRIPT.status.logLines` 依時間逐行出現）；右＝機電狀態（`SCRIPT.status.*`）。

### STATE_BLACKOUT_CORRIDOR（02:14）
* 跳電：`relayTrip`、日光燈 0.8 秒內熄滅 → 紅色緊急照明、所有監視器雪花、嗡鳴消失。
* 取下手電筒 → 手動解開側門（`player.setPortal('sideDoor', true)`）→ 進入廊道：
  霧加濃、`audio.setFootstepEcho({enabled:true, delay:0.45})`（停下時多一步）、廊道環境音。
* 未復電前返回主控室：`flags.returnsFromCorridor++`，`controlRoom.setCorruption(min(0.45, 0.12×次數))`。
* 第一次越過 `CORRIDOR.headlightTriggerX` → `corridor.triggerHeadlights()`（車燈掃過、玩家影子投在牆上）。
* 可檢視：防火門玻璃、錶、日誌、雨衣（`inspect.open` 附 3D 物件）。
* 總開關（提示 `SCRIPT.prompts.mainBreaker`）→ 復電 → 目標「返回主控室」→ 進入 controlRoom 區域 → REVELATION。

### STATE_REVELATION
* 主控室明顯陳舊（corruption ≥ 0.6、暖色昏暗燈光）、咖啡 stage 1（冷掉浮灰）。
* `feeds.boot()` → HD 彩色：CAM-04 沒有車、CAM-03 是消防員在劈門（`setHDAction(true)`，隔門悶響）。
* 右螢幕顯示「通風：主排風 手動切斷（02:11 操作員）」、左螢幕顯示事故調查摘要。
* CAM-03 於 HD 被看過（≥1.5 秒）且（CAM-04 也看過或已過 40 秒）→ 對講機響 → 接聽 → `stage 3` 清晰錄音。
* 播完 → 咖啡 stage 2（乾涸龜裂）、corruption 0.85 → ENDING_LOOP。

### STATE_ENDING_LOOP
1. 解鎖鈕緩慢呼吸紅光，唯一關鍵互動（提示 `SCRIPT.prompts.unlockButton`）。
2. 按下 → 氣壓洩壓、低沉警報、視線轉向防爆門、門 4.5 秒滑開 → 黑煙湧入（粒子＋霧轉黑＋`postfx.smoke`）、
   主控室轉為焦黑（`setBurnt(1)`）、心跳變慢。
3. 畫面轉黑前：三句獨白（`style:'monologue'`），警報 `morphAlarmToHum()` 變調為日光燈電流聲。
4. 全黑中重置世界 → 淡入：坐姿俯視桌面，熱咖啡回來了，桌上便利貼已寫好大半，
   舞台指示 `SCRIPT.endingWriting`，筆寫下最後一句 `鎖死防爆門。`（`setEndingWriting` 由約 0.8 → 1）。
5. 電子鐘停在 02:14 → 無力趴倒（rig 補間回 `SPAWN.slumped` 姿勢，看得到電子鐘）→ 電子鐘跳成 **02:00** → 淡黑。
6. `loopCount++`（存檔）→ `ui.showEndChoice`：再次交接（回 PROLOGUE，便利貼角落多一道正字記號）／工作人員名單。

## 9. 測試

```bash
npm install
node scripts/build.mjs [--out /path/x.html]          # 打包單檔
node scripts/shot.mjs --html /path/x.html --state MONITORING --wait 4 --out /path/shot.png \
     [--eval "BS.player.teleport({x:0,z:-1.6,yaw:0,pitch:0,seated:false})"] [--after 1] [--speed 4] [--logs]
```

* `?debug=1` 會把 ctx 掛到 `window.BS`，右上角顯示 fps/狀態/座標/人影 index/注視判定。
* `?state=PROLOGUE|MONITORING|BLACKOUT_CORRIDOR|REVELATION|ENDING_LOOP` 直接跳關；`?autostart=1` 略過標題點擊；
  `?speed=4` 遊戲時間加速。
* 截圖檔可用 Read 工具直接看圖。headless 使用 SwiftShader，幀率低是正常的。
