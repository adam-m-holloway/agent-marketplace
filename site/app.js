/* Agent Marketplace catalogue. Vanilla JS, same-origin only (data.json + vendored Fuse). */
(function () {
  'use strict';

  var REQUEST_BASE = 'https://github.com/adam-m-holloway/agent-marketplace/issues/new?template=plugin-request.yml&labels=plugin-request&query=';
  var WEAK_SCORE = 0.3; // Fuse score: 0 = exact, 1 = no match. Best above this = weak result.

  var data = null;
  var state = { q: '', category: '', stage: '', language: '', only: '' };
  var channelFor = {}; // plugin name -> 'latest' | 'stable'

  var $ = function (id) { return document.getElementById(id); };

  /** Tiny DOM builder: text is always set via textContent (no HTML injection). */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') el.textContent = v;
        else if (k === 'class') el.className = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); });
      else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  // ---------- clipboard ----------
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = h('textarea', { class: 'offscreen', readonly: true, 'aria-hidden': 'true' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }

  /** A code block with its own copy button. */
  function codeBlock(text, label, shell) {
    var status = h('span', { class: 'copy-status', role: 'status', 'aria-live': 'polite' });
    var btn = h('button', {
      type: 'button', class: 'copy', 'aria-label': 'Copy ' + label, text: 'Copy',
      onclick: function () {
        copyText(text).then(function () { status.textContent = 'Copied'; },
          function () { status.textContent = 'Select and copy manually'; });
        setTimeout(function () { status.textContent = ''; }, 2500);
      },
    });
    return h('div', { class: 'code' + (shell ? ' shell' : '') }, h('pre', null, h('code', { text: text })), h('div', { class: 'code-actions' }, btn, status));
  }

  // ---------- install text ----------
  function marketplaceName(channel) {
    var c = data.channels.find(function (x) { return x.id === channel; });
    return c ? c.name : 'agent-marketplace';
  }
  function marketplaceSource(channel) {
    var src = { source: 'github', repo: data.repo };
    if (channel === 'stable') { src.ref = 'stable'; src.path = '.claude-plugin/marketplace-stable.json'; }
    return src;
  }
  function settingsSnippet(plugin, channel, withPlugin) {
    var mkt = marketplaceName(channel);
    var s = { extraKnownMarketplaces: {} };
    s.extraKnownMarketplaces[mkt] = { source: marketplaceSource(channel) };
    if (withPlugin) { s.enabledPlugins = {}; s.enabledPlugins[plugin + '@' + mkt] = true; }
    return JSON.stringify(s, null, 2);
  }

  /** Install panel: channel toggle + "Just me" and "My team's repo" columns. */
  function installPanel(p, id) {
    var channel = channelFor[p.name] || 'latest';
    var body = h('div', { class: 'install-body' });
    var group = 'ch-' + p.name;

    function render() {
      body.textContent = '';
      var mkt = marketplaceName(channel);
      var just = h('div', { class: 'install-col' }, h('h3', { text: 'Just me' }));
      if (channel === 'latest') {
        just.appendChild(h('p', { text: 'From a terminal (Claude Code 2.1.292+):' }));
        just.appendChild(codeBlock('claude plugin install ' + p.name + ' --marketplace ' + data.repo, 'terminal install command', true));
        just.appendChild(h('p', { text: 'Or inside Claude Code, once the marketplace is added:' }));
        just.appendChild(codeBlock('/plugin install ' + p.name + '@' + mkt, 'slash install command'));
      } else {
        just.appendChild(h('p', { class: 'hint', text: 'The one-step --marketplace command always reads the latest catalogue, so stable takes two steps.' }));
        just.appendChild(h('p', null, '1. Add the stable marketplace to your user settings (', h('code', { text: '~/.claude/settings.json' }), '):'));
        just.appendChild(codeBlock(settingsSnippet(p.name, 'stable', false), 'stable marketplace user settings'));
        just.appendChild(h('p', { text: '2. Restart Claude Code, then install:' }));
        just.appendChild(codeBlock('/plugin install ' + p.name + '@' + mkt, 'slash install command'));
      }
      just.appendChild(h('p', { class: 'hint', text: 'Writes user settings only: not committed, and not counted by insights.' }));

      var team = h('div', { class: 'install-col' }, h('h3', { text: "My team's repo" }));
      team.appendChild(h('p', null, 'Add to ', h('code', { text: '.claude/settings.json' }), ' in the repo:'));
      team.appendChild(codeBlock(settingsSnippet(p.name, channel, true), 'team settings snippet'));
      team.appendChild(h('p', { class: 'hint', text: 'Commit it; teammates are prompted after trusting the folder. Insights counts repos listed in insights/consumers.json — open a PR to add yours.' }));
      team.appendChild(h('p', { class: 'hint' }, 'Note: ', h('code', { text: '--marketplace' }), ' writes user settings only, so it is not a substitute for this.'));

      body.appendChild(just);
      body.appendChild(team);
    }

    var toggle = h('fieldset', { class: 'toggle' }, h('legend', { text: 'Channel' }),
      h('div', { class: 'segs' }, ['latest', 'stable'].map(function (cid) {
        var inputId = group + '-' + cid;
        var input = h('input', {
          type: 'radio', name: group, id: inputId, value: cid, checked: cid === channel,
          onchange: function () { channel = cid; channelFor[p.name] = cid; render(); },
        });
        var v = p.versions[cid];
        return h('label', { for: inputId, class: 'seg' }, input, h('span', { text: cid + (v ? ' v' + v : cid === 'stable' ? ' (not yet)' : '') }));
      })));

    render();
    return h('section', { id: id, class: 'install', 'aria-label': 'Install ' + p.name }, toggle, body);
  }

  // ---------- shared bits ----------
  function badge(text, cls) { return h('span', { class: 'badge ' + (cls || ''), text: text }); }

  /** -1 / 0 / 1 for dotted numeric versions (x.y.z). Missing counts as lowest. */
  function cmpVersion(a, b) {
    if (!a || !b) return a ? 1 : b ? -1 : 0;
    var pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) { var d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }
  function stableLags(p) { return !!p.versions.stable && cmpVersion(p.versions.latest, p.versions.stable) > 0; }
  function teamsOf(p) { return uniq(p.consumers.filter(function (c) { return c.status !== 'removed'; }).map(function (c) { return c.team || c.consumer; }).filter(Boolean)); }
  function plural(n, word, many) { return n + ' ' + (n === 1 ? word : (many || word + 's')); }
  function stageBadge(p) { return badge(p.stage, 'stage stage-' + p.stage); }
  function langText(p) { return p.languages.join(', ') || 'any'; }

  function consumersBlock(p) {
    var wrap = h('div', { class: 'consumers' });
    if (!p.consumers.length) {
      wrap.appendChild(h('p', { class: 'empty-note', text: 'No team repos have committed this plugin yet.' }));
    } else {
      var rows = p.consumers.map(function (c) {
        var behind = typeof c.versions_behind === 'number'
          ? (c.versions_behind === 0 ? badge('current', 'pill-ok') : badge(c.versions_behind + ' behind', 'pill-warn'))
          : '—';
        return h('tr', null,
          h('th', { scope: 'row', text: c.team || c.consumer || '—' }),
          h('td', { text: c.channel || '—' }),
          h('td', { text: c.version ? 'v' + c.version : '—' }),
          h('td', null, behind),
          h('td', { text: c.first_seen || '—' }),
          h('td', { text: c.status || '—' }));
      });
      wrap.appendChild(h('div', { class: 'table-scroll' }, h('table', null,
        h('caption', { class: 'offscreen', text: 'Team repos using ' + p.name }),
        h('thead', null, h('tr', null, ['Team', 'Channel', 'Version', 'Behind', 'Since', 'Status'].map(function (t) { return h('th', { scope: 'col', text: t }); }))),
        h('tbody', null, rows))));
    }
    wrap.appendChild(h('p', { class: 'hint', text: data.consumers_note + '.' }));
    return wrap;
  }

  // ---------- detail page (#/plugin/<name>) ----------
  function detailHref(name) { return '#/plugin/' + encodeURIComponent(name); }
  function detailLink(name) { return h('a', { href: detailHref(name), text: name }); }

  /** Build-time rendered Markdown (escaped server-side; see renderMarkdown in build-site.mjs). */
  function prose(html, empty) {
    if (!html) return h('p', { class: 'empty-note', text: empty });
    var div = h('div', { class: 'prose' });
    div.innerHTML = html;
    return div;
  }

  /** First sentence of the rendered README (parsed inertly via <template>), for a summary preview. */
  function readmePreview(p) {
    if (!p.readme_html) return 'no README';
    var t = document.createElement('template');
    t.innerHTML = p.readme_html;
    var para = t.content.querySelector('p');
    var txt = para ? para.textContent.replace(/\s+/g, ' ').trim() : '';
    if (!txt) return 'rendered from the plugin';
    var m = txt.match(/^.*?[.!?](?=\s|$)/);
    txt = m ? m[0] : txt;
    return txt.length > 120 ? txt.slice(0, 117).replace(/\s+\S*$/, '') + '…' : txt;
  }

  /** An expandable detail section: summary = title + a one-line preview. */
  function sec(id, title, preview, children, open) {
    var d = h('details', { class: 'sec', id: id, open: !!open },
      h('summary', null,
        h('span', { class: 'sec-title', text: title }),
        preview ? h('span', { class: 'sec-preview' }, h('span', { class: 'offscreen', text: ' — ' }), preview) : null),
      h('div', { class: 'sec-body' }, children));
    d.addEventListener('toggle', function () { if (d.open) drawCharts(); });
    return d;
  }

  function timeline(p) {
    var rel = p.releases || [];
    if (!rel.length) return h('p', { class: 'empty-note', text: 'No releases recorded yet.' });
    return h('ol', { class: 'timeline' }, rel.map(function (r) {
      return h('li', null,
        h('span', { class: 'tl-version', text: 'v' + r.version }),
        r.version === p.versions.latest ? badge('latest', 'b-latest') : null,
        r.version === p.versions.stable ? badge('stable', 'b-stable') : null,
        h('span', { class: 'tl-date', text: (r.date || 'date unknown') + (r.tagged ? '' : ' · not tagged') }));
    }));
  }

  function keyFacts(p) {
    var lag = stableLags(p);
    var item = function (label, value) { return h('div', { class: 'fact' }, h('dt', { text: label }), h('dd', null, value)); };
    var lu = p.last_updated && p.last_updated.date ? p.last_updated.date + ' · v' + p.last_updated.version : 'Not released yet';
    return h('dl', { class: 'facts' },
      item('Latest', h('span', { class: 'ver' }, 'v' + (p.versions.latest || '?'))),
      item('Stable', p.versions.stable
        ? h('span', { class: 'ver' }, 'v' + p.versions.stable, lag ? ' ' : null, lag ? badge('behind latest', 'pill-warn') : null)
        : h('span', { class: 'muted', text: 'not on stable yet' })),
      item('Category', p.category + ' · ' + langText(p)),
      item('Updated', lu),
      item('Owner', p.owner || '—'));
  }

  function detailView(p) {
    var lag = stableLags(p);
    var s = p.scores || {};
    var e = s.evals;
    // Install is part of the main block: shown under the key facts, above the scores.
    var panel = h('div', { class: 'install-block' },
      h('h3', { class: 'install-heading', text: 'Install' }),
      installPanel(p, 'install-panel'));

    var skills = p.skills.length ? h('ul', { class: 'skills' }, p.skills.map(function (x) {
      return h('li', null, h('code', { text: x.name }), x.description ? h('span', { class: 'skill-desc', text: x.description }) : null);
    })) : h('p', { class: 'empty-note', text: 'No skills.' });
    var related = p.related.length
      ? h('ul', { class: 'inline' }, p.related.map(function (r) { return h('li', null, detailLink(r)); }))
      : h('p', { class: 'empty-note', text: 'No closely related plugins yet.' });
    var about = h('dl', { class: 'meta' },
      h('dt', { text: 'Compatibility' }), h('dd', { text: p.compatibility || 'Not stated' }),
      h('dt', { text: 'Listed since' }), h('dd', { text: p.since || '—' }),
      h('dt', { text: 'Tags' }), h('dd', { text: (p.tags || []).join(', ') || '—' }),
      h('dt', { text: 'Source' }), h('dd', null, h('a', { href: p.readme_url, text: 'README on GitHub' })));

    var rel = p.releases || [];
    var hist = p.score_history || [];
    var adopt = p.adoption_history || [];
    var sec_ = s.security || {}, q = s.quality || {};
    var scorePreview = 'security ' + (sec_.score == null ? '—' : sec_.score) + ' · quality ' + (q.score == null ? '—' : q.score) +
      ' · evals ' + (e ? fmtNum(e.pass_rate) + '% (' + (e.delta >= 0 ? '+' : '') + fmtNum(e.delta) + ' vs baseline)' : 'not measured');
    var usedPreview = p.consumers.length
      ? plural(teamsOf(p).length, 'team') + ' (' + p.consumers.map(function (c) { return (c.team || c.consumer) + ' ' + (c.channel || ''); }).join(', ') + ')'
      : 'no team repos yet';
    var relPreview = rel.length ? plural(rel.length, 'release') + ', latest ' + rel[0].version + (rel[0].date ? ' on ' + rel[0].date : '') : 'no releases yet';
    var trendPreview = 'score history over ' + plural(hist.length, 'tracked version') + ' · installs over ' + plural(adopt.length, 'day');

    return h('div', { class: 'detail-page' },
      h('p', { class: 'back' }, h('a', { href: '#' }, h('span', { 'aria-hidden': 'true', text: '← ' }), 'All plugins')),
      h('header', { class: 'detail-head' },
        h('div', { class: 'title-row' },
          h('div', { class: 'title-block' },
            h('h2', { id: 'detail-title', tabindex: '-1', text: p.name }),
            h('div', { class: 'title-badges' }, stageBadge(p), lag ? badge('stable behind latest', 'pill-warn') : null))),
        h('p', { class: 'detail-desc', text: p.description }),
        p.replaced_by ? h('p', { class: 'replaced' }, 'Deprecated: use ', detailLink(p.replaced_by), ' instead.') : null,
        keyFacts(p),
        panel),
      scoreRow(p),
      h('div', { class: 'sections' },
        sec('sec-scores', 'Scores', scorePreview, scoreDetail(p)),
        sec('sec-used', 'Used by', usedPreview, consumersBlock(p)),
        sec('sec-releases', 'Release history', relPreview, timeline(p)),
        sec('sec-changelog', 'Changelog', changelogPreview(p), prose(p.changelog_html, 'No CHANGELOG.')),
        sec('sec-trends', 'Trends', trendPreview, h('div', { class: 'trends' }, scoreChart(p), adoptionChart(p))),
        sec('sec-readme', 'README', readmePreview(p), prose(p.readme_html, 'No README.')),
        sec('sec-skills', 'Skills', p.skills.map(function (x) { return x.name; }).join(', ') || 'none', skills),
        sec('sec-related', 'Related', p.related.join(', ') || 'none yet', related),
        sec('sec-about', 'About', 'compatibility, listing date, tags and source', about)));
  }

  /** One-line preview for the Changelog section: the newest entry's version and date. */
  function changelogPreview(p) {
    var rel = p.releases || [];
    if (!p.changelog_html) return 'no CHANGELOG';
    return rel.length ? 'latest entry ' + rel[0].version + (rel[0].date ? ' · ' + rel[0].date : '') + ' · ' + plural(rel.length, 'entry', 'entries') : 'release notes';
  }

  function scoresPage() {
    return h('div', { class: 'detail-page' },
      h('p', { class: 'back' }, h('a', { href: '#' }, h('span', { 'aria-hidden': 'true', text: '← ' }), 'All plugins')),
      h('header', { class: 'detail-head' },
        h('h2', { id: 'detail-title', tabindex: '-1', text: 'How scores are calculated' }),
        h('p', { class: 'detail-desc', text: 'Security, quality, evals and adoption (installs): what each score means, how it is computed and when it is recorded.' })),
      h('div', { class: 'explain-page' }, explainBody()));
  }

  // ---------- static pages: #/guide and #/about (TL;DR style) ----------
  var GH = 'https://github.com/adam-m-holloway/agent-marketplace';
  function ghLink(path, text) { return h('a', { href: GH + '/blob/main/' + path, text: text || path }); }
  function code(t) { return h('code', { text: t }); }
  function backLink() { return h('p', { class: 'back' }, h('a', { href: '#' }, h('span', { 'aria-hidden': 'true', text: '← ' }), 'All plugins')); }
  function pageHead(title, desc) {
    return h('header', { class: 'detail-head' },
      h('h2', { id: 'detail-title', tabindex: '-1', text: title }),
      h('p', { class: 'detail-desc' }, desc));
  }
  /** A numbered step: a short title, then any number of lines / code blocks. */
  function step(title) {
    var body = Array.prototype.slice.call(arguments, 1);
    return h('li', { class: 'step' }, h('h4', { class: 'step-title', text: title }), h('div', { class: 'step-body' }, body));
  }
  function line() { return h('p', null, Array.prototype.slice.call(arguments)); }
  function hint() { return h('p', { class: 'hint' }, Array.prototype.slice.call(arguments)); }
  function part(id, title, sub, steps, more) {
    return h('section', { class: 'tldr-part', id: id, 'aria-labelledby': id + '-h' },
      h('h3', { class: 'part-title', id: id + '-h', text: title }),
      h('p', { class: 'muted part-sub', text: sub }),
      h('ol', { class: 'steps' }, steps),
      more ? h('p', { class: 'part-more' }, more) : null);
  }

  function guidePage() {
    var L = marketplaceName('latest'), S = marketplaceName('stable');
    var P = '<plugin>';
    var use = part('use', 'Use a plugin', 'Swap ' + P + ' for a name from the catalogue. Each plugin\'s page shows these commands ready-filled.', [
      step('Pick a channel',
        h('ul', { class: 'tight' },
          h('li', null, h('strong', { text: 'latest' }), ' (', code(L), '): tracks ', code('main'), '. New versions as soon as they merge.'),
          h('li', null, h('strong', { text: 'stable' }), ' (', code(S), '): the ', code('stable'), ' branch. Reviewed promotions only.')),
        hint('A channel serves every plugin from one commit: you pick a channel, not a version per plugin.')),
      step('Just me',
        line('Latest, one step (Claude Code 2.1.292+):'),
        codeBlock('claude plugin install ' + P + ' --marketplace ' + data.repo, 'latest install command', true),
        line('Stable: add this to your user settings (', code('~/.claude/settings.json'), '), restart, then install:'),
        codeBlock(settingsSnippet(P, 'stable', false), 'stable marketplace user settings'),
        codeBlock('/plugin install ' + P + '@' + S, 'stable slash install command'),
        hint('User settings only: not committed, not counted by insights.')),
      step("My team's repo",
        line('Commit one of these as ', code('.claude/settings.json'), '. Latest:'),
        codeBlock(settingsSnippet(P, 'latest', true), 'latest team settings snippet'),
        line('Stable:'),
        codeBlock(settingsSnippet(P, 'stable', true), 'stable team settings snippet')),
      step('Trust the folder',
        line('Claude Code reads ', code('extraKnownMarketplaces'), ' only after you trust the folder. Teammates are then prompted to install.')),
      step('Update',
        line('Auto-update is off by default. When a new version lands on your channel:'),
        codeBlock('claude plugin marketplace update ' + L, 'marketplace update command', true),
        codeBlock('claude plugin update ' + P + '@' + L, 'plugin update command', true),
        hint('On stable use ', code(S), '. Restart Claude Code afterwards.')),
      step('Headless runs (claude -p, CI)',
        line(code('-p'), ' skips the folder-trust dialog, so pass the committed settings:'),
        codeBlock('claude -p --settings .claude/settings.json "…"', 'headless command', true)),
      step("If a plugin doesn't load",
        line('Install it once per machine:'),
        codeBlock('claude plugin install ' + P + '@' + L + ' --scope project', 'project-scope install command', true),
        hint('It may reorder keys in .claude/settings.json: discard that diff (git checkout -- .claude/settings.json).')),
      step('Get counted by insights',
        line('Open a PR adding your repo to ', ghLink('insights/consumers.json'), ':'),
        codeBlock('{ "repo": "<owner>/<repo>", "team": "<team>" }', 'consumers entry')),
    ], h('span', null, 'Full detail: ', ghLink('docs/consuming-plugins.md'), '.'));

    var create = part('create', 'Create a plugin', 'Every change goes through a feature branch and a pull request.', [
      step('Scaffold',
        codeBlock('npm run new-plugin my-plugin -- --skill my-skill --languages any --description "One sentence on what it helps with"', 'new-plugin command', true),
        hint('It lists the 3 most similar plugins first and asks continue anyway? [y/N] (--yes skips). Stubs fail npm run check until filled in.')),
      step('Author with /skill-creator',
        h('ul', { class: 'tight' },
          h('li', null, code('SKILL.md'), ' description: what it does, when to use it, trigger phrases, what it is not for (≤1024 chars).'),
          h('li', null, code('evals/evals.json'), ': at least 3 cases.'),
          h('li', null, 'Trigger set: ≥8 should-trigger and ≥8 should-not. Save it (it exports to ', code('~/Downloads'), ') to ', code('evals/trigger-evals.json'), '.'))),
      step('Check',
        codeBlock('npm run sync', 'sync command', true),
        codeBlock('npm run check', 'check command', true),
        hint('No TODO/TBD/FIXME placeholders; every references/, scripts/ or assets/ path SKILL.md names must exist. npm run check -- --full adds tests, claude plugin validate and installed scanners.')),
      step('Open a PR',
        line('The plugin starts at ', code('sandbox'), ': in the repo, not listed. One plugin per PR; Conventional Commit title.')),
      step('List it (one stage per PR)',
        codeBlock('npm run stage my-plugin incubating', 'stage incubating command', true),
        codeBlock('npm run stage my-plugin published', 'stage published command', true),
        h('ul', { class: 'tight hint' },
          h('li', null, '→ incubating: every skill has evals + trigger set, owner set, no HIGH findings.'),
          h('li', null, '→ published: ≥14 days at incubating or ≥2 active consumers, plus a CHANGELOG entry.'),
          h('li', null, 'One step at a time; the PR changes only status.json and the generated catalogues.'))),
      step('Change it',
        codeBlock('npm run bump my-plugin patch', 'bump command', true),
        hint('patch | minor | major. Fill in the CHANGELOG entry: changing plugin files without a bump fails CI. On merge, release.yml tags and publishes a GitHub Release.')),
      step('Measure it (local)',
        codeBlock('npm run eval my-plugin -- --max-cost-usd 3 --record', 'eval command', true),
        hint('Runs with and without the plugin via claude plugin eval on your own Claude plan. CI never runs it.')),
      step('Promote to stable (maintainers)',
        codeBlock('npm run promote', 'promote command', true),
        hint('Opens chore(stable): promote main@<sha>; the gate checks the tree equals that main commit.')),
    ], h('span', null, 'Full detail: ', ghLink('CONTRIBUTING.md'), '.'));

    return h('div', { class: 'detail-page' }, backLink(),
      pageHead('Create & use plugins', 'The short version: install a plugin for yourself or your team, or build and ship a new one.'),
      h('div', { class: 'tldr-grid' }, use, create));
  }

  /** A TL;DR group: small heading + short items (each a term and 1–3 short lines). */
  function group(title, items, wide) {
    return h('section', { class: 'tldr-group' + (wide ? ' wide' : '') },
      h('h3', { class: 'group-title', text: title }),
      h('dl', { class: 'tldr-list' }, items.map(function (it) {
        return h('div', { class: 'tldr-item' }, h('dt', null, it[0]), h('dd', null, it.slice(1)));
      })));
  }
  function wf(name) { return ghLink('.github/workflows/' + name, name); }
  /** External link to a tool or standard the marketplace uses (plain link; the site fetches nothing). */
  function ext(href, text) { return h('a', { href: href, text: text, rel: 'noopener' }); }
  var L = {
    cc: function () { return ext('https://www.conventionalcommits.org/', 'Conventional Commits'); },
    skillspector: function () { return ext('https://github.com/NVIDIA/skillspector', 'SkillSpector'); },
    gitleaks: function () { return ext('https://github.com/gitleaks/gitleaks', 'gitleaks'); },
    actionlint: function () { return ext('https://github.com/rhysd/actionlint', 'actionlint'); },
    zizmor: function () { return ext('https://docs.zizmor.sh/', 'zizmor'); },
    codeql: function () { return ext('https://codeql.github.com/', 'CodeQL'); },
    scorecard: function () { return ext('https://scorecard.dev/viewer/?uri=github.com/adam-m-holloway/agent-marketplace', 'OpenSSF Scorecard'); },
    dependabot: function () { return ext('https://docs.github.com/en/code-security/dependabot', 'Dependabot'); },
    skillcheck: function () { return ext('https://github.com/thedaviddias/skill-check', 'skill-check'); },
    skillscore: function () { return ext('https://github.com/sayed3li97/skillscore', 'skillscore'); },
    bestPractices: function () { return ext('https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices', 'Anthropic best-practice'); },
    markdownlint: function () { return ext('https://github.com/DavidAnson/markdownlint-cli2', 'markdownlint-cli2'); },
    lychee: function () { return ext('https://github.com/lycheeverse/lychee', 'lychee'); },
    cspell: function () { return ext('https://github.com/streetsidesoftware/cspell', 'cspell'); },
  };

  function evalsTable() {
    var rows = data.plugins.map(function (p) {
      var e = p.scores && p.scores.evals;
      return h('tr', null,
        h('th', { scope: 'row' }, detailLink(p.name)),
        h('td', null, p.skills.map(function (x) { return x.name; }).join(', ') || '—'),
        h('td', { text: e ? fmtNum(e.pass_rate) + '%' : 'not measured' }),
        h('td', { text: e ? e.passed + '/' + e.total + ' vs ' + e.baseline_passed + '/' + e.total + ' (' + (e.delta >= 0 ? '+' : '') + fmtNum(e.delta) + ' pts)' : '—' }),
        h('td', { text: e ? 'v' + e.measured_version + ' · ' + (e.measured_at || '').slice(0, 10) : '—' }));
    });
    return h('div', { class: 'table-scroll' }, h('table', null,
      h('caption', { class: 'offscreen', text: 'Latest eval results per plugin' }),
      h('thead', null, h('tr', null, ['Plugin', 'Skills', 'Pass rate', 'With skill vs baseline', 'Measured'].map(function (t) { return h('th', { scope: 'col', text: t }); }))),
      h('tbody', null, rows)));
  }

  function aboutPage() {
    return h('div', { class: 'detail-page' }, backLink(),
      pageHead('About the Agent Marketplace', 'TL;DR of the whole system: what it is, how it works, what CI runs, how plugins are evaluated and scored, and how installs are counted.'),
      h('div', { class: 'tldr-groups' },
        group('What it is', [
          ['Plugin marketplace monorepo', 'Claude Code plugins for our teams, in one repo: publish once, version it, see who uses what.'],
          ['Two channels', h('strong', { text: 'latest' }), ' (', code('agent-marketplace'), ', tracks main) and ', h('strong', { text: 'stable' }), ' (', code('agent-marketplace-stable'), ', reviewed promotions).'],
          ['Generated catalogues', 'Both catalogues are generated from the plugin folders, never hand-edited.'],
        ]),
        group('How it works', [
          ['Source → catalogues', code('plugins/'), ' → ', code('npm run sync'), ' → ', code('.claude-plugin/marketplace.json'), ' + ', code('marketplace-stable.json'), '.'],
          ['Stages', code('sandbox'), ' → ', code('incubating'), ' → ', code('published'), ' → ', code('deprecated'), ' → ', code('retired'), '. Sandbox and retired are not listed; incubating is latest only.'],
          ['Stable', 'Moves only by a reviewed promotion PR of a main commit; the gate checks the tree equals that commit.'],
          ['Releases', 'Every change bumps the version + CHANGELOG; merging to main tags ', code('<plugin>--v<version>'), '.'],
        ]),
        group('CI: what runs and when', [
          [wf('pr-gate.yml'), 'Every PR to main and stable. pull_request_target: runs the base branch\'s definitions, reads the PR as data only. Four jobs:'],
          [h('span', { class: 'job' }, 'plugins'), 'validate --strict, catalogues up to date, version bump + changelog, names, frontmatter, evals/trigger set, SKILL.md ≤500 lines, schemas/taxonomy, placeholders & referenced files, stage gate, one plugin per PR, promotion check, score-change preview, triage + capability annotations.'],
          [h('span', { class: 'job' }, 'security'), 'Hidden content, dangerous/injection patterns on all text files, ', L.gitleaks(), ', ', L.skillspector(), ' --no-llm (risk >50 fails).'],
          [h('span', { class: 'job' }, 'workflows'), L.actionlint(), ', ', L.zizmor(), ', every action SHA-pinned.'],
          [h('span', { class: 'job' }, 'title'), 'PR title follows ', L.cc(), '.'],
          [wf('release.yml'), 'Push to main: tests → tag + GitHub Release per new version → score history to the data branch.'],
          [wf('pages.yml'), 'Push to main or stable (and after insights): builds this site, including a ', L.skillspector(), ' scan and the quality tools (', L.skillcheck(), ', ', L.skillscore(), ', ', L.markdownlint(), ', ', L.lychee(), ', ', L.cspell(), ').'],
          [wf('insights.yml'), 'Nightly at 03:17 UTC: install scan (below).'],
          [wf('codeql.yml'), L.codeql(), ' on pushes and PRs to main, and weekly.'],
          [wf('scorecard.yml'), L.scorecard(), ', weekly and on push to main.'],
          [L.dependabot(), 'Weekly, grouped bumps for action pins and the pinned Claude Code CLI.'],
        ], true),
        group('Evals', [
          ['What each plugin has', 'Per skill: ', code('evals/evals.json'), ' (≥3 cases with expectations) and ', code('evals/trigger-evals.json'), ' (≥8 should / ≥8 should-not trigger).'],
          ['How they run', code('npm run eval <plugin>'), ' → ', code('claude plugin eval'), ' with and without the skill; dependencies installed offline first. Authored with ', ext('https://github.com/anthropics/claude-plugins-official/tree/main/plugins/skill-creator', 'skill-creator'), '.'],
          ['Not in CI', 'Local only, on the author\'s Claude plan ($0 CI policy). ', code('--record'), ' appends to ', code('evals/results.json'), '.'],
          ['Latest results', evalsTable()],
        ], true),
        group('Scores', [
          ['Security', 'Our rule findings, capped by 100 − ', L.skillspector(), ' risk when it ran.'],
          ['Quality', '55% skill linters (', L.skillcheck(), ' and ', L.skillscore(), ', averaged), 25% ', L.bestPractices(), ' rules (our own checker), 20% docs hygiene (', L.markdownlint(), ', ', L.lychee(), ', ', L.cspell(), '). A tool that did not run shows as "not run" and the rest are re-weighted.'],
          ['Evals', 'Pass rate of the latest recorded run at or before this version, vs baseline.'],
          ['Adoption', 'Team repos that install the plugin (listed in their ', code('.claude/settings.json'), '); not how often its skills are used.'],
          ['More', h('a', { href: '#/scores', text: 'How scores are calculated' })],
        ]),
        group('Stats: how and when they\'re generated', [
          ['Where they come from', 'This page is static: the numbers are baked into ', code('data.json'), ' each time ', wf('pages.yml'), ' builds the site; your browser fetches nothing else.'],
          ['When they refresh', 'On every merge to main or stable, after every promotion, and after each nightly insights run (03:17 UTC), which re-runs the site build. The footer shows when this copy was built.'],
          ['Plugins', 'Plugins listed in the latest catalogue (stage incubating, published or deprecated).'],
          ['Teams consuming', 'Distinct team repos with an active entry in the insights snapshot (', code('latest/consumers.json'), ' on the data branch) — committed settings, not laptop installs.'],
          ['On stable', 'Plugins whose ', code('plugin.json'), ' exists on the ', code('stable'), ' branch.'],
          ['Stable behind latest', 'Plugins whose stable version is lower than the version on main.'],
          ['Scores', 'Recomputed at each build from the plugin files, ', code('evals/results.json'), ' and a fresh ', L.skillspector(), ' scan; history is written to the data branch at each major/minor release.'],
        ]),
        group('Insights', [
          ['What', 'Each consumer repo\'s committed ', code('.claude/settings.json'), ' → channel, plugin, version, versions behind, since, status. Committed intent, not laptops.'],
          ['How', 'Nightly scan of the repos in ', ghLink('insights/consumers.json'), ' via the GitHub API with ', code('GITHUB_TOKEN'), '.'],
          ['Where', 'The ', code('data'), ' branch: ', code('consumers/'), ' + ', code('events/'), ' ndjson by year/month, ', code('latest/consumers.json'), ', ', code('scores/'), ', ', h('a', { href: GH + '/blob/data/CATALOGUE.md', text: 'CATALOGUE.md' }), '.'],
          ['Surfaced', 'A pinned "Plugin usage report" issue, one "Behind: …" issue per lagging plugin, and each plugin page\'s Used by section.'],
        ]),
        group('Tools & standards used', [
          ['Plugins', ext('https://code.claude.com/docs/en/plugins', 'Claude Code plugins'), ' and ', ext('https://code.claude.com/docs/en/plugin-marketplaces', 'plugin marketplaces'), '; skills follow the ', ext('https://agentskills.io/', 'Agent Skills'), ' format.'],
          ['Authoring & evals', ext('https://github.com/anthropics/claude-plugins-official/tree/main/plugins/skill-creator', 'skill-creator'), ' and ', code('claude plugin eval'), '.'],
          ['Commits & ADRs', L.cc(), ' for commits and PR titles; ', ext('https://adr.github.io/madr/', 'MADR'), ' for ADRs (adr-helper).'],
          ['Security scanning', L.skillspector(), ', ', L.gitleaks(), ', ', L.codeql(), ', ', L.scorecard(), '.'],
          ['Quality scoring', L.skillcheck(), ', ', L.skillscore(), ', ', L.bestPractices(), ' rules, ', L.markdownlint(), ', ', L.lychee(), ' and ', L.cspell(), '.'],
          ['Workflow checks', L.actionlint(), ', ', L.zizmor(), ', ', L.dependabot(), '.'],
          ['Hosting & search', ext('https://pages.github.com/', 'GitHub Pages'), ', ', ext('https://docs.github.com/en/actions', 'GitHub Actions'), ' and ', ext('https://www.fusejs.io/', 'Fuse.js'), ' (vendored, served from this site).'],
        ]),
        group('Security & governance', [
          ['Rulesets', 'No direct commits to main or stable; squash merge only.'],
          ['Review', 'Code-owner review is off until a second reviewer exists; today the owner reviews and merges.'],
          ['Scanning', L.codeql(), ' and ', L.scorecard(), '; see ', ghLink('docs/security-scanning.md'), '.'],
        ])));
  }

  function notFound(name) {
    return h('div', { class: 'detail-page' },
      h('p', { class: 'back' }, h('a', { href: '#' }, h('span', { 'aria-hidden': 'true', text: '← ' }), 'All plugins')),
      h('div', { class: 'empty' },
        h('h2', { id: 'detail-title', tabindex: '-1', text: 'Plugin not found' }),
        h('p', null, 'There is no listed plugin called "' + name + '". ', h('a', { href: REQUEST_BASE + encodeURIComponent(name), text: 'Request it' }), '.')));
  }

  // ---------- charts (inline SVG, zero deps) ----------
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }
  var charts = []; // {box, draw(width)} for the current detail page; redrawn on resize
  var chartSeq = 0;

  /** Marker shape per series (identity is never colour alone). */
  function marker(shape, x, y, cls, label) {
    var m;
    if (shape === 'square') m = s('rect', { x: x - 4.5, y: y - 4.5, width: 9, height: 9, rx: 1.5 });
    else if (shape === 'triangle') m = s('path', { d: 'M' + x + ' ' + (y - 5.5) + 'L' + (x + 5.5) + ' ' + (y + 4.5) + 'L' + (x - 5.5) + ' ' + (y + 4.5) + 'Z' });
    else m = s('circle', { cx: x, cy: y, r: 4.5 });
    m.setAttribute('class', 'mark ' + cls);
    m.appendChild(s('title', { text: label }));
    return m;
  }
  function swatch(shape, cls) {
    var svg = s('svg', { width: 26, height: 12, viewBox: '0 0 26 12', 'aria-hidden': 'true', focusable: 'false', class: 'swatch' },
      s('line', { x1: 1, y1: 6, x2: 25, y2: 6, class: 'line ' + cls }));
    svg.appendChild(marker(shape, 13, 6, cls, ''));
    return svg;
  }

  /**
   * Line chart over points xs (0..1). series: [{label, cls, shape, dash, values[]}].
   * Fewer than 3 points: markers only (no line) plus a note, so 1–2 points never imply a trend.
   */
  function lineChart(o) {
    var id = 'chart-' + (++chartSeq);
    var n = o.xLabels.length;
    var sparse = n < 3;
    var box = h('div', { class: 'chart-box' });
    var fig = h('figure', { class: 'chart', 'aria-labelledby': id + '-cap' },
      h('figcaption', { id: id + '-cap' }, h('span', { class: 'chart-title', text: o.title }), o.sub ? h('span', { class: 'chart-sub', text: ' — ' + o.sub }) : null),
      o.series.length > 1 ? h('ul', { class: 'legend', 'aria-hidden': 'true' }, o.series.map(function (se) {
        return h('li', null, swatch(se.shape, se.cls), h('span', { text: se.label }));
      })) : null,
      box,
      sparse ? h('p', { class: 'hint chart-note', text: o.sparseNote }) : null,
      h('table', { class: 'offscreen' },
        h('caption', { text: o.title + ' (data)' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: o.xTitle }), o.series.map(function (se) { return h('th', { scope: 'col', text: se.label }); }))),
        h('tbody', null, o.xLabels.map(function (xl, i) {
          return h('tr', null, h('th', { scope: 'row', text: o.rowLabels ? o.rowLabels[i] : xl }), o.series.map(function (se) {
            return h('td', { text: se.values[i] == null ? 'no data' : o.fmt(se.values[i]) });
          }));
        }))));

    function draw(width) {
      var W = Math.max(260, Math.floor(width));
      var H = 230, ml = 58, mr = 18, mt = 14, mb = 50;
      var pw = W - ml - mr, ph = H - mt - mb;
      var pad = 28; // keep edge points (and their dodge) clear of the y-axis labels
      var X = function (i) { return ml + (n === 1 ? pw / 2 : pad + o.xs[i] * (pw - 2 * pad)); };
      var Y = function (v) { return mt + ph - (v / o.yMax) * ph; };
      var svg = s('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-labelledby': id + '-t ' + id + '-d', class: 'chart-svg' },
        s('title', { id: id + '-t', text: o.title }),
        s('desc', { id: id + '-d', text: o.desc }));
      o.yTicks.forEach(function (t) {
        svg.appendChild(s('line', { x1: ml, x2: W - mr, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis' : 'grid' }));
        svg.appendChild(s('text', { x: ml - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'tick', text: String(t) }));
      });
      var lastX = -Infinity;
      o.xLabels.forEach(function (xl, i) {
        var x = X(i);
        if (x - lastX < 70) return; // thin out labels that would collide
        lastX = x;
        svg.appendChild(s('line', { x1: x, x2: x, y1: mt + ph, y2: mt + ph + 5, class: 'axis' }));
        svg.appendChild(s('text', { x: x, y: mt + ph + 19, 'text-anchor': 'middle', class: 'tick', text: xl }));
      });
      svg.appendChild(s('text', { x: ml + pw / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis-title', text: o.xTitle }));
      svg.appendChild(s('text', { x: 0, y: 0, transform: 'translate(14 ' + (mt + ph / 2) + ') rotate(-90)', 'text-anchor': 'middle', class: 'axis-title', text: o.yTitle }));
      o.series.forEach(function (se, k) {
        if (!sparse) {
          var d = '';
          se.values.forEach(function (v, i) {
            if (v == null) return;
            d += (d && se.values[i - 1] != null ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
          });
          if (d) svg.appendChild(s('path', { d: d, class: 'line ' + se.cls, 'stroke-dasharray': se.dash || null }));
        }
        // Points-only mode: overlapping series (e.g. all at 100) are nudged apart so every marker
        // stays visible. With lines, markers sit on the line and the dash pattern tells them apart.
        var dodge = sparse && o.series.length > 1 ? (k - (o.series.length - 1) / 2) * 9 : 0;
        se.values.forEach(function (v, i) {
          if (v == null) return;
          svg.appendChild(marker(se.shape, X(i) + dodge, Y(v), se.cls, se.label + ', ' + (o.rowLabels ? o.rowLabels[i] : o.xLabels[i]) + ': ' + o.fmt(v)));
        });
      });
      box.textContent = '';
      box.appendChild(svg);
    }
    charts.push({ box: box, draw: draw });
    return fig;
  }

  function drawCharts() {
    charts.forEach(function (c) { if (c.box.isConnected) c.draw(c.box.clientWidth || 320); });
  }

  function evenXs(n) { var a = []; for (var i = 0; i < n; i++) a.push(n === 1 ? 0.5 : i / (n - 1)); return a; }
  function shortDate(iso) {
    var d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
    if (isNaN(d.getTime())) return String(iso);
    return d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  }

  function scoreChart(p) {
    var hist = p.score_history || [];
    if (!hist.length) return h('div', { class: 'chart chart-empty' }, h('p', { class: 'chart-title', text: 'Score trend' }), h('p', { class: 'muted', text: 'No tracked versions recorded yet.' }));
    var pick = function (k) { return hist.map(function (r) { return typeof r[k] === 'number' ? r[k] : null; }); };
    return lineChart({
      title: 'Score trend', sub: 'tracked (major/minor) versions',
      desc: 'Security, quality and evals scores (0 to 100) for ' + p.name + ' at each tracked version: ' +
        hist.map(function (r) { return 'v' + r.version + ' security ' + (r.security == null ? 'n/a' : r.security) + ', quality ' + (r.quality == null ? 'n/a' : r.quality) + ', evals ' + (r.evals == null ? 'n/a' : fmtNum(r.evals) + '%'); }).join('; ') + '.',
      xs: evenXs(hist.length),
      xLabels: hist.map(function (r) { return 'v' + r.version; }),
      rowLabels: hist.map(function (r) { return 'v' + r.version + (r.recorded_at ? ' (' + r.recorded_at.slice(0, 10) + ')' : ''); }),
      xTitle: 'Tracked version', yTitle: 'Score (0–100)', yMax: 100, yTicks: [0, 25, 50, 75, 100],
      fmt: function (v) { return fmtNum(v); },
      series: [
        { label: 'Security', cls: 'series-1', shape: 'circle', values: pick('security') },
        { label: 'Quality', cls: 'series-2', shape: 'square', dash: '7 4', values: pick('quality') },
        { label: 'Evals (pass %)', cls: 'series-3', shape: 'triangle', dash: '2 3', values: pick('evals') },
      ],
      sparseNote: 'Only ' + plural(hist.length, 'tracked version') + ' recorded so far, so points are shown without a line: the trend appears as more versions are recorded.',
    });
  }

  function adoptionChart(p) {
    var a = p.adoption_history || [];
    if (!a.length) return h('div', { class: 'chart chart-empty' }, h('p', { class: 'chart-title', text: 'Adoption over time' }), h('p', { class: 'muted', text: 'No install snapshots yet (the nightly insights run writes one per day).' }));
    var t = a.map(function (r) { return Date.parse(r.date + 'T00:00:00Z'); });
    var span = t[t.length - 1] - t[0];
    var max = Math.max.apply(null, a.map(function (r) { return r.active; }));
    var step = max <= 5 ? 1 : Math.ceil(max / 4);
    var yMax = Math.max(step, Math.ceil(max / step) * step);
    var ticks = []; for (var v = 0; v <= yMax; v += step) ticks.push(v);
    return lineChart({
      title: 'Adoption over time', sub: 'team repos that install it, per day',
      desc: 'Number of team repos with ' + p.name + ' committed and active, per daily scan: ' +
        a.map(function (r) { return r.date + ' ' + r.active; }).join('; ') + '.',
      xs: span ? t.map(function (x) { return (x - t[0]) / span; }) : evenXs(a.length),
      xLabels: a.map(function (r) { return shortDate(r.date); }),
      rowLabels: a.map(function (r) { return r.date; }),
      xTitle: 'Scan date (UTC)', yTitle: 'Active team repos', yMax: yMax, yTicks: ticks,
      fmt: function (v) { return String(v); },
      series: [{ label: 'Active team repos', cls: 'series-1', shape: 'circle', values: a.map(function (r) { return r.active; }) }],
      sparseNote: 'Only ' + plural(a.length, 'day') + ' of installs recorded so far, so points are shown without a line: the trend appears as more days are recorded.',
    });
  }


  // ---------- scores ----------
  function bandOf(n) { return n == null ? 'none' : n >= 90 ? 'good' : n >= 70 ? 'fair' : 'poor'; }
  var BAND_TEXT = { good: 'good', fair: 'fair', poor: 'poor', none: 'no data' };
  function fmtNum(n) { return Math.round(n * 10) / 10 + ''; }
  /** ISO datetime → "2026-11-08 12:43 UTC" (date only when there is no time). */
  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  /** "▲ 5" / "▼ 10" / "±0" vs the previous tracked version; null when unknown. */
  function changeEl(delta, vs, basis) {
    if (typeof delta !== 'number') return null;
    var dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    var text = delta > 0 ? '▲ ' + fmtNum(delta) : delta < 0 ? '▼ ' + fmtNum(-delta) : '±0';
    var spoken = (delta === 0 ? 'no change' : (delta > 0 ? 'up ' : 'down ') + fmtNum(Math.abs(delta)) + ' points') + ' since v' + vs + (basis ? ' (' + basis + ')' : '');
    return h('span', { class: 'chg chg-' + dir, title: spoken },
      h('span', { 'aria-hidden': 'true', text: text }), h('span', { class: 'offscreen', text: ', ' + spoken }));
  }
  function meter(label, value, valueText, delta, vs, basis) {
    var b = bandOf(value);
    var bar = h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'fill fill-' + b }));
    if (typeof value === 'number') bar.firstChild.style.width = Math.max(0, Math.min(100, value)) + '%';
    return h('li', { class: 'score band-' + b },
      h('span', { class: 'score-label', text: label }),
      h('span', { class: 'score-value' }, h('strong', { text: valueText }),
        typeof value === 'number' ? h('span', { class: 'score-band', text: BAND_TEXT[b] }) : null,
        changeEl(delta, vs, basis)),
      bar);
  }

  /** Compact score summary row for the top of the detail page. */
  function scoreRow(p) {
    var s = p.scores || {};
    var c = p.score_change || {};
    var vs = c.vs_version;
    var sec = s.security || {};
    var q = s.quality || {};
    var e = s.evals;
    var n = s.adoption ? s.adoption.active_consumers : 0;
    var items = [
      meter('Security', sec.score, sec.score == null ? '—' : String(sec.score), c.security, vs, c.security_basis === 'rules only' ? 'rules only' : null),
      meter('Quality', q.score, q.score == null ? '—' : String(q.score), c.quality, vs),
      meter('Evals', e ? e.pass_rate : null, e ? fmtNum(e.pass_rate) + '%' : 'not measured', c.evals, vs),
      h('li', { class: 'score score-count' },
        h('span', { class: 'score-label', text: 'Adoption' }),
        h('span', { class: 'score-value' }, h('strong', { text: String(n) }), h('span', { class: 'score-band', text: n === 1 ? 'team repo installs it' : 'team repos install it' }))),
    ];
    var sc = p.scored || {};
    var when = 'Scored ' + fmtDateTime(sc.at) + ' · v' + (sc.version || '?') +
      (sc.tracked === false ? ' (' + (sc.reason || 'patch') + ', not tracked)' : '') +
      (sc.source === 'build' ? ' (at site build)' : '');
    return h('section', { class: 'scores', 'aria-label': 'Scores for ' + p.name },
      h('ul', { class: 'score-list' }, items),
      h('p', { class: 'scored' }, when, vs ? ' · change vs v' + vs : '', ' · ', howScoresLink()));
  }

  /** Link to the "How scores are calculated" page. */
  function howScoresLink() {
    return h('a', { href: '#/scores', text: 'How scores are calculated' });
  }


  function scoreDetail(p) {
    var s = p.scores || {};
    var wrap = h('div', { class: 'score-detail' });
    var sec = s.security || {};
    wrap.appendChild(h('h3', { class: 'sub', text: 'Security' }));
    wrap.appendChild(h('p', { class: 'hint' }, sec.inputs ? sec.inputs + '. ' : '',
      data.skillspector_ran && sec.skillspector_risk != null ? 'SkillSpector risk ' + sec.skillspector_risk + '/100.' : 'SkillSpector: not run.'));
    if (s.quality) {
      var crit = s.quality.criteria || [];
      var ran = crit.filter(function (x) { return x.ran; }).length;
      wrap.appendChild(h('h3', { class: 'sub', text: 'Quality · ' + ran + ' of ' + crit.length + ' criteria ran' }));
      wrap.appendChild(h('ul', { class: 'criteria' }, crit.map(function (c) {
        return h('li', { class: c.ran && bandOf(c.score) !== 'poor' ? 'pass' : 'fail' },
          h('span', { class: 'mark num', text: c.ran ? String(c.score) : '—' }),
          h('span', null, c.label + ' (' + c.weight + '%' + (c.ran ? '' : ', not run') + ')',
            h('span', { class: 'skill-desc', text: ' — ' + c.detail })));
      })));
    }
    var e = s.evals;
    wrap.appendChild(h('h3', { class: 'sub', text: 'Evals' }));
    wrap.appendChild(h('p', { class: 'hint' }, e
      ? e.passed + '/' + e.total + ' with the skill vs ' + e.baseline_passed + '/' + e.total + ' baseline (' + (e.delta >= 0 ? '+' : '') + fmtNum(e.delta) + ' pts); measured on v' + e.measured_version +
        ' on ' + fmtDateTime(e.measured_at) + (e.earlier_version ? ' (measured on an earlier version)' : '') + (e.method ? '; ' + e.method : '') + '.'
      : 'No measured benchmark for this version yet.'));
    var hist = p.score_history || [];
    wrap.appendChild(h('h3', { class: 'sub', text: 'Score history (major/minor versions)' }));
    if (!hist.length) {
      wrap.appendChild(h('p', { class: 'empty-note', text: 'No recorded versions yet.' }));
    } else {
      var cell = function (v, pc) { return v == null ? '—' : fmtNum(v) + (pc ? '%' : ''); };
      wrap.appendChild(h('div', { class: 'table-scroll' }, h('table', null,
        h('caption', { class: 'offscreen', text: 'Score history for ' + p.name }),
        h('thead', null, h('tr', null, ['Version', 'Recorded', 'Security', 'Quality', 'Evals'].map(function (t) { return h('th', { scope: 'col', text: t }); }))),
        h('tbody', null, hist.slice().reverse().map(function (r) {
          return h('tr', null, h('th', { scope: 'row', text: 'v' + r.version }), h('td', { text: fmtDateTime(r.recorded_at) }),
            h('td', { text: cell(r.security) }), h('td', { text: cell(r.quality) }), h('td', { text: cell(r.evals, true) }));
        })))));
    }
    return wrap;
  }

  /** "How scores are calculated" body, used on home (collapsed) and on every detail page. */
  function explainBody() {
    var x = data.scores_explained;
    if (!x) return h('p', { class: 'empty-note', text: 'No explanation in this build.' });
    var list = function (title, lines) {
      return h('div', { class: 'explain-col' }, h('h3', { text: title }), h('ul', null, (lines || []).map(function (l) { return h('li', { text: l }); })));
    };
    return h('div', { class: 'explain' },
      h('p', { class: 'muted', text: 'Current scores are computed when this catalogue is built, from each plugin\'s own files and this repo\'s rules; the history comes from records written at each release. ' + (x.bands || '') }),
      h('div', { class: 'explain-grid' },
        list('Security (0–100)', x.security),
        h('div', { class: 'explain-col' }, h('h3', { text: 'Quality (0–100)' }),
          h('ul', null, (x.quality || []).map(function (l) { return h('li', { text: l }); })),
          (x.quality_tools || []).length ? h('p', { class: 'muted' }, 'Tools: ', (x.quality_tools || []).reduce(function (acc, t, i) {
            if (i) acc.push(', ');
            acc.push(ext(t.url, t.name));
            return acc;
          }, []), '.') : null),
        list('Evals', x.evals),
        list('Adoption (installs)', x.adoption),
        list('Which versions are tracked', x.tracking),
        list('When scores are recorded', x.recording)));
  }

  // ---------- home cards ----------
  /** One labelled number in the card's score line; the band is spoken, colour is only an accent. */
  function cardScore(label, value, text) {
    var b = bandOf(value);
    return h('span', { class: 'cs band-' + b },
      h('span', { class: 'cs-label', text: label }), ' ',
      h('strong', { text: text }),
      value == null ? null : h('span', { class: 'offscreen', text: ' (' + BAND_TEXT[b] + ')' }));
  }

  /** Home-grid card: name, short description, version + stage, one score line. The h3 link covers the card. */
  function card(p) {
    var s = p.scores || {};
    var sec = s.security || {};
    var q = s.quality || {};
    var e = s.evals;
    var sep = function () { return h('span', { class: 'cs-sep', 'aria-hidden': 'true', text: '·' }); };
    return h('article', { class: 'card', id: 'plugin-' + p.name, 'aria-labelledby': 'h-' + p.name },
      h('div', { class: 'card-top' },
        h('h3', { id: 'h-' + p.name }, h('a', { href: detailHref(p.name), class: 'card-link', text: p.name })),
        stageBadge(p)),
      h('p', { class: 'desc clamp', text: p.description }),
      h('div', { class: 'card-foot' },
        h('div', { class: 'card-meta' },
          badge('v' + (p.versions.latest || '?'), 'b-quiet'),
          stableLags(p) ? badge('stable v' + p.versions.stable + ' behind', 'pill-warn') : null,
          badge(p.category, 'b-quiet'),
          p.languages.map(function (l) { return badge(l, 'b-quiet'); })),
        h('p', { class: 'card-scores' },
          h('span', { class: 'offscreen', text: 'Scores: ' }),
          cardScore('Security', sec.score, sec.score == null ? '—' : String(sec.score)), sep(),
          cardScore('Quality', q.score, q.score == null ? '—' : String(q.score)), sep(),
          cardScore('Evals', e ? e.pass_rate : null, e ? fmtNum(e.pass_rate) + '%' : '—'))));
  }

  function renderStats() {
    var teams = uniq([].concat.apply([], data.plugins.map(teamsOf)));
    var lagging = data.plugins.filter(stableLags).length;
    var onStable = data.plugins.filter(function (p) { return p.versions.stable; }).length;
    var items = [
      [String(data.plugins.length), data.plugins.length === 1 ? 'plugin' : 'plugins', ''],
      [String(teams.length), (teams.length === 1 ? 'team' : 'teams') + ' consuming', ''],
      [onStable + ' of ' + data.plugins.length, 'on stable', ''],
      [String(lagging), 'stable behind latest', lagging ? ' stat-warn' : ''],
    ];
    var dl = $('stats');
    dl.textContent = '';
    items.forEach(function (it) {
      dl.appendChild(h('div', { class: 'stat' + it[2] }, h('dt', { text: it[1] }), h('dd', { text: it[0] })));
    });
  }

  // ---------- search + filter ----------
  function searchDocs() {
    return data.plugins.map(function (p) {
      return {
        name: p.name, description: p.description,
      };
    });
  }

  function compute() {
    var list;
    var best = null;
    if (state.only) {
      list = data.plugins.filter(function (p) { return p.name === state.only; });
    } else if (state.q.trim()) {
      var res = window.searchPlugins(searchDocs(), state.q, window.Fuse);
      best = res.length ? res[0].score : null;
      list = res.map(function (r) { return data.plugins[r.refIndex]; });
    } else {
      list = data.plugins.slice();
    }
    list = list.filter(function (p) {
      return (!state.category || p.category === state.category) &&
        (!state.stage || p.stage === state.stage) &&
        (!state.language || p.languages.indexOf(state.language) !== -1 || p.languages.indexOf('any') !== -1);
    });
    return { list: list, weak: !state.only && !!state.q.trim() && (list.length === 0 || best === null || best > WEAK_SCORE) };
  }

  function render() {
    var r = compute();
    var results = $('results');
    results.textContent = '';
    r.list.forEach(function (p) { results.appendChild(card(p)); });
    var n = r.list.length;
    $('count').textContent = n === data.plugins.length
      ? plural(n, 'plugin')
      : 'Showing ' + n + ' of ' + plural(data.plugins.length, 'plugin');
    $('clear').hidden = !(state.q || state.category || state.stage || state.language || state.only);
    if (!n && !r.weak) results.appendChild(h('div', { class: 'empty' }, h('p', { class: 'empty-title', text: 'No plugins match these filters' }), h('p', { class: 'muted', text: 'Try a different category, stage or language, or clear the filters.' })));

    var fb = $('focus-bar');
    fb.textContent = '';
    fb.hidden = !state.only;
    if (state.only) {
      fb.appendChild(document.createTextNode('Showing only ' + state.only + '. '));
      fb.appendChild(h('a', { href: '#', text: 'Show all plugins' }));
    }

    var req = $('request');
    req.textContent = '';
    req.hidden = !r.weak;
    if (r.weak) {
      req.appendChild(h('p', null,
        h('span', null, n ? 'Not quite what you need?' : 'Nothing matches "' + state.q.trim() + '".'),
        h('a', { href: REQUEST_BASE + encodeURIComponent(state.q.trim()), class: 'btn btn-primary btn-sm', text: 'Request this plugin' })));
    }
  }

  function fillSelect(id, values) {
    var sel = $(id);
    values.forEach(function (v) { sel.appendChild(h('option', { value: v, text: v })); });
  }
  function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }).sort(); }

  function renderSandbox() {
    var list = $('sandbox-list');
    if (!data.sandbox.length) return;
    $('sandbox').hidden = false;
    $('sandbox-count').textContent = plural(data.sandbox.length, 'plugin') + ' in the repo but not in either catalogue';
    data.sandbox.forEach(function (s) {
      list.appendChild(h('article', { class: 'sandbox-card', 'aria-labelledby': 'sb-' + s.name },
        h('h3', { id: 'sb-' + s.name, text: s.name }),
        h('p', { class: 'muted', text: 'Why it is not listed:' }),
        h('ul', null, s.reasons.map(function (x) { return h('li', { text: x }); })),
        h('p', { class: 'muted', text: 'Try it from the repo root:' }),
        codeBlock('claude --plugin-dir ./' + s.path, 'plugin-dir command', true)));
    });
  }

  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // Routes: #/plugin/<name> = detail page; #plugin=<name> = catalogue filtered to one plugin;
  // #/scores, #/guide, #/about = static pages; anything else = the catalogue.
  var STATIC_PAGES = {
    '#/scores': { title: 'How scores are calculated', build: scoresPage },
    '#/guide': { title: 'Create & use plugins', build: guidePage },
    '#/about': { title: 'About', build: aboutPage },
  };
  /** Mark the header nav link for the current page (aria-current); '' marks none. */
  function setNav(hash) {
    document.querySelectorAll('.site-nav a').forEach(function (a) {
      if (a.getAttribute('href') === hash) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  var catalogueScroll = 0;
  var inDetail = false;
  function onHash() {
    var d = location.hash.match(/^#\/plugin\/(.+)$/);
    charts = [];
    var page = STATIC_PAGES[location.hash];
    if (page) {
      if (!inDetail) catalogueScroll = window.scrollY;
      inDetail = true;
      var sv = $('detail');
      sv.textContent = '';
      sv.appendChild(page.build());
      $('catalogue').hidden = true;
      sv.hidden = false;
      document.title = page.title + ' · Agent Marketplace';
      setNav(location.hash);
      window.scrollTo(0, 0);
      $('detail-title').focus({ preventScroll: true });
      return;
    }
    setNav(d ? '' : '#');
    if (d) {
      if (!inDetail) catalogueScroll = window.scrollY;
      inDetail = true;
      var name = safeDecode(d[1]);
      var p = data.plugins.find(function (x) { return x.name === name; });
      var view = $('detail');
      view.textContent = '';
      view.appendChild(p ? detailView(p) : notFound(name));
      $('catalogue').hidden = true;
      view.hidden = false;
      document.title = (p ? p.name : 'Not found') + ' · Agent Marketplace';
      drawCharts();
      window.scrollTo(0, 0);
      $('detail-title').focus({ preventScroll: true });
      return;
    }
    var wasDetail = inDetail;
    inDetail = false;
    $('detail').hidden = true;
    $('detail').textContent = '';
    $('catalogue').hidden = false;
    document.title = 'Agent Marketplace';
    var m = location.hash.match(/^#plugin=(.+)$/);
    state.only = m ? safeDecode(m[1]) : '';
    render();
    var target = !m && location.hash.length > 1 ? document.getElementById(safeDecode(location.hash.slice(1))) : null;
    if (target && target.tagName === 'DETAILS') target.open = true;
    if (state.only) $('results').focus();
    else if (target) target.scrollIntoView();
    else if (wasDetail) window.scrollTo(0, catalogueScroll);
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(drawCharts, 120);
  });

  function init(d) {
    data = d;
    fillSelect('f-category', uniq(d.plugins.map(function (p) { return p.category; })));
    fillSelect('f-stage', uniq(d.plugins.map(function (p) { return p.stage; })));
    fillSelect('f-language', uniq([].concat.apply([], d.plugins.map(function (p) { return p.languages; }))));

    $('q').addEventListener('input', function (e) {
      state.q = e.target.value;
      if (state.only) { history.replaceState(null, '', location.pathname + location.search); state.only = ''; }
      render();
    });
    [['f-category', 'category'], ['f-stage', 'stage'], ['f-language', 'language']].forEach(function (pair) {
      $(pair[0]).addEventListener('change', function (e) { state[pair[1]] = e.target.value; render(); });
    });
    $('clear').addEventListener('click', function () {
      state.q = state.category = state.stage = state.language = '';
      ['q', 'f-category', 'f-stage', 'f-language'].forEach(function (id) { $(id).value = ''; });
      if (state.only) { history.replaceState(null, '', location.pathname + location.search); state.only = ''; }
      render();
      $('q').focus();
    });
    window.addEventListener('hashchange', onHash);
    // The site title always returns to the clean home page: catalogue, no search, no filters.
    document.querySelectorAll('.home-link, [data-home]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        state.q = state.category = state.stage = state.language = state.only = '';
        ['q', 'f-category', 'f-stage', 'f-language'].forEach(function (id) { $(id).value = ''; });
        catalogueScroll = 0;
        if (location.hash) location.hash = '';
        else render();
        window.scrollTo(0, 0);
      });
    });
    $('generated').textContent = 'Catalogue built ' + fmtDateTime(d.generated_at) + '.';
    var stale = window.staleMessage ? window.staleMessage(d.consumers_generated_at, Date.now()) : null;
    if (stale) { $('stale').textContent = stale; $('stale').hidden = false; }
    renderStats();
    renderSandbox();
    onHash();
  }

  fetch('data.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (e) { $('count').textContent = 'Could not load the catalogue (' + e.message + ').'; });
})();
