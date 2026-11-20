// 開発時だけ使うビルド: src/ と three.js を index.html ＋ later.js にまとめる（実行時ビルドは不要）。
//   node build.mjs                      -> index.html（three.js・台所・共通部分）＋ later.js（歩く・公園）
//   node build.mjs --entry src/x.js --out /path/preview.html   (見た目確認用・1ファイル)
//
// 分け方: 最初の場面（台所）だけを index.html に入れてすぐ表示し、歩く・公園は later.js にして
//   台所が見えてから裏で読み込む（src/later_loader.js）。later.js は three.js や共通の小物モジュールを
//   自分では持たず、index.html 側が window.__bentoShared に出した同じ実体を使う（src/shared.js）。
import { build } from 'esbuild';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const customEntry = arg('--entry', null);
const entry = path.resolve(here, customEntry || 'src/main.js');
const out = path.resolve(here, arg('--out', 'index.html'));
const minify = !process.argv.includes('--nomin');
const common = {
  bundle: true, format: 'iife', minify, target: ['es2019', 'safari14'], write: false, legalComments: 'none',
  nodePaths: [path.join(here, 'node_modules')],
  loader: { '.jpg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl' }, logLevel: 'warning',
};
const safeJs = (t) => t.replace(/<\/script/gi, '<\\/script');

// later.js 側で「index.html にあるもの」を参照に差し替える import（src/shared.js と対応）
const SHARED = {
  'three': 'three',
  'three/examples/jsm/geometries/RoundedBoxGeometry.js': 'rbg',
  'three/examples/jsm/utils/BufferGeometryUtils.js': 'bgu',
  './texutil.js': 'texutil',
  './tween.js': 'tween',
  './state.js': 'state',
  './props_food.js': 'propsFood',
  './props_kitchen.js': 'propsKitchen',
};
const sharedPlugin = {
  name: 'shared',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => (SHARED[a.path] && a.kind === 'import-statement' ? { path: SHARED[a.path], namespace: 'shared' } : undefined));
    b.onLoad({ filter: /.*/, namespace: 'shared' }, (a) => ({ contents: `module.exports = window.__bentoShared[${JSON.stringify(a.path)}];`, loader: 'js' }));
  },
};

// later.js が使う three.js の名前（THREE.xxx と three からの名前付き import）だけを index.html 側で公開する
//   （全部を公開すると three.js の使っていない部分まで index.html に入って重くなる）
const LATER_FILES = ['scene_walk.js', 'scene_park.js', 'props_park.js', 'later.js'];
function threeNamesUsedByLater() {
  const names = new Set();
  for (const f of LATER_FILES) {
    const src = fs.readFileSync(path.join(here, 'src', f), 'utf8');
    for (const m of src.matchAll(/\bTHREE\.([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]three['"]/g)) {
      for (const n of m[1].split(',')) { const k = n.trim().split(/\s+as\s+/)[0]; if (k) names.add(k); }
    }
  }
  return [...names].sort();
}
const subsetPlugin = {
  name: 'three-subset',
  setup(b) {
    b.onResolve({ filter: /^bento-three-subset$/ }, () => ({ path: 'subset', namespace: 'three-subset' }));
    b.onLoad({ filter: /.*/, namespace: 'three-subset' }, () => ({
      contents: `export { ${threeNamesUsedByLater().join(', ')} } from 'three';`, loader: 'js', resolveDir: here,
    }));
  },
};

let laterSrc = 'later.js';
if (!customEntry) {
  const lr = await build({ ...common, entryPoints: [path.join(here, 'src/later.js')], plugins: [sharedPlugin] });
  const lj = lr.outputFiles[0].text;
  const laterOut = path.join(path.dirname(out), 'later.js');
  fs.writeFileSync(laterOut, lj);
  // 更新後に古い later.js がキャッシュから使われないよう、中身のハッシュを付けて読む
  laterSrc = 'later.js?v=' + crypto.createHash('sha1').update(lj).digest('hex').slice(0, 10);
  console.log('built', path.relative(here, laterOut), (fs.statSync(laterOut).size / 1024).toFixed(0) + ' KB');
}
const r = await build({ ...common, entryPoints: [entry], plugins: [subsetPlugin], define: { __LATER_SRC__: JSON.stringify(laterSrc) } });
const js = safeJs(r.outputFiles[0].text);
// WebGL が使えないときだけ読む代替画像（index.html には埋め込まない）
const fb = fs.existsSync(path.join(here, 'assets/fallback.jpg')) ? 'assets/fallback.jpg' : '';
const tpl = fs.readFileSync(path.join(here, 'src/template.html'), 'utf8');
fs.writeFileSync(out, tpl.replace('/*__FALLBACK__*/', fb).replace('/*__BUNDLE__*/', () => js));
console.log('built', path.relative(here, out), (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
