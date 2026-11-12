import React from 'react'
import { Link } from 'react-router-dom'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { roundType } from '../../lib/format'
import { ErrorBox, Loading } from '../../components/ui'

export default function Rounds() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [events, teams, ee, results] = await Promise.all([
      q(supabase.from('events').select('*').order('sort')),
      q(supabase.from('teams').select('id, event_id')),
      q(supabase.from('event_evaluators').select('event_id')),
      q(supabase.from('v_team_result').select('event_id, n_criteria_scored')),
    ])
    return { events, teams, ee, results }
  }, [])
  if (loading) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  const { events, teams, ee, results } = data
  const bySem = [
    ['3rd semester', events.filter((e) => e.semester === 3)],
    ['5th semester', events.filter((e) => e.semester === 5)],
    ['Department level', events.filter((e) => e.semester == null)],
  ].filter(([, list]) => list.length)

  return (
    <>
      <div className="page-head">
        <h1>Rounds and teams</h1>
        <p className="lede">Each semester runs two section rounds; their top teams go on to the semester's inter-section round, and the top teams of both semesters meet in the department-level final. Open a round to add teams, assign evaluators and close scoring.</p>
      </div>
      {bySem.map(([sem, list]) => (
        <section key={sem} className="panel">
          <h2>{sem}</h2>
          <table className="table">
            <thead><tr><th>Round</th><th>Type</th><th className="r">Teams</th><th className="r">Scored</th><th className="r">Evaluators</th><th>Scoring</th><th /></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td><b>{e.name}</b></td>
                  <td>{roundType(e)}</td>
                  <td className="r">{teams.filter((t) => t.event_id === e.id).length}</td>
                  <td className="r">{results.filter((r) => r.event_id === e.id && r.n_criteria_scored > 0).length}</td>
                  <td className="r">{ee.filter((x) => x.event_id === e.id).length}</td>
                  <td className="nowrap">{e.locked ? <span className="tag tag-lock">Closed</span> : <span className="tag tag-open">Open</span>}
                    {e.registration_open && <span className="tag">Registration open</span>}
                    {e.leaderboard_published && <span className="tag">Leaderboard public</span>}</td>
                  <td className="r"><Link className="btn btn-small" to={`/admin/rounds/${e.id}`}>Manage</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  )
}
