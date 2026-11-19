// 開發模式：監看 src/ 變更自動重建，並在 http://localhost:5173/blind-spot.html 提供服務
import * as esbuild from 'esbuild';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle, writeHtml } from './build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 5173);

let building = false, queued = false;
async function rebuild() {
  if (building) { queued = true; return; }
  building = true;
  try {
    const t0 = Date.now();
    await writeHtml(await bundle({ minify: false }));
    console.log(`[dev] rebuilt in ${Date.now() - t0} ms`);
  } catch (e) { console.error('[dev] build failed:', e.message); }
  building = false;
  if (queued) { queued = false; rebuild(); }
}
await rebuild();
watch(path.join(root, 'src'), { recursive: true }, () => rebuild());

http.createServer(async (req, res) => {
  try {
    const html = await readFile(path.join(root, 'dist/blind-spot.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  } catch { res.writeHead(500); res.end('build missing'); }
}).listen(port, () => console.log(`[dev] http://localhost:${port}/  (任何路徑都回傳遊戲頁；加 ?debug=1 開啟除錯)`));
void esbuild;
