// 打包：src/main.js（含 three.js）→ 單一自足 HTML：dist/blind-spot.html
// 產出的檔案不依賴任何外部資源，可直接雙擊以 file:// 開啟。
import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const minify = !process.argv.includes('--no-minify');

export async function bundle({ minify: min = minify } = {}) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/main.js')],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify: min,
    sourcemap: false,
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

export async function writeHtml(js, outPath = null) {
  const tpl = await readFile(path.join(root, 'src/index.html'), 'utf8');
  // 避免 bundle 內的 "</script" 提前關閉標籤
  const safe = js.replace(/<\/script/gi, '<\\/script');
  const html = tpl.replace('/*__BUNDLE__*/', () => safe);
  const out = outPath ? path.resolve(outPath) : path.join(root, 'dist/blind-spot.html');
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, html);
  return { out, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const t0 = Date.now();
  const js = await bundle();
  const oi = process.argv.indexOf('--out');
  const { out, bytes } = await writeHtml(js, oi > 0 ? process.argv[oi + 1] : null);
  console.log(`built ${path.relative(root, out)}  ${(bytes / 1024).toFixed(0)} KB  in ${Date.now() - t0} ms`);
}
