// Related plugins: zero-dependency TF-IDF + cosine similarity. Deterministic.
// Text = name + description + tags + category + skill descriptions.

const STOPWORDS = new Set(
  'a an and are as at be by for from in into is it its of on or the this to use when with you your not no can'.split(' '),
);

/** Lowercase word tokens; kebab/snake names split; stopwords and 1-char tokens dropped. */
export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function docText(p) {
  return [
    p.name,
    p.description,
    ...(p.tags ?? []),
    p.category,
    ...(p.skills ?? []).flatMap((s) => [s.name, s.description]),
  ].join(' ');
}

/**
 * @param plugins [{name, description, tags?, category?, skills?:[{name?, description?}]}]
 * @returns {{[name:string]: string[]}} top-N most similar plugin names (score > 0), keys sorted
 */
export function related(plugins, { top = 3 } = {}) {
  const sorted = [...plugins].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const tfs = sorted.map((p) => {
    const tf = new Map();
    for (const t of tokenize(docText(p))) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const df = new Map();
  for (const tf of tfs) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = sorted.length;
  const vecs = tfs.map((tf) => {
    const v = new Map();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * Math.log((1 + n) / (1 + df.get(t)));
      if (w > 0) { v.set(t, w); norm += w * w; }
    }
    return { v, norm: Math.sqrt(norm) };
  });
  const cos = (a, b) => {
    if (!a.norm || !b.norm) return 0;
    let dot = 0;
    for (const [t, w] of a.v) { const o = b.v.get(t); if (o) dot += w * o; }
    return dot / (a.norm * b.norm);
  };
  const out = {};
  sorted.forEach((p, i) => {
    out[p.name] = sorted
      .map((q, j) => ({ name: q.name, s: i === j ? 0 : cos(vecs[i], vecs[j]) }))
      .filter((x) => x.s > 1e-9)
      .sort((a, b) => b.s - a.s || (a.name < b.name ? -1 : 1))
      .slice(0, top)
      .map((x) => x.name);
  });
  return out;
}
