// Native `claude plugin eval` cases (plugins/<p>/evals/**): every case parses and has graders, and
// every skill has enough behaviour cases and should / should-not trigger cases.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { f, PLACEHOLDER } from './_util.mjs';
import { loadSuite, classify, suiteCounts, PROMPT_KEYS, GRADER_TYPES } from '../plugin-evals.mjs';

const ID = 'evals';
/** Behaviour cases (graders beyond "the skill fired") per skill. */
export const MIN_CASES = 3;
/** Should-trigger and should-not-trigger cases, each, per skill. */
export const MIN_TRIGGER_EACH = 8;

const compiles = (pattern, flags) => { try { new RegExp(String(pattern), flags ? String(flags) : undefined); return true; } catch { return false; } };

function checkGrader(g, out) {
  if (g.error) return out.push(f(ID, 'ERROR', g.file, `frontmatter: ${g.error}`));
  const type = g.data.type;
  if (!Object.hasOwn(GRADER_TYPES, type)) return out.push(f(ID, 'ERROR', g.file, `unknown grader type "${type}" (${Object.keys(GRADER_TYPES).join(', ')})`));
  for (const k of GRADER_TYPES[type]) if (g.data[k] == null || g.data[k] === '') out.push(f(ID, 'ERROR', g.file, `${type} grader needs "${k}"`));
  if ((type === 'llm' || type === 'baseline') && !g.body && !g.data.criteria) out.push(f(ID, 'ERROR', g.file, `${type} grader needs criteria (the file body)`));
  if (type === 'regex' && g.data.pattern != null && !compiles(g.data.pattern, g.data.flags)) out.push(f(ID, 'ERROR', g.file, `pattern is not a valid JavaScript regex`));
  if (type === 'tool_used' && g.data.input_match != null && !compiles(g.data.input_match)) out.push(f(ID, 'ERROR', g.file, `input_match is not a valid JavaScript regex`));
  const m = PLACEHOLDER.exec(g.body);
  if (m) out.push(f(ID, 'ERROR', g.file, `placeholder "${m[0]}"`));
}

export default {
  id: ID,
  group: 'plugins',
  run({ root, repo }) {
    const out = [];
    for (const p of repo.plugins) {
      const suite = loadSuite(root, p.path);
      if (!suite.cases.length) {
        out.push(f(ID, 'ERROR', suite.path, 'no eval cases: add claude plugin eval cases under evals/<skill>/<case>/ (prompt.md + graders/)'));
        continue;
      }
      const skillNames = p.skills.map((s) => s.name);
      const names = new Map();
      const triggerPrompts = new Map();
      for (const c of suite.cases) {
        const file = `${c.path}/${c.prompt ? 'prompt.md' : 'case.yaml'}`;
        if (names.has(c.name)) out.push(f(ID, 'ERROR', file, `duplicate case name "${c.name}" (also ${names.get(c.name)})`));
        names.set(c.name, c.path);
        if (c.prompt) {
          if (c.prompt.error) out.push(f(ID, 'ERROR', file, `frontmatter: ${c.prompt.error}`));
          for (const k of Object.keys(c.prompt.data)) if (!PROMPT_KEYS.includes(k)) out.push(f(ID, 'ERROR', file, `unknown frontmatter key "${k}"`));
          if (!c.prompt.body.trim()) out.push(f(ID, 'ERROR', file, 'empty prompt'));
          const m = PLACEHOLDER.exec(c.prompt.body);
          if (m) out.push(f(ID, 'ERROR', file, `placeholder "${m[0]}"`));
        } else if (!/^\s*prompt:/m.test(c.caseYaml ?? '')) out.push(f(ID, 'ERROR', file, 'no prompt: add prompt.md or execution.prompt'));
        if (c.caseYaml != null) {
          const y = `${c.path}/case.yaml`;
          if (!/^schema_version:\s*["']?1\.1["']?\s*$/m.test(c.caseYaml)) out.push(f(ID, 'ERROR', y, 'needs schema_version: "1.1"'));
          if (!/^name:\s*\S/m.test(c.caseYaml)) out.push(f(ID, 'ERROR', y, 'needs name'));
          const script = /^\s+scaffold_script:\s*["']?([^"'\s]+)/m.exec(c.caseYaml)?.[1];
          if (script && !existsSync(join(root, c.path, script))) out.push(f(ID, 'ERROR', y, `scaffold_script "${script}" does not exist`));
        }
        if (!c.graders.length && !/^graders:/m.test(c.caseYaml ?? '')) out.push(f(ID, 'ERROR', file, 'no graders (add graders/<name>.md)'));
        for (const g of c.graders) checkGrader(g, out);
        const k = classify(c, skillNames);
        if (!k.skills.length) out.push(f(ID, 'ERROR', file, `case belongs to no skill (${skillNames.join(', ')}): put it under evals/<skill>/, tag it, or add a tool_used Skill grader`));
        if (k.kind === 'trigger' && c.prompt) {
          const key = c.prompt.body.trim().toLowerCase();
          if (triggerPrompts.has(key)) out.push(f(ID, 'ERROR', file, `duplicate trigger prompt (also ${triggerPrompts.get(key)})`));
          triggerPrompts.set(key, c.path);
        }
      }
      for (const [s, n] of Object.entries(suiteCounts(suite, skillNames))) {
        if (n.behaviour < MIN_CASES) out.push(f(ID, 'ERROR', suite.path, `${s}: ${n.behaviour} behaviour cases (min ${MIN_CASES})`));
        if (n.trigger < MIN_TRIGGER_EACH || n.noTrigger < MIN_TRIGGER_EACH) {
          out.push(f(ID, 'ERROR', suite.path, `${s}: ${n.trigger} should-trigger and ${n.noTrigger} should-not-trigger cases (min ${MIN_TRIGGER_EACH} each)`));
        }
      }
    }
    return out;
  },
};
