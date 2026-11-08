// Browser checks for the catalogue site. Runs in the `light` and `dark` projects (colorScheme).
// See playwright.config.mjs for how to run against the built site or the live URL.
import { test, expect } from '@playwright/test';

// ---------- helpers ----------
const siteNav = (page) => page.getByRole('navigation', { name: 'Site' });
const navLink = (page, name) => siteNav(page).getByRole('link', { name, exact: true });
const search = (page) => page.getByRole('searchbox', { name: 'Search' });
const detail = (page) => page.locator('#detail');
const catalogue = (page) => page.locator('#catalogue');

/** Names (h3 text) of the visible cards in the home grid. */
const visibleCards = (page) => page.evaluate(() =>
  [...document.querySelectorAll('#results .card')].filter((c) => c.offsetParent !== null).map((c) => c.querySelector('h3')?.textContent.trim()));

/** Plugin names in the catalogue data the page renders from. */
const listedNames = (page) => page.evaluate(() => fetch('data.json').then((r) => r.json()).then((d) => d.plugins.map((p) => p.name)));

async function home(page) {
  await page.goto('./');
  await expect(page.locator('#results .card').first()).toBeVisible();
}

async function nav(page, hash) {
  await page.evaluate((h) => { location.hash = h; }, hash);
}

async function openPlugin(page, name) {
  await home(page);
  await nav(page, `#/plugin/${name}`);
  await expect(page.locator('#detail-title')).toHaveText(name);
}

async function expandAll(page) {
  const summaries = page.locator('#detail details.sec > summary');
  const n = await summaries.count();
  for (let i = 0; i < n; i++) await summaries.nth(i).click();
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('#detail details.sec')].every((s) => s.open))).toBe(true);
}

const scrollWidth = (page) => page.evaluate(() => document.documentElement.scrollWidth);

// ---------- home: minimal cards ----------
test.describe('home', () => {
  test.beforeEach(async ({ page }) => { await home(page); });

  test('home: one card per listed plugin, with names', async ({ page }) => {
    const listed = await listedNames(page);
    await expect.poll(() => visibleCards(page)).toHaveLength(listed.length);
    const cards = await visibleCards(page);
    for (const n of listed) expect(cards).toContain(n);
  });

  test('home card: h3 link to #/plugin/<name> is the only interactive element and covers the card', async ({ page }) => {
    const card = page.locator('#plugin-adr-helper');
    await expect(card.getByRole('heading', { level: 3 }).getByRole('link')).toHaveAttribute('href', '#/plugin/adr-helper');
    await expect(card.locator('a, button, input, select, summary, details')).toHaveCount(1);
    const wholeCard = await card.evaluate((c) => {
      const link = c.querySelector('h3 a');
      const r = c.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom - 6);
      return hit === link || link.contains(hit);
    });
    expect(wholeCard).toBe(true);
  });

  test('home card: version, tag pills, stage, one score line; no install or used-by (that stays on the plugin page)', async ({ page }) => {
    const text = await page.locator('#plugin-adr-helper').innerText();
    expect(text).toMatch(/v\d+\.\d+\.\d+/);
    expect(text).toMatch(/published/i);
    expect(text).toMatch(/Security\s+\d+/);
    expect(text).toMatch(/Evals/);
    expect(text).toMatch(/documentation/);
    expect(text).not.toMatch(/claude plugin install|Used by|team-a/);
  });

  test('favicon: an SVG icon is linked and loads from the site', async ({ page, request }) => {
    const href = await page.locator('link[rel=icon]').getAttribute('href');
    expect(href).toBeTruthy();
    const res = await request.get(new URL(href, page.url()).href);
    expect(res.ok()).toBe(true);
    expect(res.headers()['content-type'] ?? '').toMatch(/svg/);
    expect(await res.text()).toContain('<svg');
  });

  test('header: "Agent Marketplace" is the H1 and the largest text', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Agent Marketplace');
    const largest = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const big = Math.max(...[...document.querySelectorAll('body *')]
        .filter((e) => e.offsetParent !== null && e.childElementCount === 0 && e.textContent.trim())
        .map((e) => parseFloat(getComputedStyle(e).fontSize)));
      return parseFloat(getComputedStyle(h1.querySelector('a') || h1).fontSize) >= big;
    });
    expect(largest).toBe(true);
    await expect(page.getByText('Claude Code plugins for our teams')).toHaveCount(0);
  });

  test('home: no install content; Scoring and Lifecycle are menu links to their own pages', async ({ page }) => {
    await expect(siteNav(page).locator('a[href="#/lifecycle"]')).toHaveCount(1);
    await expect(siteNav(page).locator('a[href="#/scores"]')).toHaveCount(1);
    await expect(page.locator('#how-scores')).toHaveCount(0);
    const body = await page.locator('body').innerText();
    expect(body.split('Catalogue built')[0]).not.toMatch(/claude plugin install|Just me|My team's repo|How consuming works/);
  });

  test('search "adr" shows only plugins whose name or description contains it', async ({ page }) => {
    await search(page).fill('adr');
    await expect.poll(() => visibleCards(page)).toHaveLength(1);
    expect((await visibleCards(page))[0]).toContain('adr-helper');
  });

  test('fuzzy "adr helpr" finds adr-helper', async ({ page }) => {
    await search(page).fill('adr helpr');
    await expect.poll(async () => (await visibleCards(page))[0] ?? '').toContain('adr-helper');
  });

  test('weak search offers "Request this plugin" pre-filled', async ({ page }) => {
    await search(page).fill('kubernetes operator');
    const box = page.locator('#request');
    await expect(box).toBeVisible();
    await expect(box.getByRole('link').first()).toHaveAttribute('href', /issues\/new\?.*template=plugin-request\.yml.*query=kubernetes(%20|\+)operator/);
  });

  test('language filter "go" → go-conventions (+ any-language plugins)', async ({ page }) => {
    const language = page.getByLabel('Language');
    const values = await language.locator('option').evaluateAll((os) => os.map((o) => o.value));
    const go = values.find((v) => /^go$/i.test(v));
    expect(go, `no go option: ${values}`).toBeTruthy();
    await language.selectOption(go);
    await expect.poll(async () => {
      const cards = await visibleCards(page);
      return cards.some((n) => n.includes('go-conventions')) && !cards.some((n) => n.includes('typescript-conventions'));
    }).toBe(true);
  });

  test('#plugin=adr-helper filters the home grid to one card', async ({ page }) => {
    await nav(page, '#plugin=adr-helper');
    await expect.poll(() => visibleCards(page)).toHaveLength(1);
    expect((await visibleCards(page))[0]).toContain('adr-helper');
  });
});

