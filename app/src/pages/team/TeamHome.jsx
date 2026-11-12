import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { ErrorBox, Loading, Notice, SdgChip } from '../../components/ui'
import TeamForm from '../../components/TeamForm'

const rpcArgs = (v) => ({
  p_name: v.name, p_members: v.members, p_phone: v.phone, p_primary: v.primary,
  p_secondary: v.secondary, p_targets: v.targets, p_problem: v.problem,
})

function ProblemChooser({ team, round, options, sdgById, onChosen }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [changing, setChanging] = useState(false)
  const chosen = options.find((p) => p.id === team.problem_statement_id)
  const canChoose = round?.ps_selection_open
  async function choose(p) {
    setBusy(p.id); setErr(null)
    try {
      await q(supabase.rpc('select_problem_statement', { p_team: team.id, p_ps: p.id }))
      setChanging(false)
      await onChosen(`You chose ${p.code}: ${p.title} for ${round.name}.`)
    } catch (e) { setErr(e.message) } finally { setBusy(null) }
  }
  const showList = !chosen || changing
  return (
    <section className={`panel ps-choose ${chosen ? '' : 'panel-attn'}`}>
      <h2>Problem statement for {round?.name}</h2>
      {chosen && !changing && (
        <div className="ps-card chosen">
          <div className="ps-card-head"><b>{chosen.code}</b> <span>{chosen.title}</span></div>
          {chosen.description && <p>{chosen.description}</p>}
          <div className="chips">{[chosen.primary_sdg, chosen.secondary_sdg].filter(Boolean).map((id) => <SdgChip key={id} sdg={sdgById[id]} />)}
            {chosen.sdg_targets && <small className="muted">Targets {chosen.sdg_targets}</small>}</div>
          {canChoose
            ? <button className="btn btn-small" onClick={() => setChanging(true)}>Change problem statement</button>
            : <p className="muted small">Selection is closed. Contact the coordinator to change it.</p>}
        </div>
      )}
      {showList && (
        <>
          <p className="muted">{canChoose
            ? 'Choose the problem your team will solve in this round. Your SDGs for this round come from the statement you choose, and evaluators will rate how well you advance them.'
            : "The coordinator hasn't opened problem statement selection yet. You can read the statements now."}</p>
          <div className="ps-cards">
            {options.map((p) => (
              <div key={p.id} className={`ps-card ${p.id === team.problem_statement_id ? 'chosen' : ''}`}>
                <div className="ps-card-head"><b>{p.code}</b> <span>{p.title}</span></div>
                {p.description && <p>{p.description}</p>}
                <div className="chips">{[p.primary_sdg, p.secondary_sdg].filter(Boolean).map((id) => <SdgChip key={id} sdg={sdgById[id]} compact />)}
                  {p.sdg_targets && <small className="muted">Targets {p.sdg_targets}</small>}</div>
                {canChoose && p.id !== team.problem_statement_id && (
                  <button className="btn btn-small btn-primary" disabled={busy !== null} onClick={() => choose(p)}>
                    {busy === p.id ? 'Saving…' : 'Choose this'}
                  </button>
                )}
              </div>
            ))}
          </div>
          {changing && <button className="btn btn-small" onClick={() => setChanging(false)}>Keep my current choice</button>}
        </>
      )}
      {err && <div className="alert alert-error" role="alert">{err}</div>}
    </section>
  )
}

