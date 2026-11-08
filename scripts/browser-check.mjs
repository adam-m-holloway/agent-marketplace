// Headless-Chrome smoke test for the catalogue site (zero deps; drives an installed Google Chrome over the
// DevTools protocol). Usage: node scripts/browser-check.mjs <url> [screenshot-dir]   (SCHEME=light|dark)
// Local only: needs Chrome at the default macOS path; CI does not run it.
// Drive real headless Chrome over CDP (Node 24 built-in WebSocket) against the live Pages site.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'https://adam-m-holloway.github.io/agent-marketplace/';
const OUT = process.argv[3] ?? tmpdir();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1280,1600', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); wsUrl = t.find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {}
  if (!wsUrl) await sleep(200);
}
console.error('ws', wsUrl);
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const requests = []; const consoleErrors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; console.error('cdp', method); const t = setTimeout(() => { console.error('TIMEOUT', method); pending.delete(i); r({}); }, 10000); pending.set(i, (m) => { clearTimeout(t); r(m); }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64')); };

await send('Network.enable'); await send('Runtime.enable'); await send('Page.enable');
if (process.env.SCHEME) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.SCHEME }] });
await send('Page.navigate', { url: URL });
await sleep(4000);

const results = {};
const check = (name, ok, detail) => { results[name] = { ok: !!ok, detail }; };
const type = (q) => evalJs(`(() => { const i = document.getElementById('q'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
const visibleCards = () => evalJs(`[...document.querySelectorAll('#results .card')].filter(c => c.offsetParent !== null).map(c => c.querySelector('h3')?.textContent.trim())`);
const nav = async (hash) => { await evalJs(`(location.hash = ${JSON.stringify(hash)}, true)`); await sleep(500); };
const listed = await evalJs(`fetch('data.json').then(r => r.json()).then(d => d.plugins.map(p => p.name))`);

// ---------- home: minimal cards ----------
const initial = await visibleCards();
check('home: one card per listed plugin, with names', initial?.length === listed?.length && listed.every((n) => initial.includes(n)), { initial, listed });
const adrCard = await evalJs(`(() => { const c = document.getElementById('plugin-adr-helper'); if (!c) return null;
  const links = [...c.querySelectorAll('a, button, input, select, summary, details')];
  const link = c.querySelector('h3 a');
  const r = c.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 6);
  return { text: c.innerText, interactive: links.length, href: link?.getAttribute('href'), wholeCard: hit === link || link?.contains(hit) }; })()`);
check('home card: h3 link to #/plugin/<name> is the only interactive element and covers the card',
  adrCard?.href === '#/plugin/adr-helper' && adrCard.interactive === 1 && adrCard.wholeCard, adrCard && { href: adrCard.href, interactive: adrCard.interactive, wholeCard: adrCard.wholeCard });
check('home card: version, stage and one score line; no install / used-by',
  /v\d+\.\d+\.\d+/.test(adrCard?.text ?? '') && /published/i.test(adrCard?.text ?? '') && /Security\s+\d+/.test(adrCard?.text ?? '') && /Evals/.test(adrCard?.text ?? '') &&
  !/claude plugin install|Used by|team-a/.test(adrCard?.text ?? ''), adrCard?.text);
check('home: no install content; "How scores are calculated" is a footer link to its own page', await evalJs(`(() => { const main = document.getElementById('catalogue'); const a = [...document.querySelectorAll('footer a')].find(x => /How scores are calculated/.test(x.textContent)); return !document.getElementById('how-scores') && !/claude plugin install|Just me|My team's repo|How consuming works/.test(document.body.innerText.split('Catalogue built')[0]) && !!a && a.getAttribute('href') === '#/scores'; })()`), null);
await shot('home-1280.png');

await type('adr helpr'); await sleep(500);
const fuzzy = await visibleCards();
check('fuzzy "adr helpr" finds adr-helper', fuzzy?.[0]?.includes('adr-helper'), fuzzy);

await type('kubernetes operator'); await sleep(500);
const req = await evalJs(`(() => { const a = document.getElementById('request'); const link = a?.querySelector('a'); return { visible: !!(a && a.offsetParent !== null), href: link?.href ?? null }; })()`);
check('weak search offers "Request this plugin" pre-filled', req?.visible && /issues\/new\?.*template=plugin-request\.yml.*query=kubernetes(%20|\+)operator/.test(req?.href ?? ''), req);
await shot('home-request.png');

await type(''); await sleep(300);
const filt = await evalJs(`(() => { const s = document.getElementById('f-language'); const opt = [...s.options].find(o => /^go$/i.test(o.value)); if (!opt) return 'no go option: ' + [...s.options].map(o=>o.value); s.value = opt.value; s.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`);
await sleep(400);
const goOnly = await visibleCards();
check('language filter "go" → go-conventions (+ any-language plugins)', filt === true && goOnly?.some((n) => n.includes('go-conventions')) && !goOnly?.some((n) => n.includes('typescript-conventions')), { filt, goOnly });
await evalJs(`(() => { const s = document.getElementById('f-language'); s.value = ''; s.dispatchEvent(new Event('change', {bubbles:true})); return true; })()`); await sleep(300);

await nav('#plugin=adr-helper');
const only = await visibleCards();
check('#plugin=adr-helper filters the home grid to one card', only?.length === 1 && only[0].includes('adr-helper'), only);
await nav('');

// ---------- detail page: key info first, expandable sections ----------
await nav('#/plugin/adr-helper'); await sleep(300);
await shot('detail-1280-collapsed.png');
const det =await evalJs(`(() => { const d = document.getElementById('detail'); const head = d.querySelector('.detail-head');
  const panel = document.getElementById('install-panel');
  const scoresEl = d.querySelector('.scores');
  const installBeforeScores = !!panel && !!scoresEl && !!(panel.compareDocumentPosition(scoresEl) & Node.DOCUMENT_POSITION_FOLLOWING);
  return { visible: d.offsetParent !== null, catalogueHidden: document.getElementById('catalogue').hidden, title: document.title,
    head: head.innerText, visiblePanel: !!panel && panel.offsetParent !== null, installBeforeScores, panelInHead: head.contains(panel), panelText: panel?.innerText ?? '',
    scores: d.querySelector('.scores')?.innerText ?? '',
    secs: [...d.querySelectorAll('details.sec')].map(s => ({ id: s.id, open: s.open, summary: s.querySelector('summary').innerText.replace(/\\s+/g, ' ') })) }; })()`);
check('detail: shown, catalogue hidden, title set', det?.visible && det.catalogueHidden && /adr-helper/.test(det.title), { title: det?.title });
check('detail head: name, description, latest + stable, stage, category, updated, owner',
  /adr-helper/.test(det?.head ?? '') && /Latest\s*v1\.\d+\.\d+/i.test(det?.head ?? '') && /Stable\s*v1\.\d+\.\d+/i.test(det?.head ?? '') && /published/i.test(det?.head ?? '') &&
  /documentation/.test(det?.head ?? '') && /Updated\s+\d{4}-\d\d-\d\d · v\d/i.test(det?.head ?? '') && /Adam Holloway/.test(det?.head ?? ''), det?.head?.slice(0, 400));
check('detail head: install panel is visible in the main block, above the scores, with the --marketplace command',
  det?.visiblePanel && det.installBeforeScores && det.panelInHead && /claude plugin install adr-helper --marketplace adam-m-holloway\/agent-marketplace/.test(det.panelText) && /Just me/.test(det.panelText) && /My team's repo/i.test(det.panelText), det && { visible: det.visiblePanel, before: det.installBeforeScores });
check('detail: score summary row (Security / Quality / Evals / Adoption)', ['Security', 'Quality', 'Evals', 'Adoption'].every((k) => new RegExp(k, 'i').test(det?.scores ?? '')) && /\d/.test(det?.scores ?? ''), det?.scores);
const sumOf = (id) => det?.secs?.find((s) => s.id === id)?.summary ?? '';
check('detail sections: collapsed with one-line previews',
  det?.secs?.length >= 8 && det.secs.every((s) => !s.open) &&
  /Scores.*security \d+ · quality \d+ · evals/i.test(sumOf('sec-scores')) && /Used by.*2 teams.*team-a latest.*team-b stable/.test(sumOf('sec-used')) &&
  /Release history.*\d+ releases, latest \d/.test(sumOf('sec-releases')) && /Changelog.+/.test(sumOf('sec-changelog')) && /Trends.*score history over/.test(sumOf('sec-trends')) &&
  /README.+/.test(sumOf('sec-readme')) && /Skills.*create-adr/.test(sumOf('sec-skills')) && /Related/.test(sumOf('sec-related')),
  det?.secs);
await shot('detail-1280-install.png');

const homeBack = await evalJs(`(() => new Promise(r => { location.hash = '#/plugin/go-conventions'; setTimeout(() => { document.querySelector('h1 .home-link').click(); setTimeout(() => r({ catalogue: !document.getElementById('catalogue').hidden, detailHidden: document.getElementById('detail').hidden, cards: document.querySelectorAll('#results .card').length, q: document.getElementById('q').value }), 400); }, 400); }))()`);
check('header: clicking the site title from a plugin page returns to the clean home page', homeBack?.catalogue && homeBack.detailHidden && homeBack.cards >= 3 && homeBack.q === '', homeBack);
await nav('#/scores'); await sleep(300);
const sp = await evalJs(`(() => ({ title: document.title, text: document.getElementById('detail').innerText, catHidden: document.getElementById('catalogue').hidden }))()`);
check('scores page: #/scores shows the explainer on its own page', /How scores are calculated/.test(sp?.title ?? '') && sp.catHidden && /Security/.test(sp.text) && /Quality/.test(sp.text) && /major and minor/i.test(sp.text), sp?.title);
await shot('scores-page.png');
await nav('#/plugin/adr-helper'); await sleep(300);
const stable = await evalJs(`(() => { const t = document.querySelector('#install-panel input[value=stable]'); if (!t) return null; t.click(); return new Promise(r => setTimeout(() => r(document.getElementById('install-panel').innerText), 300)); })()`);
check('stable toggle shows ref + path + @agent-marketplace-stable', /"ref": "stable"/.test(stable ?? '') && /\.claude-plugin\/marketplace-stable\.json/.test(stable ?? '') && /@agent-marketplace-stable/.test(stable ?? ''), stable ? 'toggled' : 'no stable toggle found');
await evalJs(`(document.querySelector('#install-panel input[value=latest]').click(), true)`);

await evalJs(`(document.querySelectorAll('#detail details.sec').forEach(d => d.querySelector('summary').click()), true)`); await sleep(500);
const open = await evalJs(`(() => { const d = document.getElementById('detail'); return { allOpen: [...d.querySelectorAll('details.sec')].every(s => s.open), text: d.innerText,
  readmeH: d.querySelectorAll('#sec-readme .prose h3, #sec-readme .prose h4').length,
  svgs: [...d.querySelectorAll('svg.chart-svg')].map(s => ({ t: s.querySelector('title')?.textContent, w: +s.getAttribute('width'), box: s.parentNode.clientWidth })),
  tables: d.querySelectorAll('.chart table.offscreen').length, scripts: d.querySelectorAll('.prose script, .prose img').length }; })()`);
check('detail sections expand on click', open?.allOpen, null);
check('Used by: team-a and team-b + "Committed intent per repo"', /team-a/.test(open?.text ?? '') && /team-b/.test(open?.text ?? '') && /Committed intent per repo/i.test(open?.text ?? ''), null);
check('Scores section: breakdown + history table', /Score history/i.test(open?.text ?? '') && /criteria/i.test(open?.text ?? ''), null);
check('README + full CHANGELOG + release timeline rendered (no scripts/images)', open?.readmeH >= 1 && /\[1\.0\.0\]/.test(open?.text ?? '') && /\[1\.1\.1\]/.test(open?.text ?? '') && /v1\.1\.0/.test(open?.text ?? '') && open.scripts === 0, { readmeH: open?.readmeH });
check('Trends: two SVG charts with titles + data tables, drawn at their box width', open?.svgs?.length === 2 && open.svgs.every((s) => s.t && Math.abs(s.w - Math.max(260, s.box)) <= 2) && open.tables === 2, open?.svgs);
await shot('detail-1280-expanded.png');

await nav('#/plugin/no-such-plugin');
check('unknown plugin shows not-found', /Plugin not found/.test(await evalJs(`document.getElementById('detail').innerText`) ?? ''), null);
await evalJs(`(document.querySelector('#detail .back a').click(), true)`); await sleep(500);
const back = await visibleCards();
check('back link returns to the full catalogue', back?.length === listed?.length, back);

// ---------- 360px ----------
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true }); await sleep(600);
const overflow360 = await evalJs(`document.documentElement.scrollWidth`);
await shot('home-360.png');
await nav('#/plugin/adr-helper'); await sleep(300);
const overflowDetail = await evalJs(`document.documentElement.scrollWidth`);
await shot('detail-360.png');
await evalJs(`(() => { document.querySelector('#detail .detail-head button').click(); document.querySelectorAll('#detail details.sec').forEach(d => d.open = true); return true; })()`); await sleep(500);
const overflowDetailOpen = await evalJs(`document.documentElement.scrollWidth`);
check('no horizontal page scroll at 360px (home + detail collapsed/expanded)', overflow360 <= 360 && overflowDetail <= 360 && overflowDetailOpen <= 360, { overflow360, overflowDetail, overflowDetailOpen });
await shot('detail-360-expanded.png');

const origin = new globalThis.URL(URL).origin;
const offsite = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('about:'));
check('no requests leave the site origin', offsite.length === 0, offsite);
check('no console errors', consoleErrors.length === 0, consoleErrors);

console.log(JSON.stringify(results, null, 2));
const failed = Object.entries(results).filter(([, v]) => !v.ok).map(([k]) => k);
console.log(failed.length ? `FAILED: ${failed.join('; ')}` : `ALL ${Object.keys(results).length} BROWSER CHECKS PASSED`);
ws.close(); chrome.kill();
process.exit(failed.length ? 1 : 0);
