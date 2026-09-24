const http = require('node:http')
const fs = require('node:fs')
const files = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = __dirname
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/index.js': ['index.js', 'text/javascript; charset=utf-8'],
  '/enwiki-freq.bin.gz': ['enwiki-freq.bin.gz', 'application/gzip'],
  '/cn-freq.bin.gz': ['cn-freq.bin.gz', 'application/gzip'],
  '/gradient-reader.png': ['gradient-reader.png', 'image/png'],
  '/gradient-reader-en.png': ['gradient-reader-en.png', 'image/png']
}
const IMPORTANCE = ['not important', 'somewhat important', 'important', 'very important', 'most important']
const MAX_TEXT = 30000
const MAX_CHOICES = 12
const BATCH_SIZE = 20
const MODEL = 'typesafe/jev-1.13'
// Bump this when sentence segmentation or Jev question instructions change.
const CACHE_VERSION = 1

function demoCacheKey(body) {
  if (body.demoId !== 'en' && body.demoId !== 'cn') return null
  const criteria = body.mode === 'semantic'
    ? body.choices.map(choice => [choice.name.trim(), choice.description.trim()])
    : null
  return crypto.createHash('sha256')
    .update(JSON.stringify([CACHE_VERSION, MODEL, body.demoId, body.mode, body.text, criteria]))
    .digest('hex')
}

function validCachedResults(data, body, sentences) {
  return data?.version === CACHE_VERSION && Array.isArray(data.results) &&
    data.results.length === sentences.length && data.results.every((item, i) => {
      if (item.start !== sentences[i].start || item.end !== sentences[i].end) return false
      return body.mode === 'sentence'
        ? Number.isFinite(item.score)
        : body.choices.some(choice => choice.name.trim() === item.choice) &&
          Number.isFinite(item.probability) && item.probability >= 0 && item.probability <= 1
    })
}

async function readDemoCache(cacheDir, key, body, sentences) {
  try {
    const data = JSON.parse(await files.readFile(path.join(cacheDir, `${key}.json`), 'utf8'))
    return validCachedResults(data, body, sentences) ? data.results : null
  } catch { return null }
}

async function writeDemoCache(cacheDir, key, results) {
  let temporary
  try {
    await files.mkdir(cacheDir, { recursive: true })
    temporary = path.join(cacheDir, `${key}.${crypto.randomUUID()}.tmp`)
    await files.writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, results }))
    await files.rename(temporary, path.join(cacheDir, `${key}.json`))
  } catch {
    if (temporary) await files.rm(temporary, { force: true }).catch(() => {})
  }
}

function splitSentences(text) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
  return Array.from(segmenter.segment(text), ({ segment, index }) => {
    const left = segment.length - segment.trimStart().length
    const value = segment.trim()
    return { start: index + left, end: index + left + value.length, text: value }
  }).filter(item => item.text)
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(data))
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 100000) {
      const error = new Error('Request is too large')
      error.status = 413
      throw error
    }
  }
  try { return JSON.parse(body) } catch {
    const error = new Error('Invalid JSON')
    error.status = 400
    throw error
  }
}

function validate(body) {
  if (!body || typeof body.text !== 'string' || !body.text.trim() || body.text.length > MAX_TEXT) {
    throw Object.assign(new Error(`Text must be 1–${MAX_TEXT} characters`), { status: 400 })
  }
  if (!['sentence', 'semantic'].includes(body.mode)) {
    throw Object.assign(new Error('Invalid mode'), { status: 400 })
  }
  if (body.mode === 'semantic') {
    if (!Array.isArray(body.choices) || body.choices.length < 2 || body.choices.length > MAX_CHOICES) {
      throw Object.assign(new Error('Semantic mode needs 2–12 choices'), { status: 400 })
    }
    const seen = new Set()
    for (const choice of body.choices) {
      if (!choice || typeof choice.name !== 'string' || typeof choice.description !== 'string' ||
          !choice.name.trim() || choice.name.length > 80 || choice.description.length > 300 ||
          seen.has(choice.name.trim().toLowerCase())) {
        throw Object.assign(new Error('Choice names must be unique and descriptions at most 300 characters'), { status: 400 })
      }
      seen.add(choice.name.trim().toLowerCase())
    }
  }
}

