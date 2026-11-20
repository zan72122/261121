// later.js — 2つめ以降の場面（歩く・公園）。index.html の後に裏で読み込まれる別ファイル（build.mjs が生成）。
//   読み込まれたら window.__bentoLater に場面ファクトリと「前もって作れるもの」の一覧を置く。
import { createWalkScene } from './scene_walk.js';
import { createParkScene } from './scene_park.js';
import { parkWarmSteps } from './props_park.js';

window.__bentoLater = { createWalkScene, createParkScene, warmSteps: parkWarmSteps };
const cb = window.__bentoLaterReady;
if (typeof cb === 'function') cb();
