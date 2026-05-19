import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = 5174
const JSON_PATH = path.join(__dirname, 'data', 'ejercicios-nuevos.json')
const VIDEOS_DIR = path.join(__dirname, 'videos')
const IMAGES_DIR = '/home/isaiasleibo/Desktop/somatrack-project/somatrack-1.0.4/frontend/public/thumbnails'

const app = express()
app.use(express.json({ limit: '50mb' }))
app.use(express.static(path.join(__dirname, 'public')))

let exercises = []
let saveTimer = null
let pendingSave = false

function loadExercises() {
  const raw = fs.readFileSync(JSON_PATH, 'utf-8')
  exercises = JSON.parse(raw)
  let mutated = false
  for (const ex of exercises) {
    if (typeof ex.importancia !== 'number') { ex.importancia = 1; mutated = true }
    if (typeof ex.verificado !== 'boolean') { ex.verificado = false; mutated = true }
    if (!('variante_de' in ex)) { ex.variante_de = null; mutated = true }
  }
  if (mutated) saveExercisesSync()
  console.log(`[load] ${exercises.length} ejercicios cargados${mutated ? ' (campos nuevos inicializados)' : ''}`)
}

function saveExercisesSync() {
  fs.writeFileSync(JSON_PATH, JSON.stringify(exercises, null, 2), 'utf-8')
}

function scheduleSave() {
  pendingSave = true
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    if (pendingSave) {
      saveExercisesSync()
      pendingSave = false
      console.log(`[save] JSON guardado @ ${new Date().toISOString()}`)
    }
    saveTimer = null
  }, 400)
}

// GET all exercises (lightweight summary first then full on demand? send all - 2MB is fine locally)
app.get('/api/exercises', (req, res) => {
  res.json(exercises)
})

app.get('/api/exercises/:id', (req, res) => {
  const ex = exercises.find(e => e.id === req.params.id)
  if (!ex) return res.status(404).json({ error: 'not found' })
  res.json(ex)
})

// PATCH single exercise (partial update)
app.patch('/api/exercises/:id', (req, res) => {
  const idx = exercises.findIndex(e => e.id === req.params.id)
  if (idx < 0) return res.status(404).json({ error: 'not found' })
  exercises[idx] = { ...exercises[idx], ...req.body }
  scheduleSave()
  res.json(exercises[idx])
})

// Toggle verified
app.post('/api/exercises/:id/verify', (req, res) => {
  const idx = exercises.findIndex(e => e.id === req.params.id)
  if (idx < 0) return res.status(404).json({ error: 'not found' })
  exercises[idx].verificado = !exercises[idx].verificado
  scheduleSave()
  res.json(exercises[idx])
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

// Check if a video file exists in the local videos folder
app.get('/api/video-exists/:filename', (req, res) => {
  const filename = req.params.filename
  const full = path.join(VIDEOS_DIR, filename)
  if (!full.startsWith(VIDEOS_DIR)) return res.status(400).json({ error: 'bad path' })
  res.json({ exists: fs.existsSync(full) })
})

// Stats endpoint
app.get('/api/stats', (req, res) => {
  const total = exercises.length
  const verified = exercises.filter(e => e.verificado).length
  res.json({ total, verified, unverified: total - verified })
})

// Generate alternative names via LM Studio (OpenAI-compatible local API)
app.post('/api/generate-alternativos/:id', async (req, res) => {
  const ex = exercises.find(e => e.id === req.params.id)
  if (!ex) return res.status(404).json({ error: 'not found' })

  const existentes = (ex.nombres_alternativos || []).join(', ') || '(ninguno)'
  const prompt = `Sos un experto en entrenamiento de gimnasio. Te paso un ejercicio y necesito que generes nombres alternativos en español que la gente usaría para buscarlo. Incluí variantes con sinónimos, abreviaciones, jerga de gimnasio (ej: "biceps" en vez de "bíceps", "press banca" en vez de "press de banca"), y traducciones del nombre en inglés.

Ejercicio:
- Nombre en español: ${ex.nombre_es}
- Nombre en inglés: ${ex.nombre_en || '(sin)'}
- Músculo principal: ${ex.musculo}
- Equipamiento: ${ex.equipo}
- Tipo: ${ex.tipo}
- Nombres alternativos ya existentes: ${existentes}

Devolveme SOLO un JSON array con 8 nombres alternativos nuevos (que NO sean iguales a los existentes ni al nombre principal). Ejemplo de formato exacto:
["nombre 1", "nombre 2", "nombre 3", "nombre 4", "nombre 5", "nombre 6", "nombre 7", "nombre 8"]

No agregues texto antes ni después del array. Solo el JSON.`

  try {
    const lmRes = await fetch('http://localhost:1234/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: 'Sos un asistente que devuelve únicamente JSON válido, sin explicaciones.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
        max_tokens: 600,
      }),
    })
    if (!lmRes.ok) {
      const text = await lmRes.text()
      return res.status(502).json({ error: `LM Studio respondió ${lmRes.status}: ${text.slice(0, 200)}` })
    }
    const data = await lmRes.json()
    const content = data.choices?.[0]?.message?.content || ''
    // Extract JSON array — accept fenced code blocks or plain
    let names = []
    const match = content.match(/\[[\s\S]*?\]/)
    if (match) {
      try { names = JSON.parse(match[0]) } catch { names = [] }
    }
    if (!Array.isArray(names)) names = []
    names = names
      .map(n => String(n || '').trim())
      .filter(n => n.length > 0 && n.length < 200)
    res.json({ names, raw: content })
  } catch (err) {
    res.status(500).json({ error: `Error llamando a LM Studio: ${err.message}` })
  }
})

loadExercises()

app.listen(PORT, () => {
  console.log(`\n  Editor ejercicios → http://localhost:${PORT}\n`)
})

// Ensure save on shutdown
process.on('SIGINT', () => {
  if (pendingSave) { saveExercisesSync(); console.log('[save] guardado en SIGINT') }
  process.exit(0)
})
