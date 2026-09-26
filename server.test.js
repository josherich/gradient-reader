const test = require('node:test')
const assert = require('node:assert/strict')
const { Readable, Writable } = require('node:stream')
const files = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createServer, splitSentences } = require('./server')

async function withServer(create, run, apiKey = 'test-key') {
  const server = createServer({ apiKey, clientFactory: () => ({ alpha: { decisions: { create } } }) })
  await run(server)
}

async function request(server, url, method = 'GET', body) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
  req.url = url
  req.method = method
  let output = ''
  const res = new Writable({ write(chunk, _encoding, done) { output += chunk; done() } })
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  const finished = new Promise((resolve, reject) => { res.on('finish', resolve); res.on('error', reject) })
  server.emit('request', req, res)
  await finished
  return { status: res.status, text: output, json: () => JSON.parse(output) }
}

test('sentence splitting keeps offsets across whitespace and Chinese punctuation', () => {
  const source = 'Title\n\nHello world. Another sentence!\n你好。'
  const sentences = splitSentences(source)
  assert.deepEqual(sentences.map(({ text }) => text), ['Title', 'Hello world.', 'Another sentence!', '你好。'])
  for (const sentence of sentences) assert.equal(source.slice(sentence.start, sentence.end), sentence.text)
})

test('sentence mode sends score questions and maps results to source offsets', async () => {
  let sent
  const fakeCreate = async ({ decisionsRequest }) => {
    sent = decisionsRequest
    return { answers: Object.fromEntries(
      Object.keys(sent.questions).map((id, i) => [id, { type: 'score', score: i + 1.25 }])
    ) }
  }
  await withServer(fakeCreate, async server => {
    const response = await request(server, '/api/analyze', 'POST', { mode: 'sentence', text: 'First. Second.' })
    assert.equal(response.status, 200)
    assert.deepEqual(response.json().results, [
      { start: 0, end: 6, score: 1.25 }, { start: 7, end: 14, score: 2.25 }
    ])
    assert.equal(sent.model, 'typesafe/jev-1.13')
    assert.equal(sent.questions.s0.type, 'score')
    assert.equal(sent.questions.s0.criteria.length, 5)
  })
})

test('semantic mode uses custom choice descriptions and rejects invalid choices', async () => {
  let sent
  let probability = 0.82
  const fakeCreate = async ({ decisionsRequest }) => {
    sent = decisionsRequest
    return { answers: { s0: { type: 'choice', choice: 'Claim', probabilities: { Claim: probability, Other: 0.18 } } } }
  }
  await withServer(fakeCreate, async server => {
    const body = { mode: 'semantic', text: 'A point.', choices: [
      { name: 'Claim', description: 'Main point' }, { name: 'Other', description: 'Everything else' }
    ] }
    const response = await request(server, '/api/analyze', 'POST', body)
    assert.equal(response.status, 200)
    assert.deepEqual(response.json().results, [{ start: 0, end: 8, choice: 'Claim', probability: 0.82 }])
    assert.deepEqual(sent.questions.s0.criteria, { Claim: 'Main point', Other: 'Everything else' })
    body.choices[1].name = 'Claim'
    const invalid = await request(server, '/api/analyze', 'POST', body)
    assert.equal(invalid.status, 400)
    body.choices[1].name = 'Other'
    probability = undefined
    assert.equal((await request(server, '/api/analyze', 'POST', body)).status, 502)
  })
})

test('rewrite sends only adjusted sentences and validates returned sentence IDs', async () => {
  const article = 'First sentence. Second sentence.'
  const second = splitSentences(article)[1]
  const body = { text: article, edits: [{ id: 's1', start: second.start, end: second.end,
    role: 'Support', targetWords: 6 }] }
  let sent
  let reply = { rewrites: [{ id: 's1', text: 'Here is a longer second sentence.' }] }
  const server = createServer({ apiKey: 'test-key', clientFactory: () => ({ chat: { send: async request => {
    sent = request.chatRequest
    return { choices: [{ message: { content: JSON.stringify(reply) } }] }
  } } }) })
  const response = await request(server, '/api/rewrite', 'POST', body)
  assert.equal(response.status, 200)
  assert.deepEqual(response.json().rewrites, reply.rewrites)
  const prompt = JSON.parse(sent.messages[1].content)
  assert.equal(prompt.article, article)
  assert.deepEqual(prompt.sentences, [
    { id: 's1', text: second.text, role: 'Support', targetWords: 6 }
  ])
  assert.deepEqual(sent.reasoning, { effort: 'none' })
  assert.equal(sent.responseFormat.type, 'json_schema')
  const first = splitSentences(article)[0]
  const deletion = { id: 's0', start: first.start, end: first.end, role: 'Hook', targetWords: 0 }
  const mixed = await request(server, '/api/rewrite', 'POST', { ...body, edits: [deletion, ...body.edits] })
  assert.equal(mixed.status, 200)
  assert.deepEqual(mixed.json().rewrites, reply.rewrites)
  assert.deepEqual(JSON.parse(sent.messages[1].content).sentences.map(item => item.id), ['s1'])
  assert.equal((await request(server, '/api/rewrite', 'POST', { ...body,
    edits: [{ ...body.edits[0], end: second.end - 1 }] })).status, 400)
  assert.equal((await request(server, '/api/rewrite', 'POST', { ...body,
    edits: [{ ...deletion, targetWords: -1 }] })).status, 400)
  reply = { rewrites: [{ id: 's0', text: 'Wrong sentence.' }] }
  assert.equal((await request(server, '/api/rewrite', 'POST', body)).status, 502)
  const offline = createServer({ apiKey: '' })
  assert.equal((await request(offline, '/api/rewrite', 'POST', body)).status, 503)
  const deleted = await request(offline, '/api/rewrite', 'POST', { text: article, edits: [deletion] })
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.json().rewrites, [])
})

