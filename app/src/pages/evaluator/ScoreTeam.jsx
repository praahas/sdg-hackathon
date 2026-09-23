import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { bandOf, bandsFor, rangeText } from '../../lib/bands'
import { num } from '../../lib/format'
import { ErrorBox, Loading, Notice, SdgChip } from '../../components/ui'
import { STRENGTHS, claimedSdgs } from '../../lib/sdgStrength'

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


function SdgRater({ sdg, isPrimary, value, onChange, disabled }) {
  const current = STRENGTHS.find((x) => String(x.value) === String(value))
  return (
    <section className={`crit sdg-rate ${current ? `crit-l${current.value}` : ''}`} style={{ '--sdg': sdg?.color }}>
      <header className="crit-head">
        <h3>How strongly does this solution advance SDG {sdg?.id}: {sdg?.name}?
          <span className="tag">{isPrimary ? 'Primary SDG' : 'Secondary SDG'}</span></h3>
      </header>
      <div className="bandbar strength-bar" role="radiogroup" aria-label={`Contribution strength for SDG ${sdg?.id}`}>
        {STRENGTHS.map((x) => (
          <button key={x.value} type="button" role="radio" aria-checked={current?.value === x.value} disabled={disabled}
            className={`band band-${x.value} ${current?.value === x.value ? 'on' : ''}`}
            onClick={() => onChange(String(x.value))}>
            <span>{x.label}</span><small>{x.value}</small>
          </button>
        ))}
      </div>
      <p className="descriptor">
        {current
          ? <><b>{current.label} ({current.value}):</b> {current.desc}</>
          : <span className="muted">Rate the solution's contribution to this goal, not the overall quality of the project.</span>}
      </p>
      {current && !disabled && <button type="button" className="btn-link small" onClick={() => onChange('')}>Clear rating</button>}
    </section>
  )
}

export default function ScoreTeam({ profile }) {
  const { eventId, teamId } = useParams()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useLoad(async () => {
    const [ref, event, teams, mine, mineSdg] = await Promise.all([
      loadReference(),
      q(supabase.from('events').select('*').eq('id', eventId).single()),
      q(supabase.from('teams').select('*').eq('event_id', eventId).order('team_code').order('id')),
      q(supabase.from('scores').select('*').eq('team_id', teamId).eq('evaluator_id', profile.id)),
      q(supabase.from('sdg_ratings').select('*').eq('team_id', teamId).eq('evaluator_id', profile.id)),
    ])
    return { ref, event, teams, mine, mineSdg }
  }, [eventId, teamId, profile.id])

  const [values, setValues] = useState({})
  const [saved, setSaved] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!data) return
    const v = {}
    data.mine.forEach((s) => { v[s.criterion_id] = String(Number(s.score)) })
    data.mineSdg.forEach((r) => { v[`sdg${r.sdg_id}`] = String(r.strength) })
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
  const claimed = claimedSdgs(team)
  const sdgKey = (id) => `sdg${id}`
  const ratedSdgs = claimed.filter((id) => (values[sdgKey(id)] ?? '') !== '')
  const dirty = [...ref.criteria.map((c) => c.id), ...claimed.map(sdgKey)].some((k) => (values[k] ?? '') !== (saved[k] ?? ''))
  const remaining = (ref.criteria.length - filled.length) + (claimed.length - ratedSdgs.length)

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
      const sdgRows = ratedSdgs.map((id) => ({ team_id: team.id, sdg_id: id, evaluator_id: profile.id, strength: Number(values[sdgKey(id)]) }))
      const sdgCleared = claimed.filter((id) => (values[sdgKey(id)] ?? '') === '' && (saved[sdgKey(id)] ?? '') !== '')
      if (sdgRows.length) await q(supabase.from('sdg_ratings').upsert(sdgRows, { onConflict: 'team_id,sdg_id,evaluator_id' }))
      if (sdgCleared.length) await q(supabase.from('sdg_ratings').delete().eq('team_id', team.id).eq('evaluator_id', profile.id).in('sdg_id', sdgCleared))
      setSaved({ ...values })
      setMsg({ kind: 'ok', text: remaining === 0 ? 'Scores saved.' : `Scores saved. ${remaining} item${remaining === 1 ? '' : 's'} still to rate.` })
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

      <h2 className="section-title">SDG contribution</h2>
      {claimed.length === 0
        ? <Notice kind="warn">This team hasn't chosen an SDG yet, so there is nothing to rate here. Ask the admin to set the team's SDG.</Notice>
        : claimed.map((id, i) => (
          <SdgRater key={id} sdg={ref.sdgById[id]} isPrimary={i === 0 && id === team.primary_sdg}
            value={values[sdgKey(id)] ?? ''} disabled={locked || busy}
            onChange={(v) => setValues((s) => ({ ...s, [sdgKey(id)]: v }))} />
        ))}

      <div className="savebar">
        <div className="savebar-total">
          <b>{num(total)}</b><span>/ {num(ref.maxTotal)}</span>
          <small>{filled.length} of {ref.criteria.length} criteria marked, {ratedSdgs.length} of {claimed.length} SDGs rated{dirty ? ', unsaved changes' : ''}</small>
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
