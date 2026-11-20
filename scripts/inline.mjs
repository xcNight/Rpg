// 把 vite 建置結果（dist/）合併成單一 HTML 檔，方便直接傳到手機或發布成單頁連結。
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const m = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+)"[^>]*><\/script>/);
if (!m) throw new Error('找不到建置後的 script 標籤');
const js = readFileSync(`dist/${m[1]}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const out = html.replace(m[0], '').replace('</body>', `<script type="module">${js}</script>\n</body>`);
writeFileSync('dist/single.html', out);
console.log(`已輸出 dist/single.html（${(out.length / 1024).toFixed(1)} KB）`);