// ---------- detail page: key info first, expandable sections ----------
test.describe('detail page', () => {
  test.beforeEach(async ({ page }) => { await openPlugin(page, 'adr-helper'); });

  test('detail: shown, catalogue hidden, title set', async ({ page }) => {
    await expect(detail(page)).toBeVisible();
    await expect(catalogue(page)).toBeHidden();
    await expect(page).toHaveTitle(/adr-helper/);
  });

  test('detail head: name, description, latest + stable, stage, category, updated, owner', async ({ page }) => {
    const head = await page.locator('#detail .detail-head').innerText();
    expect(head).toMatch(/adr-helper/);
    expect(head).toMatch(/Latest\s*v1\.\d+\.\d+/i);
    expect(head).toMatch(/Stable\s*v1\.\d+\.\d+/i);
    expect(head).toMatch(/published/i);
    expect(head).toMatch(/documentation/);
    expect(head).toMatch(/Updated\s+\d{4}-\d\d-\d\d · v\d/i);
    expect(head).toMatch(/Adam Holloway/);
  });

  test('detail head: install panel is visible in the main block, above the scores, with the --marketplace command', async ({ page }) => {
    const panel = page.locator('#install-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('#detail .detail-head #install-panel')).toHaveCount(1);
    const before = await page.evaluate(() => {
      const p = document.getElementById('install-panel');
      const s = document.querySelector('#detail .scores');
      return !!s && !!(p.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(before).toBe(true);
    await expect(panel).toContainText('claude plugin install adr-helper --marketplace adam-m-holloway/agent-marketplace');
    await expect(panel).toContainText('Just me');
    await expect(panel).toContainText(/My team's repo/i);
  });

  test('detail: score summary row (Security / Quality / Evals / Installs) + "How scoring works" link', async ({ page }) => {
    const scores = await page.locator('#detail .scores').innerText();
    for (const k of ['Security', 'Quality', 'Evals', 'Installs']) expect(scores).toMatch(new RegExp(k, 'i'));
    expect(scores).not.toMatch(/Adoption|undefined|NaN|null/);
    await expect(page.locator('#detail .scores a[href="#/scores"]')).toHaveText('How scoring works');
    expect(scores).toMatch(/\d/);
  });

  test('detail sections: collapsed with one-line previews', async ({ page }) => {
    const secs = await page.locator('#detail details.sec').evaluateAll((ds) =>
      ds.map((s) => ({ id: s.id, open: s.open, summary: s.querySelector('summary').innerText.replace(/\s+/g, ' ') })));
    expect(secs.length).toBeGreaterThanOrEqual(8);
    expect(secs.filter((s) => s.open)).toEqual([]);
    const sumOf = (id) => secs.find((s) => s.id === id)?.summary ?? '';
    expect(sumOf('sec-scores')).toMatch(/Scores.*security \d+ · quality \d+ · evals/i);
    expect(sumOf('sec-used')).toMatch(/Installed by.*2 team repos.*team-a latest.*team-b stable/);
    for (const x of secs) expect(x.summary).not.toMatch(/undefined|NaN|null/);
    expect(sumOf('sec-releases')).toMatch(/Release history.*\d+ releases, latest \d/);
    expect(sumOf('sec-changelog')).toMatch(/Changelog.+/);
    expect(sumOf('sec-trends')).toMatch(/Trends.*score history over/);
    expect(sumOf('sec-readme')).toMatch(/README.+/);
    expect(sumOf('sec-skills')).toMatch(/Skills.*create-adr/);
    expect(sumOf('sec-related')).toMatch(/Related/);
  });

  test('stable toggle shows ref + path + @agent-marketplace-stable', async ({ page }) => {
    const panel = page.locator('#install-panel');
    await panel.locator('input[value=stable]').check();
    await expect(panel).toContainText('"ref": "stable"');
    await expect(panel).toContainText('.claude-plugin/marketplace-stable.json');
    await expect(panel).toContainText('@agent-marketplace-stable');
  });
});

test.describe('detail page, sections expanded', () => {
  test.beforeEach(async ({ page }) => {
    await openPlugin(page, 'adr-helper');
    await expandAll(page);
  });

  test('detail sections expand on click', async ({ page }) => {
    const open = await page.locator('#detail details.sec').evaluateAll((ds) => ds.every((s) => s.open));
    expect(open).toBe(true);
  });

  test('Installed by: team-a and team-b, each compared with its channel\'s current version', async ({ page }) => {
    await expect(detail(page)).toContainText('team-a');
    await expect(detail(page)).toContainText('team-b');
    await expect(detail(page)).toContainText(/Based on each team repo's committed settings/i);
    const rows = await page.locator('#sec-used tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText.trim())));
    const latest = (await page.locator('#detail .facts').innerText()).match(/Latest\s*v(\d+\.\d+\.\d+)/i)[1];
    for (const r of rows) {
      if (r[1] === 'latest' && r[2] !== 'v' + latest) expect(r[3], r.join(' | ')).toMatch(/behind/);
      if (r[3] === 'up to date' && r[1] === 'latest') expect(r[2]).toBe('v' + latest);
    }
  });

  test('plugin page: no repeated SkillSpector sentence; README without its own Install section', async ({ page }) => {
    const t = await page.locator('#sec-scores').innerText();
    expect((t.match(/SkillSpector/g) || []).length).toBeLessThanOrEqual(1);
    expect(await page.locator('#sec-readme .prose h3, #sec-readme .prose h4').evaluateAll((hs) => hs.map((x) => x.textContent.trim()))).not.toContain('Install');
  });

  test('Scores section: breakdown + history table', async ({ page }) => {
    await expect(detail(page)).toContainText(/Score history/i);
    await expect(detail(page)).toContainText(/Quality · \d of \d parts ran/);
    expect(await detail(page).innerText()).not.toMatch(/undefined|NaN/);
  });

  test('README + full CHANGELOG + release timeline rendered (no scripts/images)', async ({ page }) => {
    expect(await page.locator('#sec-readme .prose h3, #sec-readme .prose h4').count()).toBeGreaterThanOrEqual(1);
    await expect(detail(page)).toContainText('[1.0.0]');
    await expect(detail(page)).toContainText('[1.1.1]');
    await expect(detail(page)).toContainText('v1.1.0');
    await expect(page.locator('#detail .prose script, #detail .prose img')).toHaveCount(0);
  });

  test('Trends: two SVG charts with titles + data tables, drawn at their box width', async ({ page }) => {
    const charts = page.locator('#detail svg.chart-svg');
    await expect(charts).toHaveCount(2);
    await expect.poll(() => charts.evaluateAll((ss) => ss.every((s) =>
      s.querySelector('title')?.textContent && Math.abs(+s.getAttribute('width') - Math.max(260, s.parentNode.clientWidth)) <= 2))).toBe(true);
    await expect(page.locator('#detail .chart table.offscreen')).toHaveCount(2);
  });
});

// ---------- header, nav and own pages (#/scores, #/guide, #/about) ----------
test.describe('pages and nav', () => {
  test.beforeEach(async ({ page }) => { await home(page); });

  test('header: clicking the site title from a plugin page returns to the clean home page', async ({ page }) => {
    await nav(page, '#/plugin/go-conventions');
    await expect(page.locator('#detail-title')).toHaveText('go-conventions');
    await page.getByRole('heading', { level: 1 }).getByRole('link', { name: 'Agent Marketplace' }).click();
    await expect(catalogue(page)).toBeVisible();
    await expect(detail(page)).toBeHidden();
    expect(await page.locator('#results .card').count()).toBeGreaterThanOrEqual(3);
    await expect(search(page)).toHaveValue('');
  });

  test('scoring page: overview, one section per score, worked examples, our code vs third-party', async ({ page }) => {
    const link = navLink(page, 'Scoring');
    await link.click();
    await expect(page).toHaveURL(/#\/scores$/);
    await expect(page).toHaveTitle(/Scoring/);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(catalogue(page)).toBeHidden();
    await expect(page.locator('#detail table.overview tbody tr')).toHaveCount(4);
    for (const id of ['score-security', 'score-quality', 'score-evals', 'score-installs', 'score-history', 'score-split']) {
      await expect(page.locator('#' + id)).toHaveCount(1);
    }
    const t = await detail(page).innerText();
    expect(t).toMatch(/Question it answers/);
    expect(t).toMatch(/So quality = .*= \d+/);
    expect(t).toMatch(/our rules give \d+/);
    expect(t).toMatch(/Our code vs third-party/);
    expect(t).toMatch(/major and minor/i);
    expect(t).not.toMatch(/undefined|NaN/);
    expect(await page.locator('#detail .src-ours').count()).toBeGreaterThanOrEqual(4);
    expect(await page.locator('#detail .src-ext').count()).toBeGreaterThanOrEqual(6);
  });

  test('scoring page: links every tool and our own scoring code', async ({ page }) => {
    await nav(page, '#/scores');
    const hrefs = await detail(page).getByRole('link').evaluateAll((as) => as.map((a) => a.href));
    for (const u of ['github.com/NVIDIA/skillspector', 'github.com/thedaviddias/skill-check', 'github.com/sayed3li97/skillscore',
      'github.com/DavidAnson/markdownlint-cli2', 'github.com/lycheeverse/lychee', 'github.com/streetsidesoftware/cspell',
      'code.claude.com/docs/en/plugin-evals', 'agent-skills/best-practices', 'agentskills.io',
      'blob/main/scripts/scores.mjs', 'blob/main/rules/patterns.json', 'blob/main/scripts/lib/best-practice.mjs',
      'blob/main/scripts/quality-tools.sh', 'blob/main/scripts/eval.mjs']) {
      expect(hrefs.some((h) => h.includes(u)), u).toBe(true);
    }
  });

  test('scoring page: overview links jump to their section and stay on the page', async ({ page }) => {
    await nav(page, '#/scores');
    await page.locator('#detail table.overview').getByRole('link', { name: 'Quality' }).click();
    await expect(page).toHaveURL(/#\/scores$/);
    await expect(page.locator('#score-quality')).toBeInViewport();
  });

  test('lifecycle page: stages, how to move a plugin, stable promotion, rules from the code', async ({ page }) => {
    const link = navLink(page, 'Lifecycle');
    await link.click();
    await expect(page).toHaveURL(/#\/lifecycle$/);
    await expect(page).toHaveTitle(/Lifecycle/);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#detail-title')).toBeFocused();
    await expect(page.locator('#detail ol.flow li')).toHaveCount(5);
    const t = await detail(page).innerText();
    for (const x of ['npm run stage my-plugin incubating', 'npm run stage my-plugin published', 'npm run stage my-plugin deprecated',
      'npm run stage my-plugin retired', 'npm run promote', 'retire-anyway', 'At least 14 days at incubating', 'at least 2 team repos',
      'One step at a time', 'Getting onto stable']) expect(t).toContain(x);
    expect(t).not.toMatch(/undefined|NaN/);
    const hrefs = await detail(page).getByRole('link').evaluateAll((as) => as.map((a) => a.href));
    for (const u of ['scripts/lib/rules/stage-gate.mjs', 'scripts/stage.mjs', 'scripts/promote.mjs']) expect(hrefs.some((h) => h.includes(u)), u).toBe(true);
  });

  test('guide and about point to Lifecycle and Scoring instead of repeating them', async ({ page }) => {
    await nav(page, '#/guide');
    expect(await detail(page).locator('a[href="#/lifecycle"]').count()).toBeGreaterThanOrEqual(1);
    expect(await detail(page).innerText()).not.toMatch(/≥14 days|retire-anyway/);
    await nav(page, '#/about');
    expect(await detail(page).locator('a[href="#/lifecycle"]').count()).toBeGreaterThanOrEqual(1);
    expect(await detail(page).locator('a[href="#/scores"]').count()).toBeGreaterThanOrEqual(1);
    expect(await detail(page).innerText()).not.toMatch(/Adoption|consuming|Pass rate/);
  });

  test('guide: header nav opens #/guide (title set, nav marked, heading focused)', async ({ page }) => {
    const link = navLink(page, 'Create & use');
    await link.click();
    await expect(page).toHaveURL(/#\/guide$/);
    await expect(page).toHaveTitle(/Create & use/);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(catalogue(page)).toBeHidden();
    await expect(page.locator('#detail-title')).toBeFocused();
  });

  test('guide: "Use a plugin" part with the --marketplace install, team snippets, update and insights steps', async ({ page }) => {
    await navLink(page, 'Create & use').click();
    await expect(page.locator('#detail-title')).toBeFocused();
    const t = await detail(page).innerText();
    expect(t).toMatch(/Use a plugin/);
    expect(t).toContain('claude plugin install <plugin> --marketplace adam-m-holloway/agent-marketplace');
    expect(t).toContain('"ref": "stable"');
    expect(t).toContain('claude plugin marketplace update agent-marketplace');
    expect(t).toContain('claude -p --settings .claude/settings.json');
    expect(t).toContain('--scope project');
    expect(t).toContain('insights/consumers.json');
    expect(t).toContain('claude plugin uninstall <plugin>@agent-marketplace');
    expect(t).toMatch(/Use stable in team repos/);
  });

  test('guide: "Create a plugin" part with npm run new-plugin, stage, bump, eval and promote', async ({ page }) => {
    await navLink(page, 'Create & use').click();
    await expect(page.locator('#detail-title')).toBeFocused();
    const t = await detail(page).innerText();
    expect(t).toMatch(/Create a plugin/);
    expect(t).toContain('npm run new-plugin my-plugin -- --skill my-skill --languages any --description');
    expect(t).toContain('npm run stage my-plugin incubating');
    expect(t).toContain('npm run bump my-plugin patch');
    expect(t).toContain('npm run eval my-plugin -- --max-cost-usd 3');
    expect(t).toContain('npm run promote');
  });

  test('about: header nav opens #/about (title set, nav marked, heading focused)', async ({ page }) => {
    const link = navLink(page, 'About');
    await link.click();
    await expect(page).toHaveURL(/#\/about$/);
    await expect(page).toHaveTitle(/About/);
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#detail-title')).toBeFocused();
  });

  test('about: pr-gate and its four jobs (plugins, security, workflows, title)', async ({ page }) => {
    await navLink(page, 'About').click();
    await expect(page.locator('#detail-title')).toBeFocused();
    const t = await detail(page).innerText();
    expect(t).toMatch(/pr-gate\.yml/);
    for (const j of ['plugins', 'security', 'workflows', 'title']) expect(t).toMatch(new RegExp('^' + j + '\\b', 'm'));
  });

  test('about: insights + the data branch, evals summary', async ({ page }) => {
    await navLink(page, 'About').click();
    await expect(page.locator('#detail-title')).toBeFocused();
    const t = await detail(page).innerText();
    expect(t).toMatch(/Insights/);
    expect(t).toMatch(/insights\.yml/);
    expect(t).toMatch(/data\b.*branch|branch.*\bdata\b/i);
    expect(t).toMatch(/latest\/consumers\.json/);
    expect(t).toMatch(/Evals/);
    expect(t).toMatch(/npm run eval/);
  });

  test('nav: "Plugins" returns to the catalogue', async ({ page }) => {
    await navLink(page, 'About').click();
    await expect(page.locator('#detail-title')).toBeFocused();
    const plugins = navLink(page, 'Plugins');
    await plugins.click();
    await expect(catalogue(page)).toBeVisible();
    await expect(plugins).toHaveAttribute('aria-current', 'page');
    await expect(page).toHaveTitle('Agent Marketplace');
  });

  test('about: links to the services used and explains how and when stats are generated', async ({ page }) => {
    await nav(page, '#/about');
    await expect(page.locator('#detail-title')).toBeFocused();
    const hrefs = await detail(page).getByRole('link').evaluateAll((as) => as.map((a) => a.href));
    for (const u of ['conventionalcommits.org', 'github.com/NVIDIA/skillspector', 'scorecard.dev', 'github.com/gitleaks/gitleaks',
      'github.com/rhysd/actionlint', 'docs.zizmor.sh', 'codeql.github.com', 'adr.github.io/madr']) {
      expect(hrefs.some((h) => h.includes(u)), u).toBe(true);
    }
    const t = await detail(page).innerText();
    expect(t).toMatch(/how and when they.re generated/i);
    expect(t).toMatch(/Teams installing/);
    expect(t).toMatch(/03:17 UTC/);
  });

  test('menu: every link is in the header menu and the footer has none', async ({ page }) => {
    const hrefs = await siteNav(page).getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    for (const x of ['#', '#/guide', '#/lifecycle', '#/scores', '#/about']) expect(hrefs).toContain(x);
    expect(hrefs.some((x) => /github\.com\/adam-m-holloway\/agent-marketplace$/.test(x))).toBe(true);
    expect(hrefs.some((x) => /plugin-request/.test(x))).toBe(true);
    await expect(page.locator('footer a')).toHaveCount(0);
  });

  test('unknown plugin shows not-found', async ({ page }) => {
    await nav(page, '#/plugin/no-such-plugin');
    await expect(detail(page)).toContainText('Plugin not found');
  });

  test('back link returns to the full catalogue', async ({ page }) => {
    const listed = await listedNames(page);
    await nav(page, '#/plugin/no-such-plugin');
    await expect(detail(page)).toContainText('Plugin not found');
    await page.locator('#detail .back').getByRole('link', { name: /All plugins/ }).click();
    await expect.poll(() => visibleCards(page)).toHaveLength(listed.length);
  });
});

// ---------- 360px ----------
test.describe('360px', () => {
  test.use({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('no horizontal page scroll at 360px (home + detail collapsed/expanded)', async ({ page }) => {
    await home(page);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(360);
    await nav(page, '#/plugin/adr-helper');
    await expect(page.locator('#detail-title')).toHaveText('adr-helper');
    expect(await scrollWidth(page)).toBeLessThanOrEqual(360);
    await page.locator('#detail .detail-head button').first().click();
    await page.evaluate(() => document.querySelectorAll('#detail details.sec').forEach((d) => { d.open = true; }));
    await expect(page.locator('#detail svg.chart-svg')).toHaveCount(2);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(360);
  });

  test('no horizontal page scroll at 360px (guide, lifecycle, scoring, about)', async ({ page }) => {
    await home(page);
    for (const [hash, title] of [['#/lifecycle', /Lifecycle/], ['#/scores', /Scoring/]]) {
      await nav(page, hash);
      await expect(page).toHaveTitle(title);
      expect(await scrollWidth(page), hash).toBeLessThanOrEqual(360);
    }
    await nav(page, '#/guide');
    await expect(page).toHaveTitle(/Create & use/);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(360);
    await nav(page, '#/about');
    await expect(page).toHaveTitle(/About/);
    expect(await scrollWidth(page)).toBeLessThanOrEqual(360);
  });
});

// ---------- whole-site walk: network and console ----------
/** Visits every page and interaction the checks above use. */
async function walk(page) {
  await home(page);
  await search(page).fill('adr');
  await search(page).fill('');
  await openPlugin(page, 'adr-helper');
  await page.locator('#install-panel input[value=stable]').check();
  await page.locator('#install-panel input[value=latest]').check();
  await expandAll(page);
  for (const [hash, title] of [['#/scores', /Scoring/], ['#/lifecycle', /Lifecycle/], ['#/guide', /Create & use/], ['#/about', /About/]]) {
    await nav(page, hash);
    await expect(page).toHaveTitle(title);
  }
  await nav(page, '#/plugin/no-such-plugin');
  await expect(detail(page)).toContainText('Plugin not found');
}

test('no requests leave the site origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await walk(page);
  expect(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('about:'))).toEqual([]);
});

test('no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await walk(page);
  expect(errors).toEqual([]);
});
