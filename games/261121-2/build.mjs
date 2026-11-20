// 開発時だけ使う結合スクリプト。実行時ビルドは不要（index.html 1ファイルで動く）。
//   node build.mjs                       → src/*.js を番号順に結合して index.html を作る
//   node build.mjs --preview out.html a.js b.js …
//        → three + 00_core.js + 指定したファイルだけを入れた確認用 HTML を out.html に作る
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, 'src');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const read = (p) => fs.readFileSync(p, 'utf8');

const args = process.argv.slice(2);
let out = path.join(here, 'index.html');
let files;
if (args[0] === '--preview') {
  out = path.resolve(args[1]);
  files = [path.join(src, '00_core.js'), ...args.slice(2).map((f) => path.resolve(f))];
} else {
  files = fs.readdirSync(src).filter((f) => /^\d\d_.*\.js$/.test(f)).sort().map((f) => path.join(src, f));
}

// WebGL が使えないときの代わりの静止画は、埋め込まずに必要になったときだけ読む（最初の読み込みを軽くする）
let fallback = '';
if (fs.existsSync(path.join(here, 'assets', 'fallback.jpg'))) fallback = 'assets/fallback.jpg';

const app = files.map((f) => `/* ── ${path.basename(f)} ── */\n` + read(f)).join('\n;\n');
let html = read(path.join(src, 'shell.html'));
html = html.replace('/*__FALLBACK__*/', () => fallback);
html = html.replace('/*__THREE__*/', () => esc(read(path.join(src, 'three.min.js'))));
html = html.replace('/*__APP__*/', () => esc(app));
fs.writeFileSync(out, html);
console.log('built', path.relative(process.cwd(), out), (html.length / 1024).toFixed(0) + ' KB', files.map((f) => path.basename(f)).join(' '));
