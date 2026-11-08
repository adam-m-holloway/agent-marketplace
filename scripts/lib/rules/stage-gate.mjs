// Staged approval (Q28): PRs that change a plugin's status.json stage are gated on evidence.
// The gate functions are shared with `npm run stage`, which prints them as a readiness checklist.
import { CHANNELS } from '../plugins.mjs';
import { hasEntry } from '../changelog.mjs';
import { f, diffFiles, readText, readPluginText } from './_util.mjs';
import { loadPatterns, scanText as scanPatterns } from './patterns.mjs';
import { scanText as scanHidden } from './hidden-content.mjs';
import { loadSuite, suiteCounts } from '../plugin-evals.mjs';

const ID = 'stage-gate';
/** Allowed single steps. deprecated is also reachable straight from incubating. */
export const NEXT = {
  sandbox: ['incubating'],
  incubating: ['published', 'deprecated'],
  published: ['deprecated'],
  deprecated: ['retired'],
  retired: [],
};
export const MIN_DAYS = 14;
export const MIN_CONSUMERS = 2;
export const RETIRE_LABEL = 'retire-anyway';

export const todayIso = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Distinct active consumers of a plugin in insights rows; null when there is no data. */
export function activeConsumers(consumers, plugin) {
  if (!consumers) return null;
  const rows = Array.isArray(consumers) ? consumers : consumers.rows ?? [];
  return [...new Set(rows.filter((r) => r?.plugin === plugin && r?.status === 'active').map((r) => r.consumer))].sort();
}

/** HIGH/ERROR findings from the patterns + hidden-content scanners for one plugin's files. */
function securityFindings(root, plugin) {
  const cfg = loadPatterns();
  const out = [];
  for (const file of plugin.files) {
    const text = readPluginText(root, file);
    if (text === null) continue;
    out.push(...scanHidden(text, file), ...scanPatterns(text, file, cfg));
  }
  return out.filter((x) => x.severity !== 'MEDIUM');
}

/**
 * Readiness checklist for moving `plugin` (as loaded from `root`) from `fromStatus` to stage `to`.
 * @param {{root:string, plugin:object, fromStatus:object|null, to:string, consumers?:any, today?:string,
 *          labels?:string[], changedFiles?:string[]|null}} o
 * @returns {{gate:string, ok:boolean, message:string, file:string}[]}
 */