test('server serves the app and reports missing API configuration', async () => {
  await withServer(() => { throw new Error('Should not call Jev') }, async server => {
    assert.equal((await request(server, '/')).status, 200)
    assert.equal((await request(server, '/index.js')).status, 200)
    assert.equal((await request(server, '/jev-demo-cache.js')).status, 200)
    assert.equal((await request(server, '/unknown')).status, 404)
    const response = await request(server, '/api/analyze', 'POST', { mode: 'sentence', text: 'A sentence.' })
    assert.equal(response.status, 503)
  }, '')
})

test('bundled Jev results match both current demos and work without an API key', async () => {
  const source = await files.readFile(path.join(__dirname, 'index.js'), 'utf8')
  const english = source.match(/en: `([\s\S]*?)`,\ncn:/)?.[1]
  const chinese = source.match(/cn: `([\s\S]*?)`\n}/)?.[1]
  const choiceSource = source.match(/const defaultChoices = \[([\s\S]*?)\n\]/)?.[1]
  assert.ok(english && chinese && choiceSource)
  const demos = { en: vm.runInNewContext('`' + english + '`'), cn: vm.runInNewContext('`' + chinese + '`') }
  const choices = vm.runInNewContext('[' + choiceSource + ']').map(([name, description]) => ({ name, description }))
  const cacheDir = await files.mkdtemp(path.join(os.tmpdir(), 'gradient-jev-empty-'))
  try {
    const server = createServer({ apiKey: '', cacheDir, clientFactory: () => { throw new Error('Should use bundled results') } })
    for (const [demoId, text] of Object.entries(demos)) {
      for (const mode of ['sentence', 'semantic']) {
        const response = await request(server, '/api/analyze', 'POST', { demoId, mode, text, choices })
        assert.equal(response.status, 200, `${demoId} ${mode}: ${response.text}`)
        assert.equal(response.json().cached, true)
        const sentences = splitSentences(text)
        assert.deepEqual(response.json().results.map(({ start, end }) => ({ start, end })),
          sentences.map(({ start, end }) => ({ start, end })))
      }
    }
    assert.equal((await request(server, '/api/analyze', 'POST', {
      demoId: 'en', mode: 'sentence', text: demos.en + ' edited'
    })).status, 503)
  } finally {
    await files.rm(cacheDir, { recursive: true, force: true })
  }
})

test('English and Chinese demo results persist and are keyed by mode, text, and choices', async () => {
  const cacheDir = await files.mkdtemp(path.join(os.tmpdir(), 'gradient-jev-'))
  let calls = 0
  const create = async ({ decisionsRequest }) => {
    calls++
    return { answers: Object.fromEntries(Object.entries(decisionsRequest.questions).map(([id, question]) =>
      [id, question.type === 'score'
        ? { type: 'score', score: 2.5 }
        : { type: 'choice', choice: 'Claim', probabilities: { Claim: 0.9, Other: 0.1 } }])) }
  }
  const clientFactory = () => ({ alpha: { decisions: { create } } })
  const server = createServer({ apiKey: 'test-key', clientFactory, cacheDir })
  const english = { demoId: 'en', mode: 'sentence', text: 'English demo.' }
  const chinese = { demoId: 'cn', mode: 'sentence', text: '中文示例。' }
  const semantic = { demoId: 'en', mode: 'semantic', text: 'English demo.', choices: [
    { name: 'Claim', description: 'Main point' }, { name: 'Other', description: 'Anything else' }
  ] }
  try {
    for (const body of [english, chinese, semantic]) {
      const first = await request(server, '/api/analyze', 'POST', body)
      const second = await request(server, '/api/analyze', 'POST', body)
      assert.equal(first.status, 200)
      assert.equal(first.json().cached, false)
      assert.equal(second.json().cached, true)
    }
    assert.equal(calls, 3)
    assert.equal((await files.readdir(cacheDir)).length, 3)

    const offline = createServer({ apiKey: '', cacheDir, clientFactory: () => { throw new Error('Should use cache') } })
    assert.equal((await request(offline, '/api/analyze', 'POST', english)).json().cached, true)
    assert.equal((await request(offline, '/api/analyze', 'POST', chinese)).json().cached, true)
    assert.equal((await request(offline, '/api/analyze', 'POST', semantic)).json().cached, true)
    assert.equal((await request(offline, '/api/analyze', 'POST', { mode: 'sentence', text: 'Edited text.' })).status, 503)

    await request(server, '/api/analyze', 'POST', { ...english, text: 'Changed demo text.' })
    await request(server, '/api/analyze', 'POST', { ...semantic, choices: [
      { name: 'Claim', description: 'Changed rubric' }, semantic.choices[1]
    ] })
    assert.equal(calls, 5)
    await request(server, '/api/analyze', 'POST', { mode: 'sentence', text: english.text })
    await request(server, '/api/analyze', 'POST', { mode: 'sentence', text: english.text })
    assert.equal(calls, 7)
    const concurrent = { ...english, text: 'Concurrent demo request.' }
    const both = await Promise.all([
      request(server, '/api/analyze', 'POST', concurrent),
      request(server, '/api/analyze', 'POST', concurrent)
    ])
    assert.ok(both.every(response => response.status === 200))
    assert.equal(calls, 8)
  } finally {
    await files.rm(cacheDir, { recursive: true, force: true })
  }
})
