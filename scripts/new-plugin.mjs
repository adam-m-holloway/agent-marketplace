#!/usr/bin/env node
// npm run new-plugin <name> [--skill <s>] [--languages go,ts] [--category <c>] [--root <dir>]
// Scaffolds plugins/<name>/ with stubs that FAIL `npm run check` until the author fills them in.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { NAME_RE, RESERVED_PREFIXES, OWNER, stableJson } from './lib/plugins.mjs';

export const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function kebabError(kind, name) {
  if (!name) return `${kind} name is required`;
  if (!NAME_RE.test(name)) return `${kind} name "${name}" must be kebab-case (lowercase letters, digits, single hyphens)`;
  if (name.length > 64) return `${kind} name "${name}" is longer than 64 characters`;
  return null;
}

/** Returns an error message, or null when the plugin name is acceptable. */
export function validateName(root, name) {
  const e = kebabError('plugin', name);
  if (e) return e;
  const p = RESERVED_PREFIXES.find((x) => name.startsWith(x));
  if (p) return `plugin name "${name}" uses the reserved prefix "${p}"`;
  if (existsSync(join(root, 'plugins', name))) return `plugins/${name} already exists`;
  return null;
}

const q = (s) => JSON.stringify(s);

/**
 * Create the plugin skeleton. Throws on an invalid name. Returns repo-relative paths written.
 * @param {string} root
 * @param {{name:string, skill?:string, languages?:string[], category?:string, today?:string}} opts
 */
export function scaffold(root, opts) {
  const { name } = opts;
  const skill = opts.skill ?? name;
  const languages = opts.languages?.length ? opts.languages : ['any'];
  const category = opts.category ?? 'engineering-practices';
  const date = opts.today ?? today();
  const err = validateName(root, name) ?? kebabError('skill', skill);
  if (err) throw new Error(err);

  const anyLang = languages.length === 1 && languages[0] === 'any';
  const base = `plugins/${name}`;
  const sk = `${base}/skills/${skill}`;
  const files = {
    [`${base}/.claude-plugin/plugin.json`]: stableJson({
      name,
      version: '1.0.0',
      description: 'TODO: one sentence on what this plugin helps with',
      author: { name: OWNER.name },
      keywords: [],
      license: 'MIT',
    }),
    [`${base}/catalogue.json`]: stableJson({ category, owner: OWNER.name, languages }),
    [`${base}/status.json`]: stableJson({ stage: 'sandbox', since: date }),
    [`${base}/README.md`]: `# ${name}\n\nTODO: what this plugin does, who it is for, and how to use it.\n\n## Skills\n\n- \`${skill}\` — TODO\n`,
    [`${base}/CHANGELOG.md`]: `# Changelog\n\nAll notable changes to this plugin are documented here (Keep a Changelog).\n\n## [1.0.0] - ${date}\n\n### Added\n- TODO: first release of ${name}\n`,
    [`${sk}/SKILL.md`]: [
      '---',
      `name: ${skill}`,
      `description: ${q('TODO: what the skill does and when Claude should use it (trigger phrases)')}`,
      ...(anyLang ? [] : [`compatibility: ${q(`TODO: requirements, e.g. a ${languages.join('/')} project`)}`]),
      '---',
      '',
      `# ${skill}`,
      '',
      'TODO: instructions for Claude. Draft this with /skill-creator.',
      '',
    ].join('\n'),
    [`${sk}/evals/evals.json`]: stableJson({
      skill_name: skill,
      evals: [
        {
          id: 1,
          prompt: 'TODO: a realistic user prompt',
          expected_output: 'TODO: what a good response looks like',
          expectations: ['TODO: a checkable expectation'],
        },
      ],
    }),
    [`${sk}/evals/trigger-evals.json`]: stableJson([
      { query: 'TODO: a query that should trigger the skill', should_trigger: true },
      { query: 'TODO: a near-miss query that should not trigger the skill', should_trigger: false },
    ]),
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return Object.keys(files);
}

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      skill: { type: 'string' },
      languages: { type: 'string' },
      category: { type: 'string' },
      root: { type: 'string', default: process.cwd() },
    },
  });
  const name = positionals[0];
  const languages = values.languages?.split(',').map((s) => s.trim()).filter(Boolean);
  let files;
  try {
    files = scaffold(values.root, { name, skill: values.skill, languages, category: values.category });
  } catch (e) {
    console.error(`new-plugin: ${e.message}`);
    console.error('usage: npm run new-plugin <name> [--skill <s>] [--languages go,ts] [--category <c>]');
    process.exit(1);
  }
  const skill = values.skill ?? name;
  console.log(`Created plugins/${name} (stage: sandbox):`);
  for (const f of files) console.log(`  ${f}`);
  console.log(`
Next steps:
  Run /skill-creator to draft SKILL.md, evals and the trigger set; save the trigger set to
  plugins/${name}/skills/${skill}/evals/trigger-evals.json; then npm run check`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
