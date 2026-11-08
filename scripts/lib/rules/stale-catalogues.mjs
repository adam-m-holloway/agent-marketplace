// Generated catalogues must match what `npm run sync` would write.
// Uses the generator from this checkout (the base branch in CI) against the judged tree.
import { f } from './_util.mjs';
import { staleFiles } from '../../sync.mjs';

const ID = 'stale-catalogues';

export default {
  id: ID,
  group: 'plugins',
  run({ root }) {
    return staleFiles(root).map((file) =>
      f(ID, 'ERROR', file, 'missing or out of date — run `npm run sync` and commit the result'),
    );
  },
};
