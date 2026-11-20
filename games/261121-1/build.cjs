#!/usr/bin/env node
/* node build.cjs [--out 出力先]  src/ から 1ファイルの index.html を作る
   - 最初の場面(おうち)に要るコードは <script> でそのまま動かす。
   - 棚・レジのコード(LATER)は <script type="text/plain" id="later"> に入れておき、
     遊んでいる間に 90-main.js が裏で動かす(起動を軽くする)。
   - src/assets/poster.jpg(小さな台所の絵)を、読み込み中にぼかして見せる。 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = path.join(root, 'src');
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 && args[oi + 1] ? path.resolve(args[oi + 1]) : path.join(root, 'index.html');
const LATER = ['30-shelf.js', '40-register.js'];

const esc = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
const jsDir = path.join(src, 'js');
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
const now = [fs.readFileSync(path.join(src, 'vendor', 'three.bundle.js'), 'utf8')];
const later = [];
for (const f of files) {
  const code = '/* ── ' + f + ' ── */\n' + fs.readFileSync(path.join(jsDir, f), 'utf8');
  (LATER.indexOf(f) >= 0 ? later : now).push(code);
}

const dataUri = (f, type) => fs.existsSync(f) ? 'data:' + type + ';base64,' + fs.readFileSync(f).toString('base64') : '';
const fb = dataUri(path.join(src, 'assets', 'fallback.jpg'), 'image/jpeg');
const ps = dataUri(path.join(src, 'assets', 'poster.jpg'), 'image/jpeg');

let html = fs.readFileSync(path.join(src, 'index.template.html'), 'utf8');
for (const k of ['/*__BUNDLE__*/', '/*__LATER__*/', '<!--FALLBACK-->', '<!--POSTER-->']) {
  if (html.indexOf(k) < 0) throw new Error('template: ' + k + ' が無い');
}
html = html.replace('<!--POSTER-->', () => (ps ? '<img alt="" src="' + ps + '">' : ''));
html = html.replace('/*__BUNDLE__*/', () => esc(now.join('\n;\n')));
html = html.replace('/*__LATER__*/', () => esc(later.join('\n;\n')));
/* 代替画面(WebGL が使えない時だけ)の絵は最後に置き、最初の表示を待たせない */
html = html.replace('<!--FALLBACK-->', () => (fb ? '<img alt="" src="' + fb + '">' : ''));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + ' KB, ' +
  (files.length - later.length) + ' js now + ' + later.length + ' later)');
