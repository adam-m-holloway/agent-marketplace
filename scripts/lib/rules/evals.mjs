// evals.json (skill-creator format) and trigger-evals.json are present, valid and not placeholders.
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { f, loadValidator, loadOwnJson, skipped, PLACEHOLDER } from './_util.mjs';

const ID = 'evals';
export const MIN_CASES = 3;
export const MIN_TRIGGER_EACH = 8;

export default {
  id: ID,
  group: 'plugins',
  async run({ root, repo }) {
    const out = [];
    const validate = await loadValidator();
    let warned = false;
    const schemaCheck = (schemaFile, data, file) => {
      if (!validate) {
        if (!warned) out.push(skipped(ID, 'scripts/lib/schema.mjs'));
        warned = true;
        return;
      }
      for (const e of validate(loadOwnJson(schemaFile), data)) out.push(f(ID, 'ERROR', file, `schema: ${e.path || '/'} ${e.message}`));
    };

    for (const p of repo.plugins) {
      for (const s of p.skills) {
        const evFile = `${s.path}/evals/evals.json`;
        const trFile = `${s.path}/evals/trigger-evals.json`;

        if (s.evalsError) out.push(f(ID, 'ERROR', evFile, s.evalsError));
        else if (s.evals) {
          schemaCheck('schema/evals.schema.json', s.evals, evFile);
          const cases = Array.isArray(s.evals.evals) ? s.evals.evals : [];
          if (cases.length < MIN_CASES) out.push(f(ID, 'ERROR', evFile, `${cases.length} eval cases (min ${MIN_CASES})`));
          const seen = new Set();
          for (const [i, c] of cases.entries()) {
            const at = `evals[${i}] (id ${c?.id})`;
            if (seen.has(c?.id)) out.push(f(ID, 'ERROR', evFile, `${at}: duplicate id`));
            seen.add(c?.id);
            if (typeof c?.prompt !== 'string' || !c.prompt.trim()) out.push(f(ID, 'ERROR', evFile, `${at}: empty prompt`));
            if (!Array.isArray(c?.expectations) || !c.expectations.length) out.push(f(ID, 'ERROR', evFile, `${at}: needs at least one expectation`));
            for (const text of [c?.prompt, c?.expected_output, ...(Array.isArray(c?.expectations) ? c.expectations : [])]) {
              const m = typeof text === 'string' && PLACEHOLDER.exec(text);
              if (m) out.push(f(ID, 'ERROR', evFile, `${at}: placeholder "${m[0]}"`));
            }
            for (const file of Array.isArray(c?.files) ? c.files : []) {
              // Paths are relative to the skill root (skill-creator format), under evals/files/.
              const rel = normalize(String(file)).split('\\').join('/');
              if (!rel.startsWith('evals/files/')) out.push(f(ID, 'ERROR', evFile, `${at}: file "${file}" must live under evals/files/`));
              else if (!existsSync(join(root, s.path, rel))) out.push(f(ID, 'ERROR', evFile, `${at}: file "${file}" does not exist`));
            }
          }
        } else out.push(f(ID, 'ERROR', evFile, 'missing'));

        if (s.triggerEvalsError) out.push(f(ID, 'ERROR', trFile, s.triggerEvalsError));
        else if (s.triggerEvals) {
          schemaCheck('schema/trigger-evals.schema.json', s.triggerEvals, trFile);
          const items = Array.isArray(s.triggerEvals) ? s.triggerEvals : [];
          const yes = items.filter((q) => q?.should_trigger === true).length;
          const no = items.filter((q) => q?.should_trigger === false).length;
          if (yes < MIN_TRIGGER_EACH || no < MIN_TRIGGER_EACH) {
            out.push(f(ID, 'ERROR', trFile, `${yes} should-trigger and ${no} should-not-trigger queries (min ${MIN_TRIGGER_EACH} each)`));
          }
          const seen = new Set();
          for (const q of items) {
            const key = String(q?.query ?? '').trim().toLowerCase();
            if (seen.has(key)) out.push(f(ID, 'ERROR', trFile, `duplicate query "${q.query}"`));
            seen.add(key);
          }
        } else out.push(f(ID, 'ERROR', trFile, 'missing'));
      }
    }
    return out;
  },
};
