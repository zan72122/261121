// later_loader.js — later.js（歩く・公園）を <script> で読み込む。file:// でも Pages のサブフォルダでも動く。
//   loadLater() → Promise<window.__bentoLater>。失敗したら次の呼び出しでもう一度試す。
/* global __LATER_SRC__ */
let pending = null;

export function laterReady() { return !!window.__bentoLater; }

export function loadLater() {
  if (window.__bentoLater) return Promise.resolve(window.__bentoLater);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    let done = false;
    const finish = (ok, err) => {
      if (done) return; done = true;
      if (ok && window.__bentoLater) resolve(window.__bentoLater);
      else { pending = null; s.remove(); reject(err || new Error('later.js failed')); }
    };
    window.__bentoLaterReady = () => finish(true);
    s.onload = () => finish(!!window.__bentoLater);
    s.onerror = (e) => finish(false, e);
    s.async = true;
    s.src = __LATER_SRC__;
    document.head.appendChild(s);
  });
  return pending;
}
