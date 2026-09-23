import React, { useEffect, useState } from 'react'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { bandsFor, rangeText } from '../../lib/bands'
import { ErrorBox, Loading } from '../../components/ui'

const PCT_FIELDS = ['target', 'level3', 'level2', 'level1']

function SettingsForm({ settings, onSaved }) {
  const toForm = (s) => ({ ...s, ...Object.fromEntries(PCT_FIELDS.map((k) => [k, Math.round(Number(s[k]) * 100)])) })
  const [f, setF] = useState(toForm(settings))
  const [msg, setMsg] = useState(null)
  useEffect(() => setF(toForm(settings)), [settings])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function save(e) {
    e.preventDefault(); setMsg(null)
    const body = {
      title: f.title, institution: f.institution, department: f.department, academic_year: f.academic_year,
      shortlist_count: Number(f.shortlist_count), updated_at: new Date().toISOString(),
      ...Object.fromEntries(PCT_FIELDS.map((k) => [k, Number(f[k]) / 100])),
    }
    if (!(body.level3 >= body.level2 && body.level2 >= body.level1)) return setMsg({ kind: 'error', text: 'Level thresholds must go from highest (Level 3) to lowest (Level 1).' })
    try { await q(supabase.from('settings').update(body).eq('id', 1)); setMsg({ kind: 'ok', text: 'Targets saved. Every result now uses them.' }); onSaved() }
    catch (err) { setMsg({ kind: 'error', text: err.message }) }
  }
  return (
    <form className="panel" onSubmit={save}>
      <h2>Targets and attainment levels</h2>
      <p>A team reaches an outcome when its attainment for that outcome is at or above the target. A round's level depends on the share of teams that reach it.</p>
      <div className="form-grid">
        <label>Target per team (%)<input type="number" min="1" max="100" required value={f.target} onChange={set('target')} /></label>
        <label>Level 3 when at least (% of teams)<input type="number" min="1" max="100" required value={f.level3} onChange={set('level3')} /></label>
        <label>Level 2 when at least<input type="number" min="1" max="100" required value={f.level2} onChange={set('level2')} /></label>
        <label>Level 1 when at least<input type="number" min="1" max="100" required value={f.level1} onChange={set('level1')} /></label>
        <label>Teams shortlisted per round<input type="number" min="1" max="20" required value={f.shortlist_count} onChange={set('shortlist_count')} /></label>
      </div>
      <h3>Hackathon details</h3>
      <div className="form-grid">
        <label>Title<input value={f.title} onChange={set('title')} /></label>
        <label>Institution<input value={f.institution} onChange={set('institution')} /></label>
        <label>Department<input value={f.department} onChange={set('department')} /></label>
        <label>Academic year<input value={f.academic_year} onChange={set('academic_year')} /></label>
      </div>
      {msg && <div className={`alert alert-${msg.kind}`}>{msg.text}</div>}
      <button className="btn btn-primary">Save targets</button>
    </form>
  )
}

function CriteriaEditor({ criteria, onSaved }) {
  const [rows, setRows] = useState(criteria)
  const [msg, setMsg] = useState(null)
  useEffect(() => setRows(criteria), [criteria])
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : k === 'is_tiebreak' && v ? { ...r, is_tiebreak: false } : r)))
  const total = rows.reduce((a, r) => a + Number(r.max_marks || 0), 0)

  async function save() {
    setMsg(null)
    try {
      await q(supabase.from('criteria').upsert(rows.map((r, i) => ({
        id: r.id, sort: i + 1, name: r.name, short_name: r.short_name, max_marks: Number(r.max_marks),
        excellent: r.excellent, good: r.good, satisfactory: r.satisfactory, needs_improvement: r.needs_improvement,
        is_tiebreak: !!r.is_tiebreak,
      }))))
      setMsg({ kind: 'ok', text: 'Rubric saved.' }); onSaved()
    } catch (e) { setMsg({ kind: 'error', text: e.message }) }
  }
  async function add() {
    try {
      await q(supabase.from('criteria').insert({ sort: rows.length + 1, name: 'New criterion', short_name: 'New', max_marks: 10 }))
      onSaved()
    } catch (e) { setMsg({ kind: 'error', text: e.message }) }
  }
  async function remove(r) {
    if (!window.confirm(`Delete "${r.name}"? Every mark already given for it is deleted too, and totals change.`)) return
    try { await q(supabase.from('criteria').delete().eq('id', r.id)); onSaved() } catch (e) { setMsg({ kind: 'error', text: e.message }) }
  }
  return (
    <section className="panel">
      <h2>Rubric</h2>
      <p>Total marks: <b>{total}</b>. Changing a maximum rescales every team's percentages immediately; avoid it once scoring has started.</p>
      {rows.map((r, i) => (
        <fieldset key={r.id} className="crit-edit">
          <legend>Criterion {i + 1}</legend>
          <div className="form-grid">
            <label className="span2">Name<input value={r.name} onChange={(e) => set(i, 'name', e.target.value)} /></label>
            <label>Short name<input value={r.short_name} onChange={(e) => set(i, 'short_name', e.target.value)} /></label>
            <label>Maximum marks<input type="number" min="1" step="0.5" value={r.max_marks} onChange={(e) => set(i, 'max_marks', e.target.value)} /></label>
          </div>
          <div className="form-grid">
            {[...bandsFor(r.max_marks || 1)].reverse().map((b) => (
              <label key={b.key}>{b.label} ({rangeText(b)})<textarea rows={3} value={r[b.key]} onChange={(e) => set(i, b.key, e.target.value)} /></label>
            ))}
          </div>
          <div className="crit-edit-foot">
            <label className="check"><input type="radio" name="tiebreak" checked={!!r.is_tiebreak} onChange={() => set(i, 'is_tiebreak', true)} /> <span>Use to break ties</span></label>
            <button type="button" className="btn btn-small btn-danger" onClick={() => remove(r)}>Delete criterion</button>
          </div>
        </fieldset>
      ))}
      {msg && <div className={`alert alert-${msg.kind}`}>{msg.text}</div>}
      <div className="row-gap">
        <button className="btn btn-primary" onClick={save}>Save rubric</button>
        <button className="btn" onClick={add}>Add criterion</button>
      </div>
    </section>
  )
}

