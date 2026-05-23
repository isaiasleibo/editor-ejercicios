import Fuse from '/fuse.min.mjs'

const MUSCLES = ['Biceps','Calves','Chest','Core','Forearms','Glutes','Hamstrings','Lowerback','Quadriceps','Shoulders','Triceps','Upperback']

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
  claude: [],            // target exercises (from Claude JSONs)
  claudeById: new Map(),
  old: [],               // old exercises (source of media)
  oldById: new Map(),
  oldSearchIndex: [],     // transformed entries used by Fuse
  fuse: null,
  filter: 'pending',
  search: '',
  muscleFilter: '',
  candMuscle: '',         // muscle filter for the candidate (old) search
  currentId: null,        // selected claude exercise
  selectedOldId: null,    // candidate currently previewed
}

const $ = (id) => document.getElementById(id)

// ---------- Load ----------
async function init() {
  const [rc, ro] = await Promise.all([
    fetch(`${API_BASE}/api/claude`),
    fetch(`${API_BASE}/api/old`),
  ])
  state.claude = await rc.json()
  state.old = await ro.json()
  for (const e of state.claude) state.claudeById.set(e.id, e)
  for (const e of state.old) state.oldById.set(e.id, e)
  buildVariantMaps()
  buildOldSearchIndex()
  populateMuscleSelect()
  bindUI()
  renderStats()
  renderList()
}

