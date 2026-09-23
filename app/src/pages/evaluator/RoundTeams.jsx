import React from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { num } from '../../lib/format'
import { ErrorBox, Loading, Notice, SdgChip } from '../../components/ui'
import { claimedSdgs } from '../../lib/sdgStrength'

export default function RoundTeams({ profile }) {
  const { eventId } = useParams()
  const { data, error, loading, reload } = useLoad(async () => {
    const [ref, event, teams] = await Promise.all([
      loadReference(),
      q(supabase.from('events').select('*').eq('id', eventId).single()),
      q(supabase.from('teams').select('*').eq('event_id', eventId).order('team_code').order('id')),
    ])
    const ids = teams.map((t) => t.id)
    const [scores, ratings] = ids.length
      ? await Promise.all([
          q(supabase.from('scores').select('team_id, score').eq('evaluator_id', profile.id).in('team_id', ids)),
          q(supabase.from('sdg_ratings').select('team_id').eq('evaluator_id', profile.id).in('team_id', ids)),
        ])
      : [[], []]
    return { ref, event, teams, scores, ratings }
  }, [eventId, profile.id])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, event, teams, scores, ratings } = data
  const n = ref.criteria.length

  return (
    <>
      <div className="page-head">
        <Link to="/score" className="back">Your rounds</Link>
        <h1>{event.name}</h1>
        <p className="lede">{teams.length} teams. Tap a team to mark the rubric and rate its SDG contribution; you can come back and change your marks until the admin closes scoring.</p>
      </div>
      {event.locked && <Notice kind="warn">Scoring for this round is closed. Your marks are shown read-only.</Notice>}
      {teams.length === 0 && <div className="empty"><h2>No teams yet</h2><p>The admin hasn't added teams to this round.</p></div>}
      <ul className="team-list">
        {teams.map((t) => {
          const mine = scores.filter((s) => s.team_id === t.id)
          const total = mine.reduce((a, s) => a + Number(s.score), 0)
          const rated = ratings.filter((r) => r.team_id === t.id).length
          const need = n + claimedSdgs(t).length
          const got = mine.length + rated
          const state = got === 0 ? 'todo' : got >= need ? 'done' : 'part'
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
                  {state === 'part' && `${got} of ${need} items`}
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
