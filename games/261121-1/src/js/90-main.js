/* 90-main.js — 起動。DOM の準備ができたら G.start()。 */
(function () {
  'use strict';
  function boot() {
    try { if (window.G && typeof G.start === 'function') G.start(); }
    catch (e) { try { console.error('[main] start', e); } catch (x) {} }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, false);
  else boot();
})();
