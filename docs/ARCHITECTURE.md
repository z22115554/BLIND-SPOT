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
         resolution.js（ResolutionGovernor：慢幀時自動降解析度）
         input.js（InputMode：觸控 ↔ 滑鼠鍵盤、looksLikeTouchDevice()）
         quality.js（detectQuality / applyQuality / rendererQuality：手機畫質預設）
  data/  script.js（全部文案，唯一文字來源）  layout.js（全部座標，唯一座標來源）
  gfx/   canvasUtil.js（噪音/污漬/手寫字等 Canvas 工具）  TextureFactory.js  PostFX.js  shaders/CRTShader.js
  audio/ AudioEngine.js（可拆 audio/*.js 輔助檔）
  world/ ControlRoom.js  Corridor.js  CameraFeeds.js  Figure.js  （可拆輔助檔）
         feeds/ channels.js（CAM-01～04 場景）anomalies.js（LD 微事件各階段）OSD.js  SideScreen.js  props.js  feedTextures.js
  systems/ PlayerController.js  Interaction.js  GazeSystem.js  InspectView.js  Subtitles.js  UI.js
           TouchControls.js（手機／平板：拖曳環顧、浮動搖桿、點擊互動、暫停鈕、湊近看監視器、直向視角）
  states/ index.js  common.js  TitleState.js  PrologueState.js  MonitoringState.js
          monitoringDirector.js（監看段落的節奏導演：純邏輯、零 import，node 模擬直接使用）
          BlackoutCorridorState.js  RevelationState.js  EndingLoopState.js
scripts/ build.mjs  dev.mjs  shot.mjs（headless 截圖/錯誤檢查）  smoke-test.mjs
         pacing-sim.mjs（節奏 node 模擬）  pacing-run.mjs（瀏覽器自動駕駛量測）  feed-stages.mjs（微事件截圖＋亮度）
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
  resolution,                            // ResolutionGovernor（?pr=N 固定像素比、?adaptive=0 關閉；webdriver 下自動關閉）
  input,                                 // InputMode { touch, everTouch, set(bool), isTouchPointer(e), downWhileLocked(e) }
  quality,                               // { tier: 'desktop' | 'mobile', ...旋鈕 }（桌機什麼都不改；?quality=mobile|desktop 強制）
  touchControls,                         // TouchControls { fovFor(w,h), enterImmersive(), update(dt) }
  precompile({sync, warm}) → Promise,    // 預編譯所有著色器＋上傳貼圖；開機時呼叫一次。之後若新增 mesh/材質，在黑畫面時呼叫
  director,                              // 只在 ?debug=1 且監看中：MonitoringDirector（dump()/fire(id)/forceFlip()/trace）
}
```

監看節奏改版新增的 `ctx.flags`：`blastLocked`、`lockPending`、`blastLocking`、`doorKnocked`、`logExtra`（SYS LOG 動態行）、
`minuteK`（這一分鐘進行到哪 0..0.999，OSD 秒數用）、`motionHintShown`。

* 建構子只能使用**已建立的**模組（順序見 `main.js`）；跨模組連結放在 `init()`（全部建構完才呼叫）。
* 所有計時用 `ctx.clock.wait / tween`（遊戲時間，暫停會凍結）。**不要用 setTimeout 做劇情計時**。
* 主迴圈每幀順序：`fsm → player → interact → gaze → feeds → controlRoom → corridor → audio → subtitles → ui → inspect`，
  然後 `feeds.renderFeeds(renderer)` → `postfx.render()` → `inspect.renderOverlay(renderer)`。
  每個步驟各自 try/catch：失敗只記錄一次、下一幀照常排程；同一步驟連續失敗 240 幀才顯示錯誤畫面。
* 畫面全黑（`postfx.isBlack()`，fade ≥ 0.999）時不渲染 3D 場景與監視器。
* 開機分步進行（每步之間讓出一幀，先畫出「載入中…」），預編譯完成才進標題；`?autostart=1` 同步開機（測試用）。

### 4.1 觸控／手機（mobile 分支＋final 修正）
* **輸入方式** `ctx.input`（`core/input.js`）：初始依裝置（主要指標 coarse 且沒有 fine 指標，或 coarse ＋行動 UA → 觸控）；
  之後依實際輸入切換：手指按下 → 觸控；真正的滑鼠按下／移動 ≥ 8 px（距上次觸控 ≥ 0.8 秒）或遊戲按鍵 → 滑鼠鍵盤。
  觸控筆只在手機／平板上算觸控，桌機的繪圖板／Surface 筆當作滑鼠。觸控模式時 `<html>` 有 class `bs-touch`，
  **所有觸控專用樣式都掛在 `html.bs-touch` 底下**，桌機外觀完全不變。在按下的手勢中切換時，class 延到該手勢的 click
  （或放開後 0.35 秒）才套用，版面不會在手指底下跳動。`everTouch`：這台裝置用過觸控（直向視角、切回滑鼠時重新鎖定指標）。
* **畫質** `ctx.quality`（`core/quality.js`）：手機／平板＝像素比上限 1.25、較寬鬆的自動解析度門檻、PCF 陰影、
  監視器 render target 480×360 無 MSAA、粒子上限、OSD 動態偵測文字放大（`osd.big`）。燈光數量與場景內容不變。
* **TouchControls**（`systems/TouchControls.js`）：拖曳環顧（弧度/像素 = 1.25 × 基本垂直視角 ÷ 視窗短邊 × 靈敏度）、
  左側浮動搖桿（→ `PlayerController.analog`）、點擊（< 10 px、< 0.45 秒）→ `Interaction.tapAt`、右上暫停鈕、
  點監視器湊近看（0.8 秒收窄到 38°）、直向放寬垂直視角（`fovFor`）。指標鎖定中的第一次觸控（座標被凍結成 0,0）
  等第一個 move 才定起點；單一事件位移 > 視窗長邊 30% 視為重新起點；旋轉螢幕時放開所有觸控。
* 其他模組的觸控掛鉤：`PlayerController.analog {x,z}`、`lookBy(dYaw, dPitch)`、`canMove()`；
  `Interaction.tapAt(x, y) → bool`、`pickAt(x, y, far?)`、`useCurrent() → bool`；`InspectView.nudge(dx, dy)`、`syncHints()`；
  `UI.menuVisible()`、`UI.hintVisible()`。觸控文案全部在 `SCRIPT.touch`（【補充文案】）。
* 黃金規則照舊：沒有震動回饋、所有觸控介面的出現/消失 ≥ 0.4 秒、視角變化都是平滑的（湊近／退回 0.8 秒）。

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
| `feeds:figureMoved` | `{index, sub}` | CameraFeeds（sub = 上限內的次姿勢） |
| `feeds:alert` | `{channel, stamp}` | CameraFeeds.raiseAlert（動態偵測；更新既有警示時也會再發一次） |
| `feeds:alertAck` | `{channel}` | CameraFeeds（該頻道顯示中且被注視連續 1.0 秒） |
| `feeds:hdSeen` | `{channel}` | CameraFeeds |
| `feeds:axeHit` | `{}` | CameraFeeds（HD 劈砍動作擊中門的瞬間；狀態據此播放隔門悶響） |
| `resize` | `{w,h}` | main |
| `input:mode` | `{touch}` | InputMode（輸入方式切換；在觸發的輸入事件內同步發出，監聽者可在同一手勢內要求指標鎖定） |
| 劇情用（States 自訂）| `intercom:answer`、`vent:restart`、`flashlight:take`、`sideDoor:open`、`breaker:pull`、`unlock:press`、`blastDoor:lock`（02:00 上鎖閘門中的防爆門互動）| states/common.js |

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
* 推進上下限由 `MonitoringState` 依節拍設定（`setFigureLimits`；表 `GATE_LIMITS` 在 `monitoringDirector.js`），
  保證 02:13 人影一定抵達防爆門前，且每一次推進都發生在玩家「先看見他、再移開視線」之後。
* **次姿勢**（`feeds.subPoses`，預設開啟，`?subposes=0` 關閉）：已到上限、被看過又沒被看 ≥ 0.5 秒時，換成該 index 的
  細微次姿勢（`Figure.LD_SUBPOSES`，每個 index 最多一次，index ≤ 5）；發 `feeds:figureMoved {index, sub:true}`。
  走一步（index 改變）時清除。次姿勢不改拖痕、不影響心跳與 A3。
* **其他頻道的盲區規則**：CAM-01/02/04 的微事件階段只在該頻道沒有被顯示時改變（`feeds.channel` 與 `feeds.shownChannel`
  都不是它）；CAM-03 只在主螢幕沒被注視時。導演排程時檢查一次，`CameraFeeds.setAnomalyStage` 再硬擋一次（`force` 除外）。

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
規格：`docs/pacing/spec.md`（2026-11 試玩回饋後的節奏改版；設計理由見 DESIGN-NOTES E）。

* **時鐘＝輕量注意力時鐘**：每個節拍（閘門）完成後最長 `CLOCK.secondsPerMinute`（17）遊戲秒翻下一分鐘；
  非保護分鐘在「沒事可做」時（沒有 hold、沒有檢視、沒有未查看的警示、這一分鐘的事件都發生了、距上一個事件 ≥ 3.5 秒）
  最早 11 秒翻（OSD 秒數在 1 秒內跑到 :59 再翻，永不倒退）。**02:10 / 02:11 / 02:12 永遠是 17 秒**。
  閘門分鐘時鐘停住直到事件完成（冒號照常閃）。02:00 上鎖閘門完成後最早 3 秒（`DWELL0`，加上 3.5 秒的 CALM）就翻到 02:01
  （玩家已經在這一分鐘裡走去上鎖；m4a 仍等 POST_HOLD 6 秒）。CAM-03 的警示只是回報，不擋提早翻分鐘。
  同一個時鐘分鐘內 OSD 秒數永不倒退（`CameraFeeds._timestamp` 守下限：序幕走到 :59 後進入監看，停在 :59 直到 02:01）。
  常數全部在 `monitoringDirector.js` 的 `PACE`。
* **導演** `MonitoringDirector`（`monitoringDirector.js`，零 import）：`MonitoringState` 提供 `sense()`（讀世界）與 `io`（改世界），
  導演負責 `canFlip`、微事件排程 `SCHEDULE`、VMD 提示、CAM-03 延遲警示、02:05 敲門、一次性提示。
* 閘門與人影上下限（index 0..7）：

| 時間 | 事件 | 完成條件 | figure {min,max} 之後 |
|---|---|---|---|
| 02:00 | **上鎖閘門**：防爆門「未鎖定」（右螢幕、門燈綠），玩家到西牆轉氣壓閥手輪上鎖 | 上鎖完成（`?lock=0` 無此閘門） | {0,2}（閘門前就設） |
| 02:01 | CAM-04 動態偵測（畫面沒變；偵測時間 `01:58:41`） | – | – |
| 02:02 | CAM-01 號誌 ↓ → ✕、VMS `隧道封閉` | – | – |
| 02:03 | 對講機 1 響（`stage 0`）；之後 +6 秒 CAM-04 車門關上、車頂燈熄 | 接聽並播完 | {1,3} |
| 02:04 | 安靜的一分鐘（可提早翻） | – | – |
| 02:05 | 通風轉速異常 → 拉桿（SYS LOG `主排風 手動操作`）；之後玩家看著 CAM-03 時防爆門傳來敲門聲 | 拉下通風拉桿 | {2,4} |
| 02:06 | CAM-02 遠處拱頂下的黑煙帶 | – | – |
| 02:07 | CAM-04 牆上焦痕＋三角錐 | – | – |
| 02:08 | 對講機 2 響（`stage 1`，有金屬敲擊）；之後 +6 秒 CAM-02 遠燈熄、油罐車與車頭剪影 | 接聽並播完 | {4,5} |
| 02:09 | CAM-01 霧轉為煙、兩盞路障琥珀燈 | – | – |
| 02:10 | 通風開始衰弱（40 秒內音高下滑）；CAM-04 時間停在 `02:14:08`（無提示） | 自動（保護分鐘） | – |
| 02:11 | CAM-02 煙帶往北推進 | 自動（保護分鐘） | – |
| 02:12 | 通風停止 → 聽覺真空（`setSilence`）、心跳出現；**不再有任何提示音或新警示** | 自動（保護分鐘） | {5,6} |
| 02:13 | 對講機 3 響（`stage 2`）| 接聽（響起時 {6,7}，接聽中 min=7）| 播完即跳電 |
| 02:14 | 中段繼電器跳脫 | → BLACKOUT_CORRIDOR | |

* **VMD（動態偵測）提示**＝唯一的新注意力語言：CAM 按鈕琥珀燈（2.4 秒呼吸、≤ 15%；光敏感模式恆亮）、`vmdTone`
  （只有 CAM-01/02/04；未查看 12 秒後最多再響一次；響鈴、通話中與 02:12 之後不響）、目前畫面時間戳下方 `▲ CAM-0n`、
  被警示頻道的 OSD 標籤 `▲ 動態偵測 HH:MM:SS`、SYS LOG 一行、互動提示「切換至 CAM-0n（動態偵測）」。注視 1.0 秒＝已查看。
  兩個有提示的事件至少間隔 11 秒；延後 ≥ 2 分鐘或基準沒看過（`needsBaseline`）的事件改為無提示套用。
* **CAM-03 延遲警示**：人影推進時玩家沒在看 → 3–6 秒後 CAM-03 也出現動態偵測（只有燈、文字、日誌，沒有提示音）；
  玩家已經回來看、hold 中或 02:12 之後則取消。CAM-03 當時就顯示在主螢幕、玩家人在座位（只是低頭按 CAM 鈕、看時鐘或側螢幕）
  時不排警示——變化就在畫面上等他抬頭（`sense().atDesk`；否則每次查看別的頻道之後幾秒都會固定跳出 `▲ CAM-03`）。
* **02:05 敲門**：拉桿完成 3 秒後，玩家看著 CAM-03 ≥ 1 秒（或 +13 秒）時：`doorKnock` 三下 → 2.4 秒後兩下 → 1 秒後
  SYS LOG `02:05 防爆門 震動感測`、`flags.doorKnocked`。玩家距門 < 2.5 m、通話或檢視中不敲；+16.5 秒還沒敲就放棄。
* 對講機字幕：`subtitles.show('', {speaker})`，再依 `segments` 逐段 `append(text)` 並等待 `dur`；最終畫面字串 = 原企劃全文。
* 側邊螢幕：左＝SYS LOG（`SCRIPT.status.logLines` 依時間逐行出現，與動態行 `pushLog` 依 HH:MM 合併，保留最後 8 行）；
  右＝機電狀態（`SCRIPT.status.*`；上鎖閘門開啟且尚未上鎖時 `normal` 顯示為 `normalUnlocked`）。
* 世界狀態：`resetWorld`（序幕與循環開始）把防爆門設為未上鎖；BLACKOUT / REVELATION / ENDING 的直接進入預設為上鎖。
* 直接進入：`?clock=02:08` 從該分鐘開始（`director.fastForward`：之前的微事件階段、上鎖、SYS LOG 行都瞬間補上，不發提示）。
* 除錯：`?pace=0`（改版前的流程；CAM-03 拖痕也不延長，但第 0 階段的固定佈景與 02:11 → 02:05 的文案仍是新版）、`?lock=0`、
  `?subposes=0`、`?spm=N`、`?seed=N`、`?pacelog=1`（每分鐘一行 `[pace]`＋停電前摘要表）；
  `?debug=1` 時 `BS.director`、`window.__paceLog`。

#### 監視器微事件與相關 API
* **頻道**（`world/feeds/channels.js` ＋ `anomalies.js`）：`ch.stage`、`ch.maxStage`（CAM-01: 2、02: 4、03: 1、04: 2）、
  `ch.meanScale`（目前階段的 LD 畫面平均亮度 ÷ 第 0 階段，實測表 `MEAN_SCALE`）、`ch.setStage(k)`（冪等、絕對；
  只改 visible / opacity / color / intensity / 霧 / 同為非 null 的 map，不增減燈光、不觸發重新編譯）。
  `Cam03.setFigurePose(i, sub)`：拖痕只在 index 改變時延長。`Figure.setPose(index, sub)`、`LD_SUBPOSE_MAX = 5`。
* **CameraFeeds**：`shownChannel`；`raiseAlert(n, {stamp}) → stamp`（只在 LD）、`alerts`、`isAlerted(n)`、`alertLevel(n)`（平滑 0..1）、
  `clearAlerts()`；`setAnomalyStage(n, k, {force}) → bool`（盲區防呆）、`anomalyStage(n)`；`setFrozenTime(n, text|null)`；
  `clockStamp()`（用 `flags.minuteK` 的 HH:MM:SS）；`subPoses`、`figureSub`。AGC 的亮度表乘上 `meanScale`，
  所以切換進變暗的階段仍符合 0.25 秒 ≤ 30%。`reset()` 與離開 LD（停電雪花、HD）清除所有警示、標籤與凍結時間。
* **ControlRoom**：`setBlastLocked(locked, {duration = 2.4}) → Promise`（手輪 2.5 圈 0.7·duration → 鎖栓 0.3·duration；
  duration ≤ 0 立即）、`blastLocked`；門燈：未上鎖綠、上鎖/解鎖中琥珀緩慢呼吸（≤ 15%；光敏感模式恆亮）、上鎖紅。
  CAM 按鈕 LED：`綠·選取·(1−al) + 琥珀·al·呼吸`，只改 LED 顏色，沒有新燈光。
* **音效**：`audio.sfx('vmdTone', {position})`（座位約 −31 dBFS）、`audio.sfx('doorKnock', {position, count, amp})`（約 −30 dBFS）。

### STATE_BLACKOUT_CORRIDOR（02:14）
* 跳電：`relayTrip`、日光燈先變暗偏黃、再熄滅並轉為紅色緊急照明（全程單調變暗、0.25 秒內 ≤ 30%）、
  主監視器雪花、兩側螢幕約 1.6 秒淡成低對比雪花、嗡鳴消失。
* 取下手電筒 → 手動解開側門（`player.setPortal('sideDoor', true)`）→ 進入廊道：
  霧加濃、`audio.setFootstepEcho({enabled:true, delay:0.45})`（停下時多一步）、廊道環境音。
* 未復電前返回主控室：`flags.returnsFromCorridor++`，`controlRoom.setCorruption(min(0.45, 0.12×次數))`。
* 第一次越過 `CORRIDOR.headlightTriggerX` → `corridor.triggerHeadlights()`（車燈掃過、玩家影子投在牆上）。
* 可檢視：防火門玻璃、錶、日誌、雨衣（`inspect.open` 附 3D 物件）。
* 總開關（提示 `SCRIPT.prompts.mainBreaker`）→ 復電 → 目標「返回主控室」→ 進入 controlRoom 區域 → REVELATION。

### STATE_REVELATION
* 主控室明顯陳舊（corruption ≥ 0.6、暖色昏暗燈光）、咖啡 stage 1（冷掉浮灰）。
* `feeds.boot()` → HD 彩色：CAM-04 沒有車、CAM-03 是消防員在劈門（`setHDAction(true)`，隔門悶響）。
* 右螢幕顯示「通風：主排風 手動切斷（02:05 操作員）」、左螢幕顯示事故調查摘要（`02:05 主排風遭控制室內手動切斷。`）。
  動態偵測在 HD 中關閉；HD 畫面與第一幕 LD 的微事件位於同一座標（車門、號誌、煙、油罐車、焦痕、三角錐）。
* CAM-03 於 HD 被看過（≥1.5 秒）且（CAM-04 也看過或已過 40 秒）→ 對講機響 → 接聽 → `stage 3` 清晰錄音。
* 播完 → 咖啡 stage 2（乾涸龜裂）、corruption 0.85 → ENDING_LOOP。

### STATE_ENDING_LOOP
1. 解鎖鈕緩慢呼吸紅光，唯一互動（`flags.unlockArmed` 時其他互動全部停用；提示 `SCRIPT.prompts.unlockButton`）。
2. 按下 → 氣壓洩壓、低沉警報、視線轉向防爆門、門 4.5 秒滑開 → 約 1.35 秒後黑煙沿天花板湧入再往下沉（粒子＋霧轉黑＋`postfx.smoke`；
   門內側橘紅火光借用既有補光燈，起伏 ≤ 9%）、
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
  `?speed=4` 遊戲時間加速（遊戲時鐘每幀 dt 上限 0.1 秒 × speed）。
* 監看節奏：`?clock=02:08`（MONITORING 從該分鐘開始）、`?pace=0`、`?lock=0`、`?subposes=0`、`?spm=N`、`?seed=N`、`?pacelog=1`（見 §8）。
* 效能：`?pr=N` 固定像素比、`?adaptive=0` 關閉自動降解析度。
* 觸控：`?touch=1|0` 強制輸入方式、`?quality=mobile|desktop` 強制畫質預設、`?tapms=N` 放寬點擊時間（SwiftShader 下每個觸控事件
  要等一幀才送達；真實像素比的測試需要 `?tapms=30000`）。Playwright：`browser.newContext({...devices['iPhone 13']})`
  或橫向 `{viewport:{width:844,height:390}, isMobile:true, hasTouch:true, deviceScaleFactor:3}`；點擊用 `page.touchscreen.tap`，
  拖曳與多點觸控用 CDP `Input.dispatchTouchEvent`（touchStart / touchMove / touchEnd）。
  `page.evaluate(() => BS.inspect.open(...))` 會卡住（open() 在關閉時才 resolve），請包在區塊裡不要 return 它。
  注意：根目錄沒有 `index.html` 時 `git checkout -- dist index.html` 什麼都不做，請用 `git checkout -- dist`。
* 截圖檔可用 Read 工具直接看圖。headless 使用 SwiftShader，幀率低是正常的。

```bash
node scripts/smoke-test.mjs                                   # 讀 dist/blind-spot.html：六個狀態各截一張圖、檢查 console 錯誤
node scripts/pacing-sim.mjs [--runs 200] [--persona all|eager|typical|starer|passive] [--table] [--seed N] [--glance 0.7]
                                                              # 節奏 node 模擬（直接 import 導演與 script.js；斷言失敗 exit 1）
node scripts/pacing-run.mjs --html x.html [--speed 4] [--persona typical] [--runs 1] [--size 480x270] [--query lock=0] [--glance 0.7]
                                                              # 瀏覽器自動駕駛：這一幕長度、最長空檔、提示數、盲區違規、錯誤
                                                              # （每次按 CAM 鈕前先低頭看控制台 0.7 秒，和真人一樣；--glance 0 是舊行為）
node scripts/feed-stages.mjs --html x.html [--only 1,3] [--merge] [--write]
                                                              # 每個微事件階段的截圖、對照表 sheet.png、實測 MEAN_SCALE（--write 寫回 anomalies.js）
```
