/* 90-main.js — 起動。
   最初の場面(おうち)に要るコードだけを先に動かし、すぐ G.start() する。
   棚・レジのコード(index.html の <script type="text/plain" id="later">)と、
   次の場面の組み立て・品物の絵などは、遊んでいる間に裏で少しずつ用意する(G.prep)。 */
(function () {
  'use strict';
  var laterDone = false;
  function err(where, e) { try { console.error('[main] ' + where, e); } catch (x) {} }

  /* 後回しにしたコードを動かす。何度呼んでもよい。まだ届いていなければ何もしない */
  function loadLater() {
    if (laterDone) return true;
    var el = document.getElementById('later');
    if (!el) { laterDone = document.readyState !== 'loading'; return laterDone; }
    laterDone = true;
    var code = el.textContent || '';
    if (el.parentNode) el.parentNode.removeChild(el);
    try {
      var s = document.createElement('script');
      s.text = code;
      (document.head || document.documentElement).appendChild(s);
      if (s.parentNode) s.parentNode.removeChild(s);
    } catch (e) { err('later', e); }
    return true;
  }

  function queuePrep() {
    if (!window.G || typeof G.prep !== 'function') return;
    var kinds = (window.Items && Items.order) ? Items.order.slice() : [];
    function items() {
      var out = [];
      for (var i = 0; i < kinds.length; i++) { try { out.push(Items.make(kinds[i])); } catch (e) { /* */ } }
      return out;
    }
    function extras() {
      var list = items();
      var g = null;
      try { g = G.prepGhost(); } catch (e) { g = null; }
      if (g) list.push(g);
      return list;
    }
    /* 1) 棚とレジのコード */
    G.prep(function () { loadLater(); });
    /* 2) 品物の形を1つずつ(最初の1回だけ重い) */
    kinds.forEach(function (k) { G.prep(function () { try { Items.make(k); } catch (e) { /* */ } }); });
    /* 3) 今の場面(おうち): 冷蔵庫に入る品物・お手本の手 */
    G.prep(function () { try { G.prepGhost(); } catch (e) { /* */ } });
    G.prep(function () { return G.prepScene(G.current === 'home2' ? 'home2' : 'home1', extras()); });
    /* 4) 次の場面: 棚 → レジ(品物とお手本の手も一緒に) */
    G.prep(function () { if (G.current !== 'shelf') return G.prepScene('shelf', extras()); });
    G.prep(function () { if (G.current !== 'register') return G.prepScene('register', extras()); });
    /* 5) レジの画面・レシートに出す品物の絵 */
    kinds.forEach(function (k) { G.prep(function () { try { if (G.icon) G.icon(k); } catch (e) { /* */ } }); });
  }

  function boot() {
    try {
      if (window.G && typeof G.start === 'function') {
        G.loadLater = loadLater;
        G.start();
        queuePrep();
      }
    } catch (e) { err('start', e); }
  }
  /* このスクリプトは body の終わり近くにあり、使う要素(#c #fade #ps)はもう読まれている。
     残り(棚・レジのコード)が届くのを待たずに始める */
  if (document.getElementById('c')) boot();
  else document.addEventListener('DOMContentLoaded', boot, false);
})();
