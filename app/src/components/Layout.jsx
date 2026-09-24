import React from 'react'
import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Layout({ profile, children }) {
  const admin = profile.role === 'admin'
  const links = admin
    ? [['/admin', 'Dashboard', true], ['/admin/rounds', 'Rounds & teams'], ['/admin/setup', 'Rubric & targets'], ['/admin/people', 'People'], ['/score', 'My scoring']]
    : profile.role === 'team'
      ? [['/team', 'My team', true], ['/team/leaderboard', 'Leaderboard']]
      : [['/score', 'My rounds']]
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>SDG Hackathon <em>evaluation</em></span>
        </div>
        <nav className="nav">
          {links.map(([to, label, end]) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
          ))}
        </nav>
        <div className="who">
          <span title={profile.email}>{profile.full_name || profile.email}</span>
          <button className="btn btn-quiet" onClick={() => { sessionStorage.setItem('sdg-after-signout', profile.role === 'team' ? 'team' : 'evaluator'); supabase.auth.signOut() }}>Sign out</button>
        </div>
      </header>
      <main className="page">{children}</main>
    </div>
  )
}