function MappingEditor({ criteria, outcomes, mapping, onSaved }) {
  const key = (c, o) => `${c}|${o}`
  const initial = () => Object.fromEntries(mapping.map((m) => [key(m.criterion_id, m.outcome_code), m.weight]))
  const [w, setW] = useState(initial)
  const [msg, setMsg] = useState(null)
  useEffect(() => setW(initial()), [mapping])
  async function save() {
    setMsg(null)
    const rows = criteria.flatMap((c) => outcomes.map((o) => ({ criterion_id: c.id, outcome_code: o.code, weight: Number(w[key(c.id, o.code)] || 0) })))
    try { await q(supabase.from('mapping').upsert(rows)); setMsg({ kind: 'ok', text: 'Mapping saved.' }); onSaved() }
    catch (e) { setMsg({ kind: 'error', text: e.message }) }
  }
  return (
    <section className="panel">
      <h2>Rubric to PO, PSO and SDG mapping</h2>
      <p>3 is a strong link, 2 medium, 1 weak, blank none. A team's attainment for an outcome is the weighted average of its criterion percentages.</p>
      <div className="scroll">
        <table className="table matrix">
          <thead><tr><th>Criterion</th>{outcomes.map((o) => <th key={o.code} className={`c k-${o.kind}`} title={o.name}>{o.code}</th>)}</tr></thead>
          <tbody>
            {criteria.map((c) => (
              <tr key={c.id}>
                <td>{c.short_name}</td>
                {outcomes.map((o) => {
                  const v = w[key(c.id, o.code)] || 0
                  return (
                    <td key={o.code} className={`c w${v}`}>
                      <select value={v} aria-label={`${c.short_name} to ${o.code}`} onChange={(e) => setW({ ...w, [key(c.id, o.code)]: Number(e.target.value) })}>
                        <option value={0}> </option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                      </select>
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr className="sum-row"><td>Criteria linked</td>
              {outcomes.map((o) => <td key={o.code} className="c">{criteria.filter((c) => (w[key(c.id, o.code)] || 0) > 0).length}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      {msg && <div className={`alert alert-${msg.kind}`}>{msg.text}</div>}
      <button className="btn btn-primary" onClick={save}>Save mapping</button>
      <details className="outcome-defs">
        <summary>Outcome definitions</summary>
        <dl>{outcomes.map((o) => <div key={o.code}><dt>{o.code}</dt><dd>{o.name}</dd></div>)}</dl>
      </details>
    </section>
  )
}

export default function Setup() {
  const { data, error, loading, reload } = useLoad(loadReference, [])
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <>
      <div className="page-head">
        <h1>Rubric and targets</h1>
        <p className="lede">Only admins can see this page. Changes apply to every round straight away, including results already calculated.</p>
      </div>
      <SettingsForm settings={data.settings} onSaved={reload} />
      <MappingEditor criteria={data.criteria} outcomes={data.outcomes} mapping={data.mapping} onSaved={reload} />
      <CriteriaEditor criteria={data.criteria} onSaved={reload} />
    </>
  )
}
