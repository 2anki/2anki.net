// Client code for the deck viewer MCP App. It runs inside the host's sandboxed
// iframe, so it ships as plain ES2019 strings inlined into the ui:// resource:
// no bundler, no external fetch, nothing for the CSP to allow.
//
// VIEWER_HELPERS_JS holds the pure functions (no DOM, no host). The unit tests
// evaluate it with `new Function` and call them directly.

export const VIEWER_HELPERS_JS = String.raw`
var PAGE_SIZE = 20;

function plural(count, one, many) {
  return count === 1 ? one : many;
}

var NOTE_TYPE_LABELS = {
  basic: 'Basic',
  'basic-reversed': 'Basic and reversed',
  'basic-and-reversed': 'Basic and reversed',
  reversed: 'Basic and reversed',
  cloze: 'Cloze',
  input: 'Type the answer',
  mcq: 'Multiple choice'
};

function noteTypeLabel(name) {
  if (typeof name !== 'string' || name.length === 0) return '';
  var key = name.toLowerCase().replace(/^n2a-/, '');
  if (NOTE_TYPE_LABELS[key]) return NOTE_TYPE_LABELS[key];
  return name;
}

function commonDeckPath(names) {
  if (!names || names.length === 0) return [];
  var first = names[0].split('::');
  var shared = first.length;
  for (var i = 1; i < names.length; i++) {
    var parts = names[i].split('::');
    var j = 0;
    while (j < shared && j < parts.length && parts[j] === first[j]) j++;
    shared = j;
  }
  return first.slice(0, shared);
}

function stripApkg(name) {
  return typeof name === 'string' ? name.replace(/\.apkg$/i, '') : '';
}

function deckTitlePath(decks, fallback) {
  var names = (decks || []).map(function (deck) { return deck.name; });
  var path = commonDeckPath(names);
  if (path.length > 0 && path.join('').length > 0) return path;
  var name = stripApkg(fallback);
  return name ? [name] : [];
}

// Turns [{ name: 'A::B', cardCount }] into a tree whose counts include every
// descendant, rooted below the shared title path so the header isn't repeated.
function buildDeckTree(decks) {
  var list = decks || [];
  var skip = commonDeckPath(list.map(function (deck) { return deck.name; })).length;
  if (list.length === 1) return [];
  var root = { children: [] };
  list.forEach(function (deck) {
    var parts = deck.name.split('::').slice(skip);
    if (parts.length === 0) parts = [deck.name.split('::').pop()];
    var node = root;
    parts.forEach(function (part) {
      var child = null;
      for (var i = 0; i < node.children.length; i++) {
        if (node.children[i].name === part) child = node.children[i];
      }
      if (!child) {
        child = { name: part, count: 0, children: [] };
        node.children.push(child);
      }
      child.count += deck.cardCount || 0;
      node = child;
    });
  });
  return root.children;
}

function splitSoundTokens(text) {
  var out = [];
  var pattern = /\[sound:[^\]]*\]/g;
  var last = 0;
  var match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    out.push({ sound: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

function summaryLine(state) {
  var parts = [];
  if (typeof state.noteCount === 'number') {
    parts.push('from ' + state.noteCount + ' ' + plural(state.noteCount, 'note', 'notes'));
  }
  var types = (state.noteTypes || []).map(noteTypeLabel).filter(Boolean);
  if (types.length > 0) parts.push(types.join(', '));
  if (state.tts) parts.push('Text to speech');
  return parts.join(' · ');
}

function asCards(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(function (card) {
    return card && typeof card.front === 'string' && typeof card.back === 'string';
  });
}

// Normalises a get_deck_preview, create_deck or convert_to_deck result into
// the viewer's state. args are the tool-call arguments, when the host sent them.
function readToolResult(result, args) {
  var sc = (result && result.structuredContent) || {};
  var text = '';
  if (result && Array.isArray(result.content)) {
    result.content.forEach(function (item) {
      if (item && item.type === 'text' && typeof item.text === 'string') text += item.text;
    });
  }
  if (result && result.isError) {
    return { view: 'error', message: typeof sc.message === 'string' ? sc.message : text };
  }
  if (sc.kind === 'processing') {
    return { view: 'processing' };
  }
  if (sc.kind === 'batch') {
    return {
      view: 'batch',
      decks: (sc.decks || []).filter(function (deck) {
        return deck && typeof deck.downloadUrl === 'string';
      })
    };
  }
  var input = args || {};
  var pageSize = typeof input.pageSize === 'number' ? input.pageSize : PAGE_SIZE;
  var page = typeof input.page === 'number' && sc.kind == null ? input.page : 0;
  var cards = asCards(sc.sampleCards);
  if (sc.kind === 'deck') {
    // create_deck and convert_to_deck may append one reverse-direction sample
    // after the first page; keep page 0 in deck order so paging lines up.
    cards = cards.slice(0, pageSize);
  }
  var decks = Array.isArray(sc.decks) ? sc.decks.filter(function (deck) {
    return deck && typeof deck.name === 'string';
  }) : [];
  var identifier = null;
  if (typeof input.jobId === 'string') identifier = { jobId: input.jobId };
  else if (typeof input.key === 'string') identifier = { key: input.key };
  else if (typeof sc.jobId === 'string') identifier = { jobId: sc.jobId };
  var total = typeof sc.cardCount === 'number' ? sc.cardCount : cards.length;
  return {
    view: 'deck',
    titlePath: deckTitlePath(decks, sc.title || sc.filename),
    cardCount: total,
    noteCount: typeof sc.noteCount === 'number' ? sc.noteCount : null,
    noteTypes: Array.isArray(sc.noteTypes) ? sc.noteTypes : [],
    tts: sc.tts === true,
    decks: decks,
    tree: buildDeckTree(decks),
    cards: cards,
    page: page,
    pageSize: pageSize,
    index: 0,
    identifier: identifier,
    downloadUrl: typeof sc.downloadUrl === 'string' ? sc.downloadUrl : null
  };
}

function cardPosition(state) {
  return state.page * state.pageSize + state.index + 1;
}

function hasNext(state) {
  if (state.index < state.cards.length - 1) return true;
  return state.identifier != null && cardPosition(state) < state.cardCount;
}

function hasPrev(state) {
  return state.index > 0 || (state.identifier != null && state.page > 0);
}
`;

