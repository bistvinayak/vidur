import express from 'express'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// All conversation data lives in this one local folder — nothing leaves
// your machine. Delete it any time to wipe history; it's gitignored.
const DATA_DIR = path.join(__dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'threads.json')
const PORT = 4300

async function readThreads() {
  if (!existsSync(DATA_FILE)) return []
  const raw = await readFile(DATA_FILE, 'utf-8')
  return raw.trim() ? JSON.parse(raw) : []
}

async function writeThreads(threads) {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(DATA_FILE, JSON.stringify(threads, null, 2))
}

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use(express.static(path.join(__dirname, 'public')))

// Full list, newest first — the web page renders everything client-side
// from this one payload, so there's no per-id route to worry about
// URL-encoding a thread id (which is itself a full page URL).
app.get('/api/threads', async (_req, res) => {
  const threads = await readThreads()
  threads.sort((a, b) => b.updatedAt - a.updatedAt)
  res.json(threads)
})

app.post('/api/threads', async (req, res) => {
  const thread = req.body
  if (!thread?.id) return res.status(400).json({ error: 'missing id' })
  const threads = await readThreads()
  const idx = threads.findIndex((t) => t.id === thread.id)
  if (idx >= 0) threads[idx] = thread
  else threads.push(thread)
  await writeThreads(threads)
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`Vidur local mirror running at http://localhost:${PORT}`)
  console.log(`Data folder: ${DATA_DIR}`)
})
