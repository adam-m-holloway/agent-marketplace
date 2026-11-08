// Plugin layout: required files exist and parse, manifest basics.
import { isValid } from '../semver.mjs';
import { f } from './_util.mjs';

const ID = 'structure';

export default {
  id: ID,
  group: 'plugins',
  run({ repo }) {
    const out = [];
    for (const p of repo.plugins) {
      for (const e of p.loadErrors) out.push(f(ID, 'ERROR', e.file, e.message));
      for (const req of ['README.md', 'CHANGELOG.md']) {
        if (!p.files.includes(`${p.path}/${req}`)) out.push(f(ID, 'ERROR', `${p.path}/${req}`, 'missing'));
      }
      if (!p.skills.length) out.push(f(ID, 'ERROR', `${p.path}/skills`, 'plugin has no skills'));
      for (const s of p.skills) {
        if (s.skillMd === null) out.push(f(ID, 'ERROR', `${s.path}/SKILL.md`, 'missing'));
      }
      const m = p.manifest;
      if (m) {
        const file = `${p.path}/.claude-plugin/plugin.json`;
        if (!isValid(m.version)) out.push(f(ID, 'ERROR', file, `version "${m.version}" is not MAJOR.MINOR.PATCH`));
        if (typeof m.description !== 'string' || !m.description.trim()) out.push(f(ID, 'ERROR', file, 'description is required'));
        if (typeof m.author?.name !== 'string' || !m.author.name) out.push(f(ID, 'ERROR', file, 'author.name is required'));
        if (m.license !== 'MIT') out.push(f(ID, 'ERROR', file, `license must be "MIT" (got ${JSON.stringify(m.license)})`));
      }
    }
    return out;
  },
};
