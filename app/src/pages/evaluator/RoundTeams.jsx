import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { num } from '../../lib/format'
import { ErrorBox, Loading, Notice, SdgChip } from '../../components/ui'

export default function RoundTeams({ profile }) {
  const { eventId } = useParams()
  const { data, error, loading, reload } = useLoad(async () => {
    const [ref, event, teams] = await Promise.all([
      loadReference(),
      q(supabase.from('events').select('*').eq('id', eventId).single()),
      q(supabase.from('teams').select('*').eq('event_id', eventId).order('team_code').order('id')),
    ])
    const ids = teams.map((t) => t.id)
    const scores = ids.length
      ? await q(supabase.from('scores').select('team_id, score').eq('evaluator_id', profile.id).in('team_id', ids))
      : []
    return { ref, event, teams, scores }
  }, [eventId, profile.id])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, event, teams, scores } = data
  const n = ref.criteria.length

  return (
    <>
      <div className="page-head">
        <Link to="/score" className="back">Your rounds</Link>
        <h1>{event.name}</h1>
        <p className="lede">{teams.length} teams. Tap a team to score it; you can come back and change your marks until the admin closes scoring.</p>
      </div>
      {event.locked && <Notice kind="warn">Scoring for this round is closed. Your marks are shown read-only.</Notice>}
      {teams.length === 0 && <div className="empty"><h2>No teams yet</h2><p>The admin hasn't added teams to this round.</p></div>}
      <ul className="team-list">
        {teams.map((t) => {
          const mine = scores.filter((s) => s.team_id === t.id)
          const total = mine.reduce((a, s) => a + Number(s.score), 0)
          const state = mine.length === 0 ? 'todo' : mine.length >= n ? 'done' : 'part'
          return (
            <li key={t.id}>
              <Link to={`/score/${eventId}/${t.id}`} className={`team-row state-${state}`}>
                <span className="team-code">{t.team_code || '—'}</span>
                <span className="team-main">
                  <b>{t.name}</b>
                  <span className="muted">{t.problem}</span>
                </span>
                <SdgChip sdg={ref.sdgById[t.primary_sdg]} compact />
                <span className="team-state">
                  {state === 'todo' && 'Not scored'}
                  {state === 'part' && `${mine.length} of ${n} criteria`}
                  {state === 'done' && `${num(total)} / ${num(ref.maxTotal)}`}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </>
  )
}
