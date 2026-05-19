import Fuse from '/fuse.min.mjs'

const MUSCLES = ['Biceps','Calves','Chest','Core','Forearms','Glutes','Hamstrings','Lowerback','Quadriceps','Shoulders','Triceps','Upperback']
const EQUIPMENT_PRESETS = ['Barbell','Dumbbell','Cable','Machine','Bench','Band','Bodyweight','Kettlebell','None']

// Same Fuse config as the real app (somatrack frontend exerciseDB.js)
const FUSE_OPTIONS = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.4,
  minMatchCharLength: 2,
  keys: [
    { name: 'nameNorm', weight: 2 },
    { name: 'sinonimosNorm', weight: 1.5 },
    { name: 'nameEnNorm', weight: 1.5 },
    { name: 'primaryMuscleNorm', weight: 1 }
  ]
}
const commonEquipment = { barbell: 3, dumbbell: 2, bodyweight: 1 }
const equipmentMap = {
  'Barbell': 'barbell', 'Barbell,bench': 'barbell', 'Dumbbell': 'dumbbell',
  'Dumbbell,bench': 'dumbbell', 'Cable': 'cable', 'Machine': 'machine',
  'Band': 'band', 'Bench': 'bodyweight', 'None': 'bodyweight'
}
// API base URL — uses dedicated api domain in production, relative in dev
const API_BASE = (() => {
  const h = location.hostname
  if (h === 'editor-ejercicios.isaiasleibo.site') return 'https://api-editor-ejercicios.isaiasleibo.site'
  return ''
})()

const muscleTranslations = {
  'Chest': 'Pecho', 'Upperback': 'Espalda superior', 'Lowerback': 'Espalda baja',
  'Shoulders': 'Hombros', 'Quadriceps': 'Cuádriceps', 'Hamstrings': 'Isquiotibiales',
  'Glutes': 'Glúteos', 'Calves': 'Pantorrillas', 'Biceps': 'Bíceps',
  'Triceps': 'Tríceps', 'Forearms': 'Antebrazos', 'Core': 'Core'
}

const state = {
  all: [],
  byId: new Map(),
  searchIndex: [],  // transformed entries used by Fuse
  searchById: new Map(),
  fuse: null,
  filter: 'unverified',
  search: '',
  muscleFilter: '',
  currentId: null,
  saveTimer: null,
  pendingPatch: {},
}

const $ = (id) => document.getElementById(id)

// ---------- Load ----------
async function init() {
  const r = await fetch(`${API_BASE}/api/exercises`)
  state.all = await r.json()
  for (const e of state.all) state.byId.set(e.id, e)
  buildSearchIndex()
  populateMuscleSelects()
  bindUI()
  renderStats()
  renderList()
}

function buildSearchIndex() {
  state.searchIndex = state.all.map(ex => {
    const nombre_es = ex.nombre_es || ''
    const nombre_en = ex.nombre_en || ''
    const sinonimos = Array.isArray(ex.nombres_alternativos) ? ex.nombres_alternativos : []
    const primaryMuscle = muscleTranslations[ex.musculo] || ex.musculo || ''
    return {
      id: ex.id,
      name: nombre_es,
      nameNorm: normalize(nombre_es),
      nameEnNorm: normalize(nombre_en),
      sinonimosNorm: sinonimos.map(s => normalize(s)),
      primaryMuscleNorm: normalize(primaryMuscle),
      equipment: equipmentMap[ex.equipo] || 'bodyweight',
    }
  })
  state.searchById = new Map(state.searchIndex.map(e => [e.id, e]))
  state.fuse = new Fuse(state.searchIndex, FUSE_OPTIONS)
}

function scoreExercise(ex, queryNorm, words) {
  let score = 0
  if (ex.nameNorm === queryNorm) return 10000
  if (ex.nameNorm.startsWith(queryNorm)) score += 500
  const nameFirstWord = ex.nameNorm.split(/\s+/)[0]
  if (nameFirstWord === words[0]) score += 100
  const nameWords = ex.nameNorm.split(/\s+/)
  const allWholeWords = words.every(w => nameWords.some(nw => nw === w))
  if (allWholeWords) score += 200
  score += Math.max(0, 80 - ex.name.length)
  score += (commonEquipment[ex.equipment] || 0) * 10
  return score
}

