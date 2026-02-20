// ── Trie (ported from index.js) ────────────────────────────────────────────
const CN_MAX_WORD_LEN = 10;

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

// ── Language detection (ported from index.js) ──────────────────────────────
function _is_chinese_char(char) {
  const cp = char.codePointAt(0);
  return (
    (cp >= 0x4E00 && cp <= 0x9FFF)  ||
    (cp >= 0x3400 && cp <= 0x4DBF)  ||
    (cp >= 0x20000 && cp <= 0x2A6DF) ||
    (cp >= 0x2A700 && cp <= 0x2B73F) ||
    (cp >= 0x2B740 && cp <= 0x2B81F) ||
    (cp >= 0x2B820 && cp <= 0x2CEAF) ||
    (cp >= 0xF900 && cp <= 0xFAFF)  ||
    (cp >= 0x2F800 && cp <= 0x2FA1F)
  );
}

function _is_chinese_text(text) {
  if (!text.length) return false;
  const len = text.length;
  const sampleN = Math.max(1, Math.floor(len / 10));
  let hits = 0;
  for (let i = 0; i < sampleN; i++) {
    const pick = Math.floor(Math.random() * len);
    if (_is_chinese_char(text[pick])) hits++;
  }
  return (hits / sampleN) > 0.5;
}

// ── Word-frequency analysis (ported from index.js) ─────────────────────────

// English: returns [[start, end, token, freq], ...]
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

// Chinese: returns [[start, end, word, log2freq], ...]
function getDensityCN(text, fmap) {
  let parent = fmap.root;
  const density = [];

  for (let i = 0; i < text.length; i++) {
    let found = false;
    let skip = 0;
    let sWord = '';
    let longest = [];

    for (let j = i; j < text.length; j++) {
      if (!parent.c[text[j]]) {
        found = false;
        skip = j - i;
        parent = fmap.root;
        if (longest.length > 0) density.push(longest);
        break;
      }

      sWord = sWord + text[j];
      if (parent.c[text[j]].e) {
        found = true;
        longest = [i, j, sWord, Math.log2(parseInt(parent.c[text[j]].f))];
        skip = j - i;
        if (skip + 1 >= CN_MAX_WORD_LEN) {
          break;
        } else {
          parent = parent.c[text[j]];
          continue;
        }
      }
      parent = parent.c[text[j]];
    }

    if (skip >= 1) i += skip - 1;
    if (!found) continue;
  }

  return density;
}

// Returns { word: [[start, end, freq], ...], ... } for rare words
// Threshold differs: 12 for Chinese, 15 for English
function getIndexing(density, isCN) {
  const thred = isCN ? 12 : 15;
  const indexing = {};
  density
    .filter(e => e[3] < thred && e[3] !== -1)
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
  const LIMIT = 15000;

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

  const blocks = Array.from(document.querySelectorAll('div, section'));
  let best = null, bestLen = 0;
  for (const el of blocks) {
    if (/nav|menu|sidebar|footer|header/i.test(el.id + el.className)) continue;
    const t = el.innerText.trim();
    if (t.length > bestLen) { bestLen = t.length; best = el; }
  }
  if (best && bestLen > 300) return best.innerText.trim().slice(0, LIMIT);

  const clone = document.body.cloneNode(true);
  ['nav', 'header', 'footer', 'script', 'style', 'aside', 'noscript'].forEach(tag => {
    clone.querySelectorAll(tag).forEach(el => el.remove());
  });
  return clone.innerText.trim().slice(0, LIMIT);
}

// ── Trie loading (per-language cache) ─────────────────────────────────────
const trieCache = { en: null, cn: null };
const triePromises = { en: null, cn: null };

function loadTrie(lang) {
  if (trieCache[lang]) return Promise.resolve(trieCache[lang]);
  if (triePromises[lang]) return triePromises[lang];
  const file = lang === 'cn' ? 'cn-trie.txt' : 'enwiki-trie.txt';
  const url = chrome.runtime.getURL(file);
  triePromises[lang] = fetch(url)
    .then(r => r.text())
    .then(text => {
      trieCache[lang] = Trie.deserialize(text);
      return trieCache[lang];
    });
  return triePromises[lang];
}

// ── Overlay ────────────────────────────────────────────────────────────────
let overlayEl = null;

function buildOverlayHTML(langLabel) {
  return `
<div id="gr-backdrop">
  <div id="gr-container">
    <div id="gr-header">
      <span id="gr-title">Gradient Reader</span>
      <span id="gr-lang-badge">${langLabel}</span>
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
  if (overlayEl) return;

  const text = extractMainContent();
  const isCN = _is_chinese_text(text);
  const lang = isCN ? 'cn' : 'en';
  const langLabel = isCN ? '中文' : 'EN';

  const wrapper = document.createElement('div');
  wrapper.id = 'gr-root';
  wrapper.innerHTML = buildOverlayHTML(langLabel);
  document.body.appendChild(wrapper);
  overlayEl = wrapper;

  wrapper.querySelector('#gr-backdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideOverlay();
  });
  wrapper.querySelector('#gr-close').addEventListener('click', hideOverlay);

  const outputEl = wrapper.querySelector('#output_text');

  loadTrie(lang)
    .then(trie => {
      const density = isCN ? getDensityCN(text, trie) : getDensityEN(text, trie);
      outputEl.innerHTML = renderContent(text, density, 5);

      const ul = wrapper.querySelector('#index ul');
      const indexing = getIndexing(density, isCN);
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
