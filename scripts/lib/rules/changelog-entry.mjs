// The current manifest version has a non-empty CHANGELOG.md section.
import { getSection } from '../changelog.mjs';
import { f, readText } from './_util.mjs';

const ID = 'changelog-entry';

export default {
  id: ID,
  group: 'plugins',
  run({ root, repo }) {
    const out = [];
    for (const p of repo.plugins) {
      const v = p.manifest?.version;
      if (!v) continue;
      const file = `${p.path}/CHANGELOG.md`;
      const text = readText(root, file);
      if (text === null) continue; // reported by structure
      const section = getSection(text, v);
      if (section === null) out.push(f(ID, 'ERROR', file, `no "## [${v}] - YYYY-MM-DD" entry for the current version`));
      else if (!section) out.push(f(ID, 'ERROR', file, `the [${v}] entry is empty`));
    }
    return out;
  },
};
