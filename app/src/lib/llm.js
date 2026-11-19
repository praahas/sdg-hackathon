// Optional write-up with a language model that runs in this browser (WebGPU, via WebLLM).
// Nothing is sent to any server: the model files are imported once from a folder on this
// computer into the browser's own storage, and the compiled model program ships with the app
// (public/models). The model only rewrites the findings it is given.

export const MODELS = [
  {
    id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 3B Instruct (recommended; about 2.5 GB of GPU memory)',
    lib: '/models/Qwen2.5-3B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm',
    vram: 2505,
    source: 'https://huggingface.co/mlc-ai/Qwen2.5-3B-Instruct-q4f16_1-MLC',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen 2.5 1.5B Instruct (smaller; about 1.6 GB of GPU memory)',
    lib: '/models/Qwen2-1.5B-Instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm',
    vram: 1630,
    source: 'https://huggingface.co/mlc-ai/Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  },
]
const CONTEXT = 4096

// Where the model's files live inside the browser's storage. Nothing is ever fetched from
// this address: the files are put there by importModelFolder().
export const modelUrl = (id) => `${location.origin}/local-models/${id}/resolve/main/`

export function appConfig(id) {
  const m = MODELS.find((x) => x.id === id)
  return {
    useIndexedDBCache: false,
    model_list: [{ model: modelUrl(id), model_id: id, model_lib: m.lib, vram_required_MB: m.vram, overrides: { context_window_size: CONTEXT } }],
  }
}

const mock = () => (typeof window !== 'undefined' ? window.__INSIGHTS_TEST_ENGINE__ : null) // used by automated tests only
const webllm = () => import('@mlc-ai/web-llm')

// Can this browser run the model at all?
export async function checkGpu() {
  if (mock()) return { ok: true, name: 'Test engine' }
  if (!('gpu' in navigator)) return { ok: false, why: 'This browser has no WebGPU. Use a recent Chrome or Edge on a computer with a graphics card.' }
  try {
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!a) return { ok: false, why: 'WebGPU is available but no suitable graphics adapter was found on this computer.' }
    const info = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : {})
    return { ok: true, name: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') || 'WebGPU device', f16: a.features?.has?.('shader-f16') }
  } catch (e) { return { ok: false, why: `WebGPU could not start: ${e.message}` } }
}

export async function isInstalled(id) {
  if (mock()) return mock().installed?.includes(id) ?? true
  try {
    const cfg = await caches.open('webllm/config')
    if (!(await cfg.match(new Request(modelUrl(id) + 'mlc-chat-config.json')))) return false
    const { hasModelInCache } = await webllm()
    return await hasModelInCache(id, appConfig(id))
  } catch { return false }
}

export async function removeModel(id) {
  const base = modelUrl(id)
  for (const name of ['webllm/model', 'webllm/config']) {
    const c = await caches.open(name)
    for (const req of await c.keys()) if (req.url.startsWith(base)) await c.delete(req)
  }
}

// files: the FileList from <input type="file" webkitdirectory>. Copies the model folder into
// browser storage under the addresses the model loader reads from.
export async function importModelFolder(files, id, onProgress = () => {}) {
  const all = [...files]
  if (!all.length) throw new Error('That folder is empty.')
  // Paths relative to the folder that holds mlc-chat-config.json (the chosen folder or one inside it).
  const cfgFile = all.find((f) => f.name === 'mlc-chat-config.json')
  if (!cfgFile) throw new Error('This folder has no mlc-chat-config.json. Choose the downloaded model folder itself (for example "Qwen2.5-3B-Instruct-q4f16_1-MLC").')
  const root = cfgFile.webkitRelativePath.slice(0, -'mlc-chat-config.json'.length)
  const byPath = new Map(all.filter((f) => f.webkitRelativePath.startsWith(root)).map((f) => [f.webkitRelativePath.slice(root.length), f]))
  const ndFile = byPath.get('ndarray-cache.json')
  if (!ndFile) throw new Error('This folder has no ndarray-cache.json, so it isn\'t a complete WebLLM model folder.')
  let nd
  try { nd = JSON.parse(await ndFile.text()) } catch { throw new Error('ndarray-cache.json in this folder could not be read.') }
  const shards = [...new Set((nd.records || []).map((r) => r.dataPath))]
  const missing = shards.filter((p) => !byPath.has(p))
  if (missing.length) throw new Error(`The folder is incomplete: ${missing.length} weight file${missing.length === 1 ? ' is' : 's are'} missing (for example ${missing[0]}). Download the model again and make sure every file finished.`)
  const tok = ['tokenizer.json', 'tokenizer.model'].filter((n) => byPath.has(n))
  if (!tok.length) throw new Error('This folder has no tokenizer.json.')
  const extra = ['tokenizer_config.json', 'vocab.json', 'merges.txt', 'added_tokens.json'].filter((n) => byPath.has(n))

  const list = [['webllm/config', 'mlc-chat-config.json'], ['webllm/model', 'ndarray-cache.json'],
    ...tok.map((n) => ['webllm/model', n]), ...extra.map((n) => ['webllm/model', n]), ...shards.map((n) => ['webllm/model', n])]
  const total = list.reduce((a, [, n]) => a + byPath.get(n).size, 0)

  if (navigator.storage?.estimate) {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    if (quota && quota - usage < total * 1.05) throw new Error(`The browser has about ${(Math.max(0, quota - usage) / 1e9).toFixed(1)} GB of storage free for this site, and the model needs ${(total / 1e9).toFixed(1)} GB. Free up disk space and try again.`)
  }
  try { await navigator.storage?.persist?.() } catch { /* best effort: ask the browser not to evict the model */ }

  await removeModel(id)
  const base = modelUrl(id)
  const caches_ = { 'webllm/config': await caches.open('webllm/config'), 'webllm/model': await caches.open('webllm/model') }
  let done = 0
  for (const [cacheName, n] of list) {
    const f = byPath.get(n)
    const type = n.endsWith('.json') ? 'application/json' : 'application/octet-stream'
    await caches_[cacheName].put(new Request(base + n), new Response(f, { headers: { 'Content-Type': type, 'Content-Length': String(f.size) } }))
    done += f.size
    onProgress(done / total, n)
  }
  return { files: list.length, bytes: total }
}

