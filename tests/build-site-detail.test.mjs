import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadRepo } from '../scripts/lib/plugins.mjs';
import {
  renderMarkdown, renderInline, safeUrl, releaseTimeline, adoptionSeries, readConsumerHistory, buildData,
} from '../scripts/build-site.mjs';

const BASE = 'https://github.com/adam-m-holloway/agent-marketplace/blob/main/plugins/x/';

test('renderMarkdown: headings, paragraphs, lists, code, inline code, links, tables', () => {
  const md = [
    '# Title', '', 'Intro *em* and **bold** with `a<b>` code.', 'Wrapped line.', '',
    '## Skills', '', '- one `x`;', '- two', '  continued', '', '1. first', '2. second', '',
    '```json', '{"a": "<b>"}', '```', '',
    '| # | Title |', '|---|:---:|', '| 1 | [Doc](docs/a.md) |', '',
    '> quoted', '', '---',
  ].join('\n');
  const html = renderMarkdown(md, { base: BASE, headingOffset: 2, dropTitle: true });
  assert.ok(!html.includes('Title</h'), 'leading h1 dropped');
  assert.match(html, /<p>Intro <em>em<\/em> and <strong>bold<\/strong> with <code>a&lt;b&gt;<\/code> code\. Wrapped line\.<\/p>/);
  assert.match(html, /<h4>Skills<\/h4>/);
  assert.match(html, /<ul><li>one <code>x<\/code>;<\/li><li>two continued<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<pre><code class="lang-json">\{&quot;a&quot;: &quot;&lt;b&gt;&quot;\}<\/code><\/pre>/);
  assert.match(html, /<th>#<\/th><th class="align-center">Title<\/th>/);
  assert.match(html, /<a href="https:\/\/github\.com\/adam-m-holloway\/agent-marketplace\/blob\/main\/plugins\/x\/docs\/a\.md" rel="noopener noreferrer">Doc<\/a>/);
  assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
  assert.match(html, /<hr>/);
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown('# A', { headingOffset: 9 }), '<h6>A</h6>');
});

test('renderMarkdown: XSS — raw HTML is escaped and unsafe link schemes are dropped', () => {
  const md = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[click](javascript:alert(1)) [data](data:text/html,<b>x</b>) [vb](  JaVaScRiPt:alert(1))',
    '[q](https://ok.example/"onmouseover="x) ![pic](https://img.example/a.png)',
    '| <b>h</b> |', '|---|', '| <i onclick=x>c</i> |',
    '`<script>`',
  ].join('\n');
  const html = renderMarkdown(md, { base: BASE });
  assert.ok(!/<script|<img|<b>|<i /i.test(html), html);
  assert.ok(!/href="(javascript|data):/i.test(html), html);
  assert.ok(!/href="[^"]*"[^>]*onmouseover/i.test(html), 'quotes cannot break out of href');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /\bclick\b/);
  assert.match(html, /<a href="https:\/\/img\.example\/a\.png" rel="noopener noreferrer">pic<\/a>/);
  assert.equal(safeUrl('javascript:alert(1)', BASE), null);
  assert.equal(safeUrl('#anchor', BASE), null);
  assert.equal(safeUrl('mailto:a@b.c', BASE), 'mailto:a@b.c');
  assert.equal(safeUrl('../../docs/x.md', BASE), 'https://github.com/adam-m-holloway/agent-marketplace/blob/main/docs/x.md');
  assert.equal(renderInline('snake_case_name and 2*3*4', null), 'snake_case_name and 2*3*4');
});

test('releaseTimeline merges CHANGELOG headings and tags, newest first', () => {
  const cl = '# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-11-07\n\n## [1.0.0] - 2026-11-01\n';
  assert.deepEqual(releaseTimeline(cl, { '1.1.0': '2026-11-08', '1.2.0': '2026-11-09' }), [
    { version: '1.2.0', date: '2026-11-09', tagged: true },
    { version: '1.1.0', date: '2026-11-08', tagged: true },
    { version: '1.0.0', date: '2026-11-01', tagged: false },
  ]);
  assert.deepEqual(releaseTimeline(null, undefined), []);
});

test('adoptionSeries counts distinct active consumers per plugin per scan date', () => {
  const rows = [
    { date: '2026-11-08', consumer: 'o/a', plugin: 'p', status: 'active' },
    { date: '2026-11-08', consumer: 'o/a', plugin: 'p', status: 'active' }, // duplicate (other channel)
    { date: '2026-11-08', consumer: 'o/b', plugin: 'p', status: 'active' },
    { date: '2026-11-09', consumer: 'o/a', plugin: 'p', status: 'removed' },
    { date: '2026-11-09', consumer: 'o/b', plugin: 'p', status: 'active' },
    { date: '2026-11-09', consumer: 'o/b', plugin: 'q', status: 'unknown' },
    { date: 'bad', consumer: 'o/c', plugin: 'p', status: 'active' },
  ];
  assert.deepEqual(adoptionSeries(rows, ['p', 'q']), {
    p: [{ date: '2026-11-08', active: 2 }, { date: '2026-11-09', active: 1 }],
    q: [{ date: '2026-11-08', active: 0 }, { date: '2026-11-09', active: 0 }],
  });
  assert.deepEqual(adoptionSeries([], ['p']), { p: [] });
});

test('readConsumerHistory reads every consumers/**.ndjson; missing data branch → []', () => {
  const files = { 'consumers/year=2026/month=11/2026-11-08.ndjson': '{"plugin":"p","date":"2026-11-08"}\nnot json\n', 'consumers/x.json': '{}' };
  assert.equal(readConsumerHistory((ref, p) => files[p] ?? null, () => Object.keys(files)).length, 1);
  assert.deepEqual(readConsumerHistory(() => null, () => []), []);
});

test('buildData: plugins carry rendered README/CHANGELOG, releases and adoption history', () => {
  const repo = loadRepo(fileURLToPath(new URL('..', import.meta.url)));
  const d = buildData(repo, {
    now: '2026-11-08T12:00:00.000Z',
    releaseTags: { 'adr-helper': { '1.0.0': '2026-11-08' } },
    consumerHistory: [{ date: '2026-11-08', consumer: 'o/a', plugin: 'adr-helper', status: 'active' }],
  });
  const adr = d.plugins.find((p) => p.name === 'adr-helper');
  assert.match(adr.readme_html, /<h4>Skills<\/h4>/);
  assert.ok(!adr.readme_html.includes('<h1>'));
  assert.match(adr.changelog_html, /<h4>\[1\.0\.0\] - \d{4}-\d{2}-\d{2}<\/h4>/);
  assert.equal(adr.releases.at(-1).version, '1.0.0');
  assert.equal(adr.releases.at(-1).tagged, true);
  assert.deepEqual(adr.adoption_history, [{ date: '2026-11-08', active: 1 }]);
  const go = d.plugins.find((p) => p.name === 'go-conventions');
  assert.deepEqual(go.adoption_history, [{ date: '2026-11-08', active: 0 }]);
});
