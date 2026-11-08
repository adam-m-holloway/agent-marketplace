// Catalogue generator: loadRepo() output -> one marketplace catalogue per channel.
// Pure (no writes). Listing = stage in LISTED_STAGES and data valid enough for an entry.
import { readFileSync } from 'node:fs';
import { CHANNELS, LISTED_STAGES, NAME_RE, OWNER, RESERVED_PREFIXES } from './plugins.mjs';
import { validate } from './schema.mjs';

export const MARKETPLACE_SCHEMA = 'https://json.schemastore.org/claude-code-marketplace-manifest.json';
export const MAX_NAME = 64;
/** Stages each channel lists (default LISTED_STAGES). Stable never lists incubating (Q28). */
export const CHANNEL_STAGES = { stable: ['published', 'deprecated'] };

// Schemas come from the harness (this checkout), never from the tree being judged.
const loadSchema = (n) => JSON.parse(readFileSync(new URL(`../../schema/${n}.schema.json`, import.meta.url), 'utf8'));
const SCHEMAS = { catalogue: loadSchema('catalogue'), status: loadSchema('status') };

const schemaReasons = (file, schema, data) =>
  validate(schema, data).map((e) => `${file}: ${e.path || '(root)'} ${e.message}`);

function prefix(stage, catalogue) {
  if (stage === 'incubating') return 'Incubating: ';
  if (stage === 'deprecated') return catalogue?.replacedBy ? `Deprecated: use ${catalogue.replacedBy}. ` : 'Deprecated. ';
  return '';
}

/** All reasons a plugin cannot be listed (empty = listable). */
export function exclusionReasons(plugin, taxonomy) {
  const { dir, manifest, catalogue, status } = plugin;
  const reasons = [];
  const stage = status?.stage;
  if (typeof stage === 'string' && !LISTED_STAGES.includes(stage)) reasons.push(`stage is ${stage} (not listed)`);

  for (const e of plugin.loadErrors) reasons.push(`${e.file.slice(plugin.path.length + 1)}: ${e.message}`);
  if (status) reasons.push(...schemaReasons('status.json', SCHEMAS.status, status));
  if (catalogue) reasons.push(...schemaReasons('catalogue.json', SCHEMAS.catalogue, catalogue));

  if (dir.length > MAX_NAME) reasons.push(`name too long (${dir.length} > ${MAX_NAME})`);
  if (!NAME_RE.test(dir)) reasons.push(`name "${dir}" is not kebab-case`);
  const reserved = RESERVED_PREFIXES.find((p) => dir.startsWith(p));
  if (reserved) reasons.push(`name uses reserved prefix "${reserved}"`);

  if (manifest) {
    if (manifest.name !== dir) reasons.push(`manifest name "${manifest.name}" does not match folder "${dir}"`);
    if (typeof manifest.description !== 'string' || !manifest.description) reasons.push('plugin.json: description is required');
  }
  if (typeof catalogue?.category === 'string' && !taxonomy.categories.includes(catalogue.category)) {
    reasons.push(`category "${catalogue.category}" is not in taxonomy`);
  }
  const keywords = manifest?.keywords ?? [];
  if (!Array.isArray(keywords)) reasons.push('plugin.json: keywords must be an array');
  else for (const k of keywords) if (!taxonomy.tags.includes(k)) reasons.push(`keyword "${k}" is not in taxonomy tags`);
  return reasons;
}

/**
 * @param repo loadRepo() output
 * @returns {{ catalogues: {channel:string, file:string, json:object}[], excluded: {name:string, reasons:string[]}[] }}
 */
export function buildCatalogues(repo) {
  const entries = [];
  const excluded = [];
  for (const p of repo.plugins) {
    const reasons = exclusionReasons(p, repo.taxonomy);
    if (reasons.length) {
      excluded.push({ name: p.dir, reasons });
      continue;
    }
    entries.push({
      stage: p.status.stage,
      name: p.dir,
      source: `./plugins/${p.dir}`,
      description: prefix(p.status.stage, p.catalogue) + p.manifest.description,
      category: p.catalogue.category,
      tags: [...(p.manifest.keywords ?? [])],
    });
  }
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  entries.sort(byName);
  excluded.sort(byName);
  const catalogues = CHANNELS.map((c) => ({
    channel: c.id,
    file: c.file,
    json: {
      $schema: MARKETPLACE_SCHEMA,
      name: c.name,
      description: c.description,
      owner: { ...OWNER },
      plugins: entries
        .filter((e) => (CHANNEL_STAGES[c.id] ?? LISTED_STAGES).includes(e.stage))
        .map(({ stage, ...e }) => ({ ...e, tags: [...e.tags] })),
    },
  }));
  return { catalogues, excluded };
}
