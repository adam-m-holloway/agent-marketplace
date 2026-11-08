// The PR title (= squash commit subject) is a Conventional Commit.
import { checkMessage } from '../commit-msg.mjs';
import { f } from './_util.mjs';

const ID = 'pr-title';

export default {
  id: ID,
  group: 'plugins',
  ciOnly: true,
  run({ pr }) {
    if (!pr) return [];
    const problem = checkMessage(pr.title ?? '');
    return problem ? [f(ID, 'ERROR', 'pr', `title: ${problem}`)] : [];
  },
};
