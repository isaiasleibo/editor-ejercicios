// Verifica, para cada ejercicio de Claude, si su imagen y video están seteados
// y si el archivo realmente existe en las carpetas de media (gym o home).
//
//   node check-media.js            → resumen + lista de los que faltan
//   node check-media.js --all      → además lista todos los ejercicios OK
//   node check-media.js --csv      → vuelca un CSV (id,nombre,imagen,video,estado)
//
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(__dirname, 'jsons-ejercicios-claude')
const THUMB_DIRS = [process.env.THUMBS_DIR || path.join(__dirname, 'todos-los-videos_thumbnails')]
const VIDEO_DIRS = [process.env.VIDEOS_DIR || path.join(__dirname, 'todos-los-videos_compressed')]

const showAll = process.argv.includes('--all')
const asCsv = process.argv.includes('--csv')

// Set con todos los nombres de archivo presentes en una lista de carpetas.
function indexFiles(dirs) {
  const set = new Set()
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) set.add(f)
  }
  return set
}

const thumbs = indexFiles(THUMB_DIRS)
const videos = indexFiles(VIDEO_DIRS)

// Carga todos los ejercicios de Claude, marcando de qué archivo viene cada uno.
function loadClaude() {
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.error(`No existe la carpeta ${CLAUDE_DIR}`)
    process.exit(1)
  }
  const out = []
  for (const file of fs.readdirSync(CLAUDE_DIR).filter(f => f.endsWith('.json'))) {
    const list = JSON.parse(fs.readFileSync(path.join(CLAUDE_DIR, file), 'utf-8'))
    for (const ex of list) out.push({ ...ex, _file: file })
  }
  return out
}

const exercises = loadClaude()

// Clasifica una pieza de media: 'ok' (tiene nombre y existe el archivo),
// 'roto' (tiene nombre pero el archivo no está) o 'vacio' (sin nombre).
function classify(name, fileSet) {
  if (!name || !String(name).trim()) return 'vacio'
  return fileSet.has(name) ? 'ok' : 'roto'
}

const rows = exercises.map(ex => {
  const imgState = classify(ex.imagen, thumbs)
  const vidState = classify(ex.video, videos)
  return { ex, imgState, vidState }
})

// ---------- CSV ----------
if (asCsv) {
  const esc = s => `"${String(s ?? '').replace(/"/g, '""')}"`
  const lines = ['id,nombre,imagen,video,imagen_estado,video_estado']
  for (const { ex, imgState, vidState } of rows) {
    lines.push([ex.id, esc(ex.nombre_es || ''), esc(ex.imagen || ''), esc(ex.video || ''), imgState, vidState].join(','))
  }
  console.log(lines.join('\n'))
  process.exit(0)
}

// ---------- Resumen ----------
const total = rows.length
const count = (pred) => rows.filter(pred).length

const ambosOk = count(r => r.imgState === 'ok' && r.vidState === 'ok')
const imgOk = count(r => r.imgState === 'ok')
const vidOk = count(r => r.vidState === 'ok')
const imgRoto = rows.filter(r => r.imgState === 'roto')
const vidRoto = rows.filter(r => r.vidState === 'roto')
const imgVacio = count(r => r.imgState === 'vacio')
const vidVacio = count(r => r.vidState === 'vacio')
const sinNada = count(r => r.imgState !== 'ok' && r.vidState !== 'ok')

const pct = n => total ? `${(n / total * 100).toFixed(1)}%` : '0%'

console.log(`\n  Ejercicios de Claude analizados: ${total}`)
console.log(`  Thumbnails disponibles: ${thumbs.size}  ·  Videos disponibles: ${videos.size}\n`)
console.log(`  ── Imagen ──`)
console.log(`     válida (archivo existe) : ${imgOk}  (${pct(imgOk)})`)
console.log(`     rota (nombre sin archivo): ${imgRoto.length}`)
console.log(`     vacía (sin nombre)       : ${imgVacio}`)
console.log(`\n  ── Video ──`)
console.log(`     válido (archivo existe)  : ${vidOk}  (${pct(vidOk)})`)
console.log(`     roto (nombre sin archivo): ${vidRoto.length}`)
console.log(`     vacío (sin nombre)       : ${vidVacio}`)
console.log(`\n  ── Combinado ──`)
console.log(`     imagen + video válidos   : ${ambosOk}  (${pct(ambosOk)})`)
console.log(`     sin imagen ni video      : ${sinNada}  (${pct(sinNada)})`)

// ---------- Detalle de problemas ----------
function listIssues(title, items, kind) {
  if (items.length === 0) return
  console.log(`\n  ${title} (${items.length}):`)
  for (const { ex } of items) {
    console.log(`    · ${ex.id}  ${ex.nombre_es || '(sin nombre)'}  →  ${ex[kind] || ''}`)
  }
}

listIssues('Imagen ROTA (nombre apunta a un archivo inexistente)', imgRoto, 'imagen')
listIssues('Video ROTO (nombre apunta a un archivo inexistente)', vidRoto, 'video')

const sinMedia = rows.filter(r => r.imgState === 'vacio' && r.vidState === 'vacio')
if (sinMedia.length) {
  console.log(`\n  Sin imagen NI video asignados (${sinMedia.length}):`)
  for (const { ex } of sinMedia) {
    console.log(`    · ${ex.id}  ${ex.nombre_es || '(sin nombre)'}`)
  }
}

if (showAll) {
  const ok = rows.filter(r => r.imgState === 'ok' && r.vidState === 'ok')
  console.log(`\n  Con imagen y video válidos (${ok.length}):`)
  for (const { ex } of ok) {
    console.log(`    ✓ ${ex.id}  ${ex.nombre_es || '(sin nombre)'}`)
  }
}

console.log('')
