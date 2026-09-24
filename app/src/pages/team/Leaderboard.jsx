import React from 'react'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { loadReference } from '../../lib/reference'
import { num, pct } from '../../lib/format'
import { fmtStrength } from '../../lib/sdgStrength'
import { ErrorBox, Loading, SdgChip } from '../../components/ui'

async function loadBoards(profileId) {
  const [ref, events, mine] = await Promise.all([
    loadReference(),
    q(supabase.from('events').select('*').order('sort')),
    q(supabase.from('teams').select('id, event_id, name').eq('owner_id', profileId)),
  ])
  const myEvents = events.filter((e) => mine.some((t) => t.event_id === e.id))
  const boards = await Promise.all(myEvents.map(async (e) => {
    if (!e.leaderboard_published) return { event: e, published: false }
    const [rows, breakdown] = await Promise.all([
      q(supabase.rpc('round_leaderboard', { p_event: e.id })),
      q(supabase.rpc('my_team_breakdown', { p_event: e.id })),
    ])
    return { event: e, published: true, rows, breakdown }
  }))
  return { ref, boards: boards.reverse() }
}

export default function Leaderboard({ profile }) {
  const { data, error, loading, reload } = useLoad(() => loadBoards(profile.id), [profile.id])
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { ref, boards } = data

  return (
    <>
      <div className="page-head dash-head">
        <div>
          <h1>Leaderboard</h1>
          <p className="lede">Rankings appear once the coordinator publishes them for your round. Only totals are shown; individual evaluators' marks stay private.</p>
        </div>
        <button className="btn" onClick={reload}>Refresh</button>
      </div>
      {boards.length === 0 && <div className="empty"><h2>No registration yet</h2><p>Register your team first; its round's leaderboard will appear here.</p></div>}
      {boards.map(({ event, published, rows, breakdown }) => (
        <section key={event.id} className="panel">
          <h2>{event.name}</h2>
          {!published ? (
            <p className="muted">The leaderboard for this round hasn't been published yet. Check back after evaluation.</p>
          ) : (
            <>
              <div className="scroll">
                <table className="table leaderboard">
                  <thead><tr><th className="r">Rank</th><th>Team</th><th className="col-sdg">SDGs</th><th className="r">Score</th><th className="r">%</th><th>Status</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.team_code + r.team_name} className={r.is_mine ? 'mine' : ''}>
                        <td className="r"><b>{r.rank ?? '—'}</b></td>
                        <td className="team-cell"><span className="muted">{r.team_code}</span> <b>{r.team_name}</b>{r.is_mine && <span className="tag">Your team</span>}</td>
                        <td className="nowrap col-sdg"><SdgChip sdg={ref.sdgById[r.primary_sdg]} compact />{r.secondary_sdg && <SdgChip sdg={ref.sdgById[r.secondary_sdg]} compact />}</td>
                        <td className="r">{r.total != null ? <>{num(r.total)}<small className="muted"> / {num(r.max_total)}</small></> : <span className="muted">Not scored</span>}</td>
                        <td className="r">{pct(r.pct)}</td>
                        <td>{r.status === 'Shortlisted' ? <span className="tag tag-open">Shortlisted</span> : <span className="muted">{r.status ?? ''}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {breakdown?.length > 0 && (
                <>
                  <h3 className="section-title">Your team's marks by criterion</h3>
                  <table className="table breakdown">
                    <tbody>
                      {breakdown.filter((b) => b.item_kind === 'criterion').map((b) => (
                        <tr key={b.label}>
                          <td>{b.label}</td>
                          <td className="bar-cell"><span className="bar"><span style={{ width: `${b.avg_value != null ? (b.avg_value / b.max_value) * 100 : 0}%` }} /></span></td>
                          <td className="r nowrap">{b.avg_value != null ? num(b.avg_value) : '—'}<small className="muted"> / {num(b.max_value)}</small></td>
                        </tr>
                      ))}
                      {breakdown.filter((b) => b.item_kind === 'sdg').map((b) => (
                        <tr key={b.label} className="sdg-row">
                          <td>Contribution to {b.label}</td>
                          <td className="bar-cell"><span className="bar sdg"><span style={{ width: `${b.avg_value != null ? (b.avg_value / 3) * 100 : 0}%` }} /></span></td>
                          <td className="r nowrap">{fmtStrength(b.avg_value)}<small className="muted"> / 3</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="muted small">Marks are averages across evaluators. SDG contribution: 3 High, 2 Medium, 1 Low, 0 None; it does not change your score or rank.</p>
                </>
              )}
            </>
          )}
        </section>
      ))}
    </>
  )
}
