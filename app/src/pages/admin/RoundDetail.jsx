import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { num, pct } from '../../lib/format'
import { ErrorBox, Loading, SdgSelect } from '../../components/ui'
import { claimedSdgs } from '../../lib/sdgStrength'

const blankTeam = { team_code: '', name: '', members: '', primary_sdg: null, secondary_sdg: null, problem: '' }

function TeamRow({ team, sdgs, onSaved, onDeleted, origin }) {
  const [t, setT] = useState(team)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => setT(team), [team])
  const dirty = ['team_code', 'name', 'members', 'primary_sdg', 'secondary_sdg', 'problem'].some((k) => (t[k] ?? '') !== (team[k] ?? ''))
  const set = (k) => (v) => setT({ ...t, [k]: v })
  async function save() {
    setBusy(true); setErr(null)
    try {
      await q(supabase.from('teams').update({
        team_code: t.team_code, name: t.name, members: t.members,
        primary_sdg: t.primary_sdg, secondary_sdg: t.secondary_sdg, problem: t.problem,
      }).eq('id', team.id))
      onSaved()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  async function remove() {
    if (!window.confirm(`Delete ${team.name}? Any marks already given to this team are deleted too.`)) return
    try { await q(supabase.from('teams').delete().eq('id', team.id)); onDeleted() } catch (e) { setErr(e.message) }
  }
  return (
    <tr className={dirty ? 'row-dirty' : ''}>
      <td><input value={t.team_code ?? ''} onChange={(e) => set('team_code')(e.target.value)} aria-label="Team ID" className="w-code" /></td>
      <td>
        <input value={t.name ?? ''} onChange={(e) => set('name')(e.target.value)} aria-label="Team name" />
        {origin && <small className="muted">From {origin}</small>}
      </td>
      <td><input value={t.members ?? ''} onChange={(e) => set('members')(e.target.value)} aria-label="Members" /></td>
      <td><SdgSelect sdgs={sdgs} value={t.primary_sdg} onChange={set('primary_sdg')} /></td>
      <td><SdgSelect sdgs={sdgs} value={t.secondary_sdg} onChange={set('secondary_sdg')} /></td>
      <td><input value={t.problem ?? ''} onChange={(e) => set('problem')(e.target.value)} aria-label="Problem statement" /></td>
      <td className="actions">
        <button className="btn btn-small btn-primary" disabled={!dirty || busy || !t.name} onClick={save}>Save</button>
        <button className="btn btn-small btn-danger" onClick={remove}>Delete</button>
        {err && <small className="field-error">{err}</small>}
      </td>
    </tr>
  )
}

function parseBulk(text) {
  // One team per line, pasted from Excel: Team ID, Team name, Members, Primary SDG no., Secondary SDG no., Problem statement.
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line) => {
    const p = line.includes('\t') ? line.split('\t') : line.split('|')
    const sdg = (v) => { const n = parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10); return n >= 1 && n <= 17 ? n : null }
    return { team_code: (p[0] ?? '').trim(), name: (p[1] ?? '').trim(), members: (p[2] ?? '').trim(),
      primary_sdg: sdg(p[3]), secondary_sdg: sdg(p[4]), problem: (p[5] ?? '').trim() }
  }).filter((t) => t.name)
}

