// shared.js — 後から読み込む later.js（歩く・公園）と同じモジュールを共有するための窓口。
//   later.js は three.js や小物モジュールを自分では持たず、ここで渡した同じ実体（キャッシュ込み）を使う。
//   build.mjs が later 側の import をこの window.__bentoShared に差し替える。
import * as three from 'bento-three-subset'; // later.js が使う three.js の名前だけ（build.mjs が生成）
import * as rbg from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as bgu from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as texutil from './texutil.js';
import * as tween from './tween.js';
import * as state from './state.js';
import * as propsFood from './props_food.js';
import * as propsKitchen from './props_kitchen.js';

export function exposeShared() {
  window.__bentoShared = { three, rbg, bgu, texutil, tween, state, propsFood, propsKitchen };
}
