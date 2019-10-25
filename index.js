// trie map for chinese
let fmap = {}

// hash map for english
let wmap = {}

// maxlen for chinese
let maxLen = -1

function loadFreq() {
  return fetch('./freq.txt')
  .then(response => response.text())
  .then(text => {
    text.split('\n').map(line => addFreq(line.split(' ')))
  })
  .then(() => {
    return fetch('./enwiki-20190320-words-frequency-fmap.txt')
  })
  .then(response => response.text())
  .then(text => {
    text.split('\n').map(line => addFreqEN(line.split(' ')))
  })
}

function loadPage(url) {
  return fetch(`https://api.mindynode.com/api/entity/${encodeURIComponent(url)}`)
  .then(response => response.json())
  .then(data => {
    return data['objects'][0]
  })
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

function getDensity(text, cb) {
  return _is_chinese_text(text) ? getDensityCN(text, cb) : getDensityEN(text, cb);
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

function getDensityEN(text, cb) {
  let density = []
  for (let i = 0; i < text.length;) {
    let char = text[i]
    let end = text.slice(i, text.length).search(/\s/)
    let skip = end + 1

    if (char.search(/\s/) == -1) {
      // remove prefix, suffix puncs
      let token = text.slice(i, end == -1 ? text.length : i+end)
      let matches = token.match(/[\w-]+/)
      if (!matches) {
        console.log(`error in matching token: ${token}, ${i} - ${i+end}`)
      } else {
        // add to density
        let freq = wmap[matches[0].toLowerCase()] || 10
        density.push([i, i+end-1, token, freq])
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

function getDensityCN(s, cb) {
  let parent = fmap
  let density = []
  
  for (let i = 0; i < s.length; i++) {
    let found = false
    let skip = 0
    let sWord = ''
    let longest = []

    for (let j = i; j < s.length; j++) {

      if (!parent[s[j]]) {
        found = false
        skip = j - i
        parent = fmap
        // push the last(longest) match if exhausted
        if (longest.length > 0) {
          density.push(longest)
        }
        break;
      }

      sWord = sWord + s[j]
      if (parent[s[j]].isEnd) {
        found = true
        // cache the longest match
        longest = [i, j, sWord, Math.log2(parseInt(parent[s[j]].val))]
        skip = j - i
        if (skip + 1 >= maxLen) {
          break
        } else {
          parent = parent[s[j]]
          continue
        }
      }
      parent = parent[s[j]]
    }

    if (skip >= 1) {
      i += skip - 1
    }

    if (!found) {
      continue
    }

  }

  if(typeof cb === 'function'){
    cb(null, s)
  }

  return density
}

function render(input, density, gray=5) {
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
    output += `<span style="display: inline-block; background: rgba(0,0,0,${grey}); box-shadow: inset 0px 0px 8px 3px rgb(255, 255, 255);">` + input.slice(start, end+1) + `</span>`
    prev = end + 1
  }
  // output += `\n ${min}, ${max}`
  return output
}