export default function RoundDetail() {
  const { eventId } = useParams()
  const { data, error, loading, reload } = useLoad(async () => {
    const [ref, event, allEvents, teams, profiles, ee, results] = await Promise.all([
      loadReference(),
      q(supabase.from('events').select('*').eq('id', eventId).single()),
      q(supabase.from('events').select('*').order('sort')),
      q(supabase.from('teams').select('*').eq('event_id', eventId).order('team_code').order('id')),
      q(supabase.from('profiles').select('*').order('full_name')),
      q(supabase.from('event_evaluators').select('*').eq('event_id', eventId)),
      q(supabase.from('v_team_result').select('*').eq('event_id', eventId)),
    ])
    const ids = teams.map((t) => t.id)
    const [scoreRows, ratingRows] = ids.length
      ? await Promise.all([
          q(supabase.from('scores').select('team_id, evaluator_id').in('team_id', ids)),
          q(supabase.from('sdg_ratings').select('team_id, evaluator_id').in('team_id', ids)),
        ])
      : [[], []]
    const scores = [...scoreRows, ...ratingRows]
    const originIds = teams.map((t) => t.origin_team_id).filter(Boolean)
    const origins = originIds.length ? await q(supabase.from('teams').select('id, event_id').in('id', originIds)) : []
    return { ref, event, allEvents, teams, profiles, ee, results, scores, origins }
  }, [eventId])

  const [meta, setMeta] = useState({ event_date: '', venue: '' })
  const [newTeam, setNewTeam] = useState(blankTeam)
  const [bulk, setBulk] = useState('')
  const [msg, setMsg] = useState(null)
  useEffect(() => { if (data) setMeta({ event_date: data.event.event_date ?? '', venue: data.event.venue ?? '' }) }, [data])

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, event, allEvents, teams, profiles, ee, results, scores, origins } = data
  const assigned = new Set(ee.map((x) => x.evaluator_id))
  const sources = allEvents.filter((e) => e.feeds_into === event.id)
  const evName = (id) => allEvents.find((e) => e.id === id)?.name
  const originName = (t) => { const o = origins.find((x) => x.id === t.origin_team_id); return o ? evName(o.event_id) : null }
  const nCrit = ref.criteria.length

  const act = async (fn, okText) => {
    setMsg(null)
    try { await fn(); if (okText) setMsg({ kind: 'ok', text: okText }); reload() } catch (e) { setMsg({ kind: 'error', text: e.message }) }
  }

  const toggleEvaluator = (pid) => act(() => assigned.has(pid)
    ? q(supabase.from('event_evaluators').delete().eq('event_id', event.id).eq('evaluator_id', pid))
    : q(supabase.from('event_evaluators').insert({ event_id: event.id, evaluator_id: pid })))

  const saveMeta = () => act(() => q(supabase.from('events').update({ event_date: meta.event_date || null, venue: meta.venue || null }).eq('id', event.id)), 'Round details saved.')
  const toggleLock = () => {
    if (!event.locked && !window.confirm('Close scoring for this round? Evaluators will no longer be able to change their marks. You can reopen it later.')) return
    act(() => q(supabase.from('events').update({ locked: !event.locked }).eq('id', event.id)), event.locked ? 'Scoring reopened.' : 'Scoring closed.')
  }
  const pull = () => {
    if (teams.length && !window.confirm('Replace the teams pulled earlier with the current shortlist?')) return
    act(async () => {
      const n = await q(supabase.rpc('promote_shortlist', { p_inter: event.id }))
      setMsg({ kind: 'ok', text: `${n} shortlisted teams added to this round.` })
    })
  }
  const addTeam = () => act(async () => {
    await q(supabase.from('teams').insert({ ...newTeam, event_id: event.id }))
    setNewTeam(blankTeam)
  }, 'Team added.')
  const addBulk = () => {
    const rows = parseBulk(bulk)
    if (!rows.length) return setMsg({ kind: 'error', text: 'No teams found. Paste one team per line with at least a team name in the second column.' })
    act(async () => { await q(supabase.from('teams').insert(rows.map((r) => ({ ...r, event_id: event.id })))); setBulk('') }, `${rows.length} teams added.`)
  }

  const resultOf = (id) => results.find((r) => r.team_id === id)
  const evaluators = profiles.filter((p) => assigned.has(p.id))

  return (
    <>
      <div className="page-head">
        <Link to="/admin/rounds" className="back">Rounds and teams</Link>
        <h1>{event.name}</h1>
        <p className="lede">{event.kind === 'inter'
          ? `Finalists come from ${sources.map((s) => s.name).join(' and ') || 'the section rounds'}. The top ${ref.settings.shortlist_count} here are shortlisted.`
          : `The top ${ref.settings.shortlist_count} teams go on to ${evName(event.feeds_into) || 'the inter-section round'}.`}</p>
      </div>
      {msg && <div className={`alert alert-${msg.kind === 'ok' ? 'ok' : 'error'}`} role="status">{msg.text}</div>}

      <section className="panel panel-row">
        <label>Date<input type="date" value={meta.event_date} onChange={(e) => setMeta({ ...meta, event_date: e.target.value })} /></label>
        <label className="grow">Venue / coordinator<input value={meta.venue} onChange={(e) => setMeta({ ...meta, venue: e.target.value })} /></label>
        <button className="btn" onClick={saveMeta}>Save details</button>
        <div className="spacer" />
        <div className="lock-box">
          <span>{event.locked ? 'Scoring is closed.' : 'Scoring is open.'}</span>
          <button className={`btn ${event.locked ? '' : 'btn-danger'}`} onClick={toggleLock}>{event.locked ? 'Reopen scoring' : 'Close scoring'}</button>
        </div>
      </section>

      {event.kind === 'inter' && (
        <section className="panel">
          <h2>Finalists</h2>
          <p>Pull the current top {ref.settings.shortlist_count} of each section round into this round. Do this once both section rounds are fully scored; it can't be repeated once finalists have marks or SDG ratings.</p>
          <button className="btn btn-primary" onClick={pull}>Pull shortlisted teams</button>
        </section>
      )}

      <section className="panel">
        <h2>Evaluators</h2>
        {profiles.length === 0 ? <p className="muted">No accounts yet.</p> : (
          <div className="check-grid">
            {profiles.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={assigned.has(p.id)} onChange={() => toggleEvaluator(p.id)} />
                <span>{p.full_name || p.email}<small className="muted">{p.email}{p.role === 'admin' ? ', admin' : ''}</small></span>
              </label>
            ))}
          </div>
        )}
        <p className="muted small">Evaluators create their own account from the sign-in page; they then appear here.</p>
      </section>

      <section className="panel">
        <h2>Scoring progress and results</h2>
        {teams.length === 0 ? <p className="muted">Add teams below to start.</p> : (
          <div className="scroll">
            <table className="table">
              <thead>
                <tr><th>Team</th>{evaluators.map((p) => <th key={p.id} className="c">{p.full_name || p.email}</th>)}
                  <th className="r">Total</th><th className="r">Score %</th><th className="r">Rank</th><th>Status</th></tr>
              </thead>
              <tbody>
                {teams.map((t) => {
                  const r = resultOf(t.id)
                  return (
                    <tr key={t.id}>
                      <td><b>{t.team_code}</b> {t.name}</td>
                      {evaluators.map((p) => {
                        const n = scores.filter((s) => s.team_id === t.id && s.evaluator_id === p.id).length
                        const need = nCrit + claimedSdgs(t).length
                        return <td key={p.id} className={`c prog ${n === 0 ? 'p0' : n >= need ? 'p2' : 'p1'}`}>{n === 0 ? '—' : n >= need ? 'Done' : `${n}/${need}`}</td>
                      })}
                      <td className="r">{r?.total != null ? num(r.total) : '—'}</td>
                      <td className="r">{pct(r?.pct)}</td>
                      <td className="r">{r?.rank ?? '—'}</td>
                      <td>{r?.status === 'Shortlisted' ? <span className="tag tag-open">Shortlisted</span> : (r?.status ?? '')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Teams ({teams.length})</h2>
        <div className="scroll">
          <table className="table table-edit">
            <thead><tr><th>Team ID</th><th>Team name</th><th>Members</th><th>Primary SDG</th><th>Secondary SDG</th><th>Problem statement</th><th /></tr></thead>
            <tbody>
              {teams.map((t) => <TeamRow key={t.id} team={t} sdgs={ref.sdgs} origin={originName(t)} onSaved={reload} onDeleted={reload} />)}
              <tr className="row-new">
                <td><input value={newTeam.team_code} onChange={(e) => setNewTeam({ ...newTeam, team_code: e.target.value })} placeholder="3A-01" className="w-code" aria-label="New team ID" /></td>
                <td><input value={newTeam.name} onChange={(e) => setNewTeam({ ...newTeam, name: e.target.value })} placeholder="Team name" aria-label="New team name" /></td>
                <td><input value={newTeam.members} onChange={(e) => setNewTeam({ ...newTeam, members: e.target.value })} placeholder="USNs / names" aria-label="New team members" /></td>
                <td><SdgSelect sdgs={ref.sdgs} value={newTeam.primary_sdg} onChange={(v) => setNewTeam({ ...newTeam, primary_sdg: v })} /></td>
                <td><SdgSelect sdgs={ref.sdgs} value={newTeam.secondary_sdg} onChange={(v) => setNewTeam({ ...newTeam, secondary_sdg: v })} /></td>
                <td><input value={newTeam.problem} onChange={(e) => setNewTeam({ ...newTeam, problem: e.target.value })} placeholder="Problem statement" aria-label="New team problem statement" /></td>
                <td><button className="btn btn-small btn-primary" disabled={!newTeam.name} onClick={addTeam}>Add team</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <details className="bulk">
          <summary>Add many teams at once</summary>
          <p className="small">Copy rows from Excel and paste below, one team per line, in this column order: Team ID, Team name, Members, Primary SDG number, Secondary SDG number, Problem statement.</p>
          <textarea rows={6} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'3A-01\tAquaSense\tUSN1, USN2, USN3\t6\t\tLow-cost water quality monitor'} />
          <button className="btn btn-primary" onClick={addBulk} disabled={!bulk.trim()}>Add pasted teams</button>
        </details>
      </section>
    </>
  )
}
