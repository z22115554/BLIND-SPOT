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
npm run build    # 產生 dist/blind-spot.html
npm test         # 打包＋headless 煙霧測試（每一幕截圖並檢查 console 錯誤）
```

除錯參數：`?debug=1`（右上角狀態、`window.BS`）、`?state=MONITORING|BLACKOUT_CORRIDOR|REVELATION|ENDING_LOOP`（直接跳關）、
`?autostart=1`、`?speed=4`（遊戲時間加速）。

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
docs/DESIGN-NOTES.md      原企劃的問題與處理方式、待決定事項
```
