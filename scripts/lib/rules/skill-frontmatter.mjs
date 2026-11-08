// SKILL.md frontmatter parses and meets the Agent Skills limits.
import { parseFrontmatter, checkSkillFrontmatter } from '../frontmatter.mjs';
import { f } from './_util.mjs';

const ID = 'skill-frontmatter';

export default {
  id: ID,
  group: 'plugins',
  run({ repo }) {
    const out = [];
    for (const p of repo.plugins) {
      for (const s of p.skills) {
        if (s.skillMd === null) continue; // structure
        const file = `${s.path}/SKILL.md`;
        const r = parseFrontmatter(s.skillMd);
        if (r.error) {
          out.push(f(ID, 'ERROR', file, `frontmatter: ${r.error}`, 1));
          continue;
        }
        for (const msg of checkSkillFrontmatter(r.data, s.name)) out.push(f(ID, 'ERROR', file, msg, 1));
      }
    }
    return out;
  },
};
