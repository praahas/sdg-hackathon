import React, { useMemo, useState } from 'react'
import { supabase, q, qAll } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { ErrorBox, Loading } from '../../components/ui'
import { RATING_LABELS } from '../../components/FeedbackForm'

const KINDS = { rating: 'Rating 1–5', choice: 'Single choice', text: 'Comment' }
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)

// Summary of one question over a set of responses.
function summarise(qn, responses) {
  const vals = responses.map((r) => r.answers?.[qn.id]).filter((v) => v !== undefined && v !== null && v !== '')
  if (qn.kind === 'rating') {
    const counts = [1, 2, 3, 4, 5].map((k) => vals.filter((v) => Number(v) === k).length)
    const avg = vals.length ? vals.reduce((a, v) => a + Number(v), 0) / vals.length : null
    return { n: vals.length, avg, counts }
  }
  if (qn.kind === 'choice') {
    const opts = [...new Set([...qn.options, ...vals])]
    return { n: vals.length, opts: opts.map((o) => [o, vals.filter((v) => v === o).length]) }
  }
  return { n: vals.length, comments: responses.filter((r) => String(r.answers?.[qn.id] ?? '').trim()) }
}

function Bars({ rows, total }) {
  return (
    <div className="fb-bars">
      {rows.map(([label, n]) => (
        <div key={label} className="fb-bar">
          <span>{label}</span>
          <div className="fb-bar-track"><div className="fb-bar-fill" style={{ width: `${pct(n, total)}%` }} /></div>
          <span className="muted">{n} ({pct(n, total)}%)</span>
        </div>
      ))}
    </div>
  )
}

const SCALE_COLORS = ['#b3432f', '#d98a3a', '#c9b44a', '#6e9a3a', '#1e7a5f']

function RatingRow({ qn, s }) {
  return (
    <div className="fb-rate">
      <div className="fb-rate-q">{qn.prompt}{!qn.active && <span className="muted small"> (removed)</span>}</div>
      <div className="fb-rate-avg"><b>{s.avg === null ? '—' : s.avg.toFixed(2)}</b><small className="muted"> / 5</small></div>
      <div className="fb-stack" title={s.counts.map((n, k) => `${k + 1} ${RATING_LABELS[k]}: ${n}`).join('\n')}>
        {s.counts.map((n, k) => n > 0 && (
          <div key={k} style={{ width: `${pct(n, s.n)}%`, background: SCALE_COLORS[k] }}>{pct(n, s.n) >= 8 ? `${pct(n, s.n)}%` : ''}</div>
        ))}
      </div>
      <div className="fb-rate-n muted small">{s.n}</div>
    </div>
  )
}

function Results({ questions, responses, teamById }) {
  if (!responses.length) return <p className="muted">No responses yet.</p>
  const shown = questions.filter((qn) => qn.active || responses.some((r) => r.answers?.[qn.id] !== undefined))
  const ratings = shown.filter((qn) => qn.kind === 'rating')
  return (
    <div className="fb-results">
      {ratings.length > 0 && (
        <div className="fb-res">
          <div className="fb-legend">{RATING_LABELS.map((l, k) => <span key={k}><i style={{ background: SCALE_COLORS[k] }} />{k + 1} {l}</span>)}</div>
          <div className="fb-rate fb-rate-head muted small"><div>Rating questions</div><div>Average</div><div>Spread of answers</div><div>Answers</div></div>
          {ratings.map((qn) => <RatingRow key={qn.id} qn={qn} s={summarise(qn, responses)} />)}
        </div>
      )}
      {shown.filter((qn) => qn.kind !== 'rating').map((qn) => {
        const s = summarise(qn, responses)
        return (
          <div key={qn.id} className="fb-res">
            <h3>{qn.prompt}{!qn.active && <span className="muted small"> (removed question)</span>}</h3>
            {qn.kind === 'choice' && <><span className="muted small">{s.n} response{s.n === 1 ? '' : 's'}</span><Bars total={s.n} rows={s.opts} /></>}
            {qn.kind === 'text' && (s.comments.length
              ? <ul className="fb-comments">{s.comments.map((r) => (
                  <li key={r.id}>{r.answers[qn.id]}<small className="muted">{r.member_name}, {teamById[r.team_id]?.team_code} {teamById[r.team_id]?.name}</small></li>
                ))}</ul>
              : <p className="muted small">No comments.</p>)}
          </div>
        )
      })}
    </div>
  )
}

