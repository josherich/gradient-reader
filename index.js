let map = {}
let fmap = {}

let pairs = {}
let polyphone = false
let anchor = ''

let maxLen = -1

function loadFreq() {
  return fetch('./freq.txt')
  .then(response => response.text())
  .then(text => {
    text.split('\n').map(line => addFreq(line.split(' ')))
  })
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

function getDensity(s, cb) {
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