export function gateChecks({ root, plugin, fromStatus, to, consumers = null, today = todayIso(), labels = [], changedFiles = null }) {
  const from = fromStatus?.stage ?? null;
  const items = [];
  const add = (gate, ok, message, file = `${plugin.path}/status.json`) => items.push({ gate, ok, message, file });

  if (from === null) {
    add('start', to === 'sandbox', to === 'sandbox' ? 'new plugin starts at `sandbox`' : `new plugin must start at \`sandbox\` (got ${to})`);
    return items;
  }
  const legal = (NEXT[from] ?? []).includes(to);
  add('step', legal, legal ? `${from} → ${to} is one step`
    : `${from} → ${to} is not allowed — one step at a time (${from} → ${(NEXT[from] ?? []).join(' | ') || 'nothing'})`);

  if (changedFiles) {
    const allowed = new Set([`${plugin.path}/status.json`, ...CHANNELS.map((c) => c.file)]);
    const extra = changedFiles.filter((x) => !allowed.has(x));
    add('scope', !extra.length, extra.length
      ? `a stage-change PR may change only ${plugin.path}/status.json and the generated catalogues; also changed: ${extra.join(', ')}`
      : 'only status.json and generated catalogues changed');
  }

  if (to === 'incubating') {
    const missing = [];
    if (!plugin.skills.length) missing.push(`${plugin.path}/skills/ (no skills)`);
    const counts = suiteCounts(loadSuite(root, plugin.path), plugin.skills.map((s) => s.name));
    for (const [s, n] of Object.entries(counts)) {
      const lack = [n.behaviour ? null : 'behaviour', n.trigger ? null : 'should-trigger', n.noTrigger ? null : 'should-not-trigger'].filter(Boolean);
      if (lack.length) missing.push(`${s} (${lack.join(', ')} cases in ${plugin.path}/evals/)`);
    }
    add('evals', !missing.length, missing.length ? `eval cases + trigger cases required; missing: ${missing.join('; ')}` : 'eval cases + trigger cases present');
    const owner = plugin.catalogue?.owner;
    const hasOwner = typeof owner === 'string' && owner.trim() !== '';
    add('owner', hasOwner, hasOwner ? `owner: ${owner}` : 'catalogue.json `owner` must name an owner', `${plugin.path}/catalogue.json`);
    const high = securityFindings(root, plugin);
    add('security', !high.length, high.length
      ? `${high.length} HIGH finding(s) must be fixed first: ${high.map((x) => `${x.file}:${x.line} ${x.message}`).join('; ')}`
      : 'no HIGH findings (patterns, hidden-content)');
  }

  if (to === 'published') {
    const days = typeof fromStatus.since === 'string' ? daysBetween(fromStatus.since, today) : NaN;
    const active = activeConsumers(consumers, plugin.dir);
    const soaked = days >= MIN_DAYS || (active?.length ?? 0) >= MIN_CONSUMERS;
    const who = active === null ? 'active consumers: unknown (no insights data)' : `${active.length} active consumer(s)`;
    add('soak', soaked, `${from} for ${Number.isNaN(days) ? '?' : days} days (need ≥${MIN_DAYS}) or ≥${MIN_CONSUMERS} active consumers; ${who}`);
    const version = plugin.manifest?.version;
    const ok = hasEntry(readText(root, `${plugin.path}/CHANGELOG.md`), version);
    add('changelog', ok, ok ? `CHANGELOG.md has an entry for ${version}` : `CHANGELOG.md has no entry for ${version}`, `${plugin.path}/CHANGELOG.md`);
  }

  if (to === 'deprecated') {
    const why = plugin.catalogue?.replacedBy ? `replacedBy: ${plugin.catalogue.replacedBy}`
      : typeof plugin.status?.reason === 'string' && plugin.status.reason.trim() ? `reason: ${plugin.status.reason}` : null;
    add('replacement', !!why, why ?? 'deprecation needs `replacedBy` in catalogue.json or a `reason` in status.json');
  }

  if (to === 'retired') {
    const active = activeConsumers(consumers, plugin.dir);
    const anyway = labels.includes(RETIRE_LABEL);
    let ok, message;
    if (active === null) {
      ok = anyway;
      message = `consumer data unavailable — pass \`--consumers <latest/consumers.json>\` or add the \`${RETIRE_LABEL}\` label`;
    } else {
      ok = !active.length || anyway;
      message = active.length
        ? `${active.length} active consumer(s): ${active.join(', ')} — migrate them first or add the \`${RETIRE_LABEL}\` label`
        : 'no active consumers';
    }
    if (anyway && active?.length !== 0) message += ` (overridden by \`${RETIRE_LABEL}\`)`;
    add('consumers', ok, message);
  }
  return items;
}

export default {
  id: ID,
  group: 'plugins',
  needsBase: true,
  run({ root, repo, base, pr, consumers = null, today = todayIso() }) {
    if (!base) return [];
    const out = [];
    let changed = null;
    for (const p of repo.plugins) {
      const old = base.repo.plugins.find((x) => x.dir === p.dir);
      const fromStatus = old?.status ?? null;
      const to = p.status?.stage;
      if (typeof to !== 'string' || to === fromStatus?.stage) continue; // no stage change (schema rule covers bad status)
      if (fromStatus && changed === null) changed = diffFiles(base.root, root);
      const items = gateChecks({ root, plugin: p, fromStatus, to, consumers, today, labels: pr?.labels ?? [], changedFiles: fromStatus ? changed : null });
      for (const x of items) if (!x.ok) out.push(f(ID, 'ERROR', x.file, x.message));
    }
    return out;
  },
};
