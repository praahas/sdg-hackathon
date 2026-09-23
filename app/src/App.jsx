import React, { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { configured, supabase } from './lib/supabase'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import Login from './pages/Login'
import MyRounds from './pages/evaluator/MyRounds'
import RoundTeams from './pages/evaluator/RoundTeams'
import ScoreTeam from './pages/evaluator/ScoreTeam'
import Dashboard from './pages/admin/Dashboard'
import Rounds from './pages/admin/Rounds'
import RoundDetail from './pages/admin/RoundDetail'
import Setup from './pages/admin/Setup'
import People from './pages/admin/People'

function NotConfigured() {
  return (
    <div className="center-card">
      <h1>Connect the app to Supabase</h1>
      <p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code> (local) or in your hosting provider's environment variables, then rebuild. The README walks through it.</p>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data))
  }, [session?.user?.id])

  if (!configured) return <NotConfigured />
  if (session === undefined) return <Loading />
  if (!session) return <Login />
  if (!profile) return <Loading label="Loading your account…" />

  const admin = profile.role === 'admin'
  return (
    <HashRouter>
      <Layout profile={profile}>
        <Routes>
          <Route path="/" element={<Navigate to={admin ? '/admin' : '/score'} replace />} />
          <Route path="/score" element={<MyRounds profile={profile} />} />
          <Route path="/score/:eventId" element={<RoundTeams profile={profile} />} />
          <Route path="/score/:eventId/:teamId" element={<ScoreTeam profile={profile} />} />
          {admin && (
            <>
              <Route path="/admin" element={<Dashboard />} />
              <Route path="/admin/rounds" element={<Rounds />} />
              <Route path="/admin/rounds/:eventId" element={<RoundDetail />} />
              <Route path="/admin/setup" element={<Setup />} />
              <Route path="/admin/people" element={<People me={profile} />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  )
}
