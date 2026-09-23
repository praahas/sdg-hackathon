import React, { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { email, password, name } = form
    const res = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
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
        <p>Evaluators score teams against the rubric. Totals, rankings and PO, PSO and SDG attainment are worked out for you.</p>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{mode === 'signin' ? 'Sign in' : 'Create your evaluator account'}</h2>
        {mode === 'signup' && (
          <label>Full name<input required value={form.name} onChange={set('name')} autoComplete="name" /></label>
        )}
        <label>Email<input required type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
        <label>Password<input required type="password" minLength={6} value={form.password} onChange={set('password')}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
        {msg && <div className={`alert alert-${msg.kind}`}>{msg.text}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        <button type="button" className="btn btn-link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg(null) }}>
          {mode === 'signin' ? 'New evaluator? Create an account' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
