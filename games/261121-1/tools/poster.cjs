#!/usr/bin/env node
/* 読み込み中に見せる台所の絵 src/assets/poster.jpg を作る(ゲーム自身の最初の場面を小さく写す)。
   node tools/poster.cjs  → その後 node build.cjs */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto('file://' + path.join(root, 'index.html') + '#reset');
  await p.waitForFunction(() => window.G && G.current === 'home1' && !document.getElementById('ps') &&
    getComputedStyle(document.getElementById('fade')).display === 'none', null, { timeout: 120000 });
  await p.waitForTimeout(600);
  const url = await p.evaluate(() => {
    const src = document.getElementById('c');
    const W = 78, H = Math.round(W * src.height / src.width);
    G.renderer.render(G.scenes.home1.scene, G.scenes.home1.camera);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, W, H);
    return c.toDataURL('image/jpeg', 0.72);
  });
  const buf = Buffer.from(url.split(',')[1], 'base64');
  fs.writeFileSync(path.join(root, 'src', 'assets', 'poster.jpg'), buf);
  console.log('poster.jpg', buf.length, 'bytes');
  await b.close();
})();
