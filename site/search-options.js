// Search shared by the page (app.js) and the Node tests. Plain script, no modules: defines globals.
//
// 1. Exact first: if any plugin's name or description contains every word typed (case-insensitive),
//    show only those. Typing "adr" shows only plugins that actually mention "adr".
// 2. Fuzzy fallback (typos, e.g. "adr helpr"): only when nothing matches exactly, Fuse.js over the
//    name and description with a strict threshold.
var FUSE_OPTIONS = {
  threshold: 0.3,
  ignoreLocation: true,
  includeScore: true,
  keys: [
    { name: 'name', weight: 3 },
    { name: 'description', weight: 1 },
  ],
};

/** docs: [{name, description}]; returns [{refIndex, score}] best first (score 0 = exact). */
function searchPlugins(docs, query, FuseCtor) {
  var words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return docs.map(function (_, i) { return { refIndex: i, score: 0 }; });
  var exact = [];
  docs.forEach(function (d, i) {
    var hay = (d.name + ' ' + (d.description || '')).toLowerCase();
    if (words.every(function (w) { return hay.indexOf(w) !== -1; })) {
      exact.push({ refIndex: i, score: d.name.toLowerCase().indexOf(words[0]) !== -1 ? 0 : 0.001 });
    }
  });
  if (exact.length) return exact.sort(function (a, b) { return a.score - b.score; });
  return new FuseCtor(docs, FUSE_OPTIONS).search(String(query).trim());
}
if (typeof module !== 'undefined') module.exports = { FUSE_OPTIONS: FUSE_OPTIONS, searchPlugins: searchPlugins };
