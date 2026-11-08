// Generated catalogues must match what `npm run sync` would write.
// The generator lives in scripts/lib/catalogue.mjs (or scripts/sync.mjs); loaded lazily.
import { CHANNELS, stableJson } from '../plugins.mjs';
import { f, tryImport, readText } from './_util.mjs';

const ID = 'stale-catalogues';
const NAMES = ['buildCatalogues', 'generateCatalogues', 'buildAll', 'buildCatalogue', 'generateCatalogue', 'build', 'generate'];

async function loadGenerator() {
  for (const [spec, lib] of [['../catalogue.mjs', 'scripts/lib/catalogue.mjs'], ['../../sync.mjs', 'scripts/sync.mjs']]) {
    const m = await tryImport(spec);
    if (!m) continue;
    for (const n of NAMES) if (typeof m[n] === 'function') return { fn: m[n], name: n, lib };
  }
  return null;
}

const asText = (v) => (typeof v === 'string' ? v : stableJson(v));

/** Normalise the generator's output to { [catalogueFile]: text }. */
async function expected(gen, repo) {
  const out = {};
  const perChannel = /Catalogue$/.test(gen.name) && !/Catalogues$/.test(gen.name);
  if (perChannel) {
    for (const ch of CHANNELS) out[ch.file] = asText(await gen.fn(repo, ch));
    return out;
  }
  let r = await gen.fn(repo);
  if (r instanceof Map) r = Object.fromEntries(r);
  if (Array.isArray(r)) {
    r.forEach((item, i) => {
      const file = item.file ?? item.path ?? CHANNELS.find((c) => c.id === item.channel || c.id === item.id || c.name === item.name)?.file ?? CHANNELS[i]?.file;
      const value = item.content ?? item.text ?? item.json ?? item.catalogue ?? item.value ?? item.data ?? item;
      out[file] = asText(value);
    });
    return out;
  }
  for (const [k, v] of Object.entries(r ?? {})) {
    const file = CHANNELS.find((c) => c.id === k || c.name === k || c.file === k)?.file ?? k;
    out[file] = asText(v?.content ?? v);
  }
  return out;
}

export default {
  id: ID,
  group: 'plugins',
  async run({ root, repo }) {
    const gen = await loadGenerator();
    if (!gen) return [f(ID, 'MEDIUM', 'scripts/lib/catalogue.mjs', 'rule skipped: scripts/lib/catalogue.mjs not available')];
    let want;
    try {
      want = await expected(gen, repo);
    } catch (e) {
      return [f(ID, 'MEDIUM', gen.lib, `rule skipped: ${gen.lib} not usable (${e.message})`)];
    }
    const out = [];
    for (const ch of CHANNELS) {
      if (want[ch.file] === undefined) continue;
      const have = readText(root, ch.file);
      if (have === null) out.push(f(ID, 'ERROR', ch.file, 'missing — run `npm run sync`'));
      else if (have !== want[ch.file]) out.push(f(ID, 'ERROR', ch.file, 'out of date — run `npm run sync` and commit the result'));
    }
    return out;
  },
};
