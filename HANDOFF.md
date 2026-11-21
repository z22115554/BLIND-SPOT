# 交接文件：從雲端 session 轉到本機

> 最後更新：2026-11-21
> 這份文件說明「現在做到哪、接下來做什麼、有哪些坑」。本機接手時先讀這份，再讀 `CLAUDE.md`。

---

## 1. 目前狀態

### 已上線
- **線上版**：https://z22115554.github.io/BLIND-SPOT/
- 倉庫已公開；GitHub Pages 從分支 `ccr-98a0543d-oehy6f` 的根目錄部署。
- 線上的 `index.html` 和 `dist/blind-spot.html` 內容相同，對應提交 `973d72c`。

### 線上版已包含
- 完整五幕：序幕 → 監看 02:00–02:14 → 跳電與維修廊道 → 高清真相 → 終幕循環。
- 審查修正：四位審查員找出 36 項，修正後又經最終審查 21 項，全部處理完。
- **監看段節奏改版**：開場親手鎖門、動態偵測（VMD）微事件、02:05 敲門。最長空檔從 85 秒降到約 20 秒。
- **手機與平板觸控**：拖曳環顧、浮動搖桿、點擊互動、點監視器湊近、暫停鈕、直向與橫向、行動版畫質。
- 煙霧測試 6/6 通過，`pacing-sim` 通過。

### 尚未開始（下一步）
- **v3 劇本改版**，目的是解決 owner 試玩後的「氛圍好但無聊、不夠恐怖」：
  - 劇本：`docs/script/script-v3-draft.md`（owner 已同意方向）
  - 實作計畫：`docs/script/implementation-plan.md`（五個階段，尚未動程式）

---

## 2. 下一步：照實作計畫從「階段 1」開始

1. **階段 1：劇本與選擇系統**
   - `script.js` 換成 v3 文案。
   - 對講機回應選單。
   - 02:05 與 02:13 兩個開門時間窗。
   - 結局 B、C 的狀態骨架。
2. **階段 2：恐怖場面**：抽屜、濕腳印、門縫滲煙、CAM-00、結局 A 的鏡頭。
3. **階段 3：結局 B、C 的完整場景。**
4. **階段 4：真實音效與人聲**。可與 2、3 並行；人聲要等階段 1 台詞定稿。
5. **階段 5：收尾**：時長量測、精簡、全面審查、部署。

### 已定案（owner 回覆「好」）
- 對講機是三年前的錄音：玩家的回應不改變志遠的台詞，只有「開門」改變結局。
- CAM-00 只在 02:12 與結局 A 出現。
- 結局 B、C 之後不提供「再次交接」，但標題畫面仍可重新開始。
- 主角不配音，只有字幕；唯一例外是 02:13 的耳語「不要開。」

### 仍待 owner 提供
1. 人聲來源：自己錄（建議），或改用語音合成。
2. 工作人員名單的實際名字（目前是佔位文字）。

---

## 3. 本機環境

```bash
git clone https://github.com/z22115554/BLIND-SPOT.git
cd BLIND-SPOT
git checkout ccr-98a0543d-oehy6f   # 目前唯一、也是預設分支
npm install                        # three 0.170.0、esbuild 0.24.2；Node 20+（雲端用 v22）
npm run dev                        # http://localhost:5173，改 src/ 自動重建
npm run build                      # 產生 dist/blind-spot.html ＋ 根目錄 index.html
npm test                           # 打包＋headless 煙霧測試（需要 Playwright + Chromium）
```

- **Playwright**：本機沒有的話，執行 `npx playwright install chromium`。
  - 雲端用 SwiftShader 軟體渲染，每秒只有 1–5 格；本機有 GPU 會快很多。
- **測試與量測工具**（都在 `scripts/`）：
  - `smoke-test.mjs`：六幕截圖，並檢查 console 錯誤。
  - `shot.mjs`：指定狀態截圖，可加 `--eval`／`--steps`。
  - `pacing-sim.mjs`：監看段節奏的 node 模擬，不需要瀏覽器。
  - `pacing-run.mjs`：瀏覽器自動駕駛，量測一幕長度與最長空檔。
  - `feed-stages.mjs`：監視器各頻道、各階段的截圖對照。
- **除錯參數**：完整表格在 `README.md`。常用的有：
  - `?debug=1`：開啟 `window.BS`
  - `?state=MONITORING`、`?clock=02:08`：直接跳到指定段落或時間
  - `?speed=4`：遊戲時間加速
  - `?pace=0`：改版前的節奏
  - `?lock=0`：關閉開場鎖門
  - `?touch=1`：強制觸控模式
  - `?pacelog=1`：輸出節奏紀錄

