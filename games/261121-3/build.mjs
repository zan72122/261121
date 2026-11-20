// 開発時だけ使うビルド: src/main.js と three.js を1つの index.html にまとめる（実行時ビルドは不要）。
//   node build.mjs                      -> index.html
//   node build.mjs --entry src/x.js --out /path/preview.html   (見た目確認用)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const entry = path.resolve(here, arg('--entry', 'src/main.js'));
const out = path.resolve(here, arg('--out', 'index.html'));
const r = await build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: !process.argv.includes('--nomin'),
  target: ['es2019', 'safari14'], write: false, legalComments: 'none',
  nodePaths: [path.join(here, 'node_modules')],
  loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' }, logLevel: 'warning',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let fb = '';
const fbPath = path.join(here, 'assets/fallback.jpg');
if (fs.existsSync(fbPath)) fb = 'data:image/jpeg;base64,' + fs.readFileSync(fbPath).toString('base64');
const tpl = fs.readFileSync(path.join(here, 'src/template.html'), 'utf8');
fs.writeFileSync(out, tpl.replace('/*__FALLBACK__*/', fb).replace('/*__BUNDLE__*/', () => js));
console.log('built', path.relative(here, out), (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
