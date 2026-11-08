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
const visibleCards = () => evalJs(`[...document.querySelectorAll('#results .card')].filter(c => c.offsetParent !== null).map(c => c.querySelector('h2,h3')?.textContent.trim())`);

const initial = await visibleCards();
check('three plugin cards render', initial?.length === 3, initial);
await evalJs(`document.querySelectorAll('#results details').forEach(d => d.querySelector('summary')?.click())`); await sleep(300);
const adr = await evalJs(`(() => { const c = [...document.querySelectorAll('#results .card')].find(c => /adr-helper/.test(c.textContent)); return c ? c.innerText : null; })()`);
check('adr-helper card shows latest + stable versions', /\d+\.\d+\.\d+/.test(adr ?? '') && /stable/i.test(adr ?? '') && /latest/i.test(adr ?? ''), adr?.slice(0, 200));
check('adr-helper card lists team-a and team-b consumers', /team-a/.test(adr ?? '') && /team-b/.test(adr ?? ''), null);
check('consumers note says committed intent', /committed intent/i.test(adr ?? ''), null);
check('install command present (--marketplace)', /claude plugin install adr-helper --marketplace adam-m-holloway\/agent-marketplace/.test(adr ?? ''), null);
check('every card has a "View details" link to #/plugin/<name>', await evalJs(`[...document.querySelectorAll('#results .card')].every(c => [...c.querySelectorAll('a')].some(a => /view details/i.test(a.textContent) && /#\\/plugin\\//.test(a.getAttribute('href'))))`), null);
await shot('site-initial.png');

await type('adr helpr'); await sleep(500);
const fuzzy = await visibleCards();
check('fuzzy "adr helpr" finds adr-helper', fuzzy?.[0]?.includes('adr-helper'), fuzzy);
await shot('site-fuzzy.png');

await type('kubernetes operator'); await sleep(500);
const req = await evalJs(`(() => { const a = document.querySelector('#request a, a#request, #request'); const link = a?.tagName === 'A' ? a : a?.querySelector('a'); return { visible: !!(a && a.offsetParent !== null), href: link?.href ?? null }; })()`);
check('weak search offers "Request this plugin" pre-filled', req?.visible && /issues\/new\?.*template=plugin-request\.yml.*query=kubernetes(%20|\+)operator/.test(req?.href ?? ''), req);
await shot('site-request.png');

await type(''); await sleep(300);
const filt = await evalJs(`(() => { const s = document.getElementById('f-language'); const opt = [...s.options].find(o => /^go$/i.test(o.value)); if (!opt) return 'no go option: ' + [...s.options].map(o=>o.value); s.value = opt.value; s.dispatchEvent(new Event('change', {bubbles:true})); s.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
await sleep(400);
const goOnly = await visibleCards();
check('language filter "go" → go-conventions (+ any-language plugins)', filt === true && goOnly?.some((n) => n.includes('go-conventions')) && !goOnly?.some((n) => n.includes('typescript-conventions')), { filt, goOnly });
await evalJs(`(() => { const s = document.getElementById('f-language'); s.value = ''; s.dispatchEvent(new Event('change', {bubbles:true})); })()`);

await evalJs(`document.querySelectorAll('#results details:not([open])').forEach(d => d.querySelector('summary')?.click())`); await sleep(300);
const toggled = await evalJs(`(() => { const c = [...document.querySelectorAll('#results .card')].find(c => /adr-helper/.test(c.textContent)); const t = [...c.querySelectorAll('button, input[type=radio], label')].find(b => /stable/i.test(b.textContent || b.value || '')); if (!t) return null; t.click(); return new Promise(r => setTimeout(() => r(c.innerText), 300)); })()`);
check('stable toggle shows ref + path + @agent-marketplace-stable', /"ref": "stable"/.test(toggled ?? '') && /marketplace-stable\.json/.test(toggled ?? '') && /@agent-marketplace-stable/.test(toggled ?? ''), toggled ? 'toggled' : 'no stable toggle found');
await shot('site-stable.png');

// --- v2: #plugin= filter links, detail page, back link, 360px screenshots ---
const nav = async (hash) => { await evalJs(`(location.hash = ${JSON.stringify(hash)}, true)`); await sleep(500); };
await nav('#plugin=adr-helper');
const only = await visibleCards();
check('#plugin=adr-helper filters to one card', only?.length === 1 && only[0].includes('adr-helper'), only);
await nav('');
await nav('#/plugin/adr-helper');
const det = await evalJs(`(() => { const d = document.getElementById('detail'); return { visible: d.offsetParent !== null, text: d.innerText, catalogueHidden: document.getElementById('catalogue').hidden,
  readmeH: d.querySelectorAll('.prose h4').length, svgs: [...d.querySelectorAll('svg.chart-svg')].map(s => s.querySelector('title')?.textContent), tables: d.querySelectorAll('.chart table.offscreen').length,
  scripts: d.querySelectorAll('.prose script, .prose img').length, title: document.title }; })()`);
check('detail page: shown, catalogue hidden, title set', det?.visible && det.catalogueHidden && /adr-helper/.test(det.title), { title: det?.title });
check('detail page: related, used-by, committed intent, install, how-scores link', /related/i.test(det?.text ?? '') && /team-a/.test(det?.text ?? '') && /team-b/.test(det?.text ?? '') && /committed intent/i.test(det?.text ?? '') && /How scores are calculated/.test(det?.text ?? '') && /claude plugin install adr-helper --marketplace adam-m-holloway\/agent-marketplace/.test(det?.text ?? ''), null);
check('detail page: rendered README + full CHANGELOG + versions', det?.readmeH >= 2 && /\[1\.0\.0\]/.test(det?.text ?? '') && /\[1\.1\.1\]/.test(det?.text ?? '') && /v1\.1\.0/.test(det?.text ?? '') && det.scripts === 0, { readmeH: det?.readmeH });
check('detail page: two SVG charts with titles + data tables', det?.svgs?.length === 2 && det.svgs.every(Boolean) && det.tables === 2, det?.svgs);
await shot('detail-1280.png');
await nav('#/plugin/no-such-plugin');
check('unknown plugin shows not-found', /Plugin not found/.test(await evalJs(`document.getElementById('detail').innerText`) ?? ''), null);
await evalJs(`(document.querySelector('#detail .back a').click(), true)`); await sleep(500);
const back = await visibleCards();
check('back link returns to the full catalogue', back?.length === 3, back);
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true }); await sleep(600);
await evalJs(`(document.querySelectorAll('#results details[open]').forEach(d => d.open = false), true)`); await sleep(200);
const overflow360 = await evalJs(`document.documentElement.scrollWidth`);
await shot('grid-360.png');
await nav('#/plugin/adr-helper'); await sleep(300);
const overflowDetail = await evalJs(`document.documentElement.scrollWidth`);
check('no horizontal page scroll at 360px (grid + detail)', overflow360 <= 360 && overflowDetail <= 360, { overflow360, overflowDetail });
await shot('detail-360.png');

const origin = new globalThis.URL(URL).origin;
const offsite = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('about:'));
check('no requests leave the site origin', offsite.length === 0, offsite);
check('no console errors', consoleErrors.length === 0, consoleErrors);

console.log(JSON.stringify(results, null, 2));
const failed = Object.entries(results).filter(([, v]) => !v.ok).map(([k]) => k);
console.log(failed.length ? `FAILED: ${failed.join('; ')}` : `ALL ${Object.keys(results).length} BROWSER CHECKS PASSED`);
ws.close(); chrome.kill();
process.exit(failed.length ? 1 : 0);
