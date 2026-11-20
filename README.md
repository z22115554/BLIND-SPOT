# 盲區交接 BLIND SPOT

第一人稱 Web 3D 心理恐怖遊戲。零跳臉、純氣氛恐怖——恐懼來自視覺盲區、空間聲學的錯位，以及逐漸意識到自己才是加害者。

* **Three.js**（WebGL）＋ **Web Audio API**：所有貼圖都以 HTML5 Canvas 程式化生成、所有聲音都即時合成，**不依賴任何外部圖片、模型、音檔或 CDN**。
* 完整五幕劇情狀態機：序幕（02:00 交接）→ 監視器裡的靜止者 → 02:14 跳電與維修廊道 → 高清還原與記憶崩塌 → 02:00 的循環。

## 直接遊玩

打開 **`dist/blind-spot.html`**（單一自足 HTML 檔，可直接雙擊以瀏覽器開啟，離線可玩）。

* 建議使用桌機版 Chrome / Edge / Firefox / Safari，配戴耳機，在安靜昏暗的環境遊玩。
* 操作：滑鼠環顧　WASD 移動　E／左鍵 互動　Esc 暫停
* 標題與暫停畫面可調整滑鼠靈敏度、音量，並開啟「光敏感模式」（降低雜訊、閃爍與畫面晃動）。

## 開發

```bash
npm install
npm run dev      # http://localhost:5173  （修改 src/ 會自動重建；加 ?debug=1 開除錯資訊）
npm run build    # 產生 dist/blind-spot.html（並寫出根目錄 index.html，給 GitHub Pages）
npm test         # 打包＋headless 煙霧測試（每一幕截圖並檢查 console 錯誤）
```

除錯參數：

| 參數 | 作用 |
|---|---|
| `?debug=1` | 右上角狀態、`window.BS`（＝ctx）；監看中另有 `BS.director`、`window.__paceLog` |
| `?state=PROLOGUE\|MONITORING\|BLACKOUT_CORRIDOR\|REVELATION\|ENDING_LOOP` | 直接跳關 |
| `?autostart=1` | 略過標題點擊 |
| `?speed=4` | 遊戲時間加速 |
| `?clock=02:08` | 監看段落從該分鐘開始（之前的事件瞬間補上） |
| `?pace=0` | 監看段落改版前的流程（沒有動態偵測、輕量時鐘、上鎖閘門、敲門、次姿勢） |
| `?lock=0` | 沒有 02:00 上鎖閘門（防爆門一開始就鎖著） |
| `?subposes=0` | CAM-03 人影不使用次姿勢 |
| `?spm=N`、`?seed=N` | 每分鐘秒數、節奏導演的亂數種子 |
| `?pacelog=1` | 每分鐘一行 `[pace]`，停電前印出整幕摘要表 |
| `?pr=N`、`?adaptive=0` | 固定像素比、關閉自動降解析度 |

節奏與畫面的量測工具：`node scripts/pacing-sim.mjs`（node 模擬）、`node scripts/pacing-run.mjs`（瀏覽器自動駕駛）、
`node scripts/feed-stages.mjs`（監視器微事件截圖），用法見 `docs/ARCHITECTURE.md` §9。

## GitHub Pages

`node scripts/build.mjs`（不帶 `--out`）除了 `dist/blind-spot.html`，也會在根目錄寫出內容相同的 `index.html`；
根目錄另有 `.nojekyll`。到 GitHub 倉庫 Settings → Pages，選 **Deploy from a branch**，分支選要發佈的分支、資料夾 `/ (root)` 即可。
（私有倉庫在免費方案下需要先公開。）帶 `--out` 的打包只寫指定檔案，不會動到 `index.html`。

## 專案結構

```
src/
  main.js                 進入點、主迴圈
  core/                   事件匯流排、可暫停的遊戲時鐘、劇情狀態機
  data/script.js          全部遊戲文案（唯一文字來源，可直接改）
  data/layout.js          全部世界座標
  gfx/                    Canvas 程式化貼圖、後期處理（暈影/底片顆粒/淡出/濃煙）、CRT 著色器
  audio/                  Web Audio 程式化音效引擎
  world/                  主控室、維修廊道、CCTV 監視系統與人影
  systems/                玩家控制、互動、注視判定（盲區機制）、物件檢視、字幕、UI
  states/                 五幕劇情狀態
scripts/                  打包、開發伺服器、截圖與煙霧測試
docs/ARCHITECTURE.md      架構、模組契約、劇情節拍
docs/DESIGN-NOTES.md      原企劃的問題與處理方式、試玩回饋後的節奏改版、待決定事項
docs/pacing/              監看段落節奏改版的規格、提案與進度
```