export const VIEWER_APP_JS = String.raw`
(function () {
  var doc = document;
  var root = doc.documentElement;
  var pending = {};
  var nextId = 1;
  var toolArgs = null;
  var state = null;
  var flipped = false;
  var busy = false;
  var errorLine = '';

  function post(message) {
    window.parent.postMessage(message, '*');
  }

  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      post({ jsonrpc: '2.0', id: id, method: method, params: params });
    });
  }

  function notify(method, params) {
    var message = { jsonrpc: '2.0', method: method };
    if (params) message.params = params;
    post(message);
  }

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Card HTML comes from user files. Parse it into an inert document and copy
  // across only formatting elements and the cloze class; scripts, handlers,
  // styles, links and media never reach the live page.
  var KEEP = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, SUB: 1, SUP: 1, BR: 1, P: 1,
    DIV: 1, SPAN: 1, UL: 1, OL: 1, LI: 1, TABLE: 1, THEAD: 1, TBODY: 1,
    TFOOT: 1, TR: 1, TD: 1, TH: 1, BLOCKQUOTE: 1, PRE: 1, CODE: 1, HR: 1,
    RUBY: 1, RT: 1, RP: 1, RB: 1, MARK: 1, SMALL: 1
  };
  var AS_DIV = { H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, SECTION: 1, ARTICLE: 1, FIGURE: 1, FIGCAPTION: 1, DETAILS: 1, SUMMARY: 1 };
  var DROP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, AUDIO: 1, VIDEO: 1, SOURCE: 1, LINK: 1, META: 1 };

  function appendText(target, text) {
    splitSoundTokens(text).forEach(function (part) {
      if (part.sound) target.appendChild(el('span', 'media-chip', 'Audio'));
      else target.appendChild(doc.createTextNode(part.text));
    });
  }

  function copyChildren(source, target) {
    for (var child = source.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 3) {
        appendText(target, child.nodeValue || '');
        continue;
      }
      if (child.nodeType !== 1) continue;
      var tag = child.tagName.toUpperCase();
      if (DROP[tag]) continue;
      if (tag === 'IMG' || tag === 'SVG') {
        target.appendChild(el('span', 'media-chip', 'Image'));
        continue;
      }
      if (KEEP[tag]) {
        var copy = doc.createElement(tag.toLowerCase());
        var cls = child.getAttribute('class') || '';
        if (/(^|\s)cloze(\s|$)/.test(cls)) copy.className = 'cloze';
        if (tag === 'TD' || tag === 'TH') {
          ['colspan', 'rowspan'].forEach(function (name) {
            var value = child.getAttribute(name);
            if (value && /^\d{1,2}$/.test(value)) copy.setAttribute(name, value);
          });
        }
        if (tag === 'HR' && child.getAttribute('id') === 'answer') copy.className = 'answer-rule';
        copyChildren(child, copy);
        target.appendChild(copy);
        continue;
      }
      if (AS_DIV[tag]) {
        var block = el('div', tag.charAt(0) === 'H' ? 'heading' : '');
        copyChildren(child, block);
        target.appendChild(block);
        continue;
      }
      copyChildren(child, target);
    }
  }

  function renderCardHtml(html, target) {
    var parsed = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    copyChildren(parsed.body, target);
  }

  function applyContext(ctx) {
    if (!ctx) return;
    if (ctx.theme === 'light' || ctx.theme === 'dark') {
      root.setAttribute('data-theme', ctx.theme);
      root.style.colorScheme = ctx.theme;
    }
    var vars = ctx.styles && ctx.styles.variables;
    if (vars) {
      Object.keys(vars).forEach(function (name) {
        if (name.indexOf('--') === 0 && typeof vars[name] === 'string') {
          root.style.setProperty(name, vars[name]);
        }
      });
    }
    var insets = ctx.safeAreaInsets;
    if (insets) {
      ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        if (typeof insets[side] === 'number') {
          root.style.setProperty('--safe-' + side, insets[side] + 'px');
        }
      });
    }
  }

  function button(label, className, onClick, disabled) {
    var node = el('button', className, label);
    node.type = 'button';
    node.disabled = !!disabled;
    node.addEventListener('click', onClick);
    return node;
  }

  function openLink(url) {
    request('ui/open-link', { url: url }).then(function (result) {
      if (result && result.isError) {
        errorLine = 'Couldn\'t open the download. Copy the link from the chat.';
        render();
      }
    }, function () {
      errorLine = 'Couldn\'t open the download. Copy the link from the chat.';
      render();
    });
  }

  function loadPage(page, index) {
    if (busy || !state || !state.identifier) return;
    busy = true;
    errorLine = '';
    render();
    var args = { page: page, pageSize: state.pageSize };
    if (state.identifier.jobId) args.jobId = state.identifier.jobId;
    else args.key = state.identifier.key;
    request('tools/call', { name: 'get_deck_preview', arguments: args }).then(function (result) {
      busy = false;
      var next = readToolResult(result, args);
      if (next.view !== 'deck' || next.cards.length === 0) {
        errorLine = 'Couldn\'t load more cards. Try again.';
      } else {
        state.cards = next.cards;
        state.page = page;
        state.index = index === 'last' ? next.cards.length - 1 : 0;
        flipped = false;
      }
      render();
    }, function () {
      busy = false;
      errorLine = 'Couldn\'t load more cards. Try again.';
      render();
    });
  }

  function go(step) {
    if (!state || busy) return;
    errorLine = '';
    if (step > 0) {
      if (state.index < state.cards.length - 1) { state.index++; flipped = false; render(); }
      else if (hasNext(state)) loadPage(state.page + 1, 0);
    } else {
      if (state.index > 0) { state.index--; flipped = false; render(); }
      else if (hasPrev(state)) loadPage(state.page - 1, 'last');
    }
  }

  function flip() {
    flipped = !flipped;
    render();
  }

  function renderHeader(main) {
    var header = el('header', 'head');
    if (state.titlePath.length > 0) {
      var path = el('div', 'path');
      state.titlePath.forEach(function (part, i) {
        if (i > 0) path.appendChild(el('span', 'sep', '::'));
        path.appendChild(el('span', i === state.titlePath.length - 1 ? 'leaf' : '', part));
      });
      header.appendChild(path);
    }
    var hero = el('div', 'hero');
    hero.appendChild(el('span', 'hero-num', String(state.cardCount)));
    hero.appendChild(el('span', 'hero-unit', plural(state.cardCount, 'card', 'cards')));
    header.appendChild(hero);
    var line = summaryLine(state);
    if (line) header.appendChild(el('div', 'meta', line));
    main.appendChild(header);
  }

  function renderCard(main) {
    var card = state.cards[state.index];
    if (!card) {
      main.appendChild(el('p', 'empty', 'No cards to show in this deck.'));
      return;
    }
    var face = el('section', 'card' + (flipped ? ' is-back' : ''));
    face.tabIndex = 0;
    face.setAttribute('role', 'button');
    face.setAttribute('aria-label', flipped ? 'Back of card. Activate to show the front.' : 'Front of card. Activate to show the answer.');
    face.addEventListener('click', flip);
    var top = el('div', 'card-top');
    top.appendChild(el('span', 'side', flipped ? 'Back' : 'Front'));
    if (card.direction === 'reverse') top.appendChild(el('span', 'side', 'Reverse'));
    if (card.deck) top.appendChild(el('span', 'card-deck', card.deck.split('::').pop()));
    face.appendChild(top);
    var body = el('div', 'card-body');
    renderCardHtml(flipped ? card.back : card.front, body);
    face.appendChild(body);
    if (card.tags && card.tags.length > 0) {
      var tags = el('div', 'tags');
      card.tags.slice(0, 8).forEach(function (tag) { tags.appendChild(el('span', 'chip', tag)); });
      if (card.tags.length > 8) tags.appendChild(el('span', 'chip more', '+' + (card.tags.length - 8)));
      face.appendChild(tags);
    }
    main.appendChild(face);

    var nav = el('nav', 'controls');
    nav.setAttribute('aria-label', 'Card navigation');
    nav.appendChild(button('Previous', 'ghost', function () { go(-1); }, busy || !hasPrev(state)));
    nav.appendChild(button(flipped ? 'Show front' : 'Show answer', 'flip', flip, false));
    nav.appendChild(button('Next', 'ghost', function () { go(1); }, busy || !hasNext(state)));
    main.appendChild(nav);
    var position = el('div', 'position', busy ? 'Loading cards…' : 'Card ' + cardPosition(state) + ' of ' + state.cardCount);
    position.setAttribute('aria-live', 'polite');
    main.appendChild(position);
  }

  function renderTree(nodes, depth, list) {
    nodes.forEach(function (node) {
      var row = el('li', 'tree-row');
      row.style.setProperty('--depth', String(depth));
      row.appendChild(el('span', 'tree-name', node.name));
      row.appendChild(el('span', 'tree-count', String(node.count)));
      list.appendChild(row);
      renderTree(node.children, depth + 1, list);
    });
  }

  function renderSubdecks(main) {
    if (state.tree.length === 0) return;
    var box = el('section', 'subdecks');
    box.appendChild(el('h2', 'label', state.decks.length + ' ' + plural(state.decks.length, 'subdeck', 'subdecks')));
    var list = el('ul', 'tree');
    renderTree(state.tree, 0, list);
    box.appendChild(list);
    main.appendChild(box);
  }

  function renderFooter(main) {
    if (errorLine) main.appendChild(el('p', 'error-line', errorLine));
    if (!state.downloadUrl) return;
    var footer = el('div', 'footer');
    footer.appendChild(button('Download .apkg', 'primary', function () { openLink(state.downloadUrl); }, false));
    main.appendChild(footer);
  }

  function renderBatch(main) {
    var header = el('header', 'head');
    var hero = el('div', 'hero');
    hero.appendChild(el('span', 'hero-num', String(state.decks.length)));
    hero.appendChild(el('span', 'hero-unit', plural(state.decks.length, 'deck', 'decks') + ' ready'));
    header.appendChild(hero);
    main.appendChild(header);
    var list = el('ul', 'batch');
    state.decks.forEach(function (deck) {
      var row = el('li', 'batch-row');
      row.appendChild(el('span', 'tree-name', deck.name));
      row.appendChild(button('Download', 'ghost', function () { openLink(deck.downloadUrl); }, false));
      list.appendChild(row);
    });
    main.appendChild(list);
    if (errorLine) main.appendChild(el('p', 'error-line', errorLine));
  }

  function render() {
    var main = doc.getElementById('app');
    main.textContent = '';
    main.removeAttribute('aria-busy');
    if (!state) return;
    if (state.view === 'error') {
      main.appendChild(el('p', 'notice', state.message || 'Something broke on our end. Try again in a moment.'));
      return;
    }
    if (state.view === 'processing') {
      main.appendChild(el('p', 'notice', 'Your deck is generating. Ask for it again in a minute to see the cards.'));
      return;
    }
    if (state.view === 'batch') {
      renderBatch(main);
      return;
    }
    renderHeader(main);
    renderCard(main);
    renderSubdecks(main);
    renderFooter(main);
  }

  function handleNotification(method, params) {
    if (method === 'ui/notifications/tool-input') {
      toolArgs = (params && params.arguments) || null;
    } else if (method === 'ui/notifications/tool-result') {
      state = readToolResult(params, toolArgs);
      flipped = false;
      errorLine = '';
      render();
    } else if (method === 'ui/notifications/host-context-changed') {
      applyContext(params);
    } else if (method === 'ui/notifications/tool-cancelled') {
      if (!state) {
        state = { view: 'error', message: 'The deck request was cancelled.' };
        render();
      }
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== '2.0') return;
    if (message.method == null && message.id != null) {
      var waiter = pending[message.id];
      if (!waiter) return;
      delete pending[message.id];
      if (message.error) waiter.reject(message.error);
      else waiter.resolve(message.result);
      return;
    }
    if (typeof message.method !== 'string') return;
    if (message.id != null) {
      var known = message.method === 'ui/resource-teardown' || message.method === 'ping';
      post(known
        ? { jsonrpc: '2.0', id: message.id, result: {} }
        : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    handleNotification(message.method, message.params);
  });

  doc.addEventListener('keydown', function (event) {
    if (!state || state.view !== 'deck') return;
    if (event.key === 'ArrowRight') { go(1); event.preventDefault(); }
    else if (event.key === 'ArrowLeft') { go(-1); event.preventDefault(); }
    else if ((event.key === ' ' || event.key === 'Enter') && event.target && event.target.classList && event.target.classList.contains('card')) {
      flip();
      event.preventDefault();
    }
  });

  function watchSize() {
    var queued = false;
    var lastWidth = 0;
    var lastHeight = 0;
    function measure() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var previous = root.style.height;
        root.style.height = 'max-content';
        var height = Math.ceil(root.getBoundingClientRect().height);
        root.style.height = previous;
        var width = Math.ceil(window.innerWidth);
        if (width !== lastWidth || height !== lastHeight) {
          lastWidth = width;
          lastHeight = height;
          notify('ui/notifications/size-changed', { width: width, height: height });
        }
      });
    }
    measure();
    if (typeof ResizeObserver === 'function') {
      var observer = new ResizeObserver(measure);
      observer.observe(root);
      observer.observe(doc.body);
    }
  }

  request('ui/initialize', {
    appInfo: { name: '2anki deck viewer', version: '1.0.0' },
    appCapabilities: { availableDisplayModes: ['inline'] },
    protocolVersion: '2026-01-26'
  }).then(function (result) {
    applyContext(result && result.hostContext);
    notify('ui/notifications/initialized');
    watchSize();
  }, function () {
    watchSize();
  });
})();
`;
