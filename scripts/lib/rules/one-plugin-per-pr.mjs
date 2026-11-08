// A PR changes at most one plugins/* directory unless labelled `multi-plugin`.
import { f } from './_util.mjs';
import { isPromotion } from './version-bump.mjs';

const ID = 'one-plugin-per-pr';

export default {
  id: ID,
  group: 'plugins',
  ciOnly: true,
  run({ pr, changedPlugins }) {
    if (!pr || isPromotion(pr) || changedPlugins.length <= 1) return [];
    if ((pr.labels ?? []).includes('multi-plugin')) return [];
    return [f(ID, 'ERROR', 'plugins/', `PR changes ${changedPlugins.length} plugins (${changedPlugins.join(', ')}) — split it or add the \`multi-plugin\` label`)];
  },
};
