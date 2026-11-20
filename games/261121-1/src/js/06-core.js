/* 06-core.js — 中心エンジン G: 描画・入力・場面切り替え・手がかり・保存。 */
(function () {
  'use strict';
  var T = window.THREE;
  var G = (window.G = {});

  var SAVE_KEY = 'gf-261121-1';
  var SAVE_SCENES = ['home1', 'shelf', 'register', 'home2'];
  var SCALES = [1.0, 0.85, 0.7, 0.6];
  var FADE = 0.35;

  G.renderer = null;
  G.env = null;
  G.low = false;
  G.time = 0;
  G.view = { w: 1, h: 1, aspect: 1, portrait: true };
  G.safe = { t: 0, r: 0, b: 0, l: 0 };
  G.current = null;
  G.scenes = {};

  /* ───────── 小道具 ───────── */
  function err(where, e) { try { console.error('[G] ' + where, e); } catch (x) {} }
  function snd(name, o) {
    var S = window.Sound;
    if (S && typeof S.play === 'function') { try { S.play(name, o); } catch (e) { err('Sound.play', e); } }
  }
  function sndCall(fn) {
    var S = window.Sound;
    if (S && typeof S[fn] === 'function') { try { S[fn](); } catch (e) { err('Sound.' + fn, e); } }
  }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  var _v1 = new T.Vector3(), _v2 = new T.Vector3(), _v3 = new T.Vector3(), _v4 = new T.Vector3();
  var _q1 = new T.Quaternion();
  var _box = new T.Box3();
  var _ray = new T.Raycaster();
  var _ndc = new T.Vector2();

  function curDef() { return G.current ? G.scenes[G.current] : null; }
  function curCam() { var d = curDef(); return d && d.camera ? d.camera : null; }
  function curScene() { var d = curDef(); return d && d.scene ? d.scene : null; }

  function call(def, name, arg) {
    if (!def || typeof def[name] !== 'function') return undefined;
    try { return def[name](arg); } catch (e) { err((def._name || '?') + '.' + name, e); }
    return undefined;
  }

  /* ───────── 物の中心と半径 ───────── */
  function inScene(obj) {
    var o = obj;
    while (o) { if (o.isScene) return true; o = o.parent; }
    return false;
  }
  function visibleChain(obj) {
    var o = obj;
    while (o) { if (!o.visible) return false; o = o.parent; }
    return true;
  }
  function measure(obj) {
    var ud = obj.userData;
    if (ud._pm) return;
    ud._pm = true;
    if (ud.cy != null && ud.r != null) return;
    obj.updateWorldMatrix(true, true);
    _box.setFromObject(obj);
    if (_box.isEmpty()) {
      if (ud.r == null) ud.r = 0.05;
      ud._pc = new T.Vector3();
      return;
    }
    var c = _box.getCenter(new T.Vector3());
    var rad = _box.getSize(_v4).length() * 0.5;
    var sc = worldScale(obj);
    if (ud.r == null) ud.r = rad / (sc || 1);
    if (ud.cy == null) ud._pc = obj.worldToLocal(c);
  }
  function worldScale(obj) {
    obj.getWorldScale(_v3);
    return Math.max(Math.abs(_v3.x), Math.abs(_v3.y), Math.abs(_v3.z));
  }
  function objCenter(obj, out) {
    measure(obj);
    obj.updateWorldMatrix(true, false);
    var ud = obj.userData;
    if (ud.cy != null) out.set(0, ud.cy, 0);
    else if (ud._pc) out.copy(ud._pc);
    else out.set(0, 0, 0);
    return out.applyMatrix4(obj.matrixWorld);
  }
  function objRadius(obj) {
    measure(obj);
    return (obj.userData.r || 0.05) * worldScale(obj);
  }
  /* target/to の位置: Object3D か function(){return Vector3} */
  function srcPos(src, out) {
    if (!src) return null;
    if (typeof src === 'function') {
      var v;
      try { v = src(); } catch (e) { err('hint src', e); v = null; }
      if (!v) return null;
      return out.copy(v);
    }
    if (src.isObject3D) {
      if (!inScene(src) || !visibleChain(src)) return null;
      return objCenter(src, out);
    }
    if (src.isVector3) return out.copy(src);
    return null;
  }
  function srcRadius(src, def) {
    if (src && src.isObject3D) return objRadius(src);
    return def || 0.06;
  }
  G._center = function (obj, out) { return objCenter(obj, out || new T.Vector3()); };

  /* ───────── 保存 ───────── */
  function defaultState() {
    return { v: 1, scene: 'home1', trip: 0, basket: [], scanned: [], bag: [], fridge: [], receipt: [], done: false };
  }
  function validKind(k) { return typeof k === 'string' && window.Items && Items.order.indexOf(k) >= 0; }
  function kindList(a) {
    var out = [];
    if (Array.isArray(a)) for (var i = 0; i < a.length; i++) if (validKind(a[i])) out.push(a[i]);
    return out;
  }
  function sanitize(s) {
    var d = defaultState();
    if (!s || typeof s !== 'object' || Array.isArray(s)) return d;
    if (typeof s.scene === 'string' && SAVE_SCENES.indexOf(s.scene) >= 0) d.scene = s.scene;
    if (typeof s.trip === 'number' && isFinite(s.trip) && s.trip >= 0) d.trip = Math.floor(s.trip);
    d.basket = kindList(s.basket);
    d.scanned = kindList(s.scanned);
    d.bag = kindList(s.bag);
    d.receipt = kindList(s.receipt);
    if (Array.isArray(s.fridge)) {
      for (var i = 0; i < s.fridge.length; i++) {
        var f = s.fridge[i];
        if (f && typeof f === 'object' && validKind(f.k) && (typeof f.s === 'number' || typeof f.s === 'string')) {
          if (typeof f.s === 'number' && !isFinite(f.s)) continue;
          d.fridge.push({ k: f.k, s: f.s });
        }
      }
    }
    d.done = s.done === true;
    return d;
  }
  function load() {
    var raw = null;
    try { raw = window.localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
    if (!raw) return defaultState();
    try { return sanitize(JSON.parse(raw)); } catch (e) { return defaultState(); }
  }
  var saveTimer = 0;
  function writeNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    try { G.state = sanitize(G.state); window.localStorage.setItem(SAVE_KEY, JSON.stringify(G.state)); } catch (e) {}
  }
  G.state = defaultState();
  G.save = function () {
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = 0; writeNow(); }, 300);
  };
  G.resetState = function () {
    G.state = defaultState();
    try { window.localStorage.removeItem(SAVE_KEY); } catch (e) {}
    G.save();
  };

  /* ───────── tween / after / ease ───────── */
  G.ease = {
    linear: function (t) { return t; },
    out: function (t) { var u = 1 - t; return 1 - u * u * u; },
    inOut: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    back: function (t) { var c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; },
    bounce: function (t) {
      var n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) { t -= 1.5 / d; return n * t * t + 0.75; }
      if (t < 2.5 / d) { t -= 2.25 / d; return n * t * t + 0.9375; }
      t -= 2.625 / d; return n * t * t + 0.984375;
    },
    elastic: function (t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    }
  };
  var tweens = [];
  function mkHandle(tw) { return { stop: function () { tw.dead = true; } }; }
  G.tween = function (dur, fn, o) {
    o = o || {};
    var e = o.ease;
    if (typeof e === 'string') e = G.ease[e];
    if (typeof e !== 'function') e = G.ease.inOut;
    var tw = { dur: Math.max(0, +dur || 0), fn: fn, ease: e, t: -(+o.delay || 0), done: o.done, owner: G.current, dead: false, started: false };
    tweens.push(tw);
    return mkHandle(tw);
  };
  G.after = function (sec, fn) {
    var tw = { dur: 0, fn: null, ease: null, t: -(+sec || 0), done: fn, owner: G.current, dead: false, after: true };
    tweens.push(tw);
    return mkHandle(tw);
  };
  function stepTweens(dt) {
    var n = tweens.length, i, tw;
    for (i = 0; i < n; i++) {
      tw = tweens[i];
      if (tw.dead) continue;
      tw.t += dt;
      if (tw.t < 0) continue;
      var raw = tw.dur > 0 ? Math.min(1, tw.t / tw.dur) : 1;
      if (tw.fn) { try { tw.fn(tw.ease(raw), raw); } catch (e) { err('tween', e); } }
      if (raw >= 1) {
        tw.dead = true;
        if (typeof tw.done === 'function') { try { tw.done(); } catch (e) { err(tw.after ? 'after' : 'tween.done', e); } }
      }
    }
    var j = 0;
    for (i = 0; i < tweens.length; i++) if (!tweens[i].dead) tweens[j++] = tweens[i];
    tweens.length = j;
  }

  /* ───────── 光のにじみ(glow) ───────── */
  var glowTex = null, dotTex = null;
  function radialTex(stops) {
    var c = document.createElement('canvas');
    c.width = c.height = 128;
    var x = c.getContext('2d');
    var g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    var t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace;
    return t;
  }
  function getGlowTex() {
    if (!glowTex) glowTex = radialTex([[0, 'rgba(255,255,255,0.10)'], [0.4, 'rgba(255,255,255,0.30)'], [0.62, 'rgba(255,255,255,0.55)'], [0.8, 'rgba(255,255,255,0.20)'], [1, 'rgba(255,255,255,0)']]);
    return glowTex;
  }
  function getDotTex() {
    if (!dotTex) dotTex = radialTex([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.75)'], [0.7, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]);
    return dotTex;
  }

  var glows = [];
  function Glow(src, o) {
    o = o || {};
    this.src = src;
    this.size = o.size || 1.5;
    this.r = o.r || 0.06;
    this.lv = 1;
    this.cur = 0;
    this.owner = G.current;
    this.phase = Math.random() * 6.28;
    var m = new T.SpriteMaterial({ map: getGlowTex(), color: new T.Color(o.color == null ? 0xffd45c : o.color), blending: T.NormalBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0, toneMapped: false });
    this.sprite = new T.Sprite(m);
    this.sprite.renderOrder = 900;
    this.sprite.visible = false;
    this.sprite.userData.noPick = true;
    this.dead = false;
    glows.push(this);
  }
  Glow.prototype.update = function (dt) {
    var sc = curScene();
    var s = this.sprite;
    if (s.parent !== sc) { if (s.parent) s.parent.remove(s); if (sc) sc.add(s); }
    this.cur = U.damp(this.cur, this.lv, 6, dt);
    var p = srcPos(this.src, _v1);
    if (!p || this.cur < 0.01) { s.visible = false; return; }
    var rad = Math.min(0.2, srcRadius(this.src, this.r) * this.size);
    var pulse = Math.sin(G.time * 2.6 + this.phase);
    s.position.copy(p);
    var k = rad * 2 * (1 + 0.07 * pulse) * (0.85 + 0.15 * Math.min(this.cur, 1.5));
    s.scale.set(k, k, 1);
    s.material.opacity = Math.min(1, this.cur * (0.6 + 0.22 * pulse));
    s.visible = true;
  };
  Glow.prototype.remove = function () {
    if (this.dead) return;
    this.dead = true;
    if (this.sprite.parent) this.sprite.parent.remove(this.sprite);
    this.sprite.material.dispose();
    var i = glows.indexOf(this);
    if (i >= 0) glows.splice(i, 1);
  };
  G.glow = function (obj, o) {
    var gl = new Glow(obj, o);
    return {
      level: function (v) { gl.lv = Math.max(0, +v || 0); },
      remove: function () { gl.remove(); }
    };
  };

  /* ───────── 粒(puff) ───────── */
  var puffs = [];
  G.puff = function (pos, o) {
    o = o || {};
    var sc = curScene();
    if (!sc || !pos) return;
    var n = Math.max(0, Math.min(32, o.n == null ? 8 : o.n | 0));
    var max = G.low ? 24 : 64;
    var col = new T.Color(o.color == null ? 0xffffff : o.color);
    var size = o.size || 0.03, up = o.up == null ? 0.1 : o.up, spread = o.spread == null ? 0.05 : o.spread, life = o.life || 0.8;
    for (var i = 0; i < n; i++) {
      var pf = null, j, live = 0;
      for (j = 0; j < puffs.length; j++) if (puffs[j].alive) live++;
      if (live >= max) {
        var oldest = null;
        for (j = 0; j < puffs.length; j++) if (puffs[j].alive && (!oldest || puffs[j].age / puffs[j].life > oldest.age / oldest.life)) oldest = puffs[j];
        pf = oldest;
      } else {
        for (j = 0; j < puffs.length; j++) if (!puffs[j].alive) { pf = puffs[j]; break; }
        if (!pf && puffs.length < 64) {
          var m = new T.SpriteMaterial({ map: getDotTex(), transparent: true, depthWrite: false, opacity: 0 });
          pf = { sp: new T.Sprite(m), v: new T.Vector3(), alive: false, age: 0, life: 1, size: 0.03, a: 1 };
          pf.sp.userData.noPick = true;
          pf.sp.renderOrder = 800;
          puffs.push(pf);
        }
      }
      if (!pf) break;
      if (pf.sp.parent !== sc) { if (pf.sp.parent) pf.sp.parent.remove(pf.sp); sc.add(pf.sp); }
      pf.alive = true;
      pf.age = 0;
      pf.life = life * (0.7 + 0.6 * Math.random());
      pf.size = size * (0.6 + 0.8 * Math.random());
      pf.owner = G.current;
      pf.sp.material.color.copy(col);
      pf.sp.position.set(pos.x + (Math.random() - 0.5) * spread, pos.y + (Math.random() - 0.5) * spread * 0.5, pos.z + (Math.random() - 0.5) * spread);
      var a = Math.random() * 6.2832;
      var h = spread * (0.6 + Math.random());
      pf.v.set(Math.cos(a) * h, up * (0.6 + 0.8 * Math.random()), Math.sin(a) * h);
      pf.sp.visible = true;
    }
  };
  function stepPuffs(dt) {
    for (var i = 0; i < puffs.length; i++) {
      var pf = puffs[i];
      if (!pf.alive) continue;
      pf.age += dt;
      var k = pf.age / pf.life;
      if (k >= 1) { killPuff(pf); continue; }
      pf.sp.position.addScaledVector(pf.v, dt);
      pf.v.multiplyScalar(Math.exp(-1.8 * dt));
      var s = pf.size * (0.7 + 0.8 * k);
      pf.sp.scale.set(s, s, 1);
      pf.sp.material.opacity = 0.75 * Math.min(1, k * 6) * (1 - k) * (1 - k);
    }
  }
  function killPuff(pf) {
    pf.alive = false;
    pf.sp.visible = false;
    if (pf.sp.parent) pf.sp.parent.remove(pf.sp);
  }

  /* ───────── 揺れ(shake) ───────── */
  var shakes = [];
  G.shake = function (obj, amp, dur) {
    if (!obj || !obj.isObject3D) return;
    amp = amp == null ? 0.05 : +amp;
    dur = dur == null ? 0.4 : Math.max(0.05, +dur);
    var sh = obj.userData._shake;
    if (sh && !sh.dead) {
      sh.t = 0; sh.amp = amp; sh.dur = dur; sh.owner = G.current;
      return;
    }
    sh = { obj: obj, t: 0, amp: amp, dur: dur, rz: 0, y: 0, dead: false, owner: G.current, ph: Math.random() > 0.5 ? 1 : -1 };
    obj.userData._shake = sh;
    shakes.push(sh);
  };
  function shakeApply(sh, rz, y) {
    sh.obj.rotation.z += rz - sh.rz;
    sh.obj.position.y += y - sh.y;
    sh.rz = rz; sh.y = y;
  }
  function shakeEnd(sh) {
    sh.obj.rotation.z -= sh.rz;
    sh.obj.position.y -= sh.y;
    sh.rz = 0; sh.y = 0;
    sh.dead = true;
    if (sh.obj.userData._shake === sh) delete sh.obj.userData._shake;
  }
  function stepShakes(dt) {
    var j = 0;
    for (var i = 0; i < shakes.length; i++) {
      var sh = shakes[i];
      if (!sh.dead) {
        sh.t += dt;
        var k = sh.t / sh.dur;
        if (k >= 1) shakeEnd(sh);
        else {
          var d = (1 - k) * (1 - k);
          var w = sh.t * Math.PI * 2 * 6.5;
          shakeApply(sh, sh.ph * sh.amp * 3 * d * Math.sin(w), sh.amp * 0.12 * d * Math.abs(Math.sin(w)));
        }
      }
      if (!sh.dead) shakes[j++] = sh;
    }
    shakes.length = j;
  }

  /* ───────── 画面座標 ───────── */
  G.screen = function (v, out) {
    out = out || { x: 0, y: 0 };
    var cam = curCam();
    if (!cam || !v) { out.x = 0; out.y = 0; return out; }
    cam.updateMatrixWorld();
    _v2.copy(v).project(cam);
    out.x = (_v2.x * 0.5 + 0.5) * G.view.w;
    out.y = (-_v2.y * 0.5 + 0.5) * G.view.h;
    out.z = _v2.z;
    return out;
  };
  G.onPlane = function (p, plane, out) {
    var cam = curCam();
    if (!cam || !p || !plane) return null;
    cam.updateMatrixWorld();
    if (p.ndc) _ndc.copy(p.ndc);
    else _ndc.set(p.x / G.view.w * 2 - 1, -(p.y / G.view.h) * 2 + 1);
    _ray.setFromCamera(_ndc, cam);
    return _ray.ray.intersectPlane(plane, out || new T.Vector3());
  };

  var _sp = { x: 0, y: 0, z: 0 }, _sp2 = { x: 0, y: 0, z: 0 }, _pickR = new T.Vector3();
  G.pick = function (p, list, marginPx) {
    var cam = curCam();
    if (!cam || !p || !list) return null;
    if (marginPx == null) marginPx = 24;
    cam.updateMatrixWorld();
    var cr = _pickR.setFromMatrixColumn(cam.matrixWorld, 0).normalize(); /* カメラの右 */
    var best = null, bestS = Infinity;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o || !o.isObject3D || o.userData.noPick) continue;
      if (!visibleChain(o) || !inScene(o)) continue;
      objCenter(o, _v1);
      var r = objRadius(o);
      G.screen(_v1, _sp);
      if (_sp.z > 1 || _sp.z < -1) continue;
      _v1.addScaledVector(cr, r);
      G.screen(_v1, _sp2);
      var rp = Math.max(34, Math.sqrt((_sp2.x - _sp.x) * (_sp2.x - _sp.x) + (_sp2.y - _sp.y) * (_sp2.y - _sp.y)));
      var dx = p.x - _sp.x, dy = p.y - _sp.y;
      var s = Math.sqrt(dx * dx + dy * dy) - rp;
      if (s < bestS) { bestS = s; best = o; }
    }
    return best && bestS <= marginPx ? best : null;
  };

  /* ───────── カメラ合わせ ───────── */
  G.fit = function (camera, o) {
    if (!camera) return 0;
    o = o || {};
    var center = o.center || _v1.set(0, 0, 0);
    var w = Math.max(1e-3, o.w || 1), h = Math.max(1e-3, o.h || 1);
    var pitch = o.pitch || 0, yaw = o.yaw || 0;
    var fov = o.fov || 35;
    var vw = G.view.w, vh = G.view.h, sf = G.safe;
    camera.fov = fov;
    camera.aspect = vw / vh;
    var sw = Math.max(vw * 0.5, vw - 2 * Math.max(sf.l, sf.r));
    var sh = Math.max(vh * 0.5, vh - 2 * Math.max(sf.t, sf.b));
    var tv = Math.tan(fov * Math.PI / 360);
    var th = tv * camera.aspect;
    var dh = (h * 0.5) / (tv * (sh / vh));
    var dw = (w * 0.5) / (th * (sw / vw));
    var d = Math.max(dh, dw);
    var cx = center.x, cy = center.y, cz = center.z;
    camera.position.set(cx + d * Math.sin(yaw) * Math.cos(pitch), cy + d * Math.sin(pitch), cz + d * Math.cos(yaw) * Math.cos(pitch));
    camera.up.set(0, 1, 0);
    camera.lookAt(cx, cy, cz);
    camera.near = 0.05;
    camera.far = Math.max(60, d * 4);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return d;
  };

  /* ───────── 品物の絵(icon) ───────── */
  var iconCache = {};
  var ic = null;
  function iconSetup() {
    if (ic) return ic;
    var r = G.renderer;
    ic = {};
    ic.scene = new T.Scene();
    ic.scene.environment = G.env;
    ic.scene.environmentIntensity = 0.9;
    ic.scene.add(new T.HemisphereLight(0xfff6ee, 0x806050, 0.6));
    var dl = new T.DirectionalLight(0xfff2e0, 2.1);
    dl.position.set(-0.6, 1.5, 1.2);
    ic.scene.add(dl);
    ic.scene.add(dl.target);
    ic.cam = new T.PerspectiveCamera(28, 1, 0.01, 20);
    var caps = r.capabilities || {};
    ic.rt1 = new T.WebGLRenderTarget(256, 256, { type: T.HalfFloatType, samples: caps.isWebGL2 === false ? 0 : 4 });
    ic.rt2 = new T.WebGLRenderTarget(256, 256, { type: T.UnsignedByteType, depthBuffer: false });
    ic.qs = new T.Scene();
    ic.qc = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    ic.qm = new T.ShaderMaterial({
      uniforms: { tMap: { value: ic.rt1.texture }, uExp: { value: 1.0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform sampler2D tMap; uniform float uExp; varying vec2 vUv;',
        'vec3 fitA(vec3 v){ vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return a/b; }',
        'vec3 aces(vec3 c){',
        '  const mat3 I = mat3(vec3(0.59719,0.07600,0.02840), vec3(0.35458,0.90834,0.13383), vec3(0.04823,0.01566,0.83777));',
        '  const mat3 O = mat3(vec3(1.60475,-0.10208,-0.00327), vec3(-0.53108,1.10813,-0.07276), vec3(-0.07367,-0.00605,1.07602));',
        '  c *= uExp/0.6; c = I*c; c = fitA(c); c = O*c; return clamp(c,0.0,1.0); }',
        'vec3 oetf(vec3 c){ return mix(pow(c, vec3(0.41666))*1.055-vec3(0.055), c*12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }',
        'void main(){ vec4 t = texture2D(tMap, vUv); float a = clamp(t.a,0.0,1.0);',
        '  vec3 c = a > 0.001 ? t.rgb / a : vec3(0.0);',
        '  gl_FragColor = vec4(oetf(aces(max(c,vec3(0.0)))), a); }'
      ].join('\n'),
      depthTest: false, depthWrite: false, toneMapped: false
    });
    ic.qs.add(new T.Mesh(new T.PlaneGeometry(2, 2), ic.qm));
    ic.buf = new Uint8Array(256 * 256 * 4);
    return ic;
  }
  G.icon = function (kind) {
    if (iconCache[kind]) return iconCache[kind];
    var cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    var r = G.renderer;
    if (!r || !window.Items) return cv;
    var obj = null, s = null;
    var prevRT = null, prevCol = new T.Color(), prevA = 1, prevAuto = true;
    try {
      s = iconSetup();
      prevRT = r.getRenderTarget();
      r.getClearColor(prevCol);
      prevA = r.getClearAlpha();
      prevAuto = r.shadowMap.autoUpdate;
      obj = Items.make(kind);
      s.scene.add(obj);
      obj.updateMatrixWorld(true);
      _box.setFromObject(obj);
      if (_box.isEmpty()) _box.set(_v1.set(-0.05, 0, -0.05), _v2.set(0.05, 0.1, 0.05));
      var c = _box.getCenter(new T.Vector3());
      var cam = s.cam;
      var pitch = 0.42, yaw = 0.38;
      cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch), c.y + Math.sin(pitch), c.z + Math.cos(yaw) * Math.cos(pitch));
      cam.lookAt(c);
      cam.updateMatrixWorld();
      _q1.copy(cam.quaternion).invert();
      var k = Math.tan(cam.fov * Math.PI / 360) * 0.86, d = 0.05;
      for (var i = 0; i < 8; i++) {
        _v3.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).sub(c).applyQuaternion(_q1);
        d = Math.max(d, Math.max(Math.abs(_v3.x), Math.abs(_v3.y)) / k + _v3.z);
      }
      cam.position.sub(c).normalize().multiplyScalar(d).add(c);
      cam.near = Math.max(0.005, d * 0.05);
      cam.far = d * 4 + 1;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      r.shadowMap.autoUpdate = false;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(s.rt1);
      r.clear(true, true, true);
      r.render(s.scene, cam);
      r.setRenderTarget(s.rt2);
      r.clear(true, true, true);
      r.render(s.qs, s.qc);
      r.readRenderTargetPixels(s.rt2, 0, 0, 256, 256, s.buf);
      var cx = cv.getContext('2d');
      var img = cx.createImageData(256, 256);
      var row = 256 * 4;
      for (var y = 0; y < 256; y++) img.data.set(s.buf.subarray((255 - y) * row, (256 - y) * row), y * row);
      cx.putImageData(img, 0, 0);
      iconCache[kind] = cv;
    } catch (e) {
      err('icon ' + kind, e);
    }
    try {
      if (obj && obj.parent) obj.parent.remove(obj);
      r.setRenderTarget(prevRT);
      r.setClearColor(prevCol, prevA);
      r.shadowMap.autoUpdate = prevAuto;
    } catch (e2) { err('icon restore', e2); }
    return cv;
  };

  /* ───────── 手がかり(hint) ───────── */
  var H = { spec: null, t: 0, nextW: 4, glow: null, ghost: null, ghostTried: false, gt: 0, gOn: false, pose: '', len: 0.18, tipL: new T.Vector3(0, 0.18, 0), fb: null };
  function clearHint() {
    H.spec = null;
    if (H.glow) { H.glow.remove(); H.glow = null; }
    ghostHide();
  }
  G.hint = function (spec) {
    if (!spec || !spec.target) { clearHint(); return; }
    if (H.spec && H.spec.key === spec.key && H.spec.target === spec.target) { H.spec = spec; return; }
    clearHint();
    H.spec = spec;
    H.t = 0;
    H.nextW = 4;
    H.glow = new Glow(spec.target, { size: 1.5 });
    H.glow.owner = null; /* clearHint で片付ける */
  };
  function hintActivity() { H.t = 0; H.nextW = 4; }

  function ghostMake() {
    if (H.ghost || H.fb) return;
    if (!H.ghostTried && window.Hand && typeof Hand.create === 'function') {
      H.ghostTried = true;
      try {
        var h = Hand.create({ ghost: true });
        if (h && h.group) {
          H.ghost = h;
          h.group.updateMatrixWorld(true);
          _box.setFromObject(h.group);
          if (!_box.isEmpty()) H.len = Math.max(0.05, _box.max.y - _box.min.y);
          if (h.tip) {
            h.tip.updateWorldMatrix(true, false);
            h.tip.getWorldPosition(H.tipL);
            h.group.worldToLocal(H.tipL);
          } else H.tipL.set(0, H.len, 0);
          h.group.traverse(function (m) { m.renderOrder = (m.material && m.material.colorWrite === false) ? 949 : 950; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; m.userData.noPick = true; });
          h.group.visible = false;
          return;
        }
      } catch (e) { err('Hand.create', e); H.ghost = null; }
    }
    if (!H.fb) {
      H.fb = new T.Sprite(new T.SpriteMaterial({ map: getDotTex(), color: 0xfff6e8, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
      H.fb.renderOrder = 950;
      H.fb.visible = false;
    }
  }
  function ghostObj() { return H.ghost ? H.ghost.group : H.fb; }
  function ghostHide() {
    H.gOn = false;
    H.gt = 0;
    var g = ghostObj();
    if (g) { g.visible = false; if (g.parent) g.parent.remove(g); }
  }
  function ghostPose(n) {
    if (H.ghost && H.pose !== n && typeof H.ghost.pose === 'function') {
      H.pose = n;
      try { H.ghost.pose(n, 0.25); } catch (e) { err('Hand.pose', e); }
    }
  }
  /* 時刻 u の時の {path 0..1, sink 0..1, alpha 0..1} */
  function ghostState(u, hasTo, out) {
    var A = 0.45, P = 0.3, C = 1.3, R = 0.3, F = 0.35, REST = 1.2;
    out.path = 0; out.sink = 0; out.alpha = 1; out.app = 1;
    var total;
    if (hasTo) {
      total = A + P + C + 0.15 + R + F + REST;
      u = u % total;
      if (u < A) { out.app = U.smooth(u / A); out.alpha = out.app; return; }
      u -= A;
      if (u < P) { out.sink = U.smooth(u / P); return; }
      u -= P; out.sink = 1;
      if (u < C) { out.path = G.ease.inOut(u / C); return; }
      u -= C; out.path = 1;
      if (u < 0.15) return;
      u -= 0.15;
      if (u < R) { out.sink = 1 - U.smooth(u / R); return; }
      u -= R; out.sink = 0;
      if (u < F) { out.alpha = 1 - U.smooth(u / F); return; }
      out.alpha = 0;
    } else {
      var TP = 0.22;
      total = A + TP * 4 + 0.1 + F + REST;
      u = u % total;
      if (u < A) { out.app = U.smooth(u / A); out.alpha = out.app; return; }
      u -= A;
      if (u < TP * 4) { var i = Math.floor(u / TP), f = (u - i * TP) / TP; out.sink = i % 2 === 0 ? U.smooth(f) : 1 - U.smooth(f); return; }
      u -= TP * 4;
      if (u < 0.1) return;
      u -= 0.1;
      if (u < F) { out.alpha = 1 - U.smooth(u / F); return; }
      out.alpha = 0;
    }
  }
  var _gs = { path: 0, sink: 0, alpha: 0, app: 0 };
  var _gA = new T.Vector3(), _gB = new T.Vector3(), _gP = new T.Vector3(), _gR = new T.Vector3(), _gU = new T.Vector3(), _gF = new T.Vector3();
  var _rotZ = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), 0.6);
  function ghostUpdate(dt) {
    var sc = curScene(), cam = curCam(), spec = H.spec;
    if (!sc || !cam || !spec) { ghostHide(); return; }
    ghostMake();
    var g = ghostObj();
    if (!g) return;
    if (!srcPos(spec.target, _gA)) { g.visible = false; return; }
    var hasTo = !!(spec.to && srcPos(spec.to, _gB));
    if (g.parent !== sc) { if (g.parent) g.parent.remove(g); sc.add(g); }
    if (!H.gOn) { H.gOn = true; H.gt = 0; H.pose = ''; }
    H.gt += dt;
    ghostState(H.gt, hasTo, _gs);
    if (hasTo) _gA.lerp(_gB, _gs.path);
    cam.updateMatrixWorld();
    var cp = cam.getWorldPosition(_gF);
    var dist = cp.distanceTo(_gA);
    _gP.copy(cp).lerp(_gA, 0.25);
    var dP = dist * 0.25;
    var visH = 2 * dP * Math.tan(cam.fov * Math.PI / 360) / (cam.zoom || 1);
    var handScreen = 0.22 * visH;
    _gR.setFromMatrixColumn(cam.matrixWorld, 0).normalize();
    _gU.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    /* 現れる時は右下から少し寄ってくる */
    var off = (1 - _gs.app) * handScreen * 0.35;
    _gP.addScaledVector(_gR, off).addScaledVector(_gU, -off);
    var sink = _gs.sink;
    if (H.ghost) {
      var s = (handScreen / H.len) * (1 - 0.08 * sink);
      g.quaternion.copy(cam.quaternion).multiply(_rotZ);
      g.scale.setScalar(s);
      _v3.copy(H.tipL).multiplyScalar(s).applyQuaternion(g.quaternion);
      g.position.copy(_gP).sub(_v3);
      ghostPose('point');
      if (typeof H.ghost.setOpacity === 'function') { try { H.ghost.setOpacity(_gs.alpha); } catch (e) { err('Hand.setOpacity', e); } }
      if (typeof H.ghost.update === 'function') { try { H.ghost.update(dt); } catch (e2) { err('Hand.update', e2); } }
    } else {
      var k = handScreen * 0.35 * (1 - 0.2 * sink);
      g.position.copy(_gP);
      g.scale.set(k, k, 1);
      g.material.opacity = 0.55 * _gs.alpha;
    }
    g.visible = _gs.alpha > 0.01;
  }
  function stepHint(dt) {
    var spec = H.spec;
    if (!spec) return;
    var held = ptr.id !== null && !ptr.ignored;
    if (held || switching) hintActivity();
    else H.t += dt;
    if (H.glow) {
      H.glow.src = held && spec.to ? spec.to : spec.target;
      H.glow.lv = H.t >= 4 ? 1.5 : 1;
    }
    if (H.t >= H.nextW) {
      H.nextW += 3;
      if (typeof spec.wiggle === 'function') { try { spec.wiggle(); } catch (e) { err('hint.wiggle', e); } }
      snd('hint');
    }
    if (H.t >= 9) ghostUpdate(dt);
    else if (H.gOn || (ghostObj() && ghostObj().visible)) ghostHide();
  }

  /* ───────── 場面 ───────── */
  var switching = false, fadePhase = '', fadeT = 0, nextName = null, queued = null;
  var fadeEl = null;
  G.addScene = function (name, def) {
    if (!name || !def) return;
    def._name = name;
    def._built = false;
    G.scenes[name] = def;
  };
  G.go = function (name) {
    if (!G.scenes[name] || !G.renderer) return;
    if (switching) {
      if (fadePhase !== 'out' && name !== nextName) queued = name;
      return;
    }
    switching = true;
    nextName = name;
    queued = null;
    cancelPointer();
    if (!G.current) { fadePhase = 'swap'; doSwap(); }
    else { fadePhase = 'out'; fadeT = 0; }
  };
  function killOwned(owner) {
    var i;
    for (i = 0; i < tweens.length; i++) if (tweens[i].owner === owner) tweens[i].dead = true;
    for (i = glows.length - 1; i >= 0; i--) if (glows[i].owner === owner) glows[i].remove();
    for (i = 0; i < puffs.length; i++) if (puffs[i].alive) killPuff(puffs[i]);
    for (i = 0; i < shakes.length; i++) if (shakes[i].owner === owner && !shakes[i].dead) shakeEnd(shakes[i]);
  }
  function doSwap() {
    var from = G.current;
    var old = curDef();
    if (old) {
      clearHint();
      call(old, 'exit');
      killOwned(from);
      clearHint();
    }
    var def = G.scenes[nextName];
    G.current = nextName;
    if (SAVE_SCENES.indexOf(nextName) >= 0 && G.state.scene !== nextName) { G.state.scene = nextName; G.save(); }
    if (!def._built) { def._built = true; call(def, 'build'); }
    if (def.scene && !def.scene.environment && G.env) { def.scene.environment = G.env; }
    call(def, 'enter', from);
    call(def, 'layout');
    fadePhase = 'in';
    fadeT = 0;
    perfSkip = 2;
  }
  function stepFade(dt) {
    if (!switching) return;
    fadeT += dt;
    if (fadePhase === 'out') {
      setFade(Math.min(1, fadeT / FADE));
      if (fadeT >= FADE) { setFade(1); fadePhase = 'swap'; doSwap(); }
    } else if (fadePhase === 'in') {
      setFade(1 - Math.min(1, fadeT / FADE));
      if (fadeT >= FADE) {
        setFade(0);
        switching = false;
        fadePhase = '';
        nextName = null;
        if (queued && queued !== G.current) { var q = queued; queued = null; G.go(q); }
        queued = null;
      }
    }
  }
  var lastFade = -1;
  function setFade(a) {
    if (!fadeEl) return;
    a = Math.round(a * 1000) / 1000;
    if (a === lastFade) return;
    lastFade = a;
    fadeEl.style.opacity = String(a);
    fadeEl.style.display = a <= 0 ? 'none' : 'block';
  }

  /* ───────── 入力 ───────── */
  var ptr = { id: null, type: '', p: null, ignored: false, t0: 0, sx: 0, sy: 0 };
  var canvas = null;
  function mkP(e) {
    var p = ptr.p;
    p.x = e.clientX;
    p.y = e.clientY;
    p.ndc.set(p.x / G.view.w * 2 - 1, -(p.y / G.view.h) * 2 + 1);
    p.dx = p.x - ptr.sx;
    p.dy = p.y - ptr.sy;
    var d = Math.sqrt(p.dx * p.dx + p.dy * p.dy);
    if (d > p.dist) p.dist = d;
    p.t = (now() - ptr.t0) / 1000;
    return p;
  }
  function onDown(e) {
    try { e.preventDefault(); } catch (x) {}
    sndCall('unlock');
    if (ptr.id !== null) return;
    ptr.id = e.pointerId;
    ptr.type = e.pointerType || '';
    ptr.t0 = now();
    ptr.sx = e.clientX; ptr.sy = e.clientY;
    ptr.p = { x: 0, y: 0, ndc: new T.Vector2(), dx: 0, dy: 0, dist: 0, t: 0, cancel: false };
    ptr.ignored = switching || !curDef();
    try { canvas.setPointerCapture(e.pointerId); } catch (x2) {}
    hintActivity();
    var p = mkP(e);
    if (!ptr.ignored) call(curDef(), 'down', p);
  }
  function onMove(e) {
    if (e.pointerId !== ptr.id) return;
    try { e.preventDefault(); } catch (x) {}
    hintActivity();
    var p = mkP(e);
    if (!ptr.ignored && !switching) call(curDef(), 'move', p);
  }
  function onUp(e) {
    if (e.pointerId !== ptr.id) return;
    try { e.preventDefault(); } catch (x) {}
    sndCall('unlock');
    var p = mkP(e);
    p.cancel = e.type !== 'pointerup';
    endPointer(p);
  }
  function endPointer(p) {
    var ign = ptr.ignored || switching;
    var id = ptr.id;
    ptr.id = null;
    ptr.ignored = false;
    hintActivity();
    try { if (id !== null && canvas.hasPointerCapture && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch (x) {}
    if (!ign) call(curDef(), 'up', p);
  }
  function cancelPointer() {
    if (ptr.id === null) return;
    var p = ptr.p;
    p.cancel = true;
    p.t = (now() - ptr.t0) / 1000;
    endPointer(p);
  }
  function onTouchEnd(e) {
    if (ptr.id === null || ptr.type !== 'touch') return;
    if (e.touches && e.touches.length === 0) {
      var id = ptr.id;
      setTimeout(function () { if (ptr.id === id) cancelPointer(); }, 60);
    }
  }

  function blockDefaults() {
    var d = document;
    var pv = function (e) { try { e.preventDefault(); } catch (x) {} };
    var opt = { passive: false };
    ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu', 'selectstart', 'dragstart'].forEach(function (n) { d.addEventListener(n, pv, opt); });
    d.addEventListener('touchstart', function (e) { if (e.touches && e.touches.length > 1) pv(e); else if (e.target === canvas) pv(e); }, opt);
    d.addEventListener('touchmove', pv, opt);
    d.addEventListener('touchend', function (e) { sndCall('unlock'); pv(e); onTouchEnd(e); }, opt);
    d.addEventListener('touchcancel', onTouchEnd, opt);
    d.addEventListener('wheel', function (e) { if (e.ctrlKey) pv(e); }, opt);
  }

  /* ───────── 大きさ ───────── */
  var saEl = null, basePR = 1, scaleIdx = 0;
  function readSafe() {
    if (!saEl) return;
    try {
      var cs = window.getComputedStyle(saEl);
      G.safe.t = parseFloat(cs.paddingTop) || 0;
      G.safe.r = parseFloat(cs.paddingRight) || 0;
      G.safe.b = parseFloat(cs.paddingBottom) || 0;
      G.safe.l = parseFloat(cs.paddingLeft) || 0;
    } catch (e) {}
  }
  function applyPR() {
    if (!G.renderer) return;
    G.renderer.setPixelRatio(basePR * SCALES[scaleIdx]);
    G.renderer.setSize(G.view.w, G.view.h, true);
  }
  function resize() {
    var w = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 1));
    var h = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 1));
    readSafe();
    basePR = Math.min(2, window.devicePixelRatio || 1);
    var changed = w !== G.view.w || h !== G.view.h;
    G.view.w = w; G.view.h = h;
    G.view.aspect = w / h;
    G.view.portrait = h >= w;
    applyPR();
    void changed;
    call(curDef(), 'layout');
    perfSkip = 2;
  }
  var resizeT = 0;
  function onResize() {
    resize();
    if (resizeT) clearTimeout(resizeT);
    resizeT = setTimeout(function () { resizeT = 0; resize(); }, 320);
  }

  /* ───────── 負荷に合わせた描画倍率 ───────── */
  var perfAcc = 0, perfN = 0, perfSkip = 2, goodWins = 0, goodNeed = 4, sinceUp = 99;
  function perfSample(raw) {
    perfAcc += Math.min(raw, 0.25);
    perfN++;
    if (perfAcc < 1.5) return;
    var avg = perfAcc / perfN;
    perfAcc = 0; perfN = 0;
    if (perfSkip > 0) { perfSkip--; return; }
    sinceUp++;
    var slow = avg > (1 / 30) * 1.2, fast = avg < (1 / 30) * 0.7;
    if (slow) {
      goodWins = 0;
      if (sinceUp <= 3) goodNeed = Math.min(64, goodNeed * 2);
      if (scaleIdx < SCALES.length - 1) { scaleIdx++; applyPR(); perfSkip = 1; }
      else if (!G.low) { G.low = true; call(curDef(), 'layout'); perfSkip = 1; }
    } else if (fast) {
      goodWins++;
      if (goodWins >= goodNeed) {
        goodWins = 0;
        if (G.low) { G.low = false; call(curDef(), 'layout'); sinceUp = 0; perfSkip = 1; }
        else if (scaleIdx > 0) { scaleIdx--; applyPR(); sinceUp = 0; perfSkip = 1; }
      }
    } else goodWins = 0;
  }

  /* ───────── ループ ───────── */
  var raf = 0, last = 0, running = false;
  function frame(ts) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var tnow = now();
    var raw = last ? (tnow - last) / 1000 : 1 / 60;
    last = tnow;
    var dt = Math.min(0.05, Math.max(0, raw));
    perfSample(raw);
    G.time += dt;
    stepFade(dt);
    stepTweens(dt);
    stepShakes(dt);
    var def = curDef();
    if (def && !(switching && fadePhase === 'swap')) call(def, 'update', dt);
    stepHint(dt);
    for (var i = glows.length - 1; i >= 0; i--) { if (glows[i]) { try { glows[i].update(dt); } catch (e) { err('glow', e); } } }
    stepPuffs(dt);
    def = curDef();
    try {
      if (def && def.scene && def.camera) G.renderer.render(def.scene, def.camera);
      else G.renderer.clear();
    } catch (e2) { err('render', e2); }
    void ts;
  }
  function startLoop() {
    if (running || !G.renderer) return;
    running = true;
    last = 0;
    perfSkip = 2;
    perfAcc = 0; perfN = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  function onHide() {
    cancelPointer();
    stopLoop();
    writeNow();
    sndCall('pause');
  }
  function onShow() {
    if (!G.renderer) return;
    sndCall('resume');
    startLoop();
  }

  /* ───────── 代替画面 ───────── */
  function showFallback() {
    try {
      var fb = document.getElementById('fb');
      if (fb) fb.style.display = 'block';
      if (canvas) canvas.style.display = 'none';
      if (fadeEl) fadeEl.style.display = 'none';
    } catch (e) {}
  }

  /* ───────── 起動 ───────── */
  var started = false;
  G.start = function () {
    if (started) return;
    started = true;
    var hash = '';
    try { hash = String(location.hash || ''); } catch (e) {}
    if (/(^#|[&#])reset\b/.test(hash)) { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
    G.state = load();

    canvas = document.getElementById('c');
    if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'c'; document.body.appendChild(canvas); }
    fadeEl = document.getElementById('fade');
    if (!fadeEl) {
      fadeEl = document.createElement('div');
      fadeEl.id = 'fade';
      fadeEl.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:#1c120d;pointer-events:none;';
      document.body.appendChild(fadeEl);
    }
    setFade(1);
    saEl = document.getElementById('sa');
    if (!saEl) {
      saEl = document.createElement('div');
      saEl.id = 'sa';
      saEl.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:var(--sat,0px) var(--sar,0px) var(--sab,0px) var(--sal,0px);';
      document.body.appendChild(saEl);
    }

    var r = null;
    try {
      r = new T.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
      if (!r.getContext()) throw new Error('no context');
    } catch (e) {
      err('WebGL', e);
      G.renderer = null;
      showFallback();
      return;
    }
    G.renderer = r;
    try {
      r.outputColorSpace = T.SRGBColorSpace;
      r.toneMapping = T.ACESFilmicToneMapping;
      r.toneMappingExposure = 0.78;
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFShadowMap;
      r.setClearColor(0x2a1d17, 1);
    } catch (e) { err('renderer setup', e); }

    canvas.addEventListener('webglcontextlost', function (e) { try { e.preventDefault(); } catch (x) {} stopLoop(); }, false);
    canvas.addEventListener('webglcontextrestored', function () { try { location.reload(); } catch (x) {} }, false);

    try {
      var pm = new T.PMREMGenerator(r);
      G.env = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
      pm.dispose();
    } catch (e) { err('env', e); G.env = null; }

    blockDefaults();
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp, { passive: false });
    canvas.addEventListener('pointercancel', onUp, { passive: false });
    canvas.addEventListener('lostpointercapture', function (e) { if (e.pointerId === ptr.id) onUp(e); }, false);

    window.addEventListener('resize', onResize, false);
    window.addEventListener('orientationchange', onResize, false);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize, false);
    document.addEventListener('visibilitychange', function () { if (document.hidden) onHide(); else onShow(); }, false);
    window.addEventListener('pagehide', onHide, false);
    window.addEventListener('pageshow', function () { if (!document.hidden) onShow(); }, false);
    window.addEventListener('blur', function () { cancelPointer(); writeNow(); }, false);

    resize();
    if (!document.hidden) startLoop();

    var m = /scene=([A-Za-z0-9_-]+)/.exec(hash);
    var first = null;
    if (m && G.scenes[m[1]]) first = m[1];
    else if (G.scenes[G.state.scene]) first = G.state.scene;
    else if (G.scenes.home1) first = 'home1';
    if (first) G.go(first);
  };
})();