export default function TeamHome({ profile }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [ref, events, mine] = await Promise.all([
      loadReference(),
      q(supabase.from('events').select('*').order('sort')),
      q(supabase.from('teams').select('*').eq('owner_id', profile.id).order('id')),
    ])
    const ids = [...new Set(mine.map((t) => t.event_id))]
    const pss = ids.length ? await q(supabase.from('problem_statements').select('*').in('event_id', ids).order('code')) : []
    return { ref, events, mine, pss }
  }, [profile.id])
  const [editing, setEditing] = useState(false)
  const [done, setDone] = useState(null)

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, events, mine, pss } = data
  const evById = Object.fromEntries(events.map((e) => [e.id, e]))
  const team = mine.find((t) => evById[t.event_id]?.kind === 'intra')
  const finals = mine.filter((t) => evById[t.event_id]?.kind === 'inter')
  const openRounds = events.filter((e) => e.kind === 'intra' && e.registration_open)

  if (!team) {
    return (
      <>
        <div className="page-head">
          <h1>Register your team</h1>
          <p className="lede">Fill in your team's details once. You can edit them until registration closes or evaluation of your team begins.</p>
        </div>
        {openRounds.length === 0 ? (
          <div className="empty">
            <h2>Registration isn't open yet</h2>
            <p>The coordinator opens registration for each section's round. Check back later, or ask your coordinator when it opens.</p>
            <button className="btn" onClick={reload}>Check again</button>
          </div>
        ) : (
          <TeamForm sdgs={ref.sdgs} settings={ref.settings} rounds={openRounds} submitLabel="Register team"
            onSubmit={async (v) => {
              await q(supabase.rpc('register_team', { p_event: v.event_id, ...rpcArgs(v) }))
              setDone('Your team is registered.'); await reload()
            }} />
        )}
      </>
    )
  }

  const round = evById[team.event_id]
  if (editing) {
    return (
      <>
        <div className="page-head"><h1>Edit registration</h1></div>
        <TeamForm sdgs={ref.sdgs} settings={ref.settings} initial={team} fixedRound={round} submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (v) => {
            await q(supabase.rpc('update_my_team', { p_team: team.id, ...rpcArgs(v) }))
            setEditing(false); setDone('Changes saved.'); await reload()
          }} />
      </>
    )
  }

  const members = team.member_list?.length ? team.member_list : null
  return (
    <>
      <div className="page-head">
        <p className="muted">{round?.name}</p>
        <h1>{team.name} <span className="team-code-big">{team.team_code}</span></h1>
      </div>
      {done && <Notice kind="ok">{done}</Notice>}
      {finals.map((f) => (
        <Notice key={f.id} kind="ok"><span>Your team qualified for <b>{evById[f.event_id]?.name}</b>.</span></Notice>
      ))}
      {mine.filter((t) => pss.some((p) => p.event_id === t.event_id)).map((t) => (
        <ProblemChooser key={t.id} team={t} round={evById[t.event_id]} options={pss.filter((p) => p.event_id === t.event_id)}
          sdgById={ref.sdgById} onChosen={async (msg) => { setDone(msg); await reload() }} />
      ))}
      <section className="panel team-card">
        <dl className="kv">
          <div><dt>Members</dt><dd>{members ? <ol>{members.map((m, i) => <li key={i}>{m.name}{m.usn ? <span className="muted"> {m.usn}</span> : null}</li>)}</ol> : team.members}</dd></div>
          <div><dt>Contact</dt><dd>{team.contact_email}{team.contact_phone ? `, ${team.contact_phone}` : ''}</dd></div>
          <div><dt>SDGs</dt><dd className="chips"><SdgChip sdg={ref.sdgById[team.primary_sdg]} />{team.secondary_sdg && <SdgChip sdg={ref.sdgById[team.secondary_sdg]} />}</dd></div>
          {team.sdg_targets && <div><dt>SDG targets</dt><dd>{team.sdg_targets}</dd></div>}
          <div><dt>Problem and solution</dt><dd className="prewrap">{team.problem}</dd></div>
        </dl>
        <div className="row-gap">
          {round?.registration_open
            ? <button className="btn" onClick={() => { setDone(null); setEditing(true) }}>Edit details</button>
            : <span className="muted small">Registration for this round is closed. Contact the coordinator to change anything.</span>}
          <Link className="btn btn-primary" to="/team/leaderboard">View leaderboard</Link>
        </div>
      </section>
    </>
  )
}