function QuestionEditor({ questions, reload, setMsg }) {
  const [draft, setDraft] = useState({})
  const [adding, setAdding] = useState({ kind: 'rating', prompt: '', options: '', required: true })
  const active = questions.filter((x) => x.active)
  const val = (qn, k) => (draft[qn.id]?.[k] ?? (k === 'options' ? qn.options.join(', ') : qn[k]))
  const setD = (qn, k, v) => setDraft({ ...draft, [qn.id]: { ...draft[qn.id], [k]: v } })
  const opts = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean)
  async function run(fn, ok) {
    setMsg(null)
    try { await fn(); if (ok) setMsg({ kind: 'ok', text: ok }); await reload() } catch (e) { setMsg({ kind: 'error', text: e.message }) }
  }
  const save = (qn) => run(async () => {
    const d = draft[qn.id] || {}
    const body = { prompt: (d.prompt ?? qn.prompt).trim(), kind: d.kind ?? qn.kind, required: d.required ?? qn.required,
      options: d.options !== undefined ? opts(d.options) : qn.options }
    if (!body.prompt) throw new Error('A question needs some text.')
    if (body.kind === 'choice' && body.options.length < 2) throw new Error('A single-choice question needs at least two options, separated by commas.')
    await q(supabase.from('feedback_questions').update(body).eq('id', qn.id))
    setDraft({ ...draft, [qn.id]: undefined })
  }, 'Question saved.')
  const move = (i, dir) => run(async () => {
    const list = [...active]; const j = i + dir; [list[i], list[j]] = [list[j], list[i]]
    await Promise.all(list.map((x, k) => q(supabase.from('feedback_questions').update({ sort: k + 1 }).eq('id', x.id))))
  })
  const remove = (qn) => run(() => q(supabase.from('feedback_questions').update({ active: false }).eq('id', qn.id)),
    'Question removed from the form. Answers already given stay in the results.')
  const add = () => run(async () => {
    const body = { kind: adding.kind, prompt: adding.prompt.trim(), required: adding.required, options: adding.kind === 'choice' ? opts(adding.options) : [],
      sort: Math.max(0, ...questions.map((x) => x.sort)) + 1 }
    if (!body.prompt) throw new Error('Type the question first.')
    if (body.kind === 'choice' && body.options.length < 2) throw new Error('A single-choice question needs at least two options, separated by commas.')
    await q(supabase.from('feedback_questions').insert(body))
    setAdding({ kind: 'rating', prompt: '', options: '', required: true })
  }, 'Question added.')

  return (
    <section className="panel">
      <h2>Questions</h2>
      <p>The same form is used for every round. Ratings use a 1–5 scale (Poor, Fair, Good, Very good, Excellent). Removing a question takes it off the form but keeps the answers already given.</p>
      {active.map((qn, i) => {
        const dirty = draft[qn.id] && Object.values(draft[qn.id]).some((v) => v !== undefined)
        return (
          <div key={qn.id} className="fb-q-edit">
            <label>Question {i + 1}<input value={val(qn, 'prompt')} onChange={(e) => setD(qn, 'prompt', e.target.value)} /></label>
            <label>Type<select value={val(qn, 'kind')} onChange={(e) => setD(qn, 'kind', e.target.value)}>
              {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {val(qn, 'kind') === 'choice' && (
              <label style={{ gridColumn: '1 / -1' }}>Options, separated by commas<input value={val(qn, 'options')} onChange={(e) => setD(qn, 'options', e.target.value)} /></label>
            )}
            <div className="fb-q-actions">
              <label className="check"><input type="checkbox" checked={val(qn, 'required')} onChange={(e) => setD(qn, 'required', e.target.checked)} /> Required</label>
              {dirty && <button className="btn btn-small btn-primary" onClick={() => save(qn)}>Save</button>}
              <button className="btn btn-small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button className="btn btn-small" disabled={i === active.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
              <button className="btn btn-small btn-danger" onClick={() => remove(qn)}>Remove</button>
            </div>
          </div>
        )
      })}
      <div className="fb-q-edit">
        <label>New question<input value={adding.prompt} onChange={(e) => setAdding({ ...adding, prompt: e.target.value })} placeholder="e.g. Quality of the venue and facilities" /></label>
        <label>Type<select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>
          {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {adding.kind === 'choice' && (
          <label style={{ gridColumn: '1 / -1' }}>Options, separated by commas<input value={adding.options} onChange={(e) => setAdding({ ...adding, options: e.target.value })} placeholder="e.g. Yes, Maybe, No" /></label>
        )}
        <div className="fb-q-actions">
          <label className="check"><input type="checkbox" checked={adding.required} onChange={(e) => setAdding({ ...adding, required: e.target.checked })} /> Required</label>
          <button className="btn btn-small btn-primary" onClick={add}>Add question</button>
        </div>
      </div>
    </section>
  )
}

async function exportExcel(events, questions, responses, teamById, settings, roundId) {
  const XLSX = await import('xlsx')
  const evName = (id) => events.find((e) => e.id === id)?.name ?? ''
  const rs = roundId ? responses.filter((r) => r.event_id === roundId) : responses
  const qs = questions.filter((qn) => qn.active || rs.some((r) => r.answers?.[qn.id] !== undefined))
  const wb = XLSX.utils.book_new()
  const summary = []
  for (const qn of qs) {
    const s = summarise(qn, rs)
    if (qn.kind === 'rating') {
      summary.push({ Question: qn.prompt, Type: KINDS[qn.kind], Responses: s.n, 'Average (out of 5)': s.avg === null ? '' : Math.round(s.avg * 100) / 100,
        ...Object.fromEntries(s.counts.map((n, k) => [`${k + 1} ${RATING_LABELS[k]}`, n])) })
    } else if (qn.kind === 'choice') {
      summary.push({ Question: qn.prompt, Type: KINDS[qn.kind], Responses: s.n, Breakdown: s.opts.map(([o, n]) => `${o}: ${n}`).join('; ') })
    } else {
      summary.push({ Question: qn.prompt, Type: KINDS[qn.kind], Responses: s.n })
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary.length ? summary : [{ Note: 'No questions' }]), 'Summary')
  const rows = rs.map((r) => ({
    Round: evName(r.event_id), 'Team code': teamById[r.team_id]?.team_code ?? '', Team: teamById[r.team_id]?.name ?? '',
    Member: r.member_name, USN: r.usn ?? '', Submitted: new Date(r.updated_at || r.submitted_at).toLocaleString(),
    ...Object.fromEntries(qs.map((qn, i) => [`Q${i + 1}. ${qn.prompt}`.slice(0, 250), r.answers?.[qn.id] ?? ''])),
  }))
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No responses yet' }]), 'Responses')
  const tag = roundId ? events.find((e) => e.id === roundId)?.code : 'all_rounds'
  XLSX.writeFile(wb, `Feedback_${tag}.xlsx`.replace(/[^\w.-]+/g, '_'))
}

export default function Feedback() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [settings, events, questions, overview, responses, teams] = await Promise.all([
      q(supabase.from('settings').select('*').eq('id', 1).single()),
      q(supabase.from('events').select('*').order('sort')),
      q(supabase.from('feedback_questions').select('*').order('sort').order('id')),
      q(supabase.rpc('feedback_overview')),
      qAll(() => supabase.from('feedback_responses').select('*').order('id')),
      qAll(() => supabase.from('teams').select('id, team_code, name, event_id').order('id')),
    ])
    return { settings, events, questions, overview, responses, teams }
  }, [])
  const [msg, setMsg] = useState(null)
  const [round, setRound] = useState(0)
  const teamById = useMemo(() => Object.fromEntries((data?.teams || []).map((t) => [t.id, t])), [data])
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { settings, events, questions, overview, responses } = data
  const act = async (fn, ok) => { setMsg(null); try { await fn(); setMsg({ kind: 'ok', text: ok }); await reload() } catch (e) { setMsg({ kind: 'error', text: e.message }) } }
  const shown = round ? responses.filter((r) => r.event_id === round) : responses

  return (
    <>
      <div className="page-head">
        <h1>Feedback</h1>
        <p className="lede">Students give feedback on the event from the team portal, one response per member per round. Open feedback for a round when it ends; you can also require feedback before a member's certificate can be downloaded.</p>
      </div>
      {msg && <div className={`alert alert-${msg.kind}`} role="status"><span>{msg.text}</span></div>}

      <section className="panel">
        <h2>Rounds</h2>
        <div className="scroll">
          <table className="table cert-table">
            <thead><tr><th>Round</th><th>Collecting feedback</th><th>Required for certificates</th><th className="r">Responses</th><th /></tr></thead>
            <tbody>
              {events.map((e) => {
                const o = overview.find((x) => x.event_id === e.id) || { members: 0, responses: 0 }
                return (
                  <tr key={e.id}>
                    <td><b>{e.name}</b></td>
                    <td>
                      <button className={`btn btn-small ${e.feedback_open ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => act(() => q(supabase.from('events').update({ feedback_open: !e.feedback_open }).eq('id', e.id)),
                          e.feedback_open ? `${e.name}: feedback closed.` : `${e.name}: teams can now give feedback from the team portal.`)}>
                        {e.feedback_open ? 'Close feedback' : 'Open feedback'}</button>
                      {e.feedback_open && <small className="tag tag-open block-tag">Open</small>}
                    </td>
                    <td>
                      <label className="check"><input type="checkbox" checked={e.feedback_required}
                        onChange={() => act(() => q(supabase.from('events').update({ feedback_required: !e.feedback_required }).eq('id', e.id)),
                          e.feedback_required ? `${e.name}: certificates no longer need feedback.` : `${e.name}: members must give feedback before downloading their certificate.`)} /> Required</label>
                      {e.feedback_required && !e.feedback_open && <small className="field-error block">Feedback is closed, so members who haven't responded can't download their certificates.</small>}
                    </td>
                    <td className="r"><b>{o.responses}</b> <span className="muted">of {o.members}</span>{o.members > 0 && <small className="muted block">{pct(o.responses, o.members)}%</small>}</td>
                    <td><div className="cert-actions">
                      <button className="btn btn-small" disabled={!o.responses} onClick={() => { setRound(e.id); document.getElementById('fb-results')?.scrollIntoView({ behavior: 'smooth' }) }}>View results</button>
                      <button className="btn btn-small" disabled={!o.responses} onClick={() => exportExcel(events, questions, responses, teamById, settings, e.id)}>Excel</button>
                    </div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" id="fb-results">
        <div className="panel-row">
          <h2 className="grow">Results</h2>
          <label>Round<select value={round} onChange={(e) => setRound(Number(e.target.value))}>
            <option value={0}>All rounds ({responses.length})</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name} ({responses.filter((r) => r.event_id === e.id).length})</option>)}
          </select></label>
          <button className="btn" disabled={!shown.length} onClick={() => exportExcel(events, questions, responses, teamById, settings, round)}>Download Excel</button>
        </div>
        <Results questions={questions} responses={shown} teamById={teamById} />
      </section>

      <QuestionEditor questions={questions} reload={reload} setMsg={setMsg} />
    </>
  )
}
