#!/usr/bin/env node
/* node build.cjs [--out 出力先]  src/ から 1ファイルの index.html を作る */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const src = path.join(root, 'src');
const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 && args[oi + 1] ? path.resolve(args[oi + 1]) : path.join(root, 'index.html');

const parts = [];
parts.push(fs.readFileSync(path.join(src, 'vendor', 'three.bundle.js'), 'utf8'));
const jsDir = path.join(src, 'js');
const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
for (const f of files) parts.push('/* ── ' + f + ' ── */\n' + fs.readFileSync(path.join(jsDir, f), 'utf8'));
const bundle = parts.join('\n;\n').replace(/<\/(script)/gi, '<\\/$1');

let fallback = '';
const fb = path.join(src, 'assets', 'fallback.jpg');
if (fs.existsSync(fb)) {
  fallback = '<img alt="" src="data:image/jpeg;base64,' + fs.readFileSync(fb).toString('base64') + '">';
}

let html = fs.readFileSync(path.join(src, 'index.template.html'), 'utf8');
if (html.indexOf('/*__BUNDLE__*/') < 0) throw new Error('template: /*__BUNDLE__*/ が無い');
html = html.replace('<!--FALLBACK-->', () => fallback);
html = html.replace('/*__BUNDLE__*/', () => bundle);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + ' KB, ' + files.length + ' js)');
