import React, { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [accountType, setAccountType] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(() => {
    const h = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''))
    return h.get('error_description')
      ? { kind: 'error', text: `${h.get('error_description')}. Sign in with your email and password instead.` }
      : null
  })
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    if (mode === 'signup' && !accountType) return setMsg({ kind: 'error', text: 'Choose whether you are registering a team or joining as an evaluator.' })
    setBusy(true); setMsg(null)
    const { email, password, name } = form
    const res = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: name, account_type: accountType }, emailRedirectTo: window.location.href.split('#')[0] } })
    setBusy(false)
    if (res.error) return setMsg({ kind: 'error', text: res.error.message })
    if (mode === 'signup' && !res.data.session) {
      setMsg({ kind: 'info', text: 'Account created. Open the confirmation link sent to your email, then sign in.' })
      setMode('signin')
    }
  }

  return (
    <div className="login">
      <div className="login-side">
        <span className="brand-mark big" aria-hidden="true" />
        <h1>SDG Hackathon evaluation</h1>
        <p>Teams register here and follow their round's leaderboard. Evaluators score teams against the rubric; totals, rankings and PO, PSO and SDG attainment are worked out automatically.</p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h2>
        {mode === 'signup' && (
          <>
            <fieldset className="choice">
              <legend>I am</legend>
              <label className={`choice-opt ${accountType === 'team' ? 'on' : ''}`}>
                <input type="radio" name="acct" checked={accountType === 'team'} onChange={() => setAccountType('team')} />
                <span><b>Registering a team</b><small>One member signs up for the whole team</small></span>
              </label>
              <label className={`choice-opt ${accountType === 'evaluator' ? 'on' : ''}`}>
                <input type="radio" name="acct" checked={accountType === 'evaluator'} onChange={() => setAccountType('evaluator')} />
                <span><b>An evaluator</b><small>Faculty or jury scoring teams</small></span>
              </label>
            </fieldset>
            <label>{accountType === 'team' ? 'Your name (team contact)' : 'Full name'}<input required value={form.name} onChange={set('name')} autoComplete="name" /></label>
          </>
        )}
        <label>{mode === 'signup' && accountType === 'team' ? "Team contact email (one member's email)" : 'Email'}<input required type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
        <label>Password<input required type="password" minLength={6} value={form.password} onChange={set('password')}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
        {msg && <div className={`alert alert-${msg.kind}`}>{msg.text}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : accountType === 'team' ? 'Create team account' : 'Create account'}</button>
        <button type="button" className="btn btn-link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg(null) }}>
          {mode === 'signin' ? 'New here? Register a team or create an evaluator account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
