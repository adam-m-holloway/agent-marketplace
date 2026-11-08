// PRs into `stable`: head branch promote/*, title `chore(stable): promote main@<sha>`, and a
// `rollback` label when any plugin version goes backwards. Tree equality is checked by the workflow.
import { compare, isValid } from '../semver.mjs';
import { f } from './_util.mjs';

const ID = 'promotion';
export const TITLE_RE = /^chore\(stable\): promote main@[0-9a-f]{7,40}$/;

export default {
  id: ID,
  group: 'plugins',
  ciOnly: true,
  run({ repo, base, pr }) {
    if (pr?.baseRef !== 'stable') return [];
    const out = [];
    if (!String(pr.headRef ?? '').startsWith('promote/')) out.push(f(ID, 'ERROR', 'pr', `PRs into stable must come from a promote/* branch (got "${pr.headRef}") — use \`npm run promote\``));
    if (!TITLE_RE.test(pr.title ?? '')) out.push(f(ID, 'ERROR', 'pr', `title must be "chore(stable): promote main@<sha>" (got "${pr.title}")`));
    if (base && !(pr.labels ?? []).includes('rollback')) {
      for (const old of base.repo.plugins) {
        const head = repo.plugins.find((p) => p.dir === old.dir);
        const a = old.manifest?.version, b = head?.manifest?.version;
        if (isValid(a) && isValid(b) && compare(a, b) > 0) {
          out.push(f(ID, 'ERROR', `${old.path}/.claude-plugin/plugin.json`, `version goes back ${a} → ${b}; add the \`rollback\` label if intended`));
        }
      }
    }
    return out;
  },
};
