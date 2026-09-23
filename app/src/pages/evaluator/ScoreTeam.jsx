import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { bandOf, bandsFor, rangeText } from '../../lib/bands'
import { num } from '../../lib/format'
import { ErrorBox, Loading, Notice, SdgChip } from '../../components/ui'

function isInvalid(value, max) {
  if (value === '' || value === undefined) return false
  const n = Number(value)
  return Number.isNaN(n) || n < 0 || n > Number(max)
}

function CriterionScorer({ c, value = '', onChange, disabled }) {
  const bands = useMemo(() => bandsFor(c.max_marks), [c.max_marks])
  const current = bandOf(bands, value)
  const invalid = isInvalid(value, c.max_marks)
  const step = (d) => {
    const base = value === '' || Number.isNaN(Number(value)) ? 0 : Number(value)
    const next = Math.min(Number(c.max_marks), Math.max(0, Math.round((base + d) * 2) / 2))
    onChange(String(next))
  }
  return (
    <section className={`crit ${current ? `crit-l${current.level}` : ''}`}>
      <header className="crit-head">
        <h3>{c.name}{c.is_tiebreak && <span className="tag" title="Used to break ties in total score">Tie-break</span>}</h3>
        <div className="stepper">
          <button type="button" onClick={() => step(-0.5)} disabled={disabled} aria-label={`Lower ${c.short_name} by half a mark`}>−</button>
          <input type="number" inputMode="decimal" step="0.5" min="0" max={c.max_marks} value={value}
            onChange={(e) => onChange(e.target.value)} disabled={disabled}
            aria-label={`Mark for ${c.name}, out of ${num(c.max_marks)}`} aria-invalid={invalid} />
          <button type="button" onClick={() => step(0.5)} disabled={disabled} aria-label={`Raise ${c.short_name} by half a mark`}>+</button>
          <span className="outof">/ {num(c.max_marks)}</span>
        </div>
      </header>
      <div className="bandbar" role="group" aria-label={`Rubric bands for ${c.short_name}`}>
        {bands.map((b) => (
          <button key={b.key} type="button" disabled={disabled}
            className={`band band-${b.level} ${current?.key === b.key ? 'on' : ''}`}
            style={{ flexGrow: b.hi - b.lo + 1 }}
            aria-pressed={current?.key === b.key}
            onClick={() => { if (current?.key !== b.key) onChange(String(b.hi)) }}>
            <span className="band-full">{b.label}</span><span className="band-short" aria-hidden="true">{b.short}</span><small>{rangeText(b)}</small>
          </button>
        ))}
      </div>
      <p className="descriptor">
        {current
          ? <><b>{current.label}:</b> {c[current.key]}</>
          : <span className="muted">Tap the band that fits best. It sets the top mark of that band; fine-tune with − and +.</span>}
      </p>
      {invalid && <p className="field-error">Enter a mark from 0 to {num(c.max_marks)}.</p>}
      <details className="all-bands">
        <summary>All descriptors</summary>
        <dl>{[...bands].reverse().map((b) => (<div key={b.key}><dt>{b.label} ({rangeText(b)})</dt><dd>{c[b.key]}</dd></div>))}</dl>
      </details>
    </section>
  )
}

