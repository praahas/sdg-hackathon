import React, { useEffect, useState } from 'react'
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import PoweredBy from '../../components/PoweredBy'

// Which portal a sign-in started from, so the app can reject the wrong account type.
export const PORTAL_KEY = 'sdg-portal'
export const FLASH_KEY = 'sdg-auth-flash'

const PORTALS = {
  team: {
    className: 'portal-team',
    title: 'Team portal',
    blurb: 'Register your team for your section\'s round, keep its details up to date, and follow the leaderboard once it is published.',
    signin: 'Sign in to your team',
    signup: 'Register a new team',
    nameLabel: 'Your name (team contact)',
    emailLabel: "Team contact email (one member's email)",
    signupButton: 'Create team account',
    switchToSignup: 'New team? Create a team account',
    note: 'One member signs up for the whole team. You add the other members after signing in.',
    other: { to: '/evaluator', label: 'Evaluator or coordinator? Use the evaluator portal' },
  },
  evaluator: {
    className: 'portal-evaluator',
    title: 'Evaluator portal',
    blurb: 'Score teams against the rubric and rate each solution\'s SDG contribution. Coordinators manage rounds, teams and results from here too.',
    signin: 'Evaluator sign in',
    signup: 'Create an evaluator account',
    nameLabel: 'Full name',
    emailLabel: 'Email',
    signupButton: 'Create evaluator account',
    switchToSignup: 'New evaluator? Create an account',
    note: 'After you sign up, the coordinator assigns you to the rounds you will judge.',
    other: { to: '/team', label: 'Registering a team? Use the team portal' },
  },
}

function readFlash() {
  const h = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''))
  if (h.get('error_description')) return { kind: 'error', text: `${h.get('error_description')}. Sign in with your email and password instead.` }
  const f = sessionStorage.getItem(FLASH_KEY)
  if (f) { sessionStorage.removeItem(FLASH_KEY); return { kind: 'error', text: f } }
  return null
}

function AuthPage({ portal }) {
  const p = PORTALS[portal]
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(readFlash)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    sessionStorage.setItem(PORTAL_KEY, portal)
    const { email, password, name } = form
    const res = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email, password,
          options: {
            data: { full_name: name, account_type: portal === 'team' ? 'team' : 'evaluator' },
            emailRedirectTo: window.location.href.split('#')[0],
          },
        })
    setBusy(false)
    if (res.error) return setMsg({ kind: 'error', text: res.error.message })
    if (mode === 'signup' && !res.data.session) {
      setMsg({ kind: 'info', text: 'Account created. Open the confirmation link sent to your email, then sign in here.' })
      setMode('signin')
    }
  }

  return (
    <div className={`login ${p.className}`}>
      <div className="login-side">
        <span className="brand-mark big" aria-hidden="true" />
        <p className="portal-kicker">SDG Hackathon</p>
        <h1>{p.title}</h1>
        <p>{p.blurb}</p>
        <Link className="portal-switch" to={p.other.to}>{p.other.label}</Link>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>{mode === 'signin' ? p.signin : p.signup}</h2>
        {mode === 'signup' && (
          <label>{p.nameLabel}<input required value={form.name} onChange={set('name')} autoComplete="name" /></label>
        )}
        <label>{mode === 'signup' ? p.emailLabel : 'Email'}<input required type="email" value={form.email} onChange={set('email')} autoComplete="email" /></label>
        <label>Password<input required type="password" minLength={6} value={form.password} onChange={set('password')}
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
        {mode === 'signup' && <p className="muted small">{p.note}</p>}
        {msg && <div className={`alert alert-${msg.kind}`}>{msg.text}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : p.signupButton}</button>
        <button type="button" className="btn btn-link" onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMsg(null) }}>
          {mode === 'signin' ? p.switchToSignup : 'Already have an account? Sign in'}
        </button>
      </form>
      <PoweredBy className="span-all" />
    </div>
  )
}

function Landing() {
  const [msg] = useState(readFlash)
  return (
    <div className="landing">
      <div className="landing-head">
        <span className="brand-mark big" aria-hidden="true" />
        <h1>SDG Hackathon</h1>
        <p>Choose how you're taking part.</p>
      </div>
      {msg && <div className={`alert alert-${msg.kind} landing-alert`}>{msg.text}</div>}
      <div className="landing-cards">
        <Link to="/team" className="landing-card portal-team">
          <span className="landing-tag">Students</span>
          <h2>Team portal</h2>
          <p>Register your team, choose the SDGs you're addressing, and see your round's leaderboard.</p>
          <span className="landing-go">Register or sign in</span>
        </Link>
        <Link to="/evaluator" className="landing-card portal-evaluator">
          <span className="landing-tag">Faculty and jury</span>
          <h2>Evaluator portal</h2>
          <p>Score teams against the rubric, rate SDG contribution, and manage rounds and results.</p>
          <span className="landing-go">Sign in or create an account</span>
        </Link>
      </div>
      <PoweredBy />
    </div>
  )
}

export default function Portal() {
  const navigate = useNavigate()
  // After signing out, return to the portal the person signed in from.
  useEffect(() => {
    const next = sessionStorage.getItem('sdg-after-signout')
    if (next) { sessionStorage.removeItem('sdg-after-signout'); navigate(`/${next}`, { replace: true }) }
  }, [navigate])
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/team" element={<AuthPage key="team" portal="team" />} />
      <Route path="/evaluator" element={<AuthPage key="evaluator" portal="evaluator" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
