const fs = require('fs');
// 1. Trie
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
  serialize() {
    const dfs = (node) => {
        let result = '';
        for (const [char, child] of Object.entries(node.c)) {
            result += char + dfs(child);
        }
        if (node.e) result += ('*'+node.f); // Mark end of a word
        return result ? `{${result}}` : ''; // Wrap children in {}
    };
    return dfs(this.root);
  }
  static deserialize(serialized) {
    let index = 0;

    function parseNode() {
        let node = new TrieNode;
        while (index < serialized.length) {
            let char = serialized[index++];

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

// 2. compress using Trie and save to new files
function compressDictAndTests(lines, tests) {
  const trie = new Trie();
  lines.forEach(line => {
    const [word, freq] = line.split(' ');
    trie.insert(word, Number(freq));
  });
  tests.forEach(([test, freq]) => {
    console.assert(trie.search(test) === freq);
  })
  const res = trie.serialize();
  const deserializedTrie = Trie.deserialize(res);
  tests.forEach(([test, freq]) => {
    console.assert(deserializedTrie.search(test) === freq);
  }) ;
  return res;
}

// 2.1 English freq dictionary from en wiki
const enFreq = fs.readFileSync('enwiki-20190320-words-frequency-fmap.txt', 'utf-8');
const enLines = enFreq.split('\n');
const enTests = [
  ['their', 22],
  [`hory's`, 5],
  [`kaimiņš`, 5],
  [`nsx-r`, 5],
  [`刑部尚書`, 5],
]

const enCompressed = compressDictAndTests(enLines, enTests);
fs.writeFileSync('enwiki-trie.txt', enCompressed);

// 2.2 Chinese freq dictionary
const cnFreq = fs.readFileSync('freq.txt', 'utf-8');
const cnLines = cnFreq.split('\n');
const cnTests = [
  ['技术', 1412723],
  ['近代文学', 700]
];

const cnCompressed = compressDictAndTests(cnLines, cnTests);
fs.writeFileSync('cn-trie.txt', cnCompressed);