function populateMuscleSelects() {
  const muscleFilter = $('filter-muscle')
  for (const m of MUSCLES) {
    muscleFilter.insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`)
  }
  const fMusculo = $('f-musculo')
  for (const m of MUSCLES) {
    fMusculo.insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`)
  }
}

// ---------- List ----------
function getFilteredList() {
  const q = state.search.trim()

  // If there's a search query, use Fuse (same as the real app) and apply filters after
  if (q) {
    const queryNorm = normalize(q)
    const words = queryNorm.split(/\s+/).filter(Boolean)
    const hits = state.fuse.search(queryNorm)
    const ranked = hits.map(hit => ({
      ex: state.byId.get(hit.item.id),
      rank: hit.score * 1000 - scoreExercise(hit.item, queryNorm, words),
    })).filter(r => r.ex)
    ranked.sort((a, b) => a.rank - b.rank)
    let list = ranked.map(r => r.ex)
    if (state.filter === 'unverified') list = list.filter(e => !e.verificado)
    else if (state.filter === 'verified') list = list.filter(e => e.verificado)
    if (state.muscleFilter) list = list.filter(e => e.musculo === state.muscleFilter)
    return list
  }

  // No search query: apply filters and sort by verification + importance
  let list = state.all
  if (state.filter === 'unverified') list = list.filter(e => !e.verificado)
  else if (state.filter === 'verified') list = list.filter(e => e.verificado)
  if (state.muscleFilter) list = list.filter(e => e.musculo === state.muscleFilter)
  return list.slice().sort((a, b) => {
    if (a.verificado !== b.verificado) return a.verificado ? 1 : -1
    if (a.verificado) return (b.importancia || 1) - (a.importancia || 1)
    return (a.importancia || 1) - (b.importancia || 1)
  })
}

function renderList() {
  const list = getFilteredList()
  const container = $('list')
  const items = list.slice(0, 500) // virtual cap for perf
  container.innerHTML = items.map(e => `
    <div class="list-item ${e.verificado ? 'verified' : ''} ${e.id === state.currentId ? 'active' : ''}" data-id="${e.id}">
      <div class="li-info">
        <div class="li-name">${escapeHtml(e.nombre_es || '(sin nombre)')}</div>
        <div class="li-meta">${escapeHtml(e.musculo || '?')} · ${escapeHtml(e.equipo || '?')}</div>
      </div>
      <div class="li-imp">${e.importancia || 1}</div>
    </div>
  `).join('')
  if (list.length > items.length) {
    container.insertAdjacentHTML('beforeend', `<div class="muted" style="padding:10px;text-align:center;font-size:11px">+ ${list.length - items.length} más (filtra para ver)</div>`)
  }
  for (const node of container.querySelectorAll('.list-item')) {
    node.addEventListener('click', () => selectExercise(node.dataset.id))
  }
}

function renderStats() {
  const total = state.all.length
  const ver = state.all.filter(e => e.verificado).length
  $('stats').textContent = `${ver}/${total} verificados (${(ver/total*100).toFixed(1)}%)`
}

// ---------- Selection / Form ----------
function selectExercise(id) {
  flushPendingPatch()
  state.currentId = id
  const ex = state.byId.get(id)
  if (!ex) return
  $('empty').classList.add('hidden')
  $('form').classList.remove('hidden')
  fillForm(ex)
  renderList()
  document.body.classList.remove('sidebar-open')
}

