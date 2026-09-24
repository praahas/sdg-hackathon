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

export default function TeamHome({ profile }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [ref, events, mine] = await Promise.all([
      loadReference(),
      q(supabase.from('events').select('*').order('sort')),
      q(supabase.from('teams').select('*').eq('owner_id', profile.id).order('id')),
    ])
    return { ref, events, mine }
  }, [profile.id])
  const [editing, setEditing] = useState(false)
  const [done, setDone] = useState(null)

  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, events, mine } = data
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
        <Notice key={f.id} kind="ok">Your team has been shortlisted for <b>{evById[f.event_id]?.name}</b>.</Notice>
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
