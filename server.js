import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = parseInt(process.env.PORT || '5174', 10)
const OLD_JSON = path.join(__dirname, 'data', 'ejercicios-nuevos.json')
const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(__dirname, 'jsons-ejercicios-claude')

// Media folders. Toda la biblioteca de videos vive junta: los .mp4 comprimidos
// en VIDEOS_DIR y los thumbnails .webp (mismo basename) en THUMBS_DIR.
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.join(__dirname, 'todos-los-videos_compressed')
const THUMBS_DIR = process.env.THUMBS_DIR || path.join(__dirname, 'todos-los-videos_thumbnails')

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

// All claude exercises, flat, each tagged with its source file.
// Re-scan the folder on each request so newly added JSON files show up
// without needing to restart the server.
app.get('/api/claude', (req, res) => {
  loadClaudeExercises()
  const out = []
  for (const [file, list] of claudeFiles) {
    for (const ex of list) out.push({ ...ex, _file: file })
  }
  res.json(out)
})

// All old exercises (for search / media lookup) — sección "Gym workout"
app.get('/api/old', (req, res) => {
  res.json(oldExercises)
})

// Build a candidate list from a video folder (no JSON). Each video file has a
// matching thumbnail with the same basename in the thumbs folder. The display
// name is the filename with separators turned into spaces.
function buildMediaList(videosDir, thumbsDir) {
  if (!fs.existsSync(videosDir)) return []
  return fs.readdirSync(videosDir)
    .filter(f => f.toLowerCase().endsWith('.mp4'))
    .map(video => {
      const base = video.replace(/\.mp4$/i, '')
      const webp = base + '.webp'
      const imagen = fs.existsSync(path.join(thumbsDir, webp)) ? webp : ''
      const nombre = base
        .replace(/_+$/g, '')
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return { id: base, video, imagen, nombre }
    })
}

// Candidatos: toda la biblioteca de videos (un solo origen).
app.get('/api/media', (req, res) => {
  res.json(buildMediaList(VIDEOS_DIR, THUMBS_DIR))
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

// Sirve un archivo de media desde una carpeta, evitando path traversal.
function serveFromDir(dir, filename, res) {
  const full = path.join(dir, filename)
  if (full.startsWith(dir) && fs.existsSync(full)) return res.sendFile(full)
  res.status(404).send('not found')
}

// Thumbnails (.webp)
app.get('/images/:filename', (req, res) => {
  serveFromDir(THUMBS_DIR, req.params.filename, res)
})

// Videos (.mp4)
app.get('/videos/:filename', (req, res) => {
  serveFromDir(VIDEOS_DIR, req.params.filename, res)
})

loadOldExercises()
loadClaudeExercises()

app.listen(PORT, () => {
  console.log(`\n  Matcher de ejercicios → http://localhost:${PORT}\n`)
})