function makeQuestions(mode, sentences, choices) {
  const questions = {}
  const criteria = mode === 'sentence' ? IMPORTANCE : Object.fromEntries(
    choices.map(choice => [choice.name.trim(), choice.description.trim() || null])
  )
  sentences.forEach((_, i) => {
    questions[`s${i}`] = mode === 'sentence'
      ? { type: 'score', instructions: `How important is \`sentences[${i}].text\` to understanding the main argument or story in \`article\`? Judge the sentence's contribution, not its writing quality.`, criteria }
      : { type: 'choice', instructions: `What is the main rhetorical role of \`sentences[${i}].text\` in \`article\`? Choose the single best fit.`, criteria }
  })
  return questions
}

async function callJev(payload, decisionsCreate) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await decisionsCreate(payload)
    } catch (cause) {
      const status = cause.statusCode ?? cause.status ?? cause.httpStatusCode
      if ([429, 503, 529].includes(status) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
        continue
      }
      const message = status === 401 ? 'OpenRouter rejected the API key.'
        : status === 402 ? 'OpenRouter account needs credits.'
          : `OpenRouter Jev request failed${status ? ` (${status})` : ''}.`
      throw Object.assign(new Error(message), { status: 502 })
    }
  }
}

function createServer({ apiKey = process.env.OPENROUTER_API_KEY, clientFactory,
  cacheDir = path.join(ROOT, '.cache', 'jev') } = {}) {
  let clientPromise
  const pending = new Map()
  const createDecision = async payload => {
    clientPromise ||= clientFactory
      ? Promise.resolve(clientFactory(apiKey))
      : import('@openrouter/sdk').then(({ OpenRouter }) => new OpenRouter({ apiKey }))
    const client = await clientPromise
    return client.alpha.decisions.create({ decisionsRequest: payload })
  }
  async function analyze(body, sentences) {
    if (!apiKey) throw Object.assign(new Error('Set OPENROUTER_API_KEY on the server to use Jev modes.'), { status: 503 })
    const results = []
    for (let offset = 0; offset < sentences.length; offset += BATCH_SIZE) {
      const batch = sentences.slice(offset, offset + BATCH_SIZE)
      const reply = await callJev({
        model: MODEL,
        state: { article: body.text, sentences: batch.map(({ text }) => ({ text })) },
        questions: makeQuestions(body.mode, batch, body.choices)
      }, createDecision)
      for (let i = 0; i < batch.length; i++) {
        const answer = reply.answers?.[`s${i}`]
        if (body.mode === 'sentence' && (answer?.type !== 'score' || !Number.isFinite(answer.score))) {
          throw new Error('Jev returned an invalid score')
        }
        if (body.mode === 'semantic' && (answer?.type !== 'choice' || !body.choices.some(c => c.name.trim() === answer.choice) ||
            !Number.isFinite(answer.probabilities?.[answer.choice]) || answer.probabilities[answer.choice] < 0 || answer.probabilities[answer.choice] > 1)) {
          throw new Error('Jev returned an invalid choice')
        }
        results.push({ start: batch[i].start, end: batch[i].end,
          ...(body.mode === 'sentence' ? { score: answer.score } : { choice: answer.choice, probability: answer.probabilities[answer.choice] }) })
      }
    }
    return results
  }

  return http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (pathname === '/api/analyze' && req.method === 'POST') {
      try {
        const body = await readJson(req)
        validate(body)
        const sentences = splitSentences(body.text)
        const key = demoCacheKey(body)
        if (key) {
          const cached = await readDemoCache(cacheDir, key, body, sentences)
          if (cached) return json(res, 200, { results: cached, cached: true })
        }
        let work = key && pending.get(key)
        if (!work) {
          work = (async () => {
            try {
              const results = await analyze(body, sentences)
              if (key) await writeDemoCache(cacheDir, key, results)
              return results
            } finally {
              if (key) pending.delete(key)
            }
          })()
          if (key) pending.set(key, work)
        }
        json(res, 200, { results: await work, cached: false })
      } catch (error) {
        json(res, error.status || 502, { error: error.message })
      }
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' })
    const file = STATIC_FILES[pathname]
    if (!file) return json(res, 404, { error: 'Not found' })
    res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff' })
    if (req.method === 'HEAD') res.end()
    else fs.createReadStream(path.join(ROOT, file[0])).pipe(res)
  })
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000
  createServer().listen(port, '127.0.0.1', () => console.log(`Gradient Reader: http://127.0.0.1:${port}`))
}

module.exports = { createServer, splitSentences, makeQuestions }
