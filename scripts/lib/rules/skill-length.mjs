// SKILL.md stays within 500 lines (progressive disclosure: move detail into references).
import { f } from './_util.mjs';

const ID = 'skill-length';
export const MAX_LINES = 500;

export default {
  id: ID,
  group: 'plugins',
  run({ repo }) {
    const out = [];
    for (const p of repo.plugins) {
      for (const s of p.skills) {
        if (s.skillMd === null) continue;
        const n = s.skillMd.replace(/\n$/, '').split('\n').length;
        if (n > MAX_LINES) out.push(f(ID, 'ERROR', `${s.path}/SKILL.md`, `${n} lines (max ${MAX_LINES})`, MAX_LINES + 1));
      }
    }
    return out;
  },
};
