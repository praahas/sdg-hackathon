import React, { useState } from 'react'
import { supabase, q } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { ErrorBox, Loading } from '../../components/ui'

export default function People({ me }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [profiles, ee, events] = await Promise.all([
      q(supabase.from('profiles').select('*').order('created_at')),
      q(supabase.from('event_evaluators').select('*')),
      q(supabase.from('events').select('id, name')),
    ])
    return { profiles, ee, events }
  }, [])
  const [msg, setMsg] = useState(null)
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />

  async function setRole(p, role) {
    setMsg(null)
    try { await q(supabase.from('profiles').update({ role }).eq('id', p.id)); reload() }
    catch (e) { setMsg(e.message) }
  }
  const base = window.location.href.split('#')[0]

  return (
    <>
      <div className="page-head">
        <h1>People</h1>
        <p className="lede">Share the portal links. Evaluators create an account and you assign them to rounds from each round's page; teams sign up with one member's email and register while a round's registration is open.</p>
        <div className="portal-links">
          <div><span className="muted small">Team portal</span><code>{base}#/team</code></div>
          <div><span className="muted small">Evaluator portal</span><code>{base}#/evaluator</code></div>
        </div>
      </div>
      {msg && <div className="alert alert-error">{msg}</div>}
      <section className="panel">
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Rounds</th><th>Role</th></tr></thead>
          <tbody>
            {data.profiles.map((p) => {
              const rounds = data.ee.filter((x) => x.evaluator_id === p.id).map((x) => data.events.find((e) => e.id === x.event_id)?.name).filter(Boolean)
              return (
                <tr key={p.id}>
                  <td><b>{p.full_name || '—'}</b>{p.id === me.id && <small className="muted"> (you)</small>}</td>
                  <td>{p.email}</td>
                  <td>{rounds.length ? rounds.join(', ') : <span className="muted">None</span>}</td>
                  <td>
                    <select value={p.role} onChange={(e) => setRole(p, e.target.value)} aria-label={`Role for ${p.email}`}>
                      <option value="evaluator">Evaluator</option>
                      <option value="admin">Admin</option>
                      <option value="team">Team</option>
                    </select>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="muted small">Admins can change targets, the rubric and teams, and see every evaluator's marks. Evaluators only see the rounds they're assigned to and only their own marks. Team accounts see only their own registration and, once published, their round's leaderboard.</p>
      </section>
    </>
  )
}
