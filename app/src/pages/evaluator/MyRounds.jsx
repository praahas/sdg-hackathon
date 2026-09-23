import React from 'react'
import { Link } from 'react-router-dom'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { ErrorBox, Loading } from '../../components/ui'

export default function MyRounds({ profile }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const rows = await q(supabase.from('event_evaluators').select('event_id, events(*)').eq('evaluator_id', profile.id))
    const events = rows.map((r) => r.events).filter(Boolean).sort((a, b) => a.sort - b.sort)
    if (!events.length) return { events: [] }
    const ids = events.map((e) => e.id)
    const [teams, scores, criteria] = await Promise.all([
      q(supabase.from('teams').select('id, event_id').in('event_id', ids)),
      q(supabase.from('scores').select('team_id').eq('evaluator_id', profile.id)),
      q(supabase.from('criteria').select('id')),
    ])
    const perTeam = {}
    scores.forEach((s) => { perTeam[s.team_id] = (perTeam[s.team_id] || 0) + 1 })
    const stats = Object.fromEntries(ids.map((id) => {
      const ts = teams.filter((t) => t.event_id === id)
      return [id, { teams: ts.length, done: ts.filter((t) => perTeam[t.id] >= criteria.length).length }]
    }))
    return { events, stats }
  }, [profile.id])

  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  return (
    <>
      <div className="page-head">
        <h1>Your rounds</h1>
        <p className="lede">Pick a round, then score each team against the nine rubric criteria.</p>
      </div>
      {data.events.length === 0 ? (
        <div className="empty">
          <h2>You haven't been added to a round yet</h2>
          <p>Ask the hackathon admin to assign you to a round. It will appear here straight away; refresh this page after they do.</p>
          <button className="btn" onClick={reload}>Refresh</button>
        </div>
      ) : (
        <ul className="round-list">
          {data.events.map((e) => {
            const s = data.stats[e.id]
            const ratio = s.teams ? s.done / s.teams : 0
            return (
              <li key={e.id}>
                <Link to={`/score/${e.id}`} className="round-row">
                  <div>
                    <h2>{e.name}</h2>
                    <p className="muted">
                      {e.kind === 'inter' ? 'Inter-section round' : 'Intra-class round'}
                      {e.event_date ? `, ${new Date(e.event_date).toLocaleDateString()}` : ''}
                      {e.venue ? `, ${e.venue}` : ''}
                    </p>
                  </div>
                  <div className="round-progress">
                    {e.locked && <span className="tag tag-lock">Scoring closed</span>}
                    <span>{s.done} of {s.teams} teams scored</span>
                    <span className="meter"><span style={{ width: `${ratio * 100}%` }} /></span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
