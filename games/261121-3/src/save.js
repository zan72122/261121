// save.js — localStorage への保存（失敗しても例外を外に出さない）
//
// 公開 API
//   import { createSave } from './save.js';   const save = createSave();
//   save.load()  → object | null
//   save.store(obj) → true/false
//   save.clear()
//   （関数として load / store / clear も直接 export）
const KEY = 'bento261121_3';

export function load() {
  try {
    const s = window.localStorage.getItem(KEY);
    if (!s) return null;
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : null;
  } catch (e) { return null; }
}
export function store(obj) {
  try { window.localStorage.setItem(KEY, JSON.stringify(obj)); return true; } catch (e) { return false; }
}
export function clear() {
  try { window.localStorage.removeItem(KEY); } catch (e) { /* noop */ }
}
export function createSave() { return { load, store, clear }; }
