// ── Trie (ported from index.js) ────────────────────────────────────────────
class TrieNode {
  constructor() {
    this.c = {};
    this.e = false;
    this.f = 0;
  }
}

class Trie {
  constructor() {
    this.root = new TrieNode();
  }
  search(word) {
    let n = this.root;
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      if (!n.c[char]) return false;
      n = n.c[char];
    }
    return n.e ? n.f : -1;
  }
  static deserialize(serialized) {
    let index = 0;
    function parseNode() {
      const node = new TrieNode();
      while (index < serialized.length) {
        const char = serialized[index++];
        if (char === '{') {
          continue;
        } else if (char === '}') {
          break;
        } else if (char === '*') {
          let freq = '';
          while (/[0-9]/.test(serialized[index])) {
            freq += serialized[index++];
          }
          node.e = true;
          node.f = parseInt(freq, 10);
        } else {
          node.c[char] = parseNode();
        }
      }
      return node;
    }
    const trie = new Trie();
    trie.root = parseNode();
    return trie;
  }
}

// ── Word-frequency analysis (ported from index.js) ─────────────────────────

// Returns [[start, end, token, freq], ...]
function getDensityEN(text, wmap) {
  const density = [];
  for (let i = 0; i < text.length;) {
    const char = text[i];
    if (['\u201c', '\u201d', '"', ',', '.'].includes(char)) { i++; continue; }

    const end = text.slice(i).search(/[\s?"",."\u201c\u201d]/);
    const skip = end + 1;

    if (char.search(/\s/) === -1) {
      const token = text.slice(i, end === -1 ? text.length : i + end);
      const matches = token.match(/[\w\-\u2018\u2019']+/);
      if (matches) {
        const freq = wmap.search(matches[0].toLowerCase()) || -1;
        density.push([i, i + end - 1, token, parseInt(freq)]);
      }
      if (end === -1) break;
      i += skip;
    } else {
      i++;
    }
  }
  return density;
}

// Returns { word: [[start, end, freq], ...], ... } for rare words
function getIndexing(density) {
  const indexing = {};
  density
    .filter(e => e[3] < 15 && e[3] !== -1)
    .sort((a, b) => a[3] - b[3])
    .forEach(e => {
      if (indexing[e[2]]) {
        indexing[e[2]].push([e[0], e[1], e[3]]);
      } else {
        indexing[e[2]] = [[e[0], e[1], e[3]]];
      }
    });
  return indexing;
}

// Returns HTML string with <span class="gray-tag"> wrappers
function renderContent(input, density, gray = 5) {
  let min = 1000, max = -1;
  for (const d of density) {
    if (d[3] === -1) continue;
    min = Math.min(d[3], min);
    max = Math.max(d[3], max);
  }
  const denom = max - min || 1;
  let output = '';
  let prev = 0;
  for (const [start, end, , val] of density) {
    const grey = (denom - (val - min)) / denom / gray;
    output += escapeHtml(input.slice(prev, start));
    output += `<span class="gray-tag" style="background:rgba(180,90,0,${grey.toFixed(3)});" data-start="${start}">${escapeHtml(input.slice(start, end + 1))}</span>`;
    prev = end + 1;
  }
  output += escapeHtml(input.slice(prev));
  return output;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Main-content extraction ────────────────────────────────────────────────
function extractMainContent() {
  const LIMIT = 15000; // chars

  // 1. Prefer semantic / common article containers
  const candidates = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.article-body',
    '.entry-content',
    '.content-body',
    '#article-body',
    '#main-content',
    '#content',
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el) {
      const t = el.innerText.trim();
      if (t.length > 300) return t.slice(0, LIMIT);
    }
  }

  // 2. Find the block element with the most text
  const blocks = Array.from(document.querySelectorAll('div, section'));
  let best = null, bestLen = 0;
  for (const el of blocks) {
    // Skip nav-like containers
    if (/nav|menu|sidebar|footer|header/i.test(el.id + el.className)) continue;
    const t = el.innerText.trim();
    if (t.length > bestLen) { bestLen = t.length; best = el; }
  }
  if (best && bestLen > 300) return best.innerText.trim().slice(0, LIMIT);

  // 3. Fallback: whole body minus chrome
  const clone = document.body.cloneNode(true);
  ['nav', 'header', 'footer', 'script', 'style', 'aside', 'noscript'].forEach(tag => {
    clone.querySelectorAll(tag).forEach(el => el.remove());
  });
  return clone.innerText.trim().slice(0, LIMIT);
}

// ── Trie loading (cached) ──────────────────────────────────────────────────
let cachedTrie = null;
let triePromise = null;

function loadTrie() {
  if (cachedTrie) return Promise.resolve(cachedTrie);
  if (triePromise) return triePromise;
  const url = chrome.runtime.getURL('enwiki-trie.txt');
  triePromise = fetch(url)
    .then(r => r.text())
    .then(text => {
      cachedTrie = Trie.deserialize(text);
      return cachedTrie;
    });
  return triePromise;
}

// ── Overlay ────────────────────────────────────────────────────────────────
let overlayEl = null;

function buildOverlayHTML() {
  return `
<div id="gr-backdrop">
  <div id="gr-container">
    <div id="gr-header">
      <span id="gr-title">Gradient Reader</span>
      <span id="gr-subtitle">Rare words highlighted — darker = less frequent</span>
      <button id="gr-close" title="Close (or click backdrop)">&#x2715;</button>
    </div>
    <div id="gr-body">
      <div id="output_text"><span class="gr-status">Loading frequency data\u2026</span></div>
      <div id="index"><h5>Rare Words</h5><ul></ul></div>
    </div>
  </div>
</div>`;
}

function showOverlay() {
  if (overlayEl) return; // already shown

  const wrapper = document.createElement('div');
  wrapper.id = 'gr-root';
  wrapper.innerHTML = buildOverlayHTML();
  document.body.appendChild(wrapper);
  overlayEl = wrapper;

  // Close on backdrop click
  wrapper.querySelector('#gr-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideOverlay();
  });
  wrapper.querySelector('#gr-close').addEventListener('click', hideOverlay);

  // Extract text then load trie and render
  const text = extractMainContent();
  const outputEl = wrapper.querySelector('#output_text');

  loadTrie()
    .then(wmap => {
      const density = getDensityEN(text, wmap);
      outputEl.innerHTML = renderContent(text, density, 5);

      // Build rare-words index
      const ul = wrapper.querySelector('#index ul');
      const indexing = getIndexing(density);
      for (const word in indexing) {
        const li = document.createElement('li');
        li.textContent = word;
        indexing[word].forEach(([start, , ], i) => {
          const span = document.createElement('span');
          span.textContent = i + 1;
          span.addEventListener('click', () => {
            const targ = outputEl.querySelector(`.gray-tag[data-start="${start}"]`);
            if (!targ) return;
            targ.classList.add('highlight');
            setTimeout(() => targ.classList.remove('highlight'), 1000);
            targ.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
          li.appendChild(span);
        });
        ul.appendChild(li);
      }
    })
    .catch(err => {
      outputEl.innerHTML = `<span class="gr-status gr-error">Failed to load: ${err.message}</span>`;
    });
}

function hideOverlay() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
}

// ── Message listener ───────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'toggle') {
    overlayEl ? hideOverlay() : showOverlay();
  }
});
