// Reads a plugin's `claude plugin eval` suite: plugins/<p>/evals/**/<case>/{prompt.md, case.yaml,
// graders/*.md}. A directory with prompt.md or case.yaml is a case (nothing inside it is another
// case); other directories only group cases. results/ and mocks/ at the top are not cases.
// Docs: https://code.claude.com/docs/en/plugin-evals.md
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';

export const EVAL_DIR = 'evals';

/** prompt.md frontmatter keys `claude plugin eval` accepts (an unknown key is an error there). */
export const PROMPT_KEYS = ['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'model',
  'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt', 'env'];

/** Grader types and the options each one needs. */
export const GRADER_TYPES = {
  regex: ['pattern'],
  tool_used: ['tool'],
  tool_order: ['before', 'after'],
  file_exists: ['path'],
  llm: [],
  baseline: ['baseline_file'],
};

const SKIP_TOP = new Set(['results', 'mocks']);
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

function loadCase(abs, relPath, relInSuite) {
  const promptText = read(join(abs, 'prompt.md'));
  const caseYaml = read(join(abs, 'case.yaml'));
  const prompt = promptText === null ? null : parseFrontmatter(promptText);
  const gDir = join(abs, 'graders');
  const graders = isDir(gDir)
    ? readdirSync(gDir).filter((f) => f.endsWith('.md')).sort().map((f) => {
      const p = parseFrontmatter(readFileSync(join(gDir, f), 'utf8'));
      return { name: f.slice(0, -3), file: `${relPath}/graders/${f}`, data: p.data, body: p.body.trim(), ...(p.error ? { error: p.error } : {}) };
    })
    : [];
  const yamlName = caseYaml && /^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(caseYaml)?.[1];
  const segs = relInSuite.split('/');
  return {
    name: (typeof prompt?.data?.name === 'string' && prompt.data.name) || yamlName || segs.at(-1),
    path: relPath,
    group: segs.length > 1 ? segs[0] : null,
    prompt,
    caseYaml,
    graders,
  };
}

/**
 * Load the suite of the plugin at repo-relative `pluginPath` under `root`.
 * @returns {{path:string, exists:boolean, cases:{name, path, group, prompt, caseYaml, graders}[]}}
 */
export function loadSuite(root, pluginPath) {
  const path = `${pluginPath}/${EVAL_DIR}`;
  const abs = join(root, path);
  const cases = [];
  const walk = (dirAbs, rel) => {
    for (const d of readdirSync(dirAbs).sort()) {
      const sub = join(dirAbs, d);
      if (d.startsWith('.') || !isDir(sub) || (!rel && SKIP_TOP.has(d))) continue;
      const r = rel ? `${rel}/${d}` : d;
      if (existsSync(join(sub, 'prompt.md')) || existsSync(join(sub, 'case.yaml'))) cases.push(loadCase(sub, `${path}/${r}`, r));
      else walk(sub, r);
    }
  };
  if (isDir(abs)) walk(abs, '');
  return { path, exists: isDir(abs), cases };
}

const listOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []);
const mentions = (text, skill) => new RegExp(`(^|[^\\w-])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(String(text ?? ''));

export const isSkillGrader = (g) => g?.data?.type === 'tool_used' && g.data.tool === 'Skill';

/**
 * What a case tests, for the given skill names. A case whose graders are all `tool_used: Skill`
 * is a trigger case: should-trigger, or should-not-trigger when its grader has `max: 0`.
 * Any other case is a behaviour case. A case belongs to a skill when it sits under
 * evals/<skill>/, is tagged with it, or a Skill grader's input_match names it.
 * @returns {{skills:string[], kind:'trigger'|'behaviour', expect:'trigger'|'no-trigger'|null}}
 */
export function classify(c, skillNames) {
  const sg = c.graders.filter(isSkillGrader);
  const tags = listOf(c.prompt?.data?.tags);
  const skills = skillNames.filter((s) => c.group === s || tags.includes(s) || sg.some((g) => mentions(g.data.input_match, s)));
  const kind = c.graders.length && sg.length === c.graders.length ? 'trigger' : 'behaviour';
  const expect = kind === 'trigger' ? (sg.every((g) => Number(g.data.max) === 0) ? 'no-trigger' : 'trigger') : null;
  return { skills, kind, expect };
}

/** Per-skill counts: { [skill]: { behaviour, trigger, noTrigger } }. */
export function suiteCounts(suite, skillNames) {
  const out = Object.fromEntries(skillNames.map((s) => [s, { behaviour: 0, trigger: 0, noTrigger: 0 }]));
  for (const c of suite.cases) {
    const k = classify(c, skillNames);
    for (const s of k.skills) {
      if (k.kind === 'behaviour') out[s].behaviour++;
      else if (k.expect === 'trigger') out[s].trigger++;
      else out[s].noTrigger++;
    }
  }
  return out;
}
