// Changed plugin files need a semver increase vs the base; new plugins start at >=1.0.0.
import { compare, isValid } from '../semver.mjs';
import { f } from './_util.mjs';

const ID = 'version-bump';

export function isPromotion(pr) {
  return pr?.baseRef === 'stable' && String(pr?.headRef ?? '').startsWith('promote/');
}

export default {
  id: ID,
  group: 'plugins',
  needsBase: true,
  run({ repo, base, pr, changedPlugins }) {
    if (!base || isPromotion(pr)) return [];
    const out = [];
    for (const dir of changedPlugins) {
      const head = repo.plugins.find((p) => p.dir === dir);
      if (!head) continue; // deleted
      const file = `${head.path}/.claude-plugin/plugin.json`;
      const v = head.manifest?.version;
      if (!isValid(v)) {
        out.push(f(ID, 'ERROR', file, `version "${v}" is not valid semver`));
        continue;
      }
      const old = base.repo.plugins.find((p) => p.dir === dir)?.manifest?.version;
      if (!isValid(old)) {
        if (compare(v, '1.0.0') < 0) out.push(f(ID, 'ERROR', file, `new plugin must start at >= 1.0.0 (got ${v})`));
      } else if (compare(v, old) <= 0) {
        out.push(f(ID, 'ERROR', file, `plugin files changed but version ${v} is not greater than base ${old} — run \`npm run bump ${dir} patch|minor|major\``));
      }
    }
    return out;
  },
};