// Loads the model onto the GPU. onProgress gets { progress: 0..1, text }.
export async function loadEngine(id, onProgress = () => {}) {
  if (mock()) return mock().engine
  const { CreateMLCEngine } = await webllm()
  return CreateMLCEngine(id, { appConfig: appConfig(id), initProgressCallback: onProgress })
}

async function complete(engine, messages, { maxTokens = 700, temperature = 0.3, onToken } = {}) {
  const stream = await engine.chat.completions.create({ messages, stream: true, max_tokens: maxTokens, temperature, top_p: 0.9 })
  let text = ''
  for await (const chunk of stream) {
    const t = chunk.choices?.[0]?.delta?.content || ''
    if (t) { text += t; onToken?.(text) }
  }
  return text.trim()
}

const SYSTEM = 'You help a college department improve its student hackathon. You write clear, practical British English for a faculty committee. Use only the facts you are given: never invent numbers, names, quotes or events. Do not name students.'

// Rough token estimate (about 4 characters per token for English).
const tokens = (s) => Math.ceil(s.length / 4)

// Writes the report. facts: plain text from factsText(); comments: [{ prompt, text }].
// onStage(label), onToken(textSoFar) report progress.
export async function writeReport(engine, { facts, comments = [] }, { onStage = () => {}, onToken } = {}) {
  // 1. Condense student comments into themes, in batches that fit the model's context.
  let digest = ''
  const lines = comments.map((c) => `- (${c.prompt}) ${String(c.text).replace(/\s+/g, ' ').slice(0, 240)}`)
  if (lines.length) {
    const budget = 1600 // tokens of comments per batch
    const batches = []
    let cur = []
    for (const l of lines) {
      if (cur.length && tokens(cur.join('\n') + l) > budget) { batches.push(cur); cur = [] }
      cur.push(l)
    }
    if (cur.length) batches.push(cur)
    const parts = []
    for (let i = 0; i < batches.length; i++) {
      onStage(`Reading student comments (${i + 1} of ${batches.length})…`)
      parts.push(await complete(engine, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Here are ${batches[i].length} comments students wrote in event feedback:\n${batches[i].join('\n')}\n\nList the main themes as short bullet points. For each theme give roughly how many of these comments raise it and whether it is praise or a request for improvement. At most 6 bullets. No introduction.` },
      ], { maxTokens: 300, temperature: 0.2 }))
    }
    digest = parts.join('\n')
    if (tokens(digest) > 700) {
      onStage('Combining comment themes…')
      digest = await complete(engine, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Merge these theme lists from different batches of student comments into one list of at most 8 bullets, adding up the counts where themes are the same:\n${digest}` },
      ], { maxTokens: 350, temperature: 0.2 })
    }
  }

  // 2. The report itself.
  onStage('Writing the report…')
  const room = CONTEXT - 950 - tokens(SYSTEM) - 120
  let factBlock = facts
  if (tokens(factBlock) + tokens(digest) > room) factBlock = factBlock.slice(0, Math.max(1000, (room - tokens(digest)) * 4))
  const prompt = `FINDINGS FROM THE HACKATHON DATA\n${factBlock}\n${digest ? `\nTHEMES IN STUDENT COMMENTS\n${digest}\n` : ''}
Write a report for the organising committee with these sections, using Markdown headings (##):
## Summary — 3 to 4 sentences on how the event went, citing the key figures.
## What worked well — short bullets.
## Recommendations for the next hackathon — a numbered list, most important first. For each: a bold one-line action, then one or two sentences on why (cite the figure) and what concretely to do.
## Closing note — one or two sentences.
Keep it under 550 words. Use only the facts above.`
  return complete(engine, [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], { maxTokens: 900, temperature: 0.3, onToken })
}
