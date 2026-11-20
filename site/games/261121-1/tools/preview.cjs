#!/usr/bin/env node
/* 見た目確認用: 部品を作業台に並べて1枚の画像にする。
   例) node tools/preview.cjs --out /tmp/x.png --files src/js/10-items-pack.js \
         --code "return ['milk','egg'].map(function(k){return Items.make(k)})"
   --code は関数本体。THREE.Object3D の配列を返すと横一列に並べる(1つだけ返してもよい)。
   --files はカンマ区切り(00-util.js と three は自動で入る)。
   --view front|high|top|side|back (既定 front: 少し上から正面)  --size 1000x700  --bg room|dark */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function opt(name, def) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; }
const out = opt('out', path.join(root, 'preview.png'));
const files = (opt('files', '') || '').split(',').filter(Boolean);
const code = opt('code', 'return []');
const view = opt('view', 'front');
const size = opt('size', '1000x700').split('x').map(Number);
const bg = opt('bg', 'room');

const read = (p) => fs.readFileSync(path.isAbsolute(p) ? p : path.join(root, p), 'utf8');
const scripts = [read('src/vendor/three.bundle.js'), read('src/js/00-util.js')].concat(files.map(read));

const runner = `
(function(){
  var T = THREE;
  var renderer = new T.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
  renderer.setSize(${size[0]}, ${size[1]});
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  document.body.appendChild(renderer.domElement);
  var scene = new T.Scene();
  scene.background = new T.Color(${bg === 'dark' ? '0x30343a' : '0xe9e6e0'});
  var pm = new T.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;
  var key = new T.DirectionalLight(0xfff4e6, 2.2);
  key.position.set(0.6, 1.6, 1.2); key.castShadow = true;
  key.shadow.mapSize.set(2048,2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
  var sc = key.shadow.camera; sc.left=-1.5; sc.right=1.5; sc.top=1.5; sc.bottom=-1.5; sc.near=0.1; sc.far=6;
  scene.add(key); scene.add(new T.HemisphereLight(0xffffff, 0xb0a090, 0.4));
  var ground = new T.Mesh(new T.PlaneGeometry(20,20), new T.MeshStandardMaterial({color:${bg === 'dark' ? '0x50545a' : '0xdedad2'}, roughness:0.85}));
  ground.rotation.x = -Math.PI/2; ground.receiveShadow = true; scene.add(ground);
  var objs = (function(){ ${code} })();
  if (objs && objs.isObject3D) objs = [objs];
  objs = objs || [];
  var x = 0, box = new T.Box3(), all = new T.Box3(), sz = new T.Vector3();
  objs.forEach(function(o){
    scene.add(o); o.updateMatrixWorld(true);
    box.setFromObject(o); box.getSize(sz);
    var cx = (box.min.x+box.max.x)/2;
    o.position.x += x + sz.x/2 - cx;
    x += sz.x + Math.max(0.04, sz.x*0.25);
    o.updateMatrixWorld(true);
    all.union(box.setFromObject(o));
  });
  var c = new T.Vector3(); all.getCenter(c); all.getSize(sz);
  key.target.position.copy(c); scene.add(key.target); key.position.add(c);
  var cam = new T.PerspectiveCamera(30, ${size[0]}/${size[1]}, 0.01, 50);
  var dirs = { front:[0,0.45,1], high:[0,1,0.75], top:[0,1,0.02], side:[1,0.35,0.25], back:[0,0.45,-1] };
  var d = new T.Vector3().fromArray(dirs['${view}'] || dirs.front).normalize();
  var rad = 0.5*Math.sqrt(sz.x*sz.x+sz.y*sz.y+sz.z*sz.z);
  var vf = cam.fov*Math.PI/180, hf = 2*Math.atan(Math.tan(vf/2)*cam.aspect);
  var dist = rad/Math.sin(Math.min(vf,hf)/2)*0.92;
  cam.position.copy(c).addScaledVector(d, dist); cam.lookAt(c);
  if (window.__tick) { for (var i=0;i<30;i++) window.__tick(1/30); }
  renderer.render(scene, cam);
  window.__done = true;
})();`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: size[0], height: size[1] } });
  const errs = [];
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  const html = '<!doctype html><html><body style="margin:0;overflow:hidden">' +
    scripts.concat([runner]).map((s) => '<script>' + s.replace(/<\/script/g, '<\\/script') + '</script>').join('\n') + '</body></html>';
  const tmp = path.join(require('os').tmpdir(), 'preview-' + process.pid + '.html');
  fs.writeFileSync(tmp, html);
  await p.goto('file://' + tmp);
  await p.waitForFunction('window.__done === true', null, { timeout: 60000 }).catch(() => errs.push('timeout'));
  await p.screenshot({ path: out });
  await b.close();
  fs.unlinkSync(tmp);
  if (errs.length) console.log('console:\n' + errs.join('\n'));
  console.log('wrote ' + out);
})();
