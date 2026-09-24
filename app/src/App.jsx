import React, { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { configured, supabase } from './lib/supabase'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import PoweredBy from './components/PoweredBy'
import Portal, { FLASH_KEY, PORTAL_KEY } from './pages/auth/Portal'
import PendingApproval from './pages/auth/PendingApproval'
import MyRounds from './pages/evaluator/MyRounds'
import RoundTeams from './pages/evaluator/RoundTeams'
import ScoreTeam from './pages/evaluator/ScoreTeam'
import Dashboard from './pages/admin/Dashboard'
import Rounds from './pages/admin/Rounds'
import RoundDetail from './pages/admin/RoundDetail'
import Setup from './pages/admin/Setup'
import People from './pages/admin/People'
import TeamHome from './pages/team/TeamHome'
import Leaderboard from './pages/team/Leaderboard'

function NotConfigured() {
  return (
    <div className="center-card">
      <h1>Connect the app to Supabase</h1>
      <p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code> (local) or in your hosting provider's environment variables, then rebuild. The README walks through it.</p>
      <PoweredBy />
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
      .then(async ({ data }) => {
        // Reject an account signing in through the other portal.
        const portal = sessionStorage.getItem(PORTAL_KEY)
        sessionStorage.removeItem(PORTAL_KEY)
        if (data && portal === 'team' && data.role !== 'team') {
          sessionStorage.setItem(FLASH_KEY, 'That is an evaluator account. Sign in through the evaluator portal instead.')
          window.location.hash = '#/evaluator'
          await supabase.auth.signOut(); return
        }
        if (data && portal === 'evaluator' && data.role === 'team') {
          sessionStorage.setItem(FLASH_KEY, 'That is a team account. Sign in through the team portal instead.')
          window.location.hash = '#/team'
          await supabase.auth.signOut(); return
        }
        setProfile(data)
      })
  }, [session?.user?.id])

  if (!configured) return <NotConfigured />
  if (session === undefined) return <Loading />
  if (!session) return <HashRouter><Portal /></HashRouter>
  if (!profile) return <Loading label="Loading your account…" />

  const admin = profile.role === 'admin'
  if (profile.role === 'pending' || profile.role === 'rejected') {
    return (
      <PendingApproval profile={profile} onRecheck={async () => {
        const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
        if (data) setProfile(data)
      }} />
    )
  }
  if (profile.role === 'team') {
    return (
      <HashRouter>
        <Layout profile={profile}>
          <Routes>
            <Route path="/team" element={<TeamHome profile={profile} />} />
            <Route path="/team/leaderboard" element={<Leaderboard profile={profile} />} />
            <Route path="*" element={<Navigate to="/team" replace />} />
          </Routes>
        </Layout>
      </HashRouter>
    )
  }
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
