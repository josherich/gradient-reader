const readline = require('readline')
const fs = require('fs')

const filename = '../enwiki-20190320-words-frequency.txt'
let trie = {}
let fmap = {}

async function bucket() {
  const fileStream = fs.createReadStream(filename)
  const lines = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let output = ''
  let dmap = trie

  for await (const line of lines) {
    if (line.length == 0) {
      continue
    }
    let [word, freq] = line.split(' ')
    let logf = Math.floor(Math.log2(freq))
    
    if (logf < 5) continue

    output += `${word} ${logf}\n`
  }

  const freqMap = Buffer.from(output, 'utf-8')
  fs.writeFileSync(`../enwiki-20190320-words-frequency-fmap.txt`, freqMap)
}

bucket()