// 場面をまたいで受け渡す遊びの状態（保存対象）。
export const FOODS = ['tamago', 'karaage', 'wiener', 'broccoli', 'tomato'];
// slot 0..4 = おかず室、slot 5 = ごはんの上
export const MAMA_SLOTS = ['tamago', 'karaage', 'wiener', 'broccoli', 'tomato', null];
export const MAMA_SHAPES = ['heart', 'star', 'flower'];

export function freshState(day = 0) {
  return { v: 1, day, stage: 'kitchen', rice: 0, furikake: [], slots: [null, null, null, null, null, null], shake: 0 };
}

export const state = freshState(0);

/** 保存データを検証して state に反映。壊れていたら無視して false。 */
export function adoptSaved(s) {
  try {
    if (!s || typeof s !== 'object' || s.v !== 1) return false;
    const day = Number.isFinite(s.day) ? Math.max(0, Math.floor(s.day)) % 10000 : 0;
    const stage = ['kitchen', 'walk', 'park'].includes(s.stage) ? s.stage : 'kitchen';
    const f = freshState(day);
    if (stage !== 'kitchen') {
      const slots = Array.isArray(s.slots) ? s.slots.slice(0, 6) : [];
      const seen = new Set();
      for (let i = 0; i < 6; i++) {
        const v = slots[i];
        if (FOODS.includes(v) && !seen.has(v)) { f.slots[i] = v; seen.add(v); }
      }
      // 欠けているおかずは空いている slot に補う（壊れた保存でも必ず5つそろう）
      for (const food of FOODS) if (!seen.has(food)) { const k = f.slots.indexOf(null); if (k >= 0) f.slots[k] = food; }
      f.rice = 2;
      if (Array.isArray(s.furikake)) {
        for (const p of s.furikake.slice(0, 400)) {
          if (p && Number.isFinite(p.u) && Number.isFinite(p.v)) f.furikake.push({ u: Math.min(1, Math.max(0, p.u)), v: Math.min(1, Math.max(0, p.v)), c: (p.c | 0) & 3 });
        }
      }
      f.shake = Number.isFinite(s.shake) ? Math.min(1, Math.max(0, s.shake)) : 0;
      f.stage = stage;
    }
    Object.assign(state, f);
    return true;
  } catch (e) { return false; }
}

export function resetState(day) { Object.assign(state, freshState(day)); }
