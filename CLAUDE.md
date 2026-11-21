# CLAUDE.md — 《盲區交接》BLIND SPOT

第一人稱 WebGL 心理恐怖小品（Three.js 0.170 + Web Audio，程式化貼圖，esbuild 打包成單一 HTML）。
與使用者溝通一律用**繁體中文**。

## 先讀
- `HANDOFF.md`：目前進度、下一步、注意事項。
- `docs/script/implementation-plan.md`：v3 實作計畫，目前要從**階段 1**開始。
- `docs/script/script-v3-draft.md`：v3 劇本全文。
- `docs/ARCHITECTURE.md`：模組契約與黃金規則（§3）。

## 指令
- `npm run dev`：開發伺服器 http://localhost:5173
- `node scripts/build.mjs --out /tmp/x.html`：開發中的打包，**不會**動到線上的 `index.html`
- `npm run build`：發布用，會寫出 `dist/blind-spot.html` 和根目錄 `index.html`；GitHub Pages 讀的是根目錄 `index.html`
- `npm test`：打包並跑六幕煙霧測試
- `node scripts/pacing-sim.mjs`：監看段節奏模擬
- 除錯參數見 README：`?debug=1`、`?state=`、`?clock=`、`?speed=`、`?touch=1`……

## 不可違反的規則
- **零跳臉**：不能有東西突然出現在鏡頭前，不能有突發巨響。
- **不閃爍**：
  - 亮度變化至少 0.4 秒。
  - 0.25 秒內整體畫面亮度變化不超過 30%。
  - 呼吸或起伏的燈光，振幅不超過 15%、週期至少 0.4 秒。
  - 要遵守 `reduceFlicker`（光敏感模式）。
- **音量**：峰值不超過 -10 dBFS。
- **燈光數量**：主場景不要增減燈光（會觸發 shader 重編譯）。新的網格與材質要在開機時建立，或之後呼叫 `ctx.precompile()`。
- **文案**：所有畫面文字都放在 `src/data/script.js`。
- **手機**：新 UI 要支援觸控，按鈕至少 44px、避開安全區，直向和橫向各測一次。
- **電腦版不能退化**：改完要跑 `npm test`。

## Git
- 分支 `ccr-98a0543d-oehy6f` 是預設分支，也是 Pages 的來源。
- 開發請開功能分支，驗證通過後再合併。
- `dist/` 和 `index.html` 只在發布時重建、提交。
- 每完成一項就提交，不要囤積未提交的工作。
- 不要提交 `.claude/`。
