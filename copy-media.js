// Si TODOS los ejercicios de Claude tienen imagen y video válidos
// (nombre seteado + archivo existente), copia las imágenes a una carpeta
// y los videos a otra. Si hay aunque sea un ejercicio con media rota o
// vacía, no copia nada y lista los problemas.
//
//   node copy-media.js              → copia a ./media-export/imagenes y ./media-export/videos
//   node copy-media.js --dry-run    → no copia, solo dice qué haría
//
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(__dirname, 'jsons-ejercicios-claude')
const THUMB_DIRS = [process.env.THUMBS_DIR || path.join(__dirname, 'todos-los-videos_thumbnails')]
const VIDEO_DIRS = [process.env.VIDEOS_DIR || path.join(__dirname, 'todos-los-videos_compressed')]

const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, 'media-export')
const OUT_IMG = path.join(OUT_DIR, 'imagenes')
const OUT_VID = path.join(OUT_DIR, 'videos')

const dryRun = process.argv.includes('--dry-run')

// Mapa nombreArchivo → ruta absoluta, recorriendo una lista de carpetas.
function indexFiles(dirs) {
  const map = new Map()
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (!map.has(f)) map.set(f, path.join(dir, f))
    }
  }
  return map
}

const thumbs = indexFiles(THUMB_DIRS)
const videos = indexFiles(VIDEO_DIRS)

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

// 'ok' (nombre + archivo existe) · 'roto' (nombre sin archivo) · 'vacio' (sin nombre).
function classify(name, fileMap) {
  if (!name || !String(name).trim()) return 'vacio'
  return fileMap.has(name) ? 'ok' : 'roto'
}

const rows = exercises.map(ex => ({
  ex,
  imgState: classify(ex.imagen, thumbs),
  vidState: classify(ex.video, videos),
}))

// ---------- Verificación: todos deben estar válidos ----------
const problemas = rows.filter(r => r.imgState !== 'ok' || r.vidState !== 'ok')

if (problemas.length) {
  console.error(`\n  ✗ No se copia nada: hay ${problemas.length} ejercicio(s) con imagen o video no válido.\n`)
  for (const { ex, imgState, vidState } of problemas) {
    const img = imgState !== 'ok' ? `imagen=${imgState}` : ''
    const vid = vidState !== 'ok' ? `video=${vidState}` : ''
    console.error(`    · ${ex.id}  ${ex.nombre_es || '(sin nombre)'}  →  ${[img, vid].filter(Boolean).join(', ')}`)
  }
  console.error('\n  Corregí estos ejercicios y volvé a correr.\n')
  process.exit(1)
}

// ---------- Todo válido: copiar ----------
console.log(`\n  ✓ Los ${rows.length} ejercicios tienen imagen y video válidos.`)

const OUT_JSON = path.join(OUT_DIR, 'ejercicios.json')

if (dryRun) {
  console.log(`\n  [dry-run] Copiaría ${rows.length} imágenes a ${OUT_IMG}`)
  console.log(`  [dry-run] Copiaría ${rows.length} videos a ${OUT_VID}`)
  console.log(`  [dry-run] Escribiría ${rows.length} ejercicios en ${OUT_JSON}\n`)
  process.exit(0)
}

fs.mkdirSync(OUT_IMG, { recursive: true })
fs.mkdirSync(OUT_VID, { recursive: true })

let imgCopiadas = 0
let vidCopiados = 0
for (const { ex } of rows) {
  const srcImg = thumbs.get(ex.imagen)
  const srcVid = videos.get(ex.video)
  fs.copyFileSync(srcImg, path.join(OUT_IMG, ex.imagen))
  imgCopiadas++
  fs.copyFileSync(srcVid, path.join(OUT_VID, ex.video))
  vidCopiados++
}

// JSON combinado de todos los ejercicios (sin el campo interno _file).
const ejercicios = rows.map(({ ex }) => {
  const { _file, ...limpio } = ex
  return limpio
})
fs.writeFileSync(OUT_JSON, JSON.stringify(ejercicios, null, 2))

console.log(`\n  Imágenes copiadas: ${imgCopiadas}  →  ${OUT_IMG}`)
console.log(`  Videos copiados : ${vidCopiados}  →  ${OUT_VID}`)
console.log(`  JSON escrito    : ${ejercicios.length} ejercicios  →  ${OUT_JSON}\n`)