function buildOldSearchIndex() {
  state.oldSearchIndex = state.old.map(ex => {
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
  state.fuse = new Fuse(state.oldSearchIndex, FUSE_OPTIONS)
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

function populateMuscleSelect() {
  for (const m of MUSCLES) {
    $('filter-muscle').insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`)
    $('old-muscle').insertAdjacentHTML('beforeend', `<option value="${m}">${m}</option>`)
  }
}

const isMatched = (ex) => !!ex.matched_con

// Map parentId -> [childId, ...] for variant relationships
function buildVariantMaps() {
  state.childrenOf = new Map()
  for (const e of state.claude) {
    if (!e.variante_de) continue
    if (!state.childrenOf.has(e.variante_de)) state.childrenOf.set(e.variante_de, [])
    state.childrenOf.get(e.variante_de).push(e.id)
  }
}

// ---------- List (left: Claude exercises) ----------
function getFilteredList() {
  let list = state.claude
  if (state.filter === 'pending') list = list.filter(e => !isMatched(e))
  else if (state.filter === 'matched') list = list.filter(e => isMatched(e))
  if (state.muscleFilter) list = list.filter(e => e.musculo === state.muscleFilter)
  const q = state.search.trim()
  if (q) {
    const qn = normalize(q)
    list = list.filter(e =>
      normalize(e.nombre_es || '').includes(qn) ||
      normalize(e.nombre_en || '').includes(qn))
  }
  return list
}

function renderList() {
  const list = getFilteredList()
  const container = $('list')
  const q = state.search.trim()
  $('list-count').textContent = q
    ? `${list.length} resultado${list.length === 1 ? '' : 's'} para "${q}"`
    : `${list.length} ejercicio${list.length === 1 ? '' : 's'}`
  container.innerHTML = list.map(e => {
    const isVar = !!e.variante_de
    const kids = (state.childrenOf.get(e.id) || []).length
    const parent = isVar ? state.claudeById.get(e.variante_de) : null
    const meta = isVar
      ? `<span class="li-arrow">↳</span> variante de ${escapeHtml(parent ? parent.nombre_es : '(padre no encontrado)')}`
      : `${escapeHtml(e.musculo || '?')} · ${escapeHtml(e.equipo || '?')}`
    return `
    <div class="list-item ${isMatched(e) ? 'matched' : ''} ${isVar ? 'is-variant' : ''} ${e.id === state.currentId ? 'active' : ''}" data-id="${e.id}">
      <div class="li-info">
        <div class="li-name">${escapeHtml(e.nombre_es || '(sin nombre)')}</div>
        <div class="li-meta">${meta}</div>
      </div>
      ${isVar ? '<span class="li-tag var">variante</span>' : (kids ? `<span class="li-tag">${kids} var.</span>` : '')}
    </div>`
  }).join('')
  for (const node of container.querySelectorAll('.list-item')) {
    node.addEventListener('click', () => selectClaude(node.dataset.id))
  }
}

function renderStats() {
  const total = state.claude.length
  const matched = state.claude.filter(isMatched).length
  $('stats').textContent = `${matched}/${total} matcheados (${total ? (matched/total*100).toFixed(0) : 0}%)`
}

// ---------- Selection ----------
function selectClaude(id) {
  state.currentId = id
  state.selectedOldId = null
  const ex = state.claudeById.get(id)
  if (!ex) return
  $('empty').classList.add('hidden')
  $('panel').classList.remove('hidden')
  $('save-status').textContent = ''

  $('c-nombre_es').textContent = ex.nombre_es || '(sin nombre)'
  $('c-nombre_en').textContent = ex.nombre_en || ''
  $('c-meta').textContent = `${ex.musculo || '?'} · ${ex.equipo || '?'}`
  $('c-id').textContent = ex.id

  renderClaudeDetails(ex)
  renderVariantBox(ex)
  renderCurrentMatch(ex)
  resetPreview()

  // Default the candidate filter to this exercise's muscle, then auto-suggest
  state.candMuscle = MUSCLES.includes(ex.musculo) ? ex.musculo : ''
  $('old-muscle').value = state.candMuscle
  $('old-search').value = ex.nombre_es || ''
  runSearch(ex.nombre_es || '')

  renderList()
  document.body.classList.remove('sidebar-open')
}

function renderClaudeDetails(ex) {
  const c = $('c-details')
  const sec = Array.isArray(ex.musculos_secundarios) ? ex.musculos_secundarios : []
  const alt = Array.isArray(ex.nombres_alternativos) ? ex.nombres_alternativos : []
  const pasos = Array.isArray(ex.como_hacerlo) ? ex.como_hacerlo : []
  c.innerHTML = `
    <div class="cd-chips">
      <span class="cd-chip">${escapeHtml(ex.tipo || '?')}</span>
      <span class="cd-chip">${escapeHtml(ex.musculo || '?')}</span>
      <span class="cd-chip">${escapeHtml(ex.equipo || '?')}</span>
      <span class="cd-chip imp">Importancia ${escapeHtml(String(ex.importancia ?? '?'))}</span>
    </div>
    ${sec.length ? `
      <div class="cd-block">
        <h4>Músculos secundarios</h4>
        <div class="cd-tags">${sec.map(s => `<span class="cd-tag">${escapeHtml(s.musculo)} <span class="muted">${escapeHtml(String(s.peso ?? ''))}</span></span>`).join('')}</div>
      </div>` : ''}
    ${alt.length ? `
      <div class="cd-block">
        <h4>Nombres alternativos</h4>
        <div class="cd-tags">${alt.map(n => `<span class="cd-tag">${escapeHtml(n)}</span>`).join('')}</div>
      </div>` : ''}
    ${pasos.length ? `
      <div class="cd-block">
        <h4>Cómo hacerlo</h4>
        <ol class="cd-steps">${pasos.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ol>
      </div>` : ''}
  `
}

function renderVariantBox(ex) {
  const c = $('variant-box')
  const parent = ex.variante_de ? state.claudeById.get(ex.variante_de) : null
  const kids = (state.childrenOf.get(ex.id) || []).map(id => state.claudeById.get(id)).filter(Boolean)
  if (!parent && kids.length === 0 && !ex.variante_de) { c.innerHTML = ''; return }

  let html = ''
  if (ex.variante_de) {
    const pName = parent ? escapeHtml(parent.nombre_es) : '(padre no encontrado)'
    const pMatched = parent && isMatched(parent)
    html += `<div class="vb-row"><span class="vb-arrow">↳</span> Es variante de ${parent ? `<button class="vb-link" data-goto="${parent.id}">${pName}</button>` : pName}${pMatched ? ' <span class="vb-ok">✓ ya matcheado</span>' : ''}</div>`
  }
  if (kids.length) {
    html += `<div class="vb-row">Tiene <strong>${kids.length}</strong> variante${kids.length === 1 ? '' : 's'}: ${kids.map(k => `<button class="vb-link ${isMatched(k) ? 'done' : ''}" data-goto="${k.id}">${escapeHtml(k.nombre_es)}</button>`).join(' ')}</div>`
  }
  c.innerHTML = html

  for (const b of c.querySelectorAll('[data-goto]')) {
    b.addEventListener('click', () => selectClaude(b.dataset.goto))
  }
}

function renderCurrentMatch(ex) {
  const c = $('current-match')
  if (!isMatched(ex)) { c.innerHTML = ''; return }
  const old = state.oldById.get(ex.matched_con)
  const oldName = old ? old.nombre_es : '(ejercicio no encontrado)'
  c.innerHTML = `
    <div class="cm-head">
      <span>✓ Matcheado con <strong>${escapeHtml(oldName)}</strong> <span class="muted">${escapeHtml(ex.matched_con)}</span></span>
      <button id="cm-clear" class="cm-clear">quitar match</button>
    </div>
    <div class="cm-media">
      ${ex.imagen ? `<img src="${API_BASE}/images/${encodeURIComponent(ex.imagen)}" alt="" />` : ''}
      ${ex.video ? `<video src="${API_BASE}/videos/${encodeURIComponent(ex.video)}" controls loop muted></video>` : ''}
    </div>
    <div class="muted small">imagen: ${escapeHtml(ex.imagen || '(ninguna)')} · video: ${escapeHtml(ex.video || '(ninguno)')}</div>
  `
  $('cm-clear').addEventListener('click', clearMatch)
}

// ---------- Search candidates (old exercises) ----------
function runSearch(q) {
  const c = $('candidates')
  const query = (q || '').trim()
  if (!query) { c.innerHTML = '<div class="cand-empty">Escribí para buscar candidatos</div>'; return }
  const queryNorm = normalize(query)
  const words = queryNorm.split(/\s+/).filter(Boolean)
  const hits = state.fuse.search(queryNorm)
  const ranked = hits
    .map(h => ({ item: h.item, rank: h.score * 1000 - scoreExercise(h.item, queryNorm, words) }))
  ranked.sort((a, b) => a.rank - b.rank)
  let top = ranked.map(r => state.oldById.get(r.item.id)).filter(Boolean)
  if (state.candMuscle) top = top.filter(m => m.musculo === state.candMuscle)
  top = top.slice(0, 30)
  if (top.length === 0) { c.innerHTML = '<div class="cand-empty">Sin resultados</div>'; return }
  c.innerHTML = top.map(m => `
    <div class="cand ${m.id === state.selectedOldId ? 'sel' : ''}" data-id="${m.id}">
      <div class="cand-thumb">${m.imagen ? `<img src="${API_BASE}/images/${encodeURIComponent(m.imagen)}" alt="" loading="lazy" />` : '<span class="noimg">—</span>'}</div>
      <div class="cand-info">
        <div class="cand-name">${escapeHtml(m.nombre_es)}</div>
        <div class="cand-meta">${escapeHtml(m.musculo || '')} · ${escapeHtml(m.equipo || '')}</div>
      </div>
    </div>
  `).join('')
  for (const node of c.querySelectorAll('.cand')) {
    node.addEventListener('click', () => selectCandidate(node.dataset.id))
  }
}

function selectCandidate(oldId) {
  state.selectedOldId = oldId
  const old = state.oldById.get(oldId)
  for (const node of $('candidates').querySelectorAll('.cand')) {
    node.classList.toggle('sel', node.dataset.id === oldId)
  }
  const p = $('preview')
  if (!old) { resetPreview(); return }
  p.innerHTML = `
    <div class="pv-title">${escapeHtml(old.nombre_es)} <span class="muted">${escapeHtml(old.nombre_en || '')}</span></div>
    <div class="pv-media">
      <div class="pv-block">
        <label>Imagen</label>
        ${old.imagen ? `<img src="${API_BASE}/images/${encodeURIComponent(old.imagen)}" alt="" />` : '<div class="pv-missing">(sin imagen)</div>'}
        <div class="muted small">${escapeHtml(old.imagen || '')}</div>
      </div>
      <div class="pv-block">
        <label>Video</label>
        ${old.video ? `<video src="${API_BASE}/videos/${encodeURIComponent(old.video)}" controls loop muted autoplay></video>` : '<div class="pv-missing">(sin video)</div>'}
        <div class="muted small">${escapeHtml(old.video || '')}</div>
      </div>
    </div>
    <button id="pv-confirm" class="pv-confirm">✓ Copiar imagen y video</button>
  `
  $('pv-confirm').addEventListener('click', () => confirmMatch(oldId))
}

function resetPreview() {
  $('preview').innerHTML = '<div class="preview-empty">Elegí un candidato de la izquierda para ver imagen y video</div>'
}

// ---------- Apply match ----------
function confirmMatch(oldId) {
  const old = state.oldById.get(oldId)
  if (!old) return
  applyMatch({ imagen: old.imagen || '', video: old.video || '', matched_con: old.id })
}

async function applyMatch(payload) {
  const ex = state.claudeById.get(state.currentId)
  if (!ex) return
  $('save-status').textContent = 'Guardando…'
  try {
    const r = await fetch(`${API_BASE}/api/claude/${ex.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const updated = await r.json()
    Object.assign(ex, updated)
    $('save-status').textContent = 'Matcheado ✓'
    $('save-status').style.color = '#22c55e'
    renderStats()
    renderList()
    advanceToNext()
  } catch (err) {
    $('save-status').textContent = 'Error al guardar'
    $('save-status').style.color = '#ef4444'
  }
}

async function clearMatch() {
  const ex = state.claudeById.get(state.currentId)
  if (!ex) return
  try {
    const r = await fetch(`${API_BASE}/api/claude/${ex.id}/clear`, { method: 'POST' })
    const updated = await r.json()
    Object.assign(ex, updated)
    renderCurrentMatch(ex)
    renderStats()
    renderList()
  } catch (err) {
    $('save-status').textContent = 'Error al quitar match'
    $('save-status').style.color = '#ef4444'
  }
}

async function deleteCurrent() {
  const ex = state.claudeById.get(state.currentId)
  if (!ex) return
  if (!confirm(`¿Eliminar "${ex.nombre_es}"?\n\nSe borra del archivo de ejercicios de Claude. Esta acción no se puede deshacer.`)) return
  const id = ex.id
  try {
    const r = await fetch(`${API_BASE}/api/claude/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error('delete failed')
    // Decide which exercise to show next before mutating state
    const order = state.claude
    const curIdx = order.findIndex(e => e.id === id)
    const nextEx = order[curIdx + 1] || order[curIdx - 1] || null
    // Remove from local state
    state.claude = state.claude.filter(e => e.id !== id)
    state.claudeById.delete(id)
    buildVariantMaps()
    renderStats()
    if (nextEx && nextEx.id !== id) {
      selectClaude(nextEx.id)
    } else {
      state.currentId = null
      $('panel').classList.add('hidden')
      $('empty').classList.remove('hidden')
      renderList()
    }
  } catch (err) {
    $('save-status').textContent = 'Error al eliminar'
    $('save-status').style.color = '#ef4444'
  }
}

function advanceToNext() {
  const pending = state.claude.filter(e => !isMatched(e))
  if (pending.length === 0) {
    $('save-status').textContent = '¡Todo matcheado! 🎉'
    renderCurrentMatch(state.claudeById.get(state.currentId))
    return
  }
  // Next pending after the current one (by source order), wrapping around
  const order = state.claude
  const curIdx = order.findIndex(e => e.id === state.currentId)
  let next = null
  for (let i = 1; i <= order.length; i++) {
    const cand = order[(curIdx + i) % order.length]
    if (!isMatched(cand)) { next = cand; break }
  }
  if (next) selectClaude(next.id)
}

// ---------- UI bindings ----------
function bindUI() {
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

  let searchTimer
  $('old-search').addEventListener('input', e => {
    clearTimeout(searchTimer)
    const v = e.target.value
    searchTimer = setTimeout(() => runSearch(v), 150)
  })
  $('old-muscle').addEventListener('change', e => {
    state.candMuscle = e.target.value
    runSearch($('old-search').value)
  })

  $('btn-next').addEventListener('click', advanceToNext)
  $('btn-delete').addEventListener('click', deleteCurrent)

  // Mobile sidebar toggle
  const closeSidebar = () => document.body.classList.remove('sidebar-open')
  $('menu-toggle').addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open')
  })
  $('sidebar-backdrop').addEventListener('click', closeSidebar)
}

// ---------- Utils ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}
function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

init()
