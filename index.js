// maxlen for chinese
let maxLen = 10

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
  insert(word, freq) {
    if (!word) return;
    let n = this.root;
    for (let i = 0; i < word.length; i++) {
      let char = word[i];
      if (!n.c[char]) {
        n.c[char] = new TrieNode();
      }
      n = n.c[char];
    }
    console.assert(freq > 0, `freq should be positive, but get ${freq} from word ${word}`)
    n.e = true;
    n.f = freq;
  }
  search(word) {
    let n = this.root
    for (let i = 0; i < word.length; i++) {
      let char = word[i]
      if (!n.c[char]) {
        return false
      }
      n = n.c[char]
    }
    return n.e ? n.f : -1
  }
}

// ---- compact frequency dictionary decoder ----------------------------------
// Format (gunzipped bytes): varint numWords, varint wordStreamLen, varint freqScale,
// then front-coded word stream, then varint freq stream. See compress.js.
function readVarint(buf, pos) {
  let n = 0, shift = 0, b
  do {
    b = buf[pos.i++]
    n += (b & 0x7f) * Math.pow(2, shift)
    shift += 7
  } while (b & 0x80)
  return n
}

function decodeFreqBin(buf) {
  const pos = { i: 0 }
  const numWords = readVarint(buf, pos)
  const wordStreamLen = readVarint(buf, pos)
  const freqScale = readVarint(buf, pos)
  const wordsEnd = pos.i + wordStreamLen
  const words = new Array(numWords)
  let prev = ''
  const decoder = new TextDecoder('utf-8')
  for (let k = 0; k < numWords; k++) {
    const v = readVarint(buf, pos)
    let keep, suffixLen
    if (v === 0) {
      keep = readVarint(buf, pos)
      suffixLen = readVarint(buf, pos)
    } else {
      keep = v >> 8
      suffixLen = v & 0xff
    }
    prev = prev.slice(0, keep) + decoder.decode(buf.subarray(pos.i, pos.i + suffixLen))
    pos.i += suffixLen
    words[k] = prev
  }
  const pairs = new Array(numWords)
  for (let k = 0; k < numWords; k++) {
    pairs[k] = [words[k], readVarint(buf, pos) / freqScale]
  }
  return pairs
}

async function fetchFreqBin(url) {
  const response = await fetch(url)
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'))
  const buf = new Uint8Array(await new Response(stream).arrayBuffer())
  return decodeFreqBin(buf)
}

let fmap = new Trie();
let wmap = new Map();

async function loadFreq(text) {
  let is_cn = _is_chinese_char(text)
  if ( is_cn && Object.keys(fmap.root.c).length === 0) {
    // CN: longest-prefix matching needs a trie; freqs are stored as log2(freq)
    const pairs = await fetchFreqBin('./cn-freq.bin.gz')
    const trie = new Trie()
    for (const [word, logFreq] of pairs) trie.insert(word, logFreq)
    fmap = trie
  }
  if (!is_cn && wmap.size === 0) {
    wmap = new Map(await fetchFreqBin('./enwiki-freq.bin.gz'))
  }
  return Promise.resolve()
}

function debounce(func, wait, immediate) {
  let timeout;

  return function executedFunction() {
    let context = this;
    let args = arguments;

    let later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    let callNow = immediate && !timeout;

    clearTimeout(timeout);

    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };
};

function getIndexing(text, density) {
  let indexing = {}
  let is_cn = _is_chinese_char(text)
  let thred = is_cn ? 12 : 15

  density.filter(e => {
    return e[3] < thred && e[3] !== -1
  }).sort((a, b) => {
    return a[3] - b[3]
  }).map(e => {
    if (indexing[e[2]]) {
      indexing[e[2]].push([e[0], e[1], e[3]])
    } else {
      indexing[e[2]] = [[e[0], e[1], e[3]]]
    }
  })

  return indexing
}

async function loadPage(url) {
  startLoading()
  const response = await fetch(`https://api.mindynode.com/api/parser/${encodeURIComponent(url)}`)
  return await response.json()
}

function _is_chinese_char(char) {
  let cp = char.codePointAt()
  if ((cp >= 0x4E00 && cp <= 0x9FFF) ||
          (cp >= 0x3400 && cp <= 0x4DBF) ||
          (cp >= 0x20000 && cp <= 0x2A6DF) ||
          (cp >= 0x2A700 && cp <= 0x2B73F) ||
          (cp >= 0x2B740 && cp <= 0x2B81F) ||
          (cp >= 0x2B820 && cp <= 0x2CEAF) ||
          (cp >= 0xF900 && cp <= 0xFAFF) ||
          (cp >= 0x2F800 && cp <= 0x2FA1F)) {
    return true
  }

  return false
}

function _is_chinese_text(text) {
  if (!text.length) return false;

  let len = text.length
  let ratio = 0
  let sampleN = Math.max(1, Math.floor(len/10))

  for (let i = 0; i < sampleN; i++) {
    let pick = Math.floor(Math.random() * len)
    if (_is_chinese_char(text[pick])) {
      ratio++
    }
  }

  return (ratio / sampleN) > 0.5
}

function getDensity(text) {
  return _is_chinese_text(text) ? getDensityCN(text) : getDensityEN(text)
}

function preprocessText(text) {
  return text
    .replace(/<p>/g, '\n<p>')
    .replace(/<\/p>/g, '</p>\n')
}