export default function ScoreTeam({ profile }) {
  const { eventId, teamId } = useParams()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useLoad(async () => {
    const [ref, event, teams, mine] = await Promise.all([
      loadReference(),
      q(supabase.from('events').select('*').eq('id', eventId).single()),
      q(supabase.from('teams').select('*').eq('event_id', eventId).order('team_code').order('id')),
      q(supabase.from('scores').select('*').eq('team_id', teamId).eq('evaluator_id', profile.id)),
    ])
    return { ref, event, teams, mine }
  }, [eventId, teamId, profile.id])

  const [values, setValues] = useState({})
  const [saved, setSaved] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!data) return
    const v = {}
    data.mine.forEach((s) => { v[s.criterion_id] = String(Number(s.score)) })
    setValues(v); setSaved(v); setMsg(null)
  }, [data])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, event, teams } = data
  const team = teams.find((t) => String(t.id) === String(teamId))
  if (!team) return <ErrorBox error="This team isn't in the round, or you aren't assigned to it." />

  const locked = event.locked
  const idx = teams.findIndex((t) => t.id === team.id)
  const next = teams[idx + 1], prev = teams[idx - 1]
  const filled = ref.criteria.filter((c) => (values[c.id] ?? '') !== '')
  const anyInvalid = ref.criteria.some((c) => isInvalid(values[c.id], c.max_marks))
  const total = filled.reduce((a, c) => a + (isInvalid(values[c.id], c.max_marks) ? 0 : Number(values[c.id])), 0)
  const dirty = ref.criteria.some((c) => (values[c.id] ?? '') !== (saved[c.id] ?? ''))

  const go = (t) => {
    if (dirty && !window.confirm('You have unsaved marks for this team. Leave without saving?')) return
    navigate(`/score/${eventId}/${t.id}`)
  }

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const rows = filled.map((c) => ({ team_id: team.id, criterion_id: c.id, evaluator_id: profile.id, score: Number(values[c.id]) }))
      const cleared = ref.criteria.filter((c) => (values[c.id] ?? '') === '' && (saved[c.id] ?? '') !== '').map((c) => c.id)
      if (rows.length) await q(supabase.from('scores').upsert(rows, { onConflict: 'team_id,criterion_id,evaluator_id' }))
      if (cleared.length) await q(supabase.from('scores').delete().eq('team_id', team.id).eq('evaluator_id', profile.id).in('criterion_id', cleared))
      setSaved({ ...values })
      setMsg({ kind: 'ok', text: filled.length === ref.criteria.length ? 'Scores saved.' : `Scores saved. ${ref.criteria.length - filled.length} criteria still need a mark.` })
    } catch (e) {
      setMsg({ kind: 'error', text: `Scores not saved: ${e.message}` })
    } finally { setBusy(false) }
  }

  return (
    <div className="score-page">
      <div className="page-head">
        <Link to={`/score/${eventId}`} className="back">{event.name}</Link>
        <div className="team-head">
          <div>
            <p className="muted">{team.team_code}</p>
            <h1>{team.name}</h1>
            {team.problem && <p className="lede">{team.problem}</p>}
            {team.members && <p className="muted small">{team.members}</p>}
          </div>
          <div className="team-sdgs">
            <SdgChip sdg={ref.sdgById[team.primary_sdg]} />
            {team.secondary_sdg && <SdgChip sdg={ref.sdgById[team.secondary_sdg]} />}
          </div>
        </div>
      </div>
      {locked && <Notice kind="warn">Scoring for this round is closed, so these marks can't be changed.</Notice>}

      {ref.criteria.map((c) => (
        <CriterionScorer key={c.id} c={c} value={values[c.id] ?? ''} disabled={locked || busy}
          onChange={(v) => setValues((s) => ({ ...s, [c.id]: v }))} />
      ))}

      <div className="savebar">
        <div className="savebar-total">
          <b>{num(total)}</b><span>/ {num(ref.maxTotal)}</span>
          <small>{filled.length} of {ref.criteria.length} criteria marked{dirty ? ', unsaved changes' : ''}</small>
        </div>
        {msg && <span className={`savebar-msg ${msg.kind}`} role="status">{msg.text}</span>}
        <div className="savebar-actions">
          {prev && <button className="btn" onClick={() => go(prev)}>Previous team</button>}
          {!locked && <button className="btn btn-primary" onClick={save} disabled={busy || anyInvalid || !dirty}>{busy ? 'Saving…' : 'Save scores'}</button>}
          {next && <button className="btn" onClick={() => go(next)}>Next team</button>}
        </div>
      </div>
    </div>
  )
}
