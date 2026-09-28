'use client'

import Link from 'next/link'
import { Moon, Settings2, Sun } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { useBackendHealth } from '@/lib/runs'
import { useTheme } from '@/lib/theme'

export type View = 'command' | 'investigate' | 'feed' | 'campaigns' | 'cases' | 'settings'

export const NAV: { id: Exclude<View, 'settings'>; label: string; index: string }[] = [
  { id: 'command', label: 'Command', index: '01' },
  { id: 'investigate', label: 'Investigate', index: '02' },
  { id: 'feed', label: 'Live feed', index: '03' },
  { id: 'campaigns', label: 'Campaigns', index: '04' },
  { id: 'cases', label: 'Case files', index: '05' },
]

/**
 * The one top bar every page shares. On the dashboard, `onNavigate` swaps
 * views in place; on a case page it's absent and each item is a plain link
 * back to `/?view=…`, so the navigation reads identically everywhere.
 */
export function Shell({
  view,
  onNavigate,
  busy = false,
  children,
}: {
  view?: View
  onNavigate?: (v: View) => void
  busy?: boolean
  children: React.ReactNode
}) {
  const { dark, toggleTheme } = useTheme()
  const health = useBackendHealth()

  const item = (id: View, content: React.ReactNode, className: string, label?: string) =>
    onNavigate ? (
      <button key={id} className={className} onClick={() => onNavigate(id)} aria-current={view === id ? 'page' : undefined} aria-label={label}>
        {content}
      </button>
    ) : (
      <Link key={id} className={className} href={id === 'command' ? '/' : `/?view=${id}`} aria-label={label}>
        {content}
      </Link>
    )

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          {item(
            'command',
            <>
              <BrandMark active={busy} />
              <span className="wordmark">
                <strong>Security Copilot</strong>
                <span>Email forensic intelligence</span>
              </span>
            </>,
            'brand',
            'Security Copilot — Command',
          )}

          <nav className="nav" aria-label="Main">
            {NAV.map((n) =>
              item(
                n.id,
                <>
                  <span className="nav-index">{n.index}</span>
                  {n.label}
                </>,
                `nav-item ${view === n.id ? 'is-active' : ''}`,
              ),
            )}
          </nav>

          <div className="topbar-actions">
            <span className={`health health-${health}`} role="status" title="Backend API reachability, re-checked every 30s">
              <span className="health-dot" />
              {health === 'online' ? 'Engine online' : health === 'offline' ? 'Engine offline' : 'Connecting'}
            </span>
            <button className="icon-btn" onClick={toggleTheme} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {item('settings', <Settings2 size={17} />, `icon-btn ${view === 'settings' ? 'is-active' : ''}`, 'Settings')}
          </div>
        </div>
      </header>
      <main id="main" className="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="footer">
        <span>Detect → Trace → Attribute → Report</span>
        <span>SIH26106 · Team Red Eye</span>
      </footer>
    </div>
  )
}
