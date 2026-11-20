/* 00-util.js — 小さな共通道具(U)と、品物の登録簿(Items)。ほかの全ファイルより先に読み込まれる。 */
(function () {
  'use strict';
  var T = window.THREE;
  var U = (window.U = {});

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.smooth = function (t) { t = U.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  /* 指数減衰のなめらか追従: v = U.damp(v, target, 12, dt) */
  U.damp = function (a, b, k, dt) { return a + (b - a) * (1 - Math.exp(-k * dt)); };

  /* 再現できる乱数: var r = U.rng(7); r() -> 0..1 */
  U.rng = function (seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.canvas = function (w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };

  /* キャンバスに描いてテクスチャにする。
     U.tex(256,256,function(ctx,w,h){...},{repeat:[2,2], data:false})
     data:true は色ではない地図(粗さ・凹凸など)用で、sRGB にしない。 */
  U.tex = function (w, h, draw, opts) {
    opts = opts || {};
    var c = U.canvas(w, h);
    var ctx = c.getContext('2d');
    draw(ctx, w, h);
    var t = new T.CanvasTexture(c);
    if (!opts.data) t.colorSpace = T.SRGBColorSpace;
    if (opts.repeat) {
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };

  /* 細かい点々のむらを重ねる(素材の「本物らしさ」用)。 */
  U.speckle = function (ctx, w, h, o) {
    o = o || {};
    var r = U.rng(o.seed || 3), n = o.n || 400, s = o.size || 1.5;
    for (var i = 0; i < n; i++) {
      ctx.globalAlpha = (o.alpha || 0.08) * (0.4 + 0.6 * r());
      ctx.fillStyle = r() < (o.lightRatio == null ? 0.5 : o.lightRatio) ? (o.light || '#ffffff') : (o.dark || '#000000');
      var z = s * (0.5 + r());
      ctx.beginPath();
      ctx.arc(r() * w, r() * h, z, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  U.shadow = function (obj, cast, receive) {
    obj.traverse(function (m) {
      if (m.isMesh) {
        m.castShadow = cast !== false && !(m.material && m.material.transparent && m.material.opacity < 0.5);
        m.receiveShadow = receive !== false;
      }
    });
    return obj;
  };

  /* ───────── 品物の登録簿 ─────────
     Items.define(kind, info, build)
       info  = { tall:bool, sound:'slosh'|'rattle'|'tok'|'crinkle'|'thud', heavy:0..1 }
       build = function(){ return THREE.Group }  原点は底の中心(y=0 に置ける)、正面は +Z、実寸(メートル)
     Items.make(kind) -> THREE.Group の複製(形状と素材は共有)。
       group.userData = { kind, w, h, d, r }  (w,h,d は外寸、r は包む球の半径)
     Items.info[kind] には define の info に加えて実測の w,h,d,r が入る。 */
  var Items = (window.Items = {
    order: ['milk', 'juice', 'yogurt', 'pudding', 'egg', 'cheese', 'strawberry', 'tomato', 'apple', 'carrot', 'cabbage', 'watermelon'],
    kinds: [],
    info: {},
    _build: {},
    _proto: {}
  });

  Items.define = function (kind, info, build) {
    if (Items.kinds.indexOf(kind) < 0) Items.kinds.push(kind);
    Items.info[kind] = info || {};
    Items._build[kind] = build;
    delete Items._proto[kind];
  };

  Items.has = function (kind) { return !!Items._build[kind]; };

  Items._prototype = function (kind) {
    var p = Items._proto[kind];
    if (p) return p;
    var b = Items._build[kind];
    if (b) {
      try { p = b(); } catch (e) { if (window.console) console.error('Items.build ' + kind, e); p = null; }
    }
    if (!p) {
      p = new T.Group();
      var m = new T.Mesh(new T.SphereGeometry(0.04, 20, 14), new T.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.7 }));
      m.position.y = 0.04;
      p.add(m);
    }
    U.shadow(p, true, true);
    p.updateMatrixWorld(true);
    var box = new T.Box3().setFromObject(p), size = new T.Vector3();
    box.getSize(size);
    var inf = Items.info[kind] || (Items.info[kind] = {});
    inf.w = size.x; inf.h = size.y; inf.d = size.z;
    inf.r = 0.5 * Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z);
    inf.cy = (box.min.y + box.max.y) / 2;
    Items._proto[kind] = p;
    return p;
  };

  Items.make = function (kind) {
    var p = Items._prototype(kind);
    var g = p.clone(true);
    var inf = Items.info[kind];
    g.userData = { kind: kind, w: inf.w, h: inf.h, d: inf.d, r: inf.r, cy: inf.cy };
    return g;
  };
})();