function fillForm(ex) {
  $('f-id').textContent = ex.id
  $('f-nombre_es').value = ex.nombre_es || ''
  $('f-nombre_en').value = ex.nombre_en || ''
  $('f-tipo').value = ex.tipo || 'Compound'
  $('f-musculo').value = ex.musculo || MUSCLES[0]
  $('f-equipo').value = ex.equipo || ''
  $('f-importancia').value = ex.importancia || 1
  $('f-importancia-val').textContent = ex.importancia || 1

  // Verify button
  const vb = $('btn-verify')
  vb.classList.toggle('is-verified', !!ex.verificado)
  vb.textContent = ex.verificado ? 'Desmarcar verificado' : 'Marcar verificado'

  // Image
  if (ex.imagen) {
    $('f-imagen').src = `${API_BASE}/images/${encodeURIComponent(ex.imagen)}`
    $('f-imagen-name').textContent = ex.imagen
  } else {
    $('f-imagen').removeAttribute('src')
    $('f-imagen-name').textContent = '(sin imagen)'
  }

  // Video
  const vid = $('f-video')
  if (ex.video) {
    vid.src = `${API_BASE}/videos/${encodeURIComponent(ex.video)}`
    $('f-video-name').textContent = ex.video
    fetch(`${API_BASE}/api/video-exists/${encodeURIComponent(ex.video)}`)
      .then(r => r.json())
      .then(d => {
        $('f-video-status').textContent = d.exists ? '' : '(no encontrado en /videos)'
      })
  } else {
    vid.removeAttribute('src')
    $('f-video-name').textContent = '(sin video)'
    $('f-video-status').textContent = ''
  }

  // Alternativos
  renderAlternativos(ex.nombres_alternativos || [])
  renderSecundarios(ex.musculos_secundarios || [])
  renderPasos(ex.como_hacerlo || [])

  // Variante
  renderVarianteCurrent(ex)
  $('f-variante-search').value = ''
  $('variante-suggestions').innerHTML = ''
}