### 音效工具 earshot（階段 4 用）
- 來源：https://github.com/Leonxlnx/earshot （MIT；產出的音效可商用、不需標註）。
- 安裝：`pip install "earshot @ git+https://github.com/Leonxlnx/earshot"`。需要 Python 3.10+；寫 ogg 需要 ffmpeg。
- 範例：`earshot make "a heavy metal door knock, muffled" -o knock.ogg`
- earshot **沒有**的音效要另外找 CC0 錄音（Freesound／BigSoundBank）：日光燈嗡鳴、通風風扇、CRT 高頻聲、無線電雜訊、斧頭劈鐵門、消防警報。

---

## 4. 注意事項（重要）

### 部署
- **Pages 從分支根目錄的 `index.html` 部署**。只有執行 `npm run build`（不帶 `--out`）時才會更新它。
- 推送後約 1–2 分鐘生效。
- 開發中**不要**把半成品的 `index.html` 推上去，否則線上版會立刻變。建議做法：
  - 在功能分支開發，驗證通過後再合併回 `ccr-98a0543d-oehy6f`，並重建 `index.html`。
  - 或者開發時只用 `node scripts/build.mjs --out /tmp/x.html`，不碰根目錄。
- 想把預設分支改名成 `main`：在 GitHub Settings → General 改，Pages 設定也要跟著改選分支。

### 黃金規則（本作的核心承諾，任何改動都不能違反）
- **零跳臉**：不能有東西突然出現在鏡頭前，不能有突發巨響或驚嚇音效。
- **不閃爍**：
  - 任何亮度變化至少 0.4 秒。
  - 0.25 秒內整體畫面亮度變化不超過 30%。
  - 會呼吸、起伏的燈光，振幅不超過 15%，週期至少 0.4 秒。
- **音量**：峰值不超過 -10 dBFS。
- 要遵守「光敏感模式」設定（`reduceFlicker`）。
- 主場景的燈光數量不要改，否則會觸發 shader 重新編譯而卡頓。
- 細節見 `docs/ARCHITECTURE.md` §3。

### 文案
- 所有畫面文字都集中在 `src/data/script.js`，模組裡不能直接寫劇情文字。
- owner 已選擇「原企劃文案可以改寫」，v3 會改寫部分原文案。
- 新文字要維持繁體中文、短句、克制的語氣。

### 手機
- 觸控系統在 `src/core/input.js`、`src/core/quality.js`、`src/systems/TouchControls.js`。
- 新增的 UI（例如階段 1 的對講機選單）必須同時支援觸控：按鈕至少 44px，並避開安全區。
- 也要在直向和橫向各測一次。

### 開發習慣
- **頻繁提交**：雲端曾三次撞到用量上限，中斷時沒提交的工作就沒了。
- `.claude/` 已加入 gitignore，不要提交。
- `dist/` 和 `index.html` 只在要發布時才提交。

---

## 5. 文件地圖

| 文件 | 內容 |
|---|---|
| `README.md` | 遊玩方式、手機說明、開發指令、除錯參數 |
| `CLAUDE.md` | 給 Claude Code 的專案規則（本機會自動讀取） |
| `docs/ARCHITECTURE.md` | 架構、模組契約、黃金規則、劇情節拍、API |
| `docs/DESIGN-NOTES.md` | 原企劃的矛盾與處理、節奏改版（E）、審查修正的刻意偏離（F）、待決定事項 |
| `docs/script/script-v3-draft.md` | **v3 劇本全文**（下一步的依據） |
| `docs/script/implementation-plan.md` | **v3 實作計畫**（下一步的依據） |
| `docs/pacing/` | 監看段節奏改版的規格、提案、進度與各工作包報告 |
| `docs/review/` | 審查發現的問題與修正紀錄 |

---

## 6. 雲端 session 留下、不在倉庫裡的東西

以下東西不在倉庫裡，不需要搬，必要時可以重新產生：
- 審查員與修正者的截圖、量測腳本：原本在雲端的 `/tmp/review-*`、`/tmp/fix-*`。結論都已寫進 `docs/review/` 和 `docs/pacing/results/`。
- earshot 的 clone，在本機重新安裝即可。
- Artifact 預覽連結（https://claude.ai/artifact/JUJxQxMAkvYDgXBrub74C5）：私人連結，內容與線上版相同；之後以 GitHub Pages 為準。
