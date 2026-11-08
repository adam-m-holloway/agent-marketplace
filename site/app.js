/* Agent Marketplace catalogue. Vanilla JS, same-origin only (data.json + vendored Fuse). */
(function () {
  'use strict';

  var REQUEST_BASE = 'https://github.com/adam-m-holloway/agent-marketplace/issues/new?template=plugin-request.yml&labels=plugin-request&query=';
  var WEAK_SCORE = 0.3; // Fuse score: 0 = exact, 1 = no match. Best above this = weak result.

  var data = null;
  var fuse = null;
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

  function installPanel(p, ctx, open) {
    var channel = channelFor[p.name] || 'latest';
    var body = h('div', { class: 'install-body' });
    var group = 'ch-' + (ctx || 'card') + '-' + p.name;

    function render() {
      body.textContent = '';
      var mkt = marketplaceName(channel);
      var just = h('div', { class: 'install-col' }, h('h4', { text: 'Just me' }));
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

      var team = h('div', { class: 'install-col' }, h('h4', { text: "My team's repo" }));
      team.appendChild(h('p', null, 'Add to ', h('code', { text: '.claude/settings.json' }), ' in the repo:'));
      team.appendChild(codeBlock(settingsSnippet(p.name, channel, true), 'team settings snippet'));
      team.appendChild(h('p', { class: 'hint', text: 'Commit it; teammates are prompted after trusting the folder; this is what insights counts.' }));
      team.appendChild(h('p', { class: 'hint' }, 'Note: ', h('code', { text: '--marketplace' }), ' writes user settings only, so it is not a substitute for this.'));

      body.appendChild(just);
      body.appendChild(team);
    }

    var toggle = h('fieldset', { class: 'toggle' }, h('legend', { text: 'Channel' }),
      ['latest', 'stable'].map(function (id) {
        var inputId = group + '-' + id;
        var input = h('input', {
          type: 'radio', name: group, id: inputId, value: id, checked: id === channel,
          onchange: function () { channel = id; channelFor[p.name] = id; render(); },
        });
        var v = p.versions[id];
        return h('label', { for: inputId, class: 'seg' }, input, h('span', { text: id + (v ? ' v' + v : id === 'stable' ? ' (not yet)' : '') }));
      }));

    render();
    return h('details', { class: 'panel install', open: !!open },
      h('summary', null, h('span', { class: 'summary-title', text: 'Install' }), h('span', { class: 'summary-hint', text: 'commands for you or your team' })),
      h('div', { class: 'panel-body' }, toggle, body));
  }

  // ---------- cards ----------
  function badge(text, cls) { return h('span', { class: 'badge ' + (cls || ''), text: text }); }

  /** -1 / 0 / 1 for dotted numeric versions (x.y.z). Missing counts as lowest. */
  function cmpVersion(a, b) {
    if (!a || !b) return a ? 1 : b ? -1 : 0;
    var pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) { var d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }
  function stableLags(p) { return cmpVersion(p.versions.latest, p.versions.stable) > 0; }
  function teamsOf(p) { return uniq(p.consumers.map(function (c) { return c.team || c.consumer; }).filter(Boolean)); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  function consumersBlock(p) {
    var wrap = h('section', { class: 'detail-sec consumers', 'aria-labelledby': 'd-used' }, h('h3', { id: 'd-used', text: 'Used by' }));
    if (!p.consumers.length) {
      wrap.appendChild(h('p', { class: 'muted', text: 'No team repos have committed this plugin yet.' }));
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

  /** A titled section of the detail page (h3 + body). */
  function section(id, title, children, cls) {
    return h('section', { class: 'detail-sec' + (cls ? ' ' + cls : ''), 'aria-labelledby': 'd-' + id },
      h('h3', { id: 'd-' + id, text: title }), children);
  }

  /** Build-time rendered Markdown (escaped server-side; see renderMarkdown in build-site.mjs). */
  function prose(html, empty) {
    if (!html) return h('p', { class: 'muted', text: empty });
    var div = h('div', { class: 'prose' });
    div.innerHTML = html;
    return div;
  }

  function versionPills(p) {
    var lag = stableLags(p);
    return h('div', { class: 'versions' },
      badge('latest v' + (p.versions.latest || '?'), 'b-latest'),
      p.versions.stable
        ? badge('stable v' + p.versions.stable, lag ? 'pill-warn' : 'b-stable')
        : badge('not on stable', 'b-none'));
  }

  function factsLine(p, linkFor) {
    var lag = stableLags(p);
    return h('p', { class: 'facts' },
      badge(p.stage, 'stage stage-' + p.stage),
      p.replaced_by ? h('span', { class: 'fact' }, 'use ', linkFor(p.replaced_by)) : null,
      h('span', { class: 'fact' }, h('span', { class: 'offscreen', text: 'Category: ' }), p.category),
      h('span', { class: 'fact' }, h('span', { class: 'offscreen', text: 'Languages: ' }), p.languages.join(', ') || '—'),
      lag ? h('span', { class: 'fact' }, badge('stable behind latest', 'pill-warn')) : null);
  }

  function updatedLine(p) {
    return p.last_updated && p.last_updated.date
      ? h('p', { class: 'updated' }, h('span', { class: 'offscreen', text: 'Last release: ' }), 'Updated ' + p.last_updated.date + ' · v' + p.last_updated.version)
      : null;
  }

  function timeline(p) {
    var rel = p.releases || [];
    if (!rel.length) return h('p', { class: 'muted', text: 'No releases recorded yet.' });
    return h('ol', { class: 'timeline' }, rel.map(function (r) {
      return h('li', null,
        h('span', { class: 'tl-version', text: 'v' + r.version }),
        r.version === p.versions.latest ? badge('latest', 'b-latest') : null,
        r.version === p.versions.stable ? badge('stable', 'b-stable') : null,
        h('span', { class: 'tl-date', text: (r.date || 'date unknown') + (r.tagged ? '' : ' · not tagged') }));
    }));
  }

  function detailView(p) {
    var facts = h('dl', { class: 'meta' },
      h('dt', { text: 'Owner' }), h('dd', { text: p.owner || '—' }),
      h('dt', { text: 'Compatibility' }), h('dd', { text: p.compatibility || 'Not stated' }),
      h('dt', { text: 'Listed since' }), h('dd', { text: p.since || '—' }),
      h('dt', { text: 'Source' }), h('dd', null, h('a', { href: p.readme_url, text: 'README on GitHub' })));
    var skills = p.skills.length ? h('ul', { class: 'skills' }, p.skills.map(function (s) {
      return h('li', null, h('code', { text: s.name }), s.description ? h('span', { class: 'skill-desc', text: s.description }) : null);
    })) : h('p', { class: 'muted', text: 'No skills.' });
    var related = p.related.length
      ? h('ul', { class: 'inline' }, p.related.map(function (r) { return h('li', null, detailLink(r)); }))
      : h('p', { class: 'muted', text: 'No closely related plugins yet.' });

    var main = h('div', { class: 'detail-main' },
      section('scores', 'Scores', [scoreRow(p), scoreDetail(p)]),
      section('trends', 'Trends', [scoreChart(p), adoptionChart(p)], 'trends'),
      section('readme', 'README', prose(p.readme_html, 'No README.')),
      section('changelog', 'Changelog', prose(p.changelog_html, 'No CHANGELOG.')));
    // Install is its own grid item so it comes first on phones and tops the side column on wide screens.
    var install = h('section', { class: 'detail-sec detail-install', 'aria-label': 'Install' }, installPanel(p, 'detail', window.matchMedia('(min-width: 960px)').matches)); // collapsed on phones
    var aside = h('div', { class: 'detail-aside' },
      section('about', 'About', facts),
      section('skills', 'Skills', skills),
      section('versions', 'Versions', timeline(p)),
      consumersBlock(p),
      section('related', 'Related', related));

    return h('div', { class: 'detail-page' },
      h('p', { class: 'back' }, h('a', { href: '#', text: '← All plugins' })),
      h('header', { class: 'detail-head' },
        h('div', { class: 'card-head' }, h('h2', { id: 'detail-title', tabindex: '-1', text: p.name }), versionPills(p)),
        factsLine(p, detailLink),
        updatedLine(p),
        h('p', { class: 'detail-desc', text: p.description })),
      h('div', { class: 'detail-grid' }, install, main, aside));
  }

  function notFound(name) {
    return h('div', { class: 'detail-page' },
      h('p', { class: 'back' }, h('a', { href: '#', text: '← All plugins' })),
      h('h2', { id: 'detail-title', tabindex: '-1', text: 'Plugin not found' }),
      h('p', null, 'There is no listed plugin called "' + name + '". ', h('a', { href: REQUEST_BASE + encodeURIComponent(name), text: 'Request it' }), '.'));
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
    if (!a.length) return h('div', { class: 'chart chart-empty' }, h('p', { class: 'chart-title', text: 'Adoption over time' }), h('p', { class: 'muted', text: 'No usage snapshots yet (the nightly insights run writes one per day).' }));
    var t = a.map(function (r) { return Date.parse(r.date + 'T00:00:00Z'); });
    var span = t[t.length - 1] - t[0];
    var max = Math.max.apply(null, a.map(function (r) { return r.active; }));
    var step = max <= 5 ? 1 : Math.ceil(max / 4);
    var yMax = Math.max(step, Math.ceil(max / step) * step);
    var ticks = []; for (var v = 0; v <= yMax; v += step) ticks.push(v);
    return lineChart({
      title: 'Adoption over time', sub: 'active team repos per day',
      desc: 'Number of team repos with ' + p.name + ' committed and active, per daily scan: ' +
        a.map(function (r) { return r.date + ' ' + r.active; }).join('; ') + '.',
      xs: span ? t.map(function (x) { return (x - t[0]) / span; }) : evenXs(a.length),
      xLabels: a.map(function (r) { return shortDate(r.date); }),
      rowLabels: a.map(function (r) { return r.date; }),
      xTitle: 'Scan date (UTC)', yTitle: 'Active team repos', yMax: yMax, yTicks: ticks,
      fmt: function (v) { return String(v); },
      series: [{ label: 'Active team repos', cls: 'series-1', shape: 'circle', values: a.map(function (r) { return r.active; }) }],
      sparseNote: 'Only ' + plural(a.length, 'day') + ' of usage recorded so far, so points are shown without a line: the trend appears as more days are recorded.',
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
  /** "▲ 5" / "▼ 10" / "no change" vs the previous tracked version; null when unknown. */
  function changeEl(delta, vs, basis) {
    if (typeof delta !== 'number') return null;
    var dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    var text = delta > 0 ? '▲ ' + fmtNum(delta) : delta < 0 ? '▼ ' + fmtNum(-delta) : '±0';
    var spoken = (delta === 0 ? 'no change' : (delta > 0 ? 'up ' : 'down ') + fmtNum(Math.abs(delta)) + ' points') + ' since v' + vs + (basis ? ' (' + basis + ')' : '');
    return h('span', { class: 'chg chg-' + dir, title: spoken },
      h('span', { 'aria-hidden': 'true', text: text }), h('span', { class: 'offscreen', text: ', ' + spoken }));
  }
  function meter(label, value, valueText, delta, vs, note, basis) {
    var b = bandOf(value);
    var bar = h('span', { class: 'bar', 'aria-hidden': 'true' }, h('span', { class: 'fill fill-' + b }));
    if (typeof value === 'number') bar.firstChild.style.width = Math.max(0, Math.min(100, value)) + '%';
    return h('li', { class: 'score band-' + b },
      h('span', { class: 'score-label', text: label }),
      h('span', { class: 'score-value' }, h('strong', { text: valueText }),
        typeof value === 'number' ? h('span', { class: 'score-band', text: ' ' + BAND_TEXT[b] }) : null,
        changeEl(delta, vs, basis)),
      bar,
      note ? h('span', { class: 'score-note', text: note }) : null);
  }

  function scoreRow(p) {
    var s = p.scores || {};
    var c = p.score_change || {};
    var vs = c.vs_version;
    var sec = s.security || {};
    var q = s.quality || {};
    var e = s.evals;
    var items = [
      meter('Security', sec.score, sec.score == null ? '—' : sec.score + '/100', c.security, vs,
        data.skillspector_ran && sec.skillspector_risk != null ? 'SkillSpector risk ' + sec.skillspector_risk + '/100' : 'SkillSpector: not run',
        c.security_basis === 'rules only' ? 'rules only' : null),
      meter('Quality', q.score, q.score == null ? '—' : q.score + '/' + (q.max || 100), c.quality, vs,
        q.criteria ? q.criteria.filter(function (x) { return x.passed; }).length + ' of ' + q.criteria.length + ' criteria' : null),
      meter('Evals', e ? e.pass_rate : null, e ? fmtNum(e.pass_rate) + '%' : 'not measured', c.evals, vs,
        e ? (e.delta >= 0 ? '+' : '') + fmtNum(e.delta) + ' pts vs baseline · v' + e.measured_version +
          (e.earlier_version ? ' (earlier version)' : '') : null),
    ];
    var n = s.adoption ? s.adoption.active_consumers : 0;
    items.push(h('li', { class: 'score score-count' },
      h('span', { class: 'score-label', text: 'Adoption' }),
      h('span', { class: 'score-value' }, h('strong', { text: String(n) })),
      h('span', { class: 'score-note', text: n === 1 ? 'active team repo' : 'active team repos' })));
    var sc = p.scored || {};
    var when = 'Scored ' + fmtDateTime(sc.at) + ' · v' + (sc.version || '?') +
      (sc.tracked === false ? ' (' + (sc.reason || 'patch') + ', not tracked)' : '') +
      (sc.source === 'build' ? ' (at site build)' : '');
    return h('section', { class: 'scores', 'aria-label': 'Scores for ' + p.name },
      h('ul', { class: 'score-list' }, items),
      h('p', { class: 'scored' }, when,
        vs ? ' · change vs v' + vs : '', ' · ', howScoresLink()));
  }

  /** Scrolls to the explainer without changing the hash, so the detail view stays open. */
  function howScoresLink() {
    return h('a', {
      href: '#how-scores', text: 'How scores are calculated',
      onclick: function (e) {
        var target = $('how-scores');
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView();
        target.focus({ preventScroll: true });
      },
    });
  }

  /** Compact score: label, value and a text band (never colour alone). */
  function miniScore(label, value, text) {
    var b = bandOf(value);
    return h('div', { class: 'mini band-' + b },
      h('dt', { text: label }),
      h('dd', null, h('strong', { text: text }), value == null ? null : h('span', { class: 'score-band', text: ' ' + BAND_TEXT[b] })));
  }

  function scoreDetail(p) {
    var s = p.scores || {};
    var wrap = h('section', { class: 'detail', 'aria-label': 'Score breakdown' }, h('h4', { text: 'Score breakdown' }));
    if (s.security) wrap.appendChild(h('p', { class: 'hint' }, h('strong', { text: 'Security: ' }), s.security.inputs + '.'));
    if (s.quality) {
      wrap.appendChild(h('ul', { class: 'criteria' }, s.quality.criteria.map(function (c) {
        return h('li', { class: c.passed ? 'pass' : 'fail' },
          h('span', { class: 'mark', 'aria-hidden': 'true', text: c.passed ? '✓' : '✗' }),
          h('span', null, h('span', { class: 'offscreen', text: c.passed ? 'Passed: ' : 'Failed: ' }), c.label + ' (' + c.weight + ')',
            h('span', { class: 'skill-desc', text: ' — ' + c.detail })));
      })));
    }
    var e = s.evals;
    wrap.appendChild(h('p', { class: 'hint' }, h('strong', { text: 'Evals: ' }), e
      ? e.passed + '/' + e.total + ' with the skill vs ' + e.baseline_passed + '/' + e.total + ' baseline; measured on v' + e.measured_version +
        ' on ' + fmtDateTime(e.measured_at) + (e.earlier_version ? ' (measured on an earlier version)' : '') + (e.method ? '; ' + e.method : '') + '.'
      : 'no measured benchmark for this version yet.'));
    var hist = p.score_history || [];
    wrap.appendChild(h('h4', { class: 'sub', text: 'Score history (major/minor versions)' }));
    if (!hist.length) {
      wrap.appendChild(h('p', { class: 'muted', text: 'No recorded versions yet.' }));
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

  function renderExplain() {
    var x = data.scores_explained;
    var box = $('how-scores-body');
    if (!x || !box) return;
    var list = function (title, lines) {
      return h('div', { class: 'explain-col' }, h('h3', { text: title }), h('ul', null, (lines || []).map(function (l) { return h('li', { text: l }); })));
    };
    box.textContent = '';
    box.appendChild(h('p', { class: 'muted', text: x.bands }));
    box.appendChild(h('div', { class: 'explain-grid' },
      list('Security (0–100)', x.security),
      list('Quality (0–100)', (x.quality_criteria || []).map(function (c) { return c.label + ' — ' + c.weight + ' points'; })),
      list('Evals', x.evals),
      list('Adoption', x.adoption),
      list('Which versions are tracked', x.tracking),
      list('When scores are recorded', x.recording)));
  }

  /** Home-grid card: key facts only; everything else is on the detail page. */
  function card(p) {
    var s = p.scores || {};
    var sec = s.security || {};
    var q = s.quality || {};
    var e = s.evals;
    var n = s.adoption ? s.adoption.active_consumers : 0;
    var teams = teamsOf(p);
    return h('article', { class: 'card', id: 'plugin-' + p.name, 'aria-labelledby': 'h-' + p.name },
      h('header', { class: 'card-head' },
        h('h3', { id: 'h-' + p.name }, h('a', { href: detailHref(p.name), class: 'card-link', text: p.name })),
        versionPills(p)),
      factsLine(p, focusLink),
      h('p', { class: 'desc clamp', title: p.description, text: p.description }),
      h('dl', { class: 'mini-scores', 'aria-label': 'Scores' },
        miniScore('Security', sec.score, sec.score == null ? '—' : String(sec.score)),
        miniScore('Quality', q.score, q.score == null ? '—' : String(q.score)),
        miniScore('Evals', e ? e.pass_rate : null, e ? fmtNum(e.pass_rate) + '%' : '—'),
        h('div', { class: 'mini band-none' }, h('dt', { text: 'Adoption' }), h('dd', null, h('strong', { text: String(n) }), h('span', { class: 'score-band', text: n === 1 ? ' repo' : ' repos' })))),
      updatedLine(p),
      h('p', { class: 'used-by' }, 'Used by: ', teams.length ? teams.join(', ') : 'no team repos yet', ' · ', h('span', { class: 'muted', text: data.consumers_note })),
      h('div', { class: 'card-foot' },
        installPanel(p, 'card'),
        h('a', { class: 'view-details', href: detailHref(p.name), 'aria-label': 'View details for ' + p.name }, 'View details ', h('span', { 'aria-hidden': 'true', text: '→' }))));
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

  function focusLink(name) {
    return h('a', { href: '#plugin=' + encodeURIComponent(name), text: name });
  }

  // ---------- search + filter ----------
  function searchDocs() {
    return data.plugins.map(function (p) {
      return {
        name: p.name, description: p.description, tags: p.tags,
        skills: p.skills.map(function (s) { return s.name + ' ' + s.description; }),
      };
    });
  }

  function compute() {
    var list;
    var best = null;
    if (state.only) {
      list = data.plugins.filter(function (p) { return p.name === state.only; });
    } else if (state.q.trim()) {
      var res = fuse.search(state.q.trim());
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
    $('count').textContent = 'Showing ' + n + ' of ' + data.plugins.length + ' plugin' + (data.plugins.length === 1 ? '' : 's') + '.';
    $('clear').hidden = !(state.q || state.category || state.stage || state.language || state.only);
    if (!n && !r.weak) results.appendChild(h('p', { class: 'empty', text: 'No plugins match these filters.' }));

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
        n ? 'Not quite what you need? ' : 'Nothing matches "' + state.q.trim() + '". ',
        h('a', { href: REQUEST_BASE + encodeURIComponent(state.q.trim()), class: 'button', text: 'Request this plugin' })));
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
    data.sandbox.forEach(function (s) {
      list.appendChild(h('article', { class: 'card sandbox-card', 'aria-labelledby': 'sb-' + s.name },
        h('h3', { id: 'sb-' + s.name, text: s.name }),
        h('h4', { text: 'Why it is not listed' }),
        h('ul', null, s.reasons.map(function (x) { return h('li', { text: x }); })),
        h('p', { text: 'From the repo root:' }),
        codeBlock('claude --plugin-dir ./' + s.path, 'plugin-dir command', true)));
    });
  }

  function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }

  // Routes: #/plugin/<name> = detail page; #plugin=<name> = catalogue filtered to one plugin;
  // anything else = the catalogue (an in-page id such as #how-scores is scrolled to).
  var catalogueScroll = 0;
  var inDetail = false;
  function onHash() {
    var d = location.hash.match(/^#\/plugin\/(.+)$/);
    charts = [];
    if (d) {
      if (!inDetail) catalogueScroll = window.scrollY;
      inDetail = true;
      var name = safeDecode(d[1]);
      var p = data.plugins.find(function (x) { return x.name === name; });
      var view = $('detail');
      view.textContent = '';
      view.appendChild(p ? detailView(p) : notFound(name));
      $('catalogue').hidden = true;
      $('sandbox').hidden = true;
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
    $('sandbox').hidden = !data.sandbox.length;
    document.title = 'Agent Marketplace';
    var m = location.hash.match(/^#plugin=(.+)$/);
    state.only = m ? safeDecode(m[1]) : '';
    render();
    var target = !m && location.hash.length > 1 ? document.getElementById(safeDecode(location.hash.slice(1))) : null;
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
    fuse = new window.Fuse(searchDocs(), window.FUSE_OPTIONS);
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
    $('generated').textContent = 'Catalogue built ' + d.generated_at + '.';
    var stale = window.staleMessage ? window.staleMessage(d.consumers_generated_at, Date.now()) : null;
    if (stale) { $('stale').textContent = stale; $('stale').hidden = false; }
    renderStats();
    renderExplain();
    renderSandbox();
    onHash();
  }

  fetch('data.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (e) { $('count').textContent = 'Could not load the catalogue (' + e.message + ').'; });
})();
