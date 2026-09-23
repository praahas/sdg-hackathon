// Builds the formatted evaluation workbook: the same Excel file the department uses,
// with every input cell filled from the app. All totals, attainment, levels, SDG tables,
// the Dashboard and the charts are the workbook's own formulas, recalculated by Excel on open.
import JSZip from 'jszip'
import { supabase, q } from './supabase'
import { loadReference } from './reference'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'
const NC = 9, NO = 13, FIRST = 7
const EW = NC + 2
const C_E = [9, 9 + EW, 9 + 2 * EW]
const SHEET_FOR = { '3A': '3A Intra', '3B': '3B Intra', '3-INTER': '3 Inter', '5A': '5A Intra', '5B': '5B Intra', '5-INTER': '5 Inter' }

const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) } return s }
const colNum = (s) => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0)
const ordinal = (n) => (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th')
const sectionLabel = (e) => (e ? `${e.semester}${ordinal(e.semester)} Sem - ${e.section ?? ''}`.trim() : '')
const sdgText = (g) => (g ? `SDG ${g.id} - ${g.name}` : null)
const who = (p) => (p ? p.full_name || p.email : null)
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

class Sheet {
  constructor(xml) {
    this.doc = new DOMParser().parseFromString(xml, 'application/xml')
    this.data = this.doc.getElementsByTagNameNS(NS, 'sheetData')[0]
    this.rows = new Map()
    for (const r of Array.from(this.data.childNodes)) if (r.localName === 'row') this.rows.set(Number(r.getAttribute('r')), r)
  }
  row(n) {
    let r = this.rows.get(n)
    if (r) return r
    r = this.doc.createElementNS(NS, 'row')
    r.setAttribute('r', String(n))
    const next = [...this.rows.keys()].filter((k) => k > n).sort((a, b) => a - b)[0]
    this.data.insertBefore(r, next ? this.rows.get(next) : null)
    this.rows.set(n, r)
    return r
  }
  cell(ref) {
    const [, col, rowNo] = /^([A-Z]+)(\d+)$/.exec(ref)
    const row = this.row(Number(rowNo))
    row.removeAttribute('spans')
    const cn = colNum(col)
    let before = null
    for (const c of Array.from(row.childNodes)) {
      if (c.localName !== 'c') continue
      const cc = colNum(/^[A-Z]+/.exec(c.getAttribute('r'))[0])
      if (cc === cn) return c
      if (cc > cn) { before = c; break }
    }
    const c = this.doc.createElementNS(NS, 'c')
    c.setAttribute('r', ref)
    row.insertBefore(c, before)
    return c
  }
  // Replaces whatever the cell held (value or formula) and keeps its formatting.
  set(ref, value) {
    const c = this.cell(ref)
    while (c.firstChild) c.removeChild(c.firstChild)
    c.removeAttribute('t')
    if (value === null || value === undefined || value === '') return
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return
      const v = this.doc.createElementNS(NS, 'v'); v.textContent = String(value); c.appendChild(v)
    } else {
      c.setAttribute('t', 'inlineStr')
      const is = this.doc.createElementNS(NS, 'is'); const t = this.doc.createElementNS(NS, 't')
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve'); t.textContent = String(value)
      is.appendChild(t); c.appendChild(is)
    }
  }
  xml() {
    const out = new XMLSerializer().serializeToString(this.doc)
    return out.startsWith('<?xml') ? out : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${out}`
  }
}

async function openTemplate() {
  const res = await fetch(`${import.meta.env.BASE_URL}report-template.xlsx`)
  if (!res.ok) throw new Error('The report template (report-template.xlsx) could not be loaded. Check that it is in the app\'s public folder and redeploy.')
  const zip = await JSZip.loadAsync(await res.arrayBuffer())
  const parser = new DOMParser()
  const wb = parser.parseFromString(await zip.file('xl/workbook.xml').async('string'), 'application/xml')
  const rels = parser.parseFromString(await zip.file('xl/_rels/workbook.xml.rels').async('string'), 'application/xml')
  const target = {}
  for (const r of Array.from(rels.getElementsByTagName('Relationship'))) target[r.getAttribute('Id')] = r.getAttribute('Target')
  const paths = {}
  for (const s of Array.from(wb.getElementsByTagNameNS(NS, 'sheet'))) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id')
    const t = target[rid]
    paths[s.getAttribute('name')] = t.startsWith('/') ? t.slice(1) : `xl/${t}`
  }
  const open = {}
  const sheet = async (name) => {
    if (!paths[name]) throw new Error(`The report template has no sheet called "${name}".`)
    if (!open[name]) open[name] = new Sheet(await zip.file(paths[name]).async('string'))
    return open[name]
  }
  const save = async () => {
    for (const [name, sh] of Object.entries(open)) zip.file(paths[name], sh.xml())
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' })
  }
  return { sheet, save }
}

export async function downloadWorkbookReport() {
  const [ref, events, teams, scores, ratings, profiles, assignments] = await Promise.all([
    loadReference(),
    q(supabase.from('events').select('*').order('sort')),
    q(supabase.from('teams').select('*')),
    q(supabase.from('scores').select('team_id, criterion_id, evaluator_id, score')),
    q(supabase.from('sdg_ratings').select('team_id, sdg_id, evaluator_id, strength')),
    q(supabase.from('profiles').select('id, full_name, email')),
    q(supabase.from('event_evaluators').select('*')),
  ])
  if (ref.criteria.length !== NC || ref.outcomes.length !== NO) {
    throw new Error(`The formatted workbook is laid out for ${NC} rubric criteria and ${NO} outcomes, but the app now has ${ref.criteria.length} criteria and ${ref.outcomes.length} outcomes. Use "Download data export" instead.`)
  }
  const warnings = []
  const { sheet, save } = await openTemplate()
  const s = ref.settings

  // Settings and rubric → PO/PSO mapping
  const m = await sheet('Mapping')
  m.set('C3', s.title); m.set('C4', s.institution); m.set('C5', s.department); m.set('C6', s.academic_year)
  m.set('C7', num(s.target)); m.set('C8', num(s.level3)); m.set('C9', num(s.level2)); m.set('C10', num(s.level1))
  m.set('C11', num(s.shortlist_count)); m.set('C12', num(s.sdg_strength_target ?? 2))
  ref.criteria.forEach((c, k) => ref.outcomes.forEach((o, j) => {
    const w = ref.mapping.find((x) => x.criterion_id === c.id && x.outcome_code === o.code)?.weight ?? 0
    m.set(`${colName(4 + j)}${15 + k}`, w > 0 ? w : null)
  }))

  // Rubric text and maximum marks
  const ru = await sheet('Rubric')
  ref.criteria.forEach((c, k) => {
    const r = 4 + k
    ru.set(`B${r}`, c.name); ru.set(`C${r}`, c.short_name); ru.set(`D${r}`, num(c.max_marks))
    ru.set(`E${r}`, c.excellent); ru.set(`F${r}`, c.good); ru.set(`G${r}`, c.satisfactory); ru.set(`H${r}`, c.needs_improvement)
  })
  const tb = ref.criteria.findIndex((c) => c.is_tiebreak)
  if (tb !== -1 && tb !== 3) warnings.push(`The app breaks ties on "${ref.criteria[tb].short_name}", but the workbook always uses criterion 4. Ranks may differ only where totals are tied.`)

  // SDG names, written in the same form the team cells use
  const sl = await sheet('SDG List')
  ref.sdgs.forEach((g, i) => sl.set(`A${2 + i}`, sdgText(g)))

  // Rounds
  const evById = Object.fromEntries(events.map((e) => [e.id, e]))
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]))
  for (const e of events) {
    const name = SHEET_FOR[e.code]
    if (!name) { warnings.push(`"${e.name}" has no sheet in the workbook, so it was left out.`); continue }
    const ws = await sheet(name)
    const cap = e.kind === 'intra' ? 20 : 10
    const ts = teams.filter((t) => t.event_id === e.id).sort(e.kind === 'inter'
      ? (a, b) => a.id - b.id
      : (a, b) => (a.team_code || '').localeCompare(b.team_code || '', undefined, { numeric: true }) || a.id - b.id)
    if (ts.length > cap) warnings.push(`${e.name} has ${ts.length} teams; the workbook sheet holds ${cap}, so ${ts.length - cap} were left out.`)
    const ids = new Set(ts.map((t) => t.id))
    const marked = [...new Set([...scores, ...ratings].filter((x) => ids.has(x.team_id)).map((x) => x.evaluator_id))]
    let evs = (marked.length ? marked : assignments.filter((a) => a.event_id === e.id).map((a) => a.evaluator_id))
      .map((id) => profiles.find((p) => p.id === id)).filter(Boolean)
      .sort((a, b) => (who(a) || '').localeCompare(who(b) || ''))
    if (evs.length > 3) warnings.push(`${e.name}: ${evs.length} evaluators gave marks, but the workbook has room for 3. Only ${evs.slice(0, 3).map(who).join(', ')} are included.`)
    evs = evs.slice(0, 3)

    ws.set('B2', e.event_date ? new Date(e.event_date).toLocaleDateString('en-GB') : null)
    ws.set('E2', e.venue || null)
    C_E.forEach((cs, i) => ws.set(`${colName(cs + 2)}3`, who(evs[i])))

    for (let i = 0; i < cap; i++) {
      const r = FIRST + i
      const t = ts[i]
      const secondary = t && t.secondary_sdg && t.secondary_sdg !== t.primary_sdg ? t.secondary_sdg : null
      const origin = t?.origin_team_id ? evById[teamById[t.origin_team_id]?.event_id] : null
      ws.set(`B${r}`, t ? sectionLabel(e.kind === 'inter' ? origin : e) || null : null)
      ws.set(`C${r}`, t?.team_code || null)
      ws.set(`D${r}`, t?.name || null)
      ws.set(`E${r}`, t?.members || null)
      ws.set(`F${r}`, t ? sdgText(ref.sdgById[t.primary_sdg]) : null)
      ws.set(`G${r}`, secondary ? sdgText(ref.sdgById[secondary]) : null)
      ws.set(`H${r}`, t?.problem || null)
      C_E.forEach((cs, j) => {
        const ev = t && evs[j]
        ref.criteria.forEach((c, k) => {
          const sc = ev && scores.find((x) => x.team_id === t.id && x.evaluator_id === ev.id && x.criterion_id === c.id)
          ws.set(`${colName(cs + k)}${r}`, sc ? num(sc.score) : null)
        })
        const rate = (sdg) => {
          const x = ev && sdg && ratings.find((y) => y.team_id === t.id && y.evaluator_id === ev.id && y.sdg_id === sdg)
          return x ? num(x.strength) : null
        }
        ws.set(`${colName(cs + NC)}${r}`, t ? rate(t.primary_sdg) : null)
        ws.set(`${colName(cs + NC + 1)}${r}`, t ? rate(secondary) : null)
      })
    }
  }

  const blob = await save()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(s.title || 'SDG Hackathon').replace(/[^\w-]+/g, '_')}_Evaluation_Workbook.xlsx`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  return warnings
}
