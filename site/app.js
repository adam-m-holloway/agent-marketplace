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
  function codeBlock(text, label) {
    var status = h('span', { class: 'copy-status', role: 'status', 'aria-live': 'polite' });
    var btn = h('button', {
      type: 'button', class: 'copy', 'aria-label': 'Copy ' + label, text: 'Copy',
      onclick: function () {
        copyText(text).then(function () { status.textContent = 'Copied'; },
          function () { status.textContent = 'Select and copy manually'; });
        setTimeout(function () { status.textContent = ''; }, 2500);
      },
    });
    return h('div', { class: 'code' }, h('pre', null, h('code', { text: text })), h('div', { class: 'code-actions' }, btn, status));
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

  function installPanel(p) {
    var channel = channelFor[p.name] || 'latest';
    var body = h('div', { class: 'install-body' });
    var group = 'ch-' + p.name;

    function render() {
      body.textContent = '';
      var mkt = marketplaceName(channel);
      var just = h('div', { class: 'install-col' }, h('h4', { text: 'Just me' }));
      if (channel === 'latest') {
        just.appendChild(h('p', { text: 'From a terminal (Claude Code 2.1.292+):' }));
        just.appendChild(codeBlock('claude plugin install ' + p.name + ' --marketplace ' + data.repo, 'terminal install command'));
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
        return h('label', { for: inputId }, input, ' ' + id + (v ? ' (v' + v + ')' : id === 'stable' ? ' (not yet on stable)' : ''));
      }));

    render();
    return h('details', { class: 'install' }, h('summary', { text: 'Install' }), toggle, body);
  }

  // ---------- cards ----------
  function badge(text, cls) { return h('span', { class: 'badge ' + (cls || '') , text: text }); }

  function consumersBlock(p) {
    var wrap = h('div', { class: 'consumers' }, h('h4', { text: 'Used by' }));
    if (!p.consumers.length) {
      wrap.appendChild(h('p', { class: 'muted', text: 'No team repos have committed this plugin yet.' }));
    } else {
      var rows = p.consumers.map(function (c) {
        var behind = typeof c.versions_behind === 'number' ? (c.versions_behind === 0 ? 'current' : c.versions_behind + ' behind') : '—';
        return h('tr', null,
          h('td', { text: c.team || c.consumer || '—' }),
          h('td', { text: c.channel || '—' }),
          h('td', { text: c.version ? 'v' + c.version : '—' }),
          h('td', { text: behind }),
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

  function card(p) {
    var versions = h('span', { class: 'versions' },
      badge('latest v' + (p.versions.latest || '?'), 'b-latest'),
      badge(p.versions.stable ? 'stable v' + p.versions.stable : 'not on stable', p.versions.stable ? 'b-stable' : 'b-none'));
    var meta = h('dl', { class: 'meta' },
      h('dt', { text: 'Stage' }), h('dd', null, badge(p.stage, 'stage-' + p.stage), p.replaced_by ? ' use ' : null,
        p.replaced_by ? focusLink(p.replaced_by) : null),
      h('dt', { text: 'Category' }), h('dd', { text: p.category }),
      h('dt', { text: 'Owner' }), h('dd', { text: p.owner || '—' }),
      h('dt', { text: 'Languages' }), h('dd', { text: p.languages.join(', ') || '—' }),
      h('dt', { text: 'Compatibility' }), h('dd', { text: p.compatibility || 'Not stated' }));
    var skills = p.skills.length ? h('div', { class: 'skills' }, h('h4', { text: 'Skills' }),
      h('ul', null, p.skills.map(function (s) { return h('li', null, h('code', { text: s.name })); }))) : null;
    var related = h('div', { class: 'related' }, h('h4', { text: 'Related' }),
      p.related.length ? h('ul', { class: 'inline' }, p.related.map(function (r) { return h('li', null, focusLink(r)); }))
        : h('p', { class: 'muted', text: 'None yet.' }));

    return h('article', { class: 'card', id: 'plugin-' + p.name, 'aria-labelledby': 'h-' + p.name },
      h('header', { class: 'card-head' }, h('h3', { id: 'h-' + p.name, text: p.name }), versions),
      h('p', { class: 'desc', text: p.description }),
      h('ul', { class: 'tags', 'aria-label': 'Tags' }, p.tags.map(function (t) { return h('li', { text: t }); })),
      meta,
      skills,
      h('p', null, h('a', { href: p.readme_url, text: 'README on GitHub' })),
      related,
      consumersBlock(p),
      installPanel(p));
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
        codeBlock('claude --plugin-dir ./' + s.path, 'plugin-dir command')));
    });
  }

  function onHash() {
    var m = location.hash.match(/^#plugin=(.+)$/);
    state.only = m ? decodeURIComponent(m[1]) : '';
    render();
    if (state.only) $('results').focus();
  }

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
    window.addEventListener('hashchange', onHash);
    $('generated').textContent = 'Catalogue built ' + d.generated_at + '.';
    renderSandbox();
    onHash();
  }

  fetch('data.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(init)
    .catch(function (e) { $('count').textContent = 'Could not load the catalogue (' + e.message + ').'; });
})();