function escapeText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function unescapeText(unsafe) {
  return unsafe
   .replace(/&amp;/g, "&")
   .replace(/&lt;/g, "<")
   .replace(/&gt;/g, ">")
   .replace(/&quot;/g, '"')
   .replace(/&#039;/g, "'")
}

// [[start, end, token, freq]]
function getDensityEN(text) {
  let density = []
  // Match a word, then optional contractions (it's / it’s) and hyphenated parts.
  // The apostrophe variants are normalized before the dictionary lookup.
  const words = /[a-z0-9_]+(?:['‘’][a-z0-9_]+)*(?:-[a-z0-9_]+)*/gi
  for (const match of text.matchAll(words)) {
    const token = match[0]
    if (/^\d+$/.test(token)) continue
    const key = token.toLowerCase().replace(/[‘’]/g, "'")
    const freq = wmap.get(key)
    // Missing dictionary entries have unknown frequency, not very low frequency.
    if (freq === undefined) continue
    density.push([match.index, match.index + token.length - 1, token, freq])
  }
  return density
}

function getDensityCN(text) {
  let parent = fmap.root
  let density = []

  for (let i = 0; i < text.length; i++) {
    let found = false
    let skip = 0
    let sWord = ''
    let longest = []

    for (let j = i; j < text.length; j++) {

      if (!parent.c[text[j]]) {
        found = false
        skip = j - i
        parent = fmap.root
        // push the last(longest) match if exhausted
        if (longest.length > 0) {
          density.push(longest)
        }
        break;
      }

      sWord = sWord + text[j]
      if (parent.c[text[j]].e) {
        console.log('found', sWord, parent.c[text[j]].f)
        found = true
        // cache the longest match (freq is already stored as log2(freq))
        longest = [i, j, sWord, parent.c[text[j]].f]
        skip = j - i
        if (skip + 1 >= maxLen) {
          break
        } else {
          parent = parent.c[text[j]]
          continue
        }
      }
      parent = parent.c[text[j]]
    }

    if (skip >= 1) {
      i += skip - 1
    }

    if (!found) {
      continue
    }

  }

  return density
}

function renderContent(input, density, gray=5) {
  let output = ''
  let min = 1000, max = -1
  for (let i = 0; i < density.length; i++) {
    let val = density[i][3]
    if (val === -1) continue
    min = Math.min(val, min)
    max = Math.max(val, max)
  }
  let denom = max - min || 1
  let prev = 0
  let previousColor = null
  for (let i = 0; i < density.length; i++) {
    let [start, end, word, val] = density[i]
    if (val === -1) continue
    let grey = (denom - (val - min)) / denom / gray
    let color = `rgba(${highlightRgb},${grey})`
    let gap = input.slice(prev, start)
    // Blend across short spaces and mid-sentence punctuation, but stop at line breaks.
    if (previousColor && gap.length > 0 && gap.length <= 4 && /^[\t ,;:，、；：]+$/.test(gap)) {
      output += `<span class="gray-bridge" style="background:linear-gradient(to right,${previousColor},${color});">${escapeText(gap)}</span>`
    } else {
      output += escapeText(gap)
    }
    let background = previousColor && !gap
      ? `linear-gradient(to right,${previousColor},${color} 25%)`
      : color
    output += `<span class="gray-tag" style="background:${background};" data-start="${start}">` + escapeText(input.slice(start, end+1)) + `</span>`
    prev = end + 1
    previousColor = color
  }
  output += escapeText(input.slice(prev))
  // output += `\n ${min}, ${max}`
  return output
}

// =============== main ===============
let lang = 'en'
let activeDemo = lang
let demo = {
  en: `Against Interpretation

The earliest experience of art must have been that it was incantatory, magical; art was an instrument of ritual. (Cf. the paintings in the caves at Lascaux, Altamira, Niaux, La Pasiega, etc.) The earliest theory of art, that of the Greek philosophers, proposed that art was mimesis, imitation of reality.
It is at this point that the peculiar question of the value of art arose. For the mimetic theory, by its very terms, challenges art to justify itself.
Plato, who proposed the theory, seems to have done so in order to rule that the value of art is dubious. Since he considered ordinary material things as themselves mimetic objects, imitations of transcendent forms or structures, even the best painting of a bed would be only an “imitation of an imitation.” For Plato, art was not particularly useful (the painting of a bed is no good to sleep on nor, in the strict sense, true. And Aristotle’s arguments in defense of art do not really challenge Plato’s view that all art is an elaborate trompe l’oeil, and therefore a lie. But he does dispute Plato’s idea that art is useless. Lie or no, art has a certain value according to Aristotle because it is a form of therapy. Art is useful, after all, Aristotle counters, medicinally useful in that it arouses and purges dangerous emotions.
In Plato and Aristotle, the mimetic theory of art goes hand in hand with the assumption that art is always figurative. But advocates of the mimetic theory need not close their eyes to decorative and abstract art. The fallacy that art is necessarily a “realism” can be modified or scrapped without ever moving outside the problems delimited by the mimetic theory.
The fact is, all Western consciousness of and reflection upon art have remained within the confines staked out by the Greek theory of art as mimesis or representation. It is through this theory that art as such— above and beyond given works of art—becomes problematic, in need of defense. And it is the defense of art which gives birth to the odd vision by which something we have learned to call “form” is separated off from something we have learned to call “content,” and to the well-intentioned move which makes content essential and form accessory.
Even in modern times, when most artists and critics have discarded the theory of art as representation of an outer reality in favor of the theory of art as subjective expression, the main feature of the mimetic theory persists. Whether we conceive of the work of art on the model of a picture (art as a picture of reality) or on the model of a statement (art as the statement of the artist), content still comes first. The content may have changed. It may now be less figurative, less lucidly realistic. But it is still assumed that a work of art is its content. Or, as it’s usually put today, that a work of art by definition says something. (“What X is saying is…,” “What X is trying to say is…,” “What X said is…” etc., etc.)
2
None of us can ever retrieve that innocence before all theory when art knew no need to justify itself, when one did not ask of a work of art what it said because one knew (or thought one knew) what it did. From now to the end of consciousness, we are stuck with the task of defending art. We can only quarrel with one or another means of defense. Indeed, we have an obligation to overthrow any means of defending and justifying art which becomes particularly obtuse or onerous or insensitive to contemporary needs and practice.
This is the case, today, with the very idea of content itself. Whatever it may have been in the past, the idea of content is today mainly a hindrance, a nuisance, a subtle or not so subtle philistinism. Though the actual developments in many arts may seem to be leading us away from the idea that a work of art is primarily its content, the idea still exerts an extraordinary hegemony. I want to suggest that this is because the idea is now perpetuated in the guise of a certain way of encountering works of art thoroughly ingrained among most people who take any of the arts seriously. What the overemphasis on the idea of content entails is the perennial, never consummated project of interpretation. And, conversely, it is the habit of approaching works of art in order to interpret them that sustains the fancy that there really is such a thing as the content of a work of art.`,
cn: `依然在应付欧盟数据保护法案（GDPR）的公司可能需要面临更多的问题了——美国的数据保护法案很快就要出炉。

加州消费者隐私法案（CCPA）即将于明年 1 月生效，现在只有 3 个月不到的时间去准备了。此外，以纽约州为起点，更多的法案正在美国多个州陆续生效。

CCPA 法案和 GDPR 类似，不论公司的地理位置在哪里，只要公司服务的消费者群体有加州和纽约州居民，则公司必须遵守法律，否则会遭到罚款。

GDPR 在欧洲生效后，互联网行业已经被罚款了无数次。第一年，超过 90,000 的商业公司主动报告了数据漏洞，以便符合 GDPR 的要求。同时，还有超过 145000 起消费者投诉。

在 2019 年 1 月，谷歌向法国当局支付了 5000 万欧元的罚款，因为它在定向广告投放上没有说明清楚对个人数据的收集和使用问题。而更早之前，一家葡萄牙医院因其糟糕的病历记录管理支付了 40 万欧元。这家医院贪图方便，创建了 1000 个医生级别的管理账户。

这还不是全部，GDPR 在线执法追踪工具可以捕捉网上所有的违法行为，包括一个正在审核的，针对英国航空公司的 2.04 亿 欧元罚款，因为公司泄露了 50 万旅客的支付信息。

相比「史上最严」的 GDPR，CCPA 是什么？
CCPA，据其官网介绍，是一个隐私保护条例，用于保护个人数据，是美国加利福尼亚州出台的地方法律。这一法律其实是 2018 年通过的，帮助消费者在访问、删除和分享企业收集到的个人数据上赋予了新的权利。

具体而言，收集消费者数据的企业必须披露收集的信息、收集信息的商业目的、以及会共享这些信息的所有第三方组织和机构。而企业需依据消费者提出的正式要求删除相关信息，如果消费者有这样的需求。此外，消费者可选择出售他们的信息，而企业则不能随意改变价格或服务水平。对于允许收集其个人信息的消费者，企业可提供「财务激励」。

根据 CCPA 的规定，加州居民可以获得对个人数据相关的很多权利。主要包括：

1. 数据访问权

2. 数据删除权

3. 不被歧视的权利

4. 在产品页面挂出明显的「不出售个人信息」选项，并纰漏新的隐私政策

5. 未成年人和监护人授权

6. 私人诉讼权

除了数据隐私保护这一目的，CCPA 还希望帮助公众了解他们的什么数据会被收集，而且这些数据会被怎样出售或公开。

和 GDPR 类似，CCPA 要求任何和加州居民发生业务往来的公司都要遵守这一法律，不存在属地管辖的原则。这无疑会给很多非美国的海外企业带来影响。

对比GDPR

那么，CCPA 和 GDPR 有什么关系呢？

CCPA 和 GDPR 最大的不同在于，CCPA 在适用监管的标准上比 GDPR 更宽松，但是一旦满足被监管的标准，违法企业收到的惩罚更大。

二者具体有以下不同：

1. GDPR 没有对法案适用的企业进行规定，因此所有有业务的企业都会被监管。但是 CCPA 不会对年营业额在 2500 万美元以下、且不涉及的超过 50000 以上用户的数据处理的商业行为进行监管，即使已经发现了数据泄露。

2. 但是，一旦满足了上述条件且发生了数据泄露问题，CCPA 的处罚比 GDPR 要严厉得多。即使是无意中发生了泄露，CCPA 规定每位用户 100 到 750 美元，或者以泄露造成的实际损失计算罚款。因此对于一些公司而言，很可能罚款会使其直接破产。而 GDPR 的罚款上限是企业收入的 4%。

仅有 2％的企业做好了准备
根据 CCPA 的法律规定，无论企业在美国以何种方式经营业务或提供服务，加利福尼亚州和纽约州的强制性隐私保护法将保障消费者自身及客户的隐私权。

然而，值得关注的是，离 2020 年 1 月 1 日正式实施 CCPA 还有不到三个月的时间，那么美国企业是否已经做好相应准备了呢？

2019 年 8 月份，IAPP/OneTrust 主要对美国企业的员工（各种规模）进行了 CCPA 准备度（CCPA Readiness）调查，结果显示，74％的受访者认为他们的雇主应该遵守加州即将实施的隐私法，但遗憾的是，只有大约 2％的受访者认为他们的企业已经完全做好了应对 CCPA 的准备。

美国数据隐私保护法案来临，明年1月生效，现仅2%企业合规

IAPP/OneTrust 分别于 2019 年 4 月和 8 月进行了两次调查，调查问题是：你希望自己所在的企业什么时候可以完全遵守 CCPA？在 2019 年 4 月的调查中，企业现已或者可于 2020 年 1 月 1 日之前完全遵守 CCPA 的比例占 55％，而奇怪的是，在 8 月的调查中，这一比例却降到了 49％。这是否说明了企业对 CCPA 的态度呢？

所以，即使企业现在认为这些隐私法不适用于自身，但相关标准的应用是不可避免的。此外，虽然存在法律的不适用，但如果企业违反或损害了相关标准，也会追究它们的民事责任。无论如何，这些法律在美国和世界各地的不断推出，为法官处理企业与受影响客户之间的直接纠纷（未经法律检验）设定了一个标准。归根结底，保护客户的隐私有助于他们增加对企业的信任以及企业自身业务和品牌的发展，而这些的价值要远远高于企业因违反隐私法而要缴纳的罚款。

数据保护刻不容缓
随着大数据时代的不断发展，用户的隐私遭到侵犯甚至用于不当牟利的情况层出不穷，并且各国有关数据隐私的立法往往跟不上互联网的发展速度。所以，为了改变这种用户数据遭滥用和隐私遭侵犯的现象，世界各国在数据立法上不断地进行改善，从而予以企业更多的监管，使用户数据得到更多更全的保障。

以欧盟为例，欧盟早在 2016 年 4 月就提出了 GDPR，但并没有立即实施，而是给予了企业两年多的缓冲时间，最终于 2018 年 5 月 25 日正式实施，被称为「史上最严格的的用户个人数据保护法案」。GDPR 的处罚之严格令人咂舌，以违反个人数据的罚款额度为例，违法企业将最高面临其年营业额 4％的罚款，以目前最高者为准，即 2000 万欧元（约合人民币 1.56 亿）。

在个人数据保护的全球浪潮中，中国也无法置身事外。中国也在数据保护立法上持续做出努力。早在 2003 年，国务院信息化办公室就已经开始展开个人信息保护法立法研究工作，并于 2005 年形成专家意见稿；2009 年中华人民共和国刑法修正案（七）对窃取、出售或非法提供给他人的行为作出「情节严重的，处三年以下有期徒刑或拘役，并处或单处罚金」的规定，之后 2015 年的刑法修正案（九）又对非法获取公民个人信息的罪名做了补充；2017 年 12 月 29 日，全国信息安全标准化技术委员会正式发布《信息安全技术个人信息安全规范》，从信息权利保护的角度全面规定了公民个人信息的收集、保存、使用、委托处理、共享、转让、公开披露以及个人信息安全的处置等。`
}

let gray = Number(document.querySelector('#gray_range').value) / 10
let highlightRgb = '180,90,0'
let density = []
let text = null

function updateLegend() {
  const bar = document.querySelector('#legend-bar')
  if (!bar.children.length) {
    for (let i = 0; i < 8; i++) bar.appendChild(document.createElement('span'))
  }
  Array.from(bar.children).forEach((step, i) => {
    const opacity = (i / (bar.children.length - 1)) * 0.62
    step.style.background = `rgba(${highlightRgb},${opacity.toFixed(2)})`
  })
}

updateLegend()

function renderToggles(pairs) {
  let toggles = document.querySelector('.toggles')
  toggles.innerHTML = ""
  for (let k in pairs) {
    let tog = document.querySelector('.word-toggle').cloneNode(true)
    tog.querySelector('input').setAttribute('id', k)
    tog.querySelector('input').setAttribute('name', k)
    tog.querySelector('input').setAttribute('checked', true)
    tog.querySelector('label').setAttribute('for', k)
    tog.querySelector('label').textContent = pairs[k].join('/')
    tog.querySelector('input').addEventListener('click', function(e) {
      console.log(e.target.checked)
      let s = document.querySelector('#output_text').textContent
      if (e.target.checked) {
        let reg = new RegExp(k, 'g')
        s = s.replace(reg, pairs[k][1])
      } else {
        let reg = new RegExp(pairs[k][1], 'g')
        s = s.replace(reg, pairs[k][0])
      }
      document.querySelector('#output_text').textContent = s
    })
    toggles.appendChild(tog)
  }
}

const defaultChoices = [
  ['Hook', 'Gets the reader in the door: a surprising fact, question, or scene.', '#e63946'],
  ['Claim / topic sentence', 'States the point of the paragraph.', '#f77f00'],
  ['Thesis / nut graf', 'States the claim of the whole article and why it matters.', '#d4a000'],
  ['Support', 'Evidence, data, or quotes that prove a claim.', '#2a9d8f'],
  ['Example', 'Makes an abstract claim concrete.', '#52b788'],
  ['Elaboration', 'Unpacks or restates a claim in different words.', '#4d96ff'],
  ['Definition', 'Pins down the meaning of a term.', '#4361ee'],
  ['Analogy', 'Explains through a familiar comparison.', '#9b5de5'],
  ['Pivot', 'Turns the direction of the argument.', '#d65db1'],
  ['Transition / bridge', 'Connects one idea to the next.', '#8d99ae'],
  ['So-what / conclusion', 'Explains what the argument means or concludes.', '#a44a3f'],
  ['Others', 'Any other rhetorical role.', '#6c757d']
]
let choices = defaultChoices.map(([name, description, color]) => ({ name, description, color, enabled: true }))
let mode = 'word'
let sentenceResults = []
let semanticPresence = null
let originalWordCounts = []
let targetWordCounts = []
let segmentDrag = null
let rewrittenById = null
let rewriteVersion = 0
const analysisIntensity = { sentence: 65, semantic: 65 }
let renderVersion = 0
const output = document.querySelector('#output_text')
const status = document.querySelector('#analysis-status')
const roleMenu = document.querySelector('#role-menu')
const roleSelect = document.querySelector('#role-select')
const roleBlocks = document.querySelector('#role-blocks')
const segmentTooltip = document.querySelector('#segment-tooltip')
const rewriteButton = document.querySelector('#rewrite-button')
const rewriteStatus = document.querySelector('#rewrite-status')
let activeRoleIndex = null
const isGitHubPages = location.hostname.endsWith('.github.io')
if (isGitHubPages) document.querySelector('.url-input').hidden = true

async function bundledDemoResults(body) {
  if (!body.demoId || !window.JEV_DEMO_CACHE) return null
  const criteria = body.mode === 'semantic'
    ? body.choices.map(choice => [choice.name.trim(), choice.description.trim()])
    : null
  const input = JSON.stringify([1, 'typesafe/jev-1.13', body.demoId, body.mode, body.text, criteria])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return window.JEV_DEMO_CACHE[key]?.results || null
}

function setStatus(message, error = false) {
  status.textContent = message
  status.classList.toggle('error', error)
}

function renderWordIndex(source, entries) {
  document.querySelector('#index ul').innerHTML = ""
  const indexing = getIndexing(source, entries)
  for (let k in indexing) {
    let el = document.createElement('li')
    let occ = indexing[k]
    el.textContent = k

    for (let i = 0; i < occ.length; i++) {
      let occEl = document.createElement('span')
      occEl.addEventListener('click', (e) => {
        let targ = document.querySelector(`.gray-tag[data-start="${occ[i][0]}"]`)
        if (!targ) return
        targ.classList.add('highlight')
        setTimeout(e => {
          targ.classList.remove('highlight')
        }, 1000)
        targ.scrollIntoView()
      })
      occEl.textContent = `${i+1}`
      el.appendChild(occEl)
    }
    document.querySelector('#index ul').appendChild(el)
  }
}

function renderSentenceHighlights() {
  closeRoleMenu()
  let html = ''
  let last = 0
  const scores = mode === 'sentence'
    ? sentenceResults.map(item => Math.max(0, Math.min(4, Number(item.score)))).filter(Number.isFinite)
    : []
  const highlightedScores = scores.filter(score => score >= 1.5)
  const minScore = Math.min(...highlightedScores)
  const scoreSpread = Math.max(...highlightedScores) - minScore
  for (const [index, item] of sentenceResults.entries()) {
    if (item.start < last || item.end > text.length || item.end <= item.start) continue
    html += escapeText(text.slice(last, item.start))
    const sentence = escapeText(text.slice(item.start, item.end))
    const baseline = analysisIntensity[mode] / 100
    if (mode === 'sentence') {
      const score = Math.max(0, Math.min(4, Number(item.score)))
      const relativeScore = scoreSpread > 0.001 ? (score - minScore) / scoreSpread : (score - 1.5) / 2.5
      const alpha = score < 1.5 ? 0 : baseline * (0.12 + 0.88 * Math.pow(relativeScore, 1.6))
      const label = defaultImportance[Math.round(score)]
      html += `<span class="sentence-tag" style="background:rgba(180,90,0,${alpha.toFixed(3)})" title="${escapeText(label)} (${score.toFixed(2)})">${sentence}</span>`
    } else {
      const choice = choices.find(c => c.name.trim() === item.choice)
      if (choice && choice.enabled) {
        const probability = item.manuallyAssigned ? 1 : Math.max(0, Math.min(1, Number(item.probability)))
        const alpha = Math.round(baseline * probability * 255).toString(16).padStart(2, '0')
        const detail = item.manuallyAssigned ? 'manually assigned' : `${Math.round(probability * 100)}%`
        html += `<span class="sentence-tag semantic-tag" data-result-index="${index}" role="button" tabindex="0" style="background:${choice.color}${alpha}" title="${escapeText(choice.name)} (${detail}). Click to change role">${sentence}</span>`
      } else html += sentence
    }
    last = item.end
  }
  output.innerHTML = html + escapeText(text.slice(last))
  if (mode === 'semantic') {
    renderRoleBlocks()
    if (rewrittenById) renderRewrittenArticle()
  }
}

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
function countWords(sentence) {
  return Math.max(1, Array.from(wordSegmenter.segment(sentence)).filter(part => part.isWordLike).length)
}

function resetRewrite() {
  rewriteVersion++
  rewrittenById = null
  document.querySelector('#rewritten-section').hidden = true
  rewriteButton.disabled = false
  rewriteStatus.textContent = ''
  rewriteStatus.classList.remove('error')
}

function resetLengthTargets() {
  originalWordCounts = sentenceResults.map(item => countWords(text.slice(item.start, item.end)))
  targetWordCounts = [...originalWordCounts]
  resetRewrite()
}

function semanticGroups() {
  const groups = []
  sentenceResults.forEach((item, index) => {
    if (!groups.length || groups[groups.length - 1].role !== item.choice) groups.push({ role: item.choice, indices: [] })
    groups[groups.length - 1].indices.push(index)
  })
  return groups
}

function updateRewriteActions() {
  const adjusted = targetWordCounts.some((count, index) => count !== originalWordCounts[index])
  rewriteButton.hidden = !adjusted
  document.querySelector('#reset-lengths').hidden = !adjusted
}

function renderRoleBlocks() {
  const section = document.querySelector('#semantic-visualization')
  section.hidden = mode !== 'semantic' || !sentenceResults.length || targetWordCounts.length !== sentenceResults.length
  if (section.hidden) return
  const groups = semanticGroups()
  const availableWidth = Math.max(1, roleBlocks.clientWidth)
  const minimumWidth = Math.min(48, availableWidth / Math.max(...groups.map(group => group.indices.length)))
  const segmentWidth = (index, unit) => Math.max(minimumWidth, unit * Math.sqrt(targetWordCounts[index]))
  const groupWidth = (group, unit) => group.indices.reduce((sum, index) => sum + segmentWidth(index, unit), 0)
  let lowerUnit = 0
  let upperUnit = 24
  for (let attempt = 0; attempt < 24; attempt++) {
    const unit = (lowerUnit + upperUnit) / 2
    if (groups.every(group => groupWidth(group, unit) <= availableWidth)) lowerUnit = unit
    else upperUnit = unit
  }
  roleBlocks.replaceChildren()
  groups.forEach(group => {
    const row = document.createElement('div')
    row.className = 'role-block-row'
    const bar = document.createElement('div')
    bar.className = 'role-block-bar'
    bar.style.width = `${Math.min(availableWidth, groupWidth(group, lowerUnit))}px`
    group.indices.forEach(index => {
      const item = sentenceResults[index]
      const choice = choices.find(candidate => candidate.name.trim() === item.choice)
      const probability = item.manuallyAssigned ? 1 : Math.max(0, Math.min(1, Number(item.probability)))
      const segment = document.createElement('div')
      segment.className = 'role-segment'
      segment.dataset.resultIndex = String(index)
      segment.classList.toggle('is-adjusted', targetWordCounts[index] !== originalWordCounts[index])
      segment.style.flex = `0 0 ${segmentWidth(index, lowerUnit)}px`
      segment.style.backgroundColor = choice ? `${choice.color}${Math.round((0.25 + 0.75 * probability) * 255).toString(16).padStart(2, '0')}` : '#6c757d'
      const confidence = item.manuallyAssigned ? 'manually assigned' : `${Math.round(probability * 100)}% confidence`
      const count = document.createElement('span')
      count.className = 'role-segment-count'
      count.textContent = targetWordCounts[index] === originalWordCounts[index]
        ? String(originalWordCounts[index])
        : `${targetWordCounts[index]}/${originalWordCounts[index]}`
      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = 'role-segment-handle'
      handle.setAttribute('aria-label', `Resize sentence ${index + 1}, ${item.choice}, ${targetWordCounts[index]} target words of ${originalWordCounts[index]} original words. Drag or use arrow keys to adjust; Home sets zero.`)
      handle.addEventListener('pointerdown', event => startSegmentDrag(event, index, segment))
      handle.addEventListener('keydown', event => {
        const step = event.shiftKey ? 10 : 1
        const next = event.key === 'ArrowLeft' ? targetWordCounts[index] - step
          : event.key === 'ArrowRight' ? targetWordCounts[index] + step
            : event.key === 'Home' ? 0 : null
        if (next === null) return
        event.preventDefault()
        setSentenceTarget(index, Math.max(0, Math.min(5000, next)))
        roleBlocks.querySelector(`.role-segment[data-result-index="${index}"] .role-segment-handle`)?.focus()
      })
      segment.append(count, handle)
      bar.append(segment)
    })
    row.append(bar)
    roleBlocks.append(row)
  })
  updateRewriteActions()
}

function setSentenceTarget(index, value) {
  if (!Number.isInteger(value) || value < 0 || value > 5000) return
  if (targetWordCounts[index] === value) return
  targetWordCounts[index] = value
  resetRewrite()
  renderRoleBlocks()
}

function hideSegmentTooltip() {
  segmentTooltip.hidden = true
}

function startSegmentDrag(event, index, segment) {
  if (event.button !== 0) return
  event.preventDefault()
  hideSegmentTooltip()
  stopSegmentDrag()
  const startWords = targetWordCounts[index]
  const width = segment.getBoundingClientRect().width
  const pixelsPerWord = startWords === 0 ? 8 : Math.min(10, Math.max(2, width / startWords), Math.max(1, (event.clientX - 8) / startWords))
  segmentDrag = { pointerId: event.pointerId, index, startX: event.clientX, startWords, pixelsPerWord }
  document.body.classList.add('is-resizing-role-segment')
  window.addEventListener('pointermove', moveSegmentDrag)
  window.addEventListener('pointerup', stopSegmentDrag)
  window.addEventListener('pointercancel', stopSegmentDrag)
}

function moveSegmentDrag(event) {
  if (!segmentDrag || event.pointerId !== segmentDrag.pointerId) return
  const { index, startX, startWords, pixelsPerWord } = segmentDrag
  const next = Math.max(0, Math.min(5000, startWords + Math.round((event.clientX - startX) / pixelsPerWord)))
  setSentenceTarget(index, next)
}

function stopSegmentDrag(event) {
  if (event && segmentDrag && event.pointerId !== segmentDrag.pointerId) return
  segmentDrag = null
  document.body.classList.remove('is-resizing-role-segment')
  window.removeEventListener('pointermove', moveSegmentDrag)
  window.removeEventListener('pointerup', stopSegmentDrag)
  window.removeEventListener('pointercancel', stopSegmentDrag)
}

function renderRewrittenArticle() {
  if (!rewrittenById) return
  const host = document.querySelector('#rewritten-text')
  let html = ''
  let last = 0
  let pendingGap = ''
  let removedSinceKept = false
  let keptCount = 0
  for (const [index, item] of sentenceResults.entries()) {
    const gap = text.slice(last, item.start)
    if (targetWordCounts[index] === 0) {
      pendingGap += gap
      removedSinceKept = true
      last = item.end
      continue
    }
    let separator = pendingGap + gap
    if (removedSinceKept) separator = keptCount === 0 ? '' : /\n\s*\n/.test(separator) ? '\n\n' : /\n/.test(separator) ? '\n' : /\s/.test(separator) ? ' ' : ''
    html += escapeText(separator)
    const sentence = escapeText(rewrittenById[`s${index}`] ?? text.slice(item.start, item.end))
    const choice = choices.find(candidate => candidate.name.trim() === item.choice)
    if (choice?.enabled) {
      const probability = item.manuallyAssigned ? 1 : Math.max(0, Math.min(1, Number(item.probability)))
      const alpha = Math.round(analysisIntensity.semantic / 100 * probability * 255).toString(16).padStart(2, '0')
      html += `<span class="sentence-tag" style="background:${choice.color}${alpha}" title="${escapeText(item.choice)}">${sentence}</span>`
    } else html += sentence
    last = item.end
    pendingGap = ''
    removedSinceKept = false
    keptCount++
  }
  host.innerHTML = keptCount ? html + (removedSinceKept ? '' : escapeText(text.slice(last))) : '<p class="empty-article">All sentences were removed.</p>'
  const counts = new Map()
  sentenceResults.forEach((item, index) => {
    if (targetWordCounts[index] > 0) counts.set(item.choice, (counts.get(item.choice) || 0) + 1)
  })
  const list = document.querySelector('#rewritten-role-list')
  list.replaceChildren()
  choices.forEach(choice => {
    const row = document.createElement('label')
    row.className = 'rewritten-role-row'
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = choice.enabled
    checkbox.disabled = !counts.has(choice.name.trim())
    checkbox.setAttribute('aria-label', `Show ${choice.name} in rewritten article`)
    checkbox.addEventListener('change', () => {
      choice.enabled = checkbox.checked
      syncChoiceAvailability()
      renderSentenceHighlights()
    })
    const swatch = document.createElement('span')
    swatch.className = 'rewritten-role-swatch'
    swatch.style.backgroundColor = choice.color
    const name = document.createElement('span')
    name.textContent = choice.name
    const count = document.createElement('span')
    count.className = 'rewritten-role-count'
    count.textContent = String(counts.get(choice.name.trim()) || 0)
    row.append(checkbox, swatch, name, count)
    list.append(row)
  })
}

function closeRoleMenu(restoreFocus = false) {
  const index = activeRoleIndex
  roleMenu.hidden = true
  activeRoleIndex = null
  if (restoreFocus && index !== null) output.querySelector(`.semantic-tag[data-result-index="${index}"]`)?.focus()
}

function openRoleMenu(tag) {
  const index = Number(tag.dataset.resultIndex)
  const item = sentenceResults[index]
  if (mode !== 'semantic' || !item) return
  if (activeRoleIndex === index) { closeRoleMenu(); return }
  roleSelect.replaceChildren()
  choices.forEach((choice, choiceIndex) => {
    if (!choice.name.trim()) return
    const option = new Option(choice.name.trim(), String(choiceIndex))
    option.selected = choice.name.trim() === item.choice
    roleSelect.add(option)
  })
  activeRoleIndex = index
  roleMenu.hidden = false
  const rect = tag.getBoundingClientRect()
  const menuWidth = roleMenu.offsetWidth
  const menuHeight = roleMenu.offsetHeight
  roleMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8))}px`
  const below = rect.bottom + 6
  const above = rect.top - menuHeight - 6
  const top = below + menuHeight <= window.innerHeight - 8 ? below : above >= 8 ? above : Math.max(8, window.innerHeight - menuHeight - 8)
  roleMenu.style.top = `${top}px`
  roleSelect.focus()
}

output.addEventListener('click', event => {
  const tag = event.target.closest('.semantic-tag')
  if (tag && output.contains(tag)) openRoleMenu(tag)
})
output.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const tag = event.target.closest('.semantic-tag')
  if (!tag || !output.contains(tag)) return
  event.preventDefault()
  openRoleMenu(tag)
})
roleSelect.addEventListener('change', () => {
  if (activeRoleIndex === null) return
  const index = activeRoleIndex
  const choice = choices[Number(roleSelect.value)]
  if (!choice) return
  sentenceResults[index].choice = choice.name.trim()
  sentenceResults[index].manuallyAssigned = true
  choice.enabled = true
  resetRewrite()
  semanticPresence = new Set(sentenceResults.map(item => item.choice))
  syncChoiceAvailability()
  renderSentenceHighlights()
  output.querySelector(`.semantic-tag[data-result-index="${index}"]`)?.focus()
})
document.addEventListener('pointerdown', event => {
  if (!roleMenu.hidden && !roleMenu.contains(event.target) && !output.contains(event.target.closest('.semantic-tag'))) closeRoleMenu()
})
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !roleMenu.hidden) { event.preventDefault(); closeRoleMenu(true) }
})
output.addEventListener('scroll', () => closeRoleMenu())
window.addEventListener('scroll', () => closeRoleMenu())

roleBlocks.addEventListener('pointermove', event => {
  if (segmentDrag) return
  const segment = event.target.closest('.role-segment')
  if (!segment || !roleBlocks.contains(segment)) { hideSegmentTooltip(); return }
  const index = Number(segment.dataset.resultIndex)
  const item = sentenceResults[index]
  if (!item) return
  document.querySelector('#segment-tooltip-role').textContent = `${item.choice} · Sentence ${index + 1}`
  document.querySelector('#segment-tooltip-text').textContent = text.slice(item.start, item.end)
  segmentTooltip.hidden = false
  segmentTooltip.style.left = `${Math.max(8, Math.min(event.clientX + 12, innerWidth - segmentTooltip.offsetWidth - 8))}px`
  segmentTooltip.style.top = `${Math.max(8, Math.min(event.clientY + 12, innerHeight - segmentTooltip.offsetHeight - 8))}px`
})
roleBlocks.addEventListener('pointerleave', hideSegmentTooltip)
window.addEventListener('scroll', hideSegmentTooltip, true)
window.addEventListener('resize', renderRoleBlocks)
document.querySelector('#reset-lengths').addEventListener('click', () => {
  stopSegmentDrag()
  hideSegmentTooltip()
  targetWordCounts = [...originalWordCounts]
  resetRewrite()
  renderRoleBlocks()
})
rewriteButton.addEventListener('click', async () => {
  const edits = sentenceResults.flatMap((item, index) => targetWordCounts[index] === originalWordCounts[index] ? [] : [{
    id: `s${index}`, start: item.start, end: item.end, role: item.choice, targetWords: targetWordCounts[index]
  }])
  if (!edits.length) return
  const removedCount = edits.filter(edit => edit.targetWords === 0).length
  const rewriteCount = edits.length - removedCount
  const version = ++rewriteVersion
  rewriteButton.disabled = true
  rewriteStatus.classList.remove('error')
  rewriteStatus.textContent = rewriteCount ? `Rewriting ${rewriteCount} sentence${rewriteCount === 1 ? '' : 's'}…` : `Removing ${removedCount} sentence${removedCount === 1 ? '' : 's'}…`
  try {
    let data = { rewrites: [] }
    if (rewriteCount) {
      if (isGitHubPages) throw new Error('Rewriting requires the local Node server with OPENROUTER_API_KEY.')
      const response = await fetch('./api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, edits })
      })
      data = await response.json().catch(() => ({ error: 'Rewrite response was not valid JSON.' }))
      if (!response.ok) throw new Error(data.error || `Rewrite failed (${response.status})`)
    }
    if (version !== rewriteVersion) return
    rewrittenById = Object.fromEntries(data.rewrites.map(item => [item.id, item.text]))
    renderRewrittenArticle()
    document.querySelector('#rewritten-section').hidden = false
    rewriteStatus.textContent = [
      rewriteCount && `${rewriteCount} sentence${rewriteCount === 1 ? '' : 's'} rewritten`,
      removedCount && `${removedCount} sentence${removedCount === 1 ? '' : 's'} removed`
    ].filter(Boolean).join('; ') + '.'
  } catch (error) {
    if (version !== rewriteVersion) return
    rewriteStatus.textContent = error.message
    rewriteStatus.classList.add('error')
  } finally {
    if (version === rewriteVersion) rewriteButton.disabled = false
  }
})

const defaultImportance = ['not important', 'somewhat important', 'important', 'very important', 'most important']

async function renderCurrent(version) {
  const currentText = text
  const currentMode = mode
  if (!currentText.trim()) {
    output.textContent = ''
    sentenceResults = []
    document.querySelector('#semantic-visualization').hidden = true
    setStatus('')
    return
  }
  output.classList.add('is-loading')
  setStatus(currentMode === 'word' ? 'Reading word frequencies…' : 'Analyzing sentences with Jev…')
  try {
    if (currentMode === 'word') {
      await loadFreq(currentText)
      const entries = getDensity(currentText)
      if (version !== renderVersion) return
      density = entries
      output.innerHTML = renderContent(currentText, density, gray)
      renderWordIndex(currentText, density)
      setStatus('')
    } else {
      const isDefaultSemanticChoices = choices.length === defaultChoices.length &&
        choices.every((choice, i) => choice.name === defaultChoices[i][0] && choice.description === defaultChoices[i][1])
      const demoId = activeDemo && (currentMode === 'sentence' || isDefaultSemanticChoices) ? activeDemo : undefined
      const body = { text: currentText, mode: currentMode, demoId,
        choices: currentMode === 'semantic' ? choices.map(({ name, description }) => ({ name, description })) : undefined }
      let data
      if (isGitHubPages) {
        const results = await bundledDemoResults(body)
        if (!results) throw new Error('Jev results on GitHub Pages are available for the built-in demos with default roles. Run npm start to analyze custom text or roles.')
        data = { results, cached: true }
      } else {
        const response = await fetch('./api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        data = await response.json().catch(() => ({ error: 'Jev modes require the local Node server. Run npm start.' }))
        if (!response.ok) throw new Error(data.error || `Analysis failed (${response.status})`)
      }
      if (version !== renderVersion) return
      sentenceResults = data.results.map(item => ({ ...item }))
      if (currentMode === 'semantic') {
        semanticPresence = new Set(sentenceResults.map(item => item.choice))
        syncChoiceAvailability()
        resetLengthTargets()
      }
      renderSentenceHighlights()
      setStatus(`${sentenceResults.length} sentences analyzed with Jev${data.cached ? ' (cached)' : ''}.`)
    }
  } catch (error) {
    if (version !== renderVersion) return
    output.textContent = currentText
    document.querySelector('#semantic-visualization').hidden = true
    setStatus(error.message, true)
  } finally {
    if (version === renderVersion) output.classList.remove('is-loading')
  }
}

const debouncedRender = debounce(version => renderCurrent(version), 650)
function scheduleRender() {
  closeRoleMenu()
  stopSegmentDrag()
  hideSegmentTooltip()
  resetRewrite()
  document.querySelector('#semantic-visualization').hidden = true
  renderVersion++
  const version = renderVersion
  debouncedRender(version)
}

function updateMode() {
  mode = document.querySelector('#mode').value
  sentenceResults = []
  if (mode === 'semantic') {
    semanticPresence = null
    syncChoiceAvailability()
  }
  output.textContent = text
  document.querySelectorAll('.word-options').forEach(el => { el.hidden = mode !== 'word' })
  document.querySelector('.analysis-options').hidden = mode === 'word'
  if (mode !== 'word') {
    document.querySelector('#analysis_intensity').value = analysisIntensity[mode]
    document.querySelector('#analysis_intensity_value').textContent = `${analysisIntensity[mode]}%`
  }
  document.querySelector('#semantic-panel').hidden = mode !== 'semantic'
  document.querySelector('.main').classList.toggle('semantic-layout', mode === 'semantic')
  document.querySelector('#index').hidden = mode !== 'word'
  document.querySelector('.page-header p').textContent = mode === 'word'
    ? 'Rare and uncommon words are highlighted — the darker the shade, the less frequent the word.'
    : mode === 'sentence'
      ? 'Important sentences stand out; lower-importance sentences have little or no highlight.'
      : 'Jev classifies each sentence by its role in the article.'
  scheduleRender()
}

function renderChoiceEditor() {
  const host = document.querySelector('#semantic-choices')
  host.replaceChildren()
  choices.forEach((choice, index) => {
    const row = document.createElement('div')
    row.className = 'semantic-row'
    const enabled = document.createElement('input')
    enabled.type = 'checkbox'
    enabled.checked = choice.enabled
    enabled.setAttribute('aria-label', `Show ${choice.name} highlights`)
    enabled.addEventListener('change', () => { choice.enabled = enabled.checked; if (mode === 'semantic' && sentenceResults.length) renderSentenceHighlights() })
    const color = document.createElement('input')
    color.type = 'color'
    color.value = choice.color
    color.setAttribute('aria-label', `${choice.name} highlight color`)
    color.addEventListener('input', () => { choice.color = color.value; if (mode === 'semantic' && sentenceResults.length) renderSentenceHighlights() })
    const name = document.createElement('input')
    name.type = 'text'
    name.value = choice.name
    name.maxLength = 80
    name.placeholder = 'Role name'
    name.setAttribute('aria-label', `Role ${index + 1} name`)
    name.addEventListener('input', () => { choice.name = name.value; semanticPresence = null; syncChoiceAvailability(); scheduleRender() })
    const description = document.createElement('input')
    description.type = 'text'
    description.className = 'choice-description'
    description.value = choice.description
    description.maxLength = 300
    description.placeholder = 'What this role means'
    description.setAttribute('aria-label', `${choice.name} description`)
    description.id = `semantic-description-${index}`
    description.hidden = !choice.expanded
    description.addEventListener('input', () => { choice.description = description.value; scheduleRender() })
    const expand = document.createElement('button')
    expand.type = 'button'
    expand.textContent = choice.expanded ? '▾' : '▸'
    expand.title = `${choice.expanded ? 'Hide' : 'Show'} ${choice.name} description`
    expand.setAttribute('aria-label', expand.title)
    expand.setAttribute('aria-controls', description.id)
    expand.setAttribute('aria-expanded', String(Boolean(choice.expanded)))
    expand.addEventListener('click', () => {
      choice.expanded = !choice.expanded
      description.hidden = !choice.expanded
      expand.textContent = choice.expanded ? '▾' : '▸'
      expand.title = `${choice.expanded ? 'Hide' : 'Show'} ${choice.name} description`
      expand.setAttribute('aria-label', expand.title)
      expand.setAttribute('aria-expanded', String(choice.expanded))
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = '×'
    remove.title = `Remove ${choice.name}`
    remove.setAttribute('aria-label', remove.title)
    remove.disabled = choices.length <= 2
    remove.addEventListener('click', () => { choices.splice(index, 1); semanticPresence = null; renderChoiceEditor(); scheduleRender() })
    row.append(enabled, color, name, expand, remove, description)
    host.append(row)
  })
  document.querySelector('#add-choice').disabled = choices.length >= 12
  syncChoiceAvailability()
}

function syncChoiceAvailability() {
  document.querySelectorAll('#semantic-choices .semantic-row').forEach((row, index) => {
    const choice = choices[index]
    const present = semanticPresence === null || semanticPresence.has(choice.name.trim())
    const checkbox = row.querySelector('input[type="checkbox"]')
    checkbox.checked = present && choice.enabled
    checkbox.disabled = !present
    checkbox.title = present ? '' : 'No sentences assigned to this role in the current article'
    row.classList.toggle('role-absent', !present)
  })
}

function setAllSemanticRoles(enabled) {
  choices.forEach(choice => { choice.enabled = enabled })
  syncChoiceAvailability()
  if (mode === 'semantic' && sentenceResults.length) renderSentenceHighlights()
}

document.querySelector('#select-all-roles').addEventListener('click', () => setAllSemanticRoles(true))
document.querySelector('#unselect-all-roles').addEventListener('click', () => setAllSemanticRoles(false))

document.querySelector('#add-choice').addEventListener('click', () => {
  if (choices.length >= 12) return
  choices.push({ name: `New role ${choices.length + 1}`, description: '', color: '#8b5cf6', enabled: true })
  semanticPresence = null
  renderChoiceEditor()
  scheduleRender()
})

renderChoiceEditor()
document.querySelector('#mode').addEventListener('change', updateMode)
document.querySelector('#analysis_intensity').addEventListener('input', function(e) {
  if (mode === 'word') return
  analysisIntensity[mode] = Number(e.target.value)
  document.querySelector('#analysis_intensity_value').textContent = `${analysisIntensity[mode]}%`
  if (sentenceResults.length) renderSentenceHighlights()
})
document.querySelector('#input_text').value = demo[lang]
text = demo[lang]
scheduleRender()

document.querySelector('#input_text').addEventListener('input', function(e) {
  text = e.target.value
  activeDemo = null
  semanticPresence = null
  syncChoiceAvailability()
  scheduleRender()
})

document.querySelector('#lang').addEventListener('change', function(e) {
  lang = e.target.value
  activeDemo = lang
  text = demo[lang]
  semanticPresence = null
  syncChoiceAvailability()
  document.querySelector('#input_text').value = text
  scheduleRender()
})

document.querySelector('#gray_range').addEventListener('input', function(e) {
  gray = Number(e.target.value) / 10
  if (mode === 'word') output.innerHTML = renderContent(text, density, gray)
})

document.querySelector('#highlight_color').addEventListener('input', function(e) {
  const hex = e.target.value
  highlightRgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')
  updateLegend()
  if (mode === 'word') output.innerHTML = renderContent(text, density, gray)
})

function startLoading() {
  const btn = document.querySelector('#load')
  btn.textContent = 'Loading...'
  btn.disabled = true
}

function endLoading() {
  const btn = document.querySelector('#load')
  btn.textContent = 'Load'
  btn.disabled = false
}

document.querySelector('#load').addEventListener('click', async function() {
  try {
    const uri = document.querySelector('#url').value
    const data = await loadPage(uri)
    const raw = data.content
    const temp = document.createElement('div')
    temp.innerHTML = preprocessText(raw)
    text = temp.textContent
    activeDemo = null
    semanticPresence = null
    syncChoiceAvailability()
    document.querySelector('#input_text').value = text
    scheduleRender()
  } catch (error) {
    setStatus(`Could not load URL: ${error.message}`, true)
  } finally {
    endLoading()
  }
})
