// trie map for chinese
let fmap = {}

// hash map for english
let wmap = {}

// maxlen for chinese
let maxLen = -1

async function loadFreq(text) {
  let is_cn = _is_chinese_char(text)
  if ( is_cn && Object.keys(fmap).length === 0) {
    const response = await fetch('./freq.txt')
    const text_1 = await response.text()
    text_1.split('\n').map(line => addFreq(line.split(' ')))
  }
  if (!is_cn && Object.keys(wmap).length === 0) {
    const response_1 = await fetch('./enwiki-20190320-words-frequency-fmap.txt')
    const text_2 = await response_1.text()
    text_2.split('\n').map(line_1 => addFreqEN(line_1.split(' ')))
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
  const response = await fetch(`https://api.mindynode.com/api/parser/${encodeURIComponent(url)}`)
  return await response.json()
}

async function loadLMDensity(text, isCN=false) {
  const response = await fetch(`https://tinysaas.mindynode.com/api/attention`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({text: text, is_cn: isCN})
  })
  const res = await response.json()
  return res.map(({ weight, words, positions }) => positions.map(([start, end]) => [start, end, words, weight])).flat()
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

function addFreqEN(pair) {
  let [word, freq] = pair
  wmap[word] = freq
}

function addFreq(pair) {
  let [word, freq] = pair
  let parent = fmap
  maxLen = Math.max(word.length, maxLen)

  for (let i = 0; i < word.length; i++) {
    if (!parent[word[i]]) parent[word[i]] = {}
    parent = parent[word[i]]
    // parent.isEnd = false
  }
  parent.val = freq
  parent.isEnd = true
}

async function getDensity(text, useLM=false) {
  const isCN = _is_chinese_text(text);
  if (useLM) {
    return await loadLMDensity(text, isCN)
  } else {
    return _is_chinese_text(text) ? getDensityCN(text) : getDensityEN(text);
  }
}

function preprocessText(text) {
  return text
    .replace(/<p>/g, '\n<p>')
    .replace(/<\/p>/g, '</p>\n')
}

function escapeText(text) {
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&/g, '&amp;')
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
  for (let i = 0; i < text.length;) {
    let char = text[i]

    if (['"', '“', '”', ',', '.'].includes(char)) {
      i++
      continue
    }

    let end = text.slice(i, text.length).search(/[\s?“”,."]/)
    let skip = end + 1

    if (char.search(/\s/) == -1) {
      // remove prefix, suffix puncs
      let token = text.slice(i, end == -1 ? text.length : i+end)
      let matches = token.match(/[\w-'’]+/)
      if (!matches) {
        console.log(`error in matching token, ignored: ${token}, ${i} - ${i+end}`)
      } else {
        // add to density
        let freq = wmap[matches[0].toLowerCase()] || -1
        density.push([i, i+end-1, token, parseInt(freq)])
      }

      // skip to next
      if (end == -1) break;
      i += skip
    } else {
      i++
    }
  }
  return density
}

function getDensityCN(text) {
  let parent = fmap
  let density = []

  for (let i = 0; i < text.length; i++) {
    let found = false
    let skip = 0
    let sWord = ''
    let longest = []

    for (let j = i; j < text.length; j++) {

      if (!parent[text[j]]) {
        found = false
        skip = j - i
        parent = fmap
        // push the last(longest) match if exhausted
        if (longest.length > 0) {
          density.push(longest)
        }
        break;
      }

      sWord = sWord + text[j]
      if (parent[text[j]].isEnd) {
        found = true
        // cache the longest match
        longest = [i, j, sWord, Math.log2(parseInt(parent[text[j]].val))]
        skip = j - i
        if (skip + 1 >= maxLen) {
          break
        } else {
          parent = parent[text[j]]
          continue
        }
      }
      parent = parent[text[j]]
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
    min = Math.min(val, min)
    max = Math.max(val, max)
  }
  let denom = max - min
  let prev = 0
  for (let i = 0; i < density.length; i++) {
    let [start, end, word, val] = density[i]
    let grey = (denom - (val - min)) / denom / gray
    output += input.slice(prev, start)
    output += `<span class="gray-tag" style="background: rgba(0,0,0,${grey});" data-start="${start}">` + input.slice(start, end+1) + `</span>`
    prev = end + 1
  }
  // output += `\n ${min}, ${max}`
  return output
}

// =============== main ===============
let lang = 'en'
let use_lm = false;
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

let gray = 6
let density = []
let text = null

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

let renderMain = debounce(async function(text) {
  density = await getDensity(text, use_lm)

  document.querySelector('#output_text').innerHTML = renderContent(text, density, gray)

  document.querySelector('#index ul').innerHTML = ""
  const indexing = getIndexing(text, density)
  for (let k in indexing) {
    let el = document.createElement('li')
    let occ = indexing[k]
    el.textContent = k

    for (let i = 0; i < occ.length; i++) {
      let occEl = document.createElement('span')
      occEl.addEventListener('click', (e) => {
        let targ = document.querySelector(`.gray-tag[data-start="${occ[i][0]}"]`)
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

}, 500)

document.querySelector('#input_text').value = demo[lang]
text = demo[lang]

loadFreq(text).then(_ => {
  renderMain(demo[lang])
})

document.querySelector('#input_text').addEventListener('keyup', function(e) {
  text = e.target.value
  let temp = document.createElement('div')
  temp.innerHTML = preprocessText(text)
  text = escapeText(temp.textContent)

  loadFreq(text).then(_ => {
    renderMain(text)
  })
})

document.querySelector('#lang').addEventListener('change', function(e) {
  lang = e.target.value
  document.querySelector('#input_text').value = demo[lang]
  text = demo[lang]
  loadFreq(text).then(_ => {
    renderMain(text)
  })
})

document.querySelector('#gray_range').addEventListener('change', function(e) {
  let gray = parseFloat(e.target.value/10)
  let html = renderContent(text, density, gray)
  document.querySelector('#output_text').innerHTML = html
})

document.querySelector('#use_lm').addEventListener('change', function(e) {
  use_lm = e.target.checked
  renderMain(text)
})

document.querySelector('#load').addEventListener('click', function(e) {
  let uri = document.querySelector('#url').value
  loadPage(uri)
    .then(data => {
      text = data['content']
      document.querySelector('#input_text').value = text
      let temp = document.createElement('div')
      temp.innerHTML = preprocessText(text)
      text = escapeText(temp.textContent)

      renderMain(text)
    })
    .catch(err => {
      document.querySelector('#output_text').innerHTML = `<h6>Invalid URL: ${err}</h6>`
    })
})
