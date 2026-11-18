import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import PoweredBy from '../components/PoweredBy'

const longDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const titleCase = (s) => (s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase())

// Public page: anyone can check a certificate ID, signed in or not.
export default function Verify() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [input, setInput] = useState(code || '')
  const [state, setState] = useState({ loading: !!code })
  useEffect(() => {
    if (!code) { setState({}); return }
    setInput(code); setState({ loading: true })
    Promise.all([
      supabase.rpc('verify_certificate', { p_code: code }),
      supabase.from('sdgs').select('id, name, color'),
    ]).then(([v, s]) => {
      if (v.error) return setState({ error: v.error.message })
      setState({ cert: v.data?.[0] || null, sdgs: Object.fromEntries((s.data || []).map((g) => [g.id, g])) })
    })
  }, [code])
  const c = state.cert
  return (
    <div className="landing">
      <div className="center-card verify-card">
        <p className="portal-kicker">Certificate verification</p>
        <form className="verify-form" onSubmit={(e) => { e.preventDefault(); if (input.trim()) navigate(`/verify/${input.trim().toUpperCase()}`) }}>
          <label>Certificate ID<input value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. 57E34CC4EF" autoCapitalize="characters" /></label>
          <button className="btn btn-primary">Verify</button>
        </form>
        {state.loading && <p className="muted">Checking…</p>}
        {state.error && <div className="alert alert-error"><span>{state.error}</span></div>}
        {code && !state.loading && !state.error && !c && (
          <div className="verify-result bad"><h1>Not found</h1><p>No certificate with ID <b>{code.toUpperCase()}</b> was issued. Check the ID and try again.</p></div>
        )}
        {c && (
          <div className="verify-result ok">
            <p className="verify-badge">Genuine certificate</p>
            <h1>{c.member_name}</h1>
            {c.usn && <p className="muted">USN {c.usn}</p>}
            <dl className="kv">
              <div><dt>Certificate</dt><dd>{c.kind === 'winner' ? `Achievement: ${titleCase(c.place)}` : 'Participation'}</dd></div>
              <div><dt>Team</dt><dd>{c.team_code} {c.team_name}</dd></div>
              <div><dt>Event</dt><dd>{c.hackathon}: {c.round_name}</dd></div>
              <div><dt>Held on</dt><dd>{longDate(c.event_date)}</dd></div>
              <div><dt>Organised by</dt><dd>Department of {c.department}, {c.institution}</dd></div>
              {c.problem && <div><dt>Problem statement</dt><dd>{c.problem}</dd></div>}
              {(c.primary_sdg || c.secondary_sdg) && <div><dt>SDGs</dt><dd className="chips">{[c.primary_sdg, c.secondary_sdg].filter(Boolean).map((id) => state.sdgs[id] && (
                <span key={id} className="sdg-chip" style={{ '--sdg': state.sdgs[id].color }}><b>{id}</b><span>{state.sdgs[id].name}</span></span>))}</dd></div>}
              <div><dt>Certificate ID</dt><dd><code>{c.code}</code>, issued {longDate(String(c.issued_at).slice(0, 10))}</dd></div>
            </dl>
          </div>
        )}
        <p className="small"><Link to="/">Go to the hackathon site</Link></p>
        <PoweredBy />
      </div>
    </div>
  )
}
