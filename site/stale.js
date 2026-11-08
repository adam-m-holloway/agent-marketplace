// Stale usage-data banner, shared by the page (app.js) and the Node test (tests/build-site.test.mjs).
// Plain script, no modules: defines globals.
var STALE_HOURS = 36;

/** Banner text when usage data (consumers_generated_at) is older than STALE_HOURS, else null. */
function staleMessage(generatedAt, nowMs) {
  if (!generatedAt) return null;
  var t = Date.parse(generatedAt);
  if (isNaN(t)) return null;
  var hours = Math.floor((nowMs - t) / 3600000);
  if (hours < STALE_HOURS) return null;
  return 'Usage data is ' + hours + ' hours old — the nightly insights run may have stopped.';
}