function renderAlternativos(arr) {
  const c = $('f-alternativos')
  c.innerHTML = ''
  arr.forEach((name, i) => {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<input type="text" value="${escapeAttr(name)}" data-i="${i}"/><button class="del" data-i="${i}">×</button>`
    c.appendChild(row)
    row.querySelector('input').addEventListener('input', e => {
      const ex = currentEx()
      ex.nombres_alternativos[i] = e.target.value
      queuePatch({ nombres_alternativos: ex.nombres_alternativos })
    })
    row.querySelector('.del').addEventListener('click', () => {
      const ex = currentEx()
      ex.nombres_alternativos.splice(i, 1)
      renderAlternativos(ex.nombres_alternativos)
      queuePatch({ nombres_alternativos: ex.nombres_alternativos })
    })
  })
}

function renderSecundarios(arr) {
  const c = $('f-secundarios')
  c.innerHTML = ''
  arr.forEach((s, i) => {
    const row = document.createElement('div')
    row.className = 'row'
    const opts = MUSCLES.map(m => `<option value="${m}" ${m === s.musculo ? 'selected' : ''}>${m}</option>`).join('')
    row.innerHTML = `
      <select class="musculo" data-i="${i}">${opts}</select>
      <input class="weight" type="number" step="0.1" min="0" max="1" value="${s.peso ?? 0.3}" data-i="${i}"/>
      <button class="del" data-i="${i}">×</button>
    `
    c.appendChild(row)
    row.querySelector('.musculo').addEventListener('change', e => {
      const ex = currentEx()
      ex.musculos_secundarios[i].musculo = e.target.value
      queuePatch({ musculos_secundarios: ex.musculos_secundarios })
    })
    row.querySelector('.weight').addEventListener('input', e => {
      const ex = currentEx()
      ex.musculos_secundarios[i].peso = parseFloat(e.target.value)
      queuePatch({ musculos_secundarios: ex.musculos_secundarios })
    })
    row.querySelector('.del').addEventListener('click', () => {
      const ex = currentEx()
      ex.musculos_secundarios.splice(i, 1)
      renderSecundarios(ex.musculos_secundarios)
      queuePatch({ musculos_secundarios: ex.musculos_secundarios })
    })
  })
}

function renderPasos(arr) {
  const c = $('f-pasos')
  c.innerHTML = ''
  arr.forEach((step, i) => {
    const row = document.createElement('div')
    row.className = 'row'
    row.innerHTML = `<input class="step" type="text" value="${escapeAttr(step)}" data-i="${i}"/><button class="del" data-i="${i}">×</button>`
    c.appendChild(row)
    row.querySelector('input').addEventListener('input', e => {
      const ex = currentEx()
      ex.como_hacerlo[i] = e.target.value
      queuePatch({ como_hacerlo: ex.como_hacerlo })
    })
    row.querySelector('.del').addEventListener('click', () => {
      const ex = currentEx()
      ex.como_hacerlo.splice(i, 1)
      renderPasos(ex.como_hacerlo)
      queuePatch({ como_hacerlo: ex.como_hacerlo })
    })
  })
}

function renderAiSuggestions(names) {
  const c = $('ai-suggestions')
  c.innerHTML = `
    <div class="ai-header">
      <span>Sugerencias IA — elegí cuáles agregar</span>
      <button id="ai-accept-all">aceptar todas</button>
    </div>
    ${names.map((name, i) => `
      <div class="ai-suggestion" data-i="${i}">
        <input type="text" value="${escapeAttr(name)}" />
        <button class="accept">+ agregar</button>
        <button class="reject" title="descartar">×</button>
      </div>
    `).join('')}
    <div class="ai-header">
      <span></span>
      <button id="ai-close">cerrar</button>
    </div>
  `

  const acceptOne = (row, ex) => {
    const inputEl = row.querySelector('input')
    const value = inputEl.value.trim()
    if (!value) return
    ex.nombres_alternativos = ex.nombres_alternativos || []
    if (!ex.nombres_alternativos.includes(value)) ex.nombres_alternativos.push(value)
    renderAlternativos(ex.nombres_alternativos)
    queuePatch({ nombres_alternativos: ex.nombres_alternativos })
    row.remove()
  }

  for (const row of c.querySelectorAll('.ai-suggestion')) {
    row.querySelector('.accept').addEventListener('click', () => {
      const ex = currentEx(); if (!ex) return
      acceptOne(row, ex)
    })
    row.querySelector('.reject').addEventListener('click', () => row.remove())
  }

  c.querySelector('#ai-accept-all').addEventListener('click', () => {
    const ex = currentEx(); if (!ex) return
    for (const row of [...c.querySelectorAll('.ai-suggestion')]) acceptOne(row, ex)
    c.innerHTML = ''
  })
  c.querySelector('#ai-close').addEventListener('click', () => { c.innerHTML = '' })
}

function renderVarianteCurrent(ex) {
  const c = $('variante-current')
  if (!ex.variante_de) { c.innerHTML = ''; return }
  const parent = state.byId.get(ex.variante_de)
  c.innerHTML = `
    <span>Es variante de: <strong>${escapeHtml(parent ? parent.nombre_es : '(ejercicio borrado)')}</strong> <span class="muted">${escapeHtml(ex.variante_de)}</span></span>
    <button class="del">quitar</button>
  `
  c.querySelector('.del').addEventListener('click', () => {
    ex.variante_de = null
    renderVarianteCurrent(ex)
    queuePatch({ variante_de: null })
  })
}

// ---------- UI bindings ----------
function bindUI() {
  // Filters
  for (const btn of document.querySelectorAll('.filters [data-filter]')) {
    btn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.filters [data-filter]')) b.classList.remove('active')
      btn.classList.add('active')
      state.filter = btn.dataset.filter
      renderList()
    })
  }
  $('filter-muscle').addEventListener('change', e => {
    state.muscleFilter = e.target.value
    renderList()
  })
  $('search').addEventListener('input', e => {
    state.search = e.target.value
    renderList()
  })

  // Form: simple text fields
  bindField('f-nombre_es', 'nombre_es')
  bindField('f-nombre_en', 'nombre_en')
  bindField('f-tipo', 'tipo')
  bindField('f-musculo', 'musculo')
  bindField('f-equipo', 'equipo')

  // Importance slider
  $('f-importancia').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10)
    $('f-importancia-val').textContent = v
    const ex = currentEx()
    if (!ex) return
    ex.importancia = v
    queuePatch({ importancia: v })
    // re-render list since sort changes
    renderListDebounced()
  })

  // Verify button — only updates the button + stats + list, not the whole form
  $('btn-verify').addEventListener('click', async () => {
    const id = state.currentId
    if (!id) return
    flushPendingPatch()
    const r = await fetch(`${API_BASE}/api/exercises/${id}/verify`, { method: 'POST' })
    const updated = await r.json()
    state.byId.set(id, updated)
    const idx = state.all.findIndex(e => e.id === id)
    if (idx >= 0) state.all[idx] = updated
    const vb = $('btn-verify')
    vb.classList.toggle('is-verified', !!updated.verificado)
    vb.textContent = updated.verificado ? 'Desmarcar verificado' : 'Marcar verificado'
    renderStats()
    renderList()
  })

  // Equipment chip suggestions
  const chipRow = $('equipo-chips')
  chipRow.innerHTML = EQUIPMENT_PRESETS.map(eq => `<span class="chip" data-eq="${eq}">${eq}</span>`).join('')
  for (const chip of chipRow.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      const ex = currentEx()
      if (!ex) return
      const cur = ex.equipo || ''
      const newVal = cur ? `${cur}, ${chip.dataset.eq}` : chip.dataset.eq
      $('f-equipo').value = newVal
      ex.equipo = newVal
      queuePatch({ equipo: newVal })
    })
  }

  // Add buttons
  $('add-alt').addEventListener('click', () => {
    const ex = currentEx(); if (!ex) return
    ex.nombres_alternativos = ex.nombres_alternativos || []
    ex.nombres_alternativos.push('')
    renderAlternativos(ex.nombres_alternativos)
    queuePatch({ nombres_alternativos: ex.nombres_alternativos })
  })
  $('add-sec').addEventListener('click', () => {
    const ex = currentEx(); if (!ex) return
    ex.musculos_secundarios = ex.musculos_secundarios || []
    ex.musculos_secundarios.push({ musculo: 'Core', peso: 0.3 })
    renderSecundarios(ex.musculos_secundarios)
    queuePatch({ musculos_secundarios: ex.musculos_secundarios })
  })
  $('add-step').addEventListener('click', () => {
    const ex = currentEx(); if (!ex) return
    ex.como_hacerlo = ex.como_hacerlo || []
    ex.como_hacerlo.push('')
    renderPasos(ex.como_hacerlo)
    queuePatch({ como_hacerlo: ex.como_hacerlo })
  })

  // Variant search — uses Fuse with the same config as the main search
  let varianteTimer
  $('f-variante-search').addEventListener('input', e => {
    clearTimeout(varianteTimer)
    varianteTimer = setTimeout(() => {
      const q = e.target.value.trim()
      const c = $('variante-suggestions')
      if (!q) { c.innerHTML = ''; return }
      const queryNorm = normalize(q)
      const words = queryNorm.split(/\s+/).filter(Boolean)
      const hits = state.fuse.search(queryNorm)
      const ranked = hits
        .filter(h => h.item.id !== state.currentId)
        .map(h => ({ item: h.item, rank: h.score * 1000 - scoreExercise(h.item, queryNorm, words) }))
      ranked.sort((a, b) => a.rank - b.rank)
      const top = ranked.slice(0, 20).map(r => state.byId.get(r.item.id)).filter(Boolean)
      c.innerHTML = top.map(m => `<div class="sug" data-id="${m.id}"><strong>${escapeHtml(m.nombre_es)}</strong> <span class="muted">${escapeHtml(m.musculo || '')} · ${escapeHtml(m.id)}</span></div>`).join('')
      for (const node of c.querySelectorAll('.sug')) {
        node.addEventListener('click', () => {
          const ex = currentEx(); if (!ex) return
          ex.variante_de = node.dataset.id
          renderVarianteCurrent(ex)
          queuePatch({ variante_de: node.dataset.id })
          $('f-variante-search').value = ''
          c.innerHTML = ''
        })
      }
    }, 150)
  })

  // AI: generate alternativos via LM Studio
  $('gen-alt').addEventListener('click', async () => {
    const ex = currentEx(); if (!ex) return
    flushPendingPatch()
    const btn = $('gen-alt')
    const container = $('ai-suggestions')
    btn.disabled = true
    btn.textContent = '✨ Generando…'
    container.innerHTML = `<div class="ai-loading">Pidiéndole a la IA…</div>`
    try {
      const r = await fetch(`${API_BASE}/api/generate-alternativos/${ex.id}`, { method: 'POST' })
      const data = await r.json()
      if (!r.ok) {
        container.innerHTML = `<div class="ai-error">${escapeHtml(data.error || 'Error desconocido')}</div>`
      } else if (!data.names || data.names.length === 0) {
        container.innerHTML = `<div class="ai-error">La IA no devolvió nombres válidos. Respuesta cruda:<br>${escapeHtml((data.raw || '').slice(0, 300))}</div>`
      } else {
        renderAiSuggestions(data.names)
      }
    } catch (err) {
      container.innerHTML = `<div class="ai-error">Error: ${escapeHtml(err.message)}</div>`
    } finally {
      btn.disabled = false
      btn.textContent = '✨ Generar con IA'
    }
  })

  // Mobile sidebar toggle
  const closeSidebar = () => document.body.classList.remove('sidebar-open')
  $('menu-toggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open')
  })
  $('sidebar-backdrop').addEventListener('click', closeSidebar)
}

function bindField(elementId, field) {
  $(elementId).addEventListener('input', e => {
    const ex = currentEx()
    if (!ex) return
    ex[field] = e.target.value
    queuePatch({ [field]: e.target.value })
  })
}

let listDebounceTimer
function renderListDebounced() {
  clearTimeout(listDebounceTimer)
  listDebounceTimer = setTimeout(renderList, 300)
}

// ---------- Save / patch queue ----------
function currentEx() {
  return state.byId.get(state.currentId)
}

function queuePatch(partial) {
  Object.assign(state.pendingPatch, partial)
  $('save-status').textContent = 'Editando…'
  $('save-status').style.color = '#9ca3af'
  if (state.saveTimer) clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(flushPendingPatch, 600)
}

async function flushPendingPatch() {
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null }
  if (!state.currentId || Object.keys(state.pendingPatch).length === 0) return
  const payload = state.pendingPatch
  const id = state.currentId
  state.pendingPatch = {}
  $('save-status').textContent = 'Guardando…'
  try {
    const r = await fetch(`${API_BASE}/api/exercises/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const updated = await r.json()
    state.byId.set(id, updated)
    const idx = state.all.findIndex(e => e.id === id)
    if (idx >= 0) state.all[idx] = updated
    refreshSearchEntry(updated)
    $('save-status').textContent = 'Guardado ✓'
    $('save-status').style.color = '#22c55e'
  } catch (err) {
    $('save-status').textContent = 'Error al guardar'
    $('save-status').style.color = '#ef4444'
  }
}

function refreshSearchEntry(ex) {
  const idxSearch = state.searchIndex.findIndex(e => e.id === ex.id)
  if (idxSearch < 0) return
  const nombre_es = ex.nombre_es || ''
  const nombre_en = ex.nombre_en || ''
  const sinonimos = Array.isArray(ex.nombres_alternativos) ? ex.nombres_alternativos : []
  const primaryMuscle = muscleTranslations[ex.musculo] || ex.musculo || ''
  const entry = {
    id: ex.id,
    name: nombre_es,
    nameNorm: normalize(nombre_es),
    nameEnNorm: normalize(nombre_en),
    sinonimosNorm: sinonimos.map(s => normalize(s)),
    primaryMuscleNorm: normalize(primaryMuscle),
    equipment: equipmentMap[ex.equipo] || 'bodyweight',
  }
  state.searchIndex[idxSearch] = entry
  state.searchById.set(ex.id, entry)
  // Rebuild Fuse — cheap enough for 2k items, ensures the change is reflected
  state.fuse = new Fuse(state.searchIndex, FUSE_OPTIONS)
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}
function escapeAttr(s) { return escapeHtml(s) }
function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

// Save before leaving
window.addEventListener('beforeunload', () => {
  if (Object.keys(state.pendingPatch).length > 0) {
    navigator.sendBeacon(`${API_BASE}/api/exercises/${state.currentId}`, new Blob([JSON.stringify(state.pendingPatch)], { type: 'application/json' }))
  }
})

init()
