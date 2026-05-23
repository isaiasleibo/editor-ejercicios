import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = parseInt(process.env.PORT || '5174', 10)
const OLD_JSON = path.join(__dirname, 'data', 'ejercicios-nuevos.json')
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(__dirname, 'jsons-ejercicios-claude')
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.join(__dirname, 'videos')
const IMAGES_DIR = process.env.IMAGES_DIR || '/home/isaiasleibo/Desktop/somatrack-project/somatrack-1.0.4/frontend/public/thumbnails'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)

const app = express()

// CORS — allow configured origins (no credentials needed)
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '50mb' }))
app.use(express.static(path.join(__dirname, 'public')))

// ---------- Old exercises (source of media — read only) ----------
let oldExercises = []

function loadOldExercises() {
  const raw = fs.readFileSync(OLD_JSON, 'utf-8')
  oldExercises = JSON.parse(raw)
  console.log(`[load] ${oldExercises.length} ejercicios viejos (fuente de imagen/video)`)
}

// ---------- Claude exercises (target — we copy media into these) ----------
// Each file in CLAUDE_DIR is a list of exercises. We track which file each
// exercise belongs to so we can write changes back to the right file.
let claudeFiles = new Map()      // filename -> array of exercises
let claudeIndex = new Map()      // id -> { ex, file }

function loadClaudeExercises() {
  claudeFiles = new Map()
  claudeIndex = new Map()
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.warn(`[warn] no existe la carpeta ${CLAUDE_DIR}`)
    return
  }
  const files = fs.readdirSync(CLAUDE_DIR).filter(f => f.endsWith('.json'))
  let total = 0
  for (const file of files) {
    const raw = fs.readFileSync(path.join(CLAUDE_DIR, file), 'utf-8')
    const list = JSON.parse(raw)
    let mutated = false
    for (const ex of list) {
      if (typeof ex.imagen !== 'string') { ex.imagen = ''; mutated = true }
      if (typeof ex.video !== 'string') { ex.video = ''; mutated = true }
      if (!('matched_con' in ex)) { ex.matched_con = null; mutated = true }
      claudeIndex.set(ex.id, { ex, file })
    }
    claudeFiles.set(file, list)
    if (mutated) saveClaudeFile(file)
    total += list.length
  }
  console.log(`[load] ${total} ejercicios de Claude desde ${files.length} archivo(s)`)
}

function saveClaudeFile(file) {
  const list = claudeFiles.get(file)
  if (!list) return
  fs.writeFileSync(path.join(CLAUDE_DIR, file), JSON.stringify(list, null, 2), 'utf-8')
}

// All claude exercises, flat, each tagged with its source file
app.get('/api/claude', (req, res) => {
  const out = []
  for (const [file, list] of claudeFiles) {
    for (const ex of list) out.push({ ...ex, _file: file })
  }
  res.json(out)
})

// All old exercises (for search / media lookup)
app.get('/api/old', (req, res) => {
  res.json(oldExercises)
})

// Apply / update a match on a claude exercise (copy media + record source)
app.patch('/api/claude/:id', (req, res) => {
  const entry = claudeIndex.get(req.params.id)
  if (!entry) return res.status(404).json({ error: 'not found' })
  const allowed = ['imagen', 'video', 'matched_con']
  for (const key of allowed) {
    if (key in req.body) entry.ex[key] = req.body[key]
  }
  saveClaudeFile(entry.file)
  res.json(entry.ex)
})

// Delete a claude exercise entirely from its source file
app.delete('/api/claude/:id', (req, res) => {
  const entry = claudeIndex.get(req.params.id)
  if (!entry) return res.status(404).json({ error: 'not found' })
  const list = claudeFiles.get(entry.file)
  const idx = list.findIndex(e => e.id === req.params.id)
  if (idx >= 0) list.splice(idx, 1)
  claudeIndex.delete(req.params.id)
  saveClaudeFile(entry.file)
  res.json({ ok: true, id: req.params.id })
})

// Clear a match on a claude exercise
app.post('/api/claude/:id/clear', (req, res) => {
  const entry = claudeIndex.get(req.params.id)
  if (!entry) return res.status(404).json({ error: 'not found' })
  entry.ex.imagen = ''
  entry.ex.video = ''
  entry.ex.matched_con = null
  saveClaudeFile(entry.file)
  res.json(entry.ex)
})

// Progress stats over claude exercises
app.get('/api/stats', (req, res) => {
  let total = 0
  let matched = 0
  for (const list of claudeFiles.values()) {
    for (const ex of list) {
      total++
      if (ex.matched_con) matched++
    }
  }
  res.json({ total, matched, pending: total - matched })
})

// Serve images from the somatrack frontend thumbnails folder
app.get('/images/:filename', (req, res) => {
  const filename = req.params.filename
  const full = path.join(IMAGES_DIR, filename)
  if (!full.startsWith(IMAGES_DIR)) return res.status(400).send('bad path')
  if (!fs.existsSync(full)) return res.status(404).send('not found')
  res.sendFile(full)
})

// Serve videos from local videos folder
app.get('/videos/:filename', (req, res) => {
  const filename = req.params.filename
  const full = path.join(VIDEOS_DIR, filename)
  if (!full.startsWith(VIDEOS_DIR)) return res.status(400).send('bad path')
  if (!fs.existsSync(full)) return res.status(404).send('not found')
  res.sendFile(full)
})

loadOldExercises()
loadClaudeExercises()

app.listen(PORT, () => {
  console.log(`\n  Matcher de ejercicios → http://localhost:${PORT}\n`)
})
