'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Inbox,
  Link2,
  Loader2,
  Mail,
  Menu,
  Network,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Moon,
  X,
} from 'lucide-react'
import { ScoreBar } from '@/components/ScoreBar'
import { ApiError, apiGet, apiPost, apiPostStream, getApiBaseUrl, setApiBaseUrl } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import type { Campaign, RunSummary, VerdictLabel } from '@/lib/types'
import { isThreatLabel, severityOf, type Severity } from '@/lib/verdict'

type View = 'Overview' | 'Link scans' | 'Email scans' | 'Campaigns' | 'History' | 'Settings'
type Kind = 'Link' | 'Email'
type Run = { id: string; target: string; kind: Kind; verdict: Severity; score: number; time: string; detail: string }

const nav: { label: View; icon: typeof Activity }[] = [
  { label: 'Overview', icon: BarChart3 },
  { label: 'Link scans', icon: Link2 },
  { label: 'Email scans', icon: Mail },
  { label: 'Campaigns', icon: Network },
  { label: 'History', icon: Clock3 },
]

const verdictClass: Record<Severity, string> = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
  Safe: 'safe',
  Unknown: 'unknown',
}

// Backend verdict labels -> the UI's severity buckets. `inconclusive` is a real
// verdict and maps to Low; `Unknown` is reserved for fetch/network failures.
function severityFromLabel(label?: VerdictLabel | string): Severity {
  return severityOf(label)
}

function kindFromCaseType(caseType: string): Kind {
  if (caseType === 'email') return 'Email'
  return 'Link'
}

function meterColor(sev: Severity): string {
  if (sev === 'Critical' || sev === 'High') return 'var(--red)'
  if (sev === 'Medium') return 'var(--yellow)'
  if (sev === 'Safe') return 'var(--green)'
  return 'var(--muted)'
}

function scoreColor(score: number): string {
  if (score >= 80) return 'var(--green)'
  if (score >= 50) return 'var(--yellow)'
  return 'var(--red)'
}

function relativeTime(seconds: number): string {
  const diff = Date.now() - seconds * 1000
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

// Raw .eml inputs start with headers; show their Subject instead of "Received: from …".
function displayTarget(summary: RunSummary): string {
  if (summary.case_type !== 'email') return summary.raw_input
  const subject = summary.raw_input.match(/^Subject:[ \t]*(.+)$/im)
  return subject && /^[\w-]+:/.test(summary.raw_input.trimStart()) ? `✉ ${subject[1].trim()}` : summary.raw_input
}

function runFromSummary(summary: RunSummary): Run {
  return {
    id: summary.id,
    target: displayTarget(summary),
    kind: kindFromCaseType(summary.case_type),
    verdict: severityFromLabel(summary.verdict?.label),
    score: Math.round((summary.verdict?.risk_score ?? summary.verdict?.confidence ?? 0) * 100),
    time: relativeTime(summary.created_at),
    detail: summary.verdict?.reason || 'No summary was recorded for this run.',
  }
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.'
}

function Badge({ verdict }: { verdict: Severity }) {
  return (
    <span className={`badge ${verdictClass[verdict]}`}>
      <span className="badge-dot" />
      {verdict}
    </span>
  )
}

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="section-title animate-in">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {children}
    </div>
  )
}

/* ─── SVG Score Gauge ──────────────────────────────────────────────── */
function ScoreGauge({ score, size = 100 }: { score: number; size?: number }) {
  const radius = (size - 16) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = scoreColor(score)

  return (
    <div className="score-ring-wrap" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
        />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{
            '--score-circumference': circumference,
            '--score-offset': offset,
          } as React.CSSProperties}
        />
      </svg>
      <div className="score-ring-label">
        <strong>{score}</strong>
        <span>/100</span>
      </div>
    </div>
  )
}

/* ─── Score Mini Bar (inline in tables) ────────────────────────────── */
// Colored by verdict classification, not by the raw score magnitude — the
// score here is verdict *confidence* (0-100), not a safety percentage, so
// a high score on a dangerous/critical verdict is still dangerous. Only
// the Overview page's posture gauge (a genuine safe%, see postureScore
// below) uses magnitude-based scoreColor.
function ScoreMiniBar({ score, sev }: { score: number; sev: Severity }) {
  return (
    <span className="score-visual">
      <ScoreBar score={score} color={meterColor(sev)} />
      <span className="score">{score}</span>
    </span>
  )
}

export default function Page() {
  const router = useRouter()
  const [view, setView] = useState<View>('Overview')
  const { dark, toggleTheme } = useTheme()
  const [mobileNav, setMobileNav] = useState(false)

  // Every run now opens its own full page (dashboard/app/run/[id]/page.tsx)
  // instead of a modal here — a screenshot, the full VirusTotal vendor
  // breakdown, and the sandbox's page-content findings need real room, and
  // a real URL per run is what makes the extension's "Full report" able to
  // deep-link straight to one (background.ts's runFullCheck).
  function openRun(run: Run) {
    router.push(`/run/${run.id}`)
  }

  // Old-style deep link (`/?run=<id>`, from before the dedicated /run/[id]
  // route existed) — redirect rather than break it, in case anything still
  // links to it (e.g. a bookmark, or a report generated before this change).
  // `/?draft=<id>` is a different case (the Gmail add-on's "Check Report"
  // button): switches to Email scans and lets that view auto-load + run it.
  const [draftId, setDraftId] = useState<string | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const runId = params.get('run')
    if (runId) {
      router.replace(`/run/${runId}`)
      return
    }
    const draft = params.get('draft')
    if (draft) {
      setDraftId(draft)
      setView('Email scans')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openView(next: View) {
    setView(next)
    setMobileNav(false)
  }

  return (
    <div className={dark ? 'app-shell dark' : 'app-shell'} suppressHydrationWarning>
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={18} />
          </div>
          <span>
            Security<span className="brand-accent"> </span>Copilot
          </span>
          <button className="icon-button mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <div className="workspace">
          <div className="workspace-avatar">SC</div>
          <div>
            <strong>Security team</strong>
            <span>Workspace / default</span>
          </div>
          <ChevronRight size={15} />
        </div>
        <nav aria-label="Main navigation">
          <p className="nav-label">Workspace</p>
          {nav.map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${view === label ? 'active' : ''}`} onClick={() => openView(label)}>
              <Icon size={17} />
              <span>{label}</span>
            </button>
          ))}
          <p className="nav-label secondary-label">Configuration</p>
          <button className={`nav-item ${view === 'Settings' ? 'active' : ''}`} onClick={() => openView('Settings')}>
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="system-status">
            <span className="pulse" />
            Connected to backend
          </div>
          <div className="profile">
            <div className="profile-avatar">SC</div>
            <div>
              <strong>Security Copilot</strong>
              <span>Analyst workspace</span>
            </div>
            <SlidersHorizontal size={15} />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div className="crumb">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="top-actions">
            <button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="live-indicator">
              <span className="pulse" />
              Live monitoring
            </div>
          </div>
        </header>
        <div className="page-wrap">
          {view === 'Overview' && <Overview onNavigate={openView} onSelect={openRun} />}
          {view === 'Link scans' && <LinkScan onSelect={openRun} />}
          {view === 'Email scans' && <EmailScan onSelect={openRun} draftId={draftId} />}
          {view === 'Campaigns' && <Campaigns />}
          {view === 'History' && <History onSelect={openRun} />}
          {view === 'Settings' && <SettingsView />}
        </div>
      </main>
    </div>
  )
}

function useRuns(query: string) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setRuns(null)
    setError(null)
    apiGet<RunSummary[]>(query)
      .then((data) => {
        if (alive) setRuns(data)
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err))
      })
    return () => {
      alive = false
    }
  }, [query])

  return { runs, error }
}

function TableState({ colSpan, loading, error, empty }: { colSpan: number; loading: boolean; error: string | null; empty: boolean }) {
  let content: React.ReactNode = null
  if (loading) content = (
    <>
      <Loader2 className="spin" size={15} /> Loading runs…
    </>
  )
  else if (error) content = (
    <>
      <AlertTriangle size={15} /> {error}
    </>
  )
  else if (empty) content = (
    <>
      <Inbox size={15} /> No runs yet.
    </>
  )
  if (!content) return null
  return (
    <tr>
      <td colSpan={colSpan}>
        <span className="table-state">{content}</span>
      </td>
    </tr>
  )
}

function RunTable({
  runs,
  onSelect,
  loading = false,
  error = null,
}: {
  runs: Run[]
  onSelect: (r: Run) => void
  loading?: boolean
  error?: string | null
}) {
  const showState = loading || !!error || runs.length === 0
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Type</th>
            <th>Verdict</th>
            <th>Score</th>
            <th>Time</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {showState ? (
            <TableState colSpan={6} loading={loading} error={error} empty={runs.length === 0} />
          ) : (
            runs.map((run) => (
              <tr key={run.id} onClick={() => onSelect(run)}>
                <td>
                  <strong>{run.target}</strong>
                  <span>{run.id}</span>
                </td>
                <td>
                  <span className="type-cell">
                    {run.kind === 'Link' ? <Link2 size={14} /> : <Mail size={14} />}
                    {run.kind}
                  </span>
                </td>
                <td>
                  <Badge verdict={run.verdict} />
                </td>
                <td>
                  <ScoreMiniBar score={run.score} sev={run.verdict} />
                </td>
                <td className="time-cell">{run.time}</td>
                <td>
                  <ChevronRight size={15} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function Overview({ onNavigate, onSelect }: { onNavigate: (v: View) => void; onSelect: (r: Run) => void }) {
  const { runs, error } = useRuns('/runs?limit=50')
  const loading = runs === null && !error
  const list = runs ?? []

  const stats = useMemo(() => {
    const total = list.length
    const dangerous = list.filter((r) => ['Critical', 'High'].includes(severityOf(r.verdict?.label))).length
    const suspicious = list.filter((r) => severityOf(r.verdict?.label) === 'Medium').length
    const safe = list.filter((r) => severityOf(r.verdict?.label) === 'Safe').length
    const inconclusive = list.filter((r) => r.verdict?.label === 'inconclusive').length
    const safePct = total ? Math.round((safe / total) * 100) : 0
    return { total, dangerous, suspicious, safe, inconclusive, safePct }
  }, [list])

  const buckets = useMemo(() => buildBuckets(list), [list])
  const maxBucket = Math.max(1, ...buckets.map((b) => b.total))
  const hasActivity = buckets.some((b) => b.total > 0)

  const postureScore = stats.total ? stats.safePct : 100
  const postureBadge: Severity = postureScore >= 85 ? 'Safe' : postureScore >= 60 ? 'Medium' : 'Critical'

  const tableRuns = list.slice(0, 4).map(runFromSummary)

  return (
    <>
      <SectionTitle eyebrow="Security posture / recent activity" title="Security Copilot">
        <button className="button primary" onClick={() => onNavigate('Link scans')}>
          <Plus size={16} />
          New scan
        </button>
      </SectionTitle>
      <div className="metric-grid">
        <div className="animate-in animate-in-delay-1">
          <Metric label="Scans completed" value={loading ? '—' : String(stats.total)} icon={Activity} />
        </div>
        <div className="animate-in animate-in-delay-2">
          <Metric label="Threats detected" value={loading ? '—' : String(stats.dangerous)} icon={AlertTriangle} accent="danger" />
        </div>
        <div className="animate-in animate-in-delay-3">
          <Metric label="Suspicious" value={loading ? '—' : String(stats.suspicious)} icon={CircleHelp} accent="blue" />
        </div>
        <div className="animate-in animate-in-delay-4">
          <Metric label="Safe verdicts" value={loading ? '—' : `${stats.safePct}%`} icon={ShieldCheck} accent="green" />
        </div>
      </div>
      <div className="overview-grid">
        <section className="panel posture-panel animate-in animate-in-delay-2">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Risk distribution</p>
              <h2>Current posture</h2>
            </div>
          </div>
          <div className="posture-score">
            <ScoreGauge score={postureScore} />
            <div>
              <Badge verdict={postureBadge} />
              <p>{postureScore >= 85 ? 'Strong security posture' : 'Elevated threat activity'}</p>
              <span>{stats.total ? `Based on the last ${stats.total} runs.` : 'No runs recorded yet.'}</span>
            </div>
          </div>
          <div className="risk-bars">
            <Risk label="Safe" count={stats.safe} total={stats.total} color="green" />
            <Risk label="Low / Medium" count={stats.suspicious + stats.inconclusive} total={stats.total} color="yellow" />
            <Risk label="High / Critical" count={stats.dangerous} total={stats.total} color="red" />
          </div>
        </section>
        <section className="panel activity-panel animate-in animate-in-delay-3">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Detection activity</p>
              <h2>Scan volume · last 12h</h2>
            </div>
            <div className="chart-legend">
              <span className="legend-safe" />Safe <span className="legend-threat" />Threat
            </div>
          </div>
          {hasActivity ? (
            <div className="bars">
              {buckets.map((bucket, i) => (
                <div className="bar" key={i} title={`${bucket.total} scan${bucket.total === 1 ? '' : 's'}`}>
                  <div className="bar-stack" style={{ height: `${(bucket.total / maxBucket) * 100}%` }}>
                    <span
                      className="bar-seg threat"
                      style={{ height: `${bucket.total ? (bucket.threat / bucket.total) * 100 : 0}%` }}
                    />
                    <span className="bar-seg safe" style={{ flex: 1 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="chart-empty">{loading ? 'Loading activity…' : 'No scans in the last 12 hours.'}</div>
          )}
        </section>
      </div>
      <section className="panel runs-panel animate-in animate-in-delay-4">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Latest activity</p>
            <h2>Recent scans</h2>
          </div>
          <button className="text-button" onClick={() => onNavigate('History')}>
            View all <ArrowUpRight size={14} />
          </button>
        </div>
        <RunTable runs={tableRuns} onSelect={onSelect} loading={loading} error={error} />
      </section>
    </>
  )
}

type Bucket = { safe: number; threat: number; total: number }

// Bucket runs into the last 12 one-hour windows from their created_at timestamps.
// `threat` = dangerous + suspicious; everything else counts as safe-ish.
function buildBuckets(runs: RunSummary[]): Bucket[] {
  const hours = 12
  const now = Date.now() / 1000
  const buckets: Bucket[] = Array.from({ length: hours }, () => ({ safe: 0, threat: 0, total: 0 }))
  for (const run of runs) {
    const age = now - run.created_at
    if (age < 0 || age >= hours * 3600) continue
    const idx = hours - 1 - Math.floor(age / 3600)
    if (idx < 0 || idx >= hours) continue
    const label = run.verdict?.label
    const isThreat = isThreatLabel(label)
    buckets[idx].total += 1
    if (isThreat) buckets[idx].threat += 1
    else buckets[idx].safe += 1
  }
  return buckets
}

function Metric({ label, value, icon: Icon, accent = '' }: { label: string; value: string; icon: typeof Activity; accent?: string }) {
  return (
    <div className="metric">
      <div className={`metric-icon ${accent}`}>
        <Icon size={17} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function Risk({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total ? Math.round((count / total) * 100) : 0
  return (
    <div className="risk-row">
      <div>
        <span className={`risk-dot ${color}`} />
        {label}
        <div className="risk-bar-track" style={{ width: '80px' }}>
          <div className={`risk-bar-fill ${color}`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <strong>{count}</strong>
      <span className="risk-percent">{pct}%</span>
    </div>
  )
}

function SignalCoverage({ isLink }: { isLink: boolean }) {
  const rows = isLink
    ? [
        ['Reputation', 'Domain age, DNS, blocklists'],
        ['Content', 'DOM, scripts, forms'],
        ['Redirects', 'Chain and destination'],
      ]
    : [
        ['Sender identity', 'SPF, DKIM, DMARC'],
        ['Payloads', 'Attachments and URLs'],
        ['Intent', 'Language and urgency'],
      ]
  return (
    <section className="panel info-panel animate-in animate-in-delay-2">
      <p className="eyebrow">What we inspect</p>
      <h2>Signal coverage</h2>
      {rows.map(([title, text], i) => (
        <div className="coverage-row" key={title}>
          <span className="coverage-number">0{i + 1}</span>
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
          <Check size={15} />
        </div>
      ))}
      <div className="privacy-note">
        <ShieldCheck size={16} />
        <span>Inputs are analyzed by the backend agent and logged to run history.</span>
      </div>
    </section>
  )
}

function ResultCard({ target, sev, score, reason, mitigation }: { target: string; sev: Severity; score: number; reason: string; mitigation?: string | null }) {
  return (
    <div className="result-card">
      <div className="result-head">
        <div>
          <p className="eyebrow">Analysis complete</p>
          <h3>{target}</h3>
        </div>
        <Badge verdict={sev} />
      </div>
      <div className="result-score">
        <strong>{score}</strong>
        <span>/ 100 risk score</span>
        <div className="score-meter">
          <span style={{ width: `${score}%`, background: meterColor(sev) }} />
        </div>
      </div>
      <p>{reason}</p>
      {mitigation && <p className="result-mitigation">{mitigation}</p>}
    </div>
  )
}

function LinkScan({ onSelect }: { onSelect: (r: Run) => void }) {
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<string[]>([])
  const [result, setResult] = useState<{ sev: Severity; score: number; reason: string; mitigation: string | null; target: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { runs, error: runsError } = useRuns('/runs?view=phishing&limit=100')
  const loadingRuns = runs === null && !runsError
  const rows = (runs ?? []).filter((r) => r.case_type === 'link').map(runFromSummary)

  async function run() {
    const url = input.trim()
    if (!url || running) return
    setRunning(true)
    setSteps([])
    setResult(null)
    setError(null)
    try {
      for await (const event of apiPostStream('/check-links-stream', { urls: [url] })) {
        if (event.type === 'progress') {
          setSteps((prev) => [...prev, event.label])
        } else if (event.type === 'done') {
          const v = event.verdict
          setResult({
            target: url,
            sev: severityFromLabel(v.label),
            score: Math.round((v.confidence ?? 0) * 100),
            reason: v.reason,
            mitigation: v.mitigation,
          })
        }
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <SectionTitle eyebrow="Analysis / link" title="Link scanner">
        <span className="engine-status">
          <span className="pulse" />
          Engine ready
        </span>
      </SectionTitle>
      <div className="scan-layout">
        <section className="panel scan-card animate-in">
          <div className="scan-icon">
            <Link2 size={22} />
          </div>
          <p className="eyebrow">URL reputation &amp; content analysis</p>
          <h2>Scan a link</h2>
          <p className="muted">Paste a URL to inspect redirects, reputation, content, and credential harvesting signals. Progress streams live as the agent works.</p>
          <div className="input-wrap">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://example.com/login"
              onKeyDown={(e) => {
                if (e.key === 'Enter') run()
              }}
            />
            <button className="button primary" onClick={run} disabled={running}>
              {running ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {running ? 'Analyzing' : 'Run analysis'}
            </button>
          </div>
          {running && (
            <div className="progress-wrap">
              <div className="progress-head">
                <span>Running security engine</span>
                <span>Analyzing…</span>
              </div>
              <div className="progress-bar">
                <span />
              </div>
              <div className="steps steps-live">
                {steps.map((step, i) => (
                  <span key={i} className="done">
                    <Check size={12} />
                    {step}
                  </span>
                ))}
                <span className="current">
                  <Loader2 className="spin" size={12} />
                  Working…
                </span>
              </div>
            </div>
          )}
          {error && (
            <div className="result-card">
              <div className="result-head">
                <div>
                  <p className="eyebrow">Scan failed</p>
                  <h3>{input.trim() || 'Link'}</h3>
                </div>
                <Badge verdict="Unknown" />
              </div>
              <p>{error}</p>
            </div>
          )}
          {result && !running && (
            <ResultCard target={result.target} sev={result.sev} score={result.score} reason={result.reason} mitigation={result.mitigation} />
          )}
        </section>
        <SignalCoverage isLink />
      </div>
      <section className="panel runs-panel animate-in animate-in-delay-2">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Past link scans</p>
            <h2>Recent link investigations</h2>
          </div>
        </div>
        <RunTable runs={rows} onSelect={onSelect} loading={loadingRuns} error={runsError} />
      </section>
    </>
  )
}

function EmailScan({ onSelect, draftId }: { onSelect: (r: Run) => void; draftId?: string | null }) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<string[]>([])
  const [result, setResult] = useState<{ sev: Severity; score: number; reason: string; mitigation: string | null; runId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { runs, error: runsError } = useRuns('/runs?view=phishing&limit=100')

  async function loadEml(file?: File) {
    if (file) setInput(await file.text())
  }
  const loadingRuns = runs === null && !runsError
  const rows = (runs ?? []).filter((r) => r.case_type === 'email').map(runFromSummary)

  async function runWithText(text: string, gmailMessageId?: string | null) {
    if (!text.trim() || running) return
    setRunning(true)
    setSteps([])
    setResult(null)
    setError(null)
    try {
      let v: { label: VerdictLabel; confidence: number; risk_score?: number; reason: string; mitigation: string | null } | null = null
      let runId = ''
      for await (const event of apiPostStream('/check-email-stream', { text: text.trim() })) {
        if (event.type === 'progress') {
          setSteps((prev) => [...prev, event.label])
        } else if (event.type === 'done') {
          v = event.verdict
          runId = event.run_id
        }
      }
      if (!v) throw new Error('Stream ended without a verdict')
      setResult({
        sev: severityFromLabel(v.label),
        score: Math.round((v.risk_score ?? v.confidence ?? 0) * 100),
        reason: v.reason,
        mitigation: v.mitigation,
        runId,
      })
      // Only present when this came from the Gmail add-on's draft handoff —
      // records the association so reopening that email shows this same
      // report instead of the add-on offering to run a new one.
      if (gmailMessageId) {
        apiPost('/gmail-reports', { message_id: gmailMessageId, run_id: runId }).catch(() => {
          // Best-effort: the case itself already succeeded and is saved to
          // history regardless, this is only the Gmail-side convenience link.
        })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  function run() {
    return runWithText(input)
  }

  // Arrived via the Gmail add-on's "Check Report" button (/?draft=<id>):
  // fetch the raw email the add-on handed off, populate the box, and start
  // the scan immediately — the whole point of this path is "click a button
  // in Gmail, land here, watch the report run," not another manual step.
  useEffect(() => {
    if (!draftId) return
    let alive = true
    apiGet<{ text: string; message_id: string | null }>(`/email-drafts/${draftId}`)
      .then((draft) => {
        if (!alive) return
        setInput(draft.text)
        void runWithText(draft.text, draft.message_id)
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  return (
    <>
      <SectionTitle eyebrow="Analysis / email" title="Email scanner">
        <span className="engine-status">
          <span className="pulse" />
          Engine ready
        </span>
      </SectionTitle>
      <div className="scan-layout">
        <section className="panel scan-card animate-in">
          <div className="scan-icon">
            <Mail size={22} />
          </div>
          <p className="eyebrow">Header, content &amp; intent analysis</p>
          <h2>Scan an email</h2>
          <p className="muted">
            Paste the raw email (full headers + body) or upload a .eml file to trace its origin, check SPF/DKIM/DMARC, and
            scan attachments.
          </p>
          <input type="file" accept=".eml,message/rfc822" onChange={(e) => loadEml(e.target.files?.[0])} />
          <div className="input-wrap">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste email headers and body here…"
              rows={5}
            />
          </div>
          <div className="input-actions">
            <button className="button primary" onClick={run} disabled={running}>
              {running ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
              {running ? 'Analyzing' : 'Run analysis'}
            </button>
          </div>
          {running && (
            <div className="progress-wrap">
              <div className="progress-head">
                <span>Running security engine</span>
                <span>Analyzing…</span>
              </div>
              <div className="progress-bar">
                <span />
              </div>
              <div className="steps steps-live">
                {steps.map((step, i) => (
                  <span key={i} className="done">
                    <Check size={12} />
                    {step}
                  </span>
                ))}
                <span className="current">
                  <Loader2 className="spin" size={12} />
                  Working…
                </span>
              </div>
            </div>
          )}
          {error && (
            <div className="result-card">
              <div className="result-head">
                <div>
                  <p className="eyebrow">Scan failed</p>
                  <h3>Email</h3>
                </div>
                <Badge verdict="Unknown" />
              </div>
              <p>{error}</p>
            </div>
          )}
          {result && !running && (
            <>
              <ResultCard target="Email analysis" sev={result.sev} score={result.score} reason={result.reason} mitigation={result.mitigation} />
              <button className="button secondary" onClick={() => router.push(`/run/${result.runId}`)}>
                <ArrowUpRight size={15} />
                Open full forensic report
              </button>
            </>
          )}
        </section>
        <SignalCoverage isLink={false} />
      </div>
      <section className="panel runs-panel animate-in animate-in-delay-2">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Past email scans</p>
            <h2>Recent email investigations</h2>
          </div>
        </div>
        <RunTable runs={rows} onSelect={onSelect} loading={loadingRuns} error={runsError} />
      </section>
    </>
  )
}

function Campaigns() {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<Campaign[]>('/campaigns').then(setCampaigns).catch((err) => setError(errorMessage(err)))
  }, [])

  const fmt = (t: number | null) => (t ? new Date(t * 1000).toLocaleString() : '—')

  return (
    <>
      <SectionTitle eyebrow="Identity correlation / clustering" title="Campaigns" />
      <section className="panel animate-in">
        <p className="muted">Malicious cases grouped by similarity of their investigations.</p>
        {error && <p>{error}</p>}
        {campaigns === null && !error && <p className="muted">Loading…</p>}
        {campaigns?.length === 0 && <p className="muted">No campaigns yet — at least two similar malicious cases are needed.</p>}
        {campaigns && campaigns.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Cases</th>
                <th>Shared domains / IPs / senders</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.campaign_id}>
                  <td>{c.campaign_id}</td>
                  <td>
                    {c.run_ids.map((id) => (
                      <button key={id} className="text-button" onClick={() => router.push(`/run/${id}`)}>
                        {id.slice(0, 8)}
                      </button>
                    ))}
                    <span className="muted"> ({c.case_count})</span>
                  </td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 420 }}>{c.shared_entities.map((e) => e.value).join(', ') || '—'}</td>
                  <td>{fmt(c.first_seen)}</td>
                  <td>{fmt(c.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
    </>
  )
}

function History({ onSelect }: { onSelect: (r: Run) => void }) {
  const [query, setQuery] = useState('')
  const { runs, error } = useRuns('/runs?limit=200')
  const loading = runs === null && !error

  const [typeFilter, setTypeFilter] = useState<'All' | Kind>('All')
  const [verdictFilter, setVerdictFilter] = useState<'All' | Severity>('All')

  const rows = useMemo(() => (runs ?? []).map(runFromSummary), [runs])
  const filtered = useMemo(() => {
    let result = rows

    // Text search
    if (query) {
      const q = query.toLowerCase()
      result = result.filter((run) =>
        `${run.target} ${run.kind} ${run.verdict} ${run.id}`.toLowerCase().includes(q),
      )
    }

    // Type filter
    if (typeFilter !== 'All') {
      result = result.filter((run) => run.kind === typeFilter)
    }

    // Verdict filter
    if (verdictFilter !== 'All') {
      result = result.filter((run) => run.verdict === verdictFilter)
    }

    return result
  }, [rows, query, typeFilter, verdictFilter])

  function exportCsv() {
    const header = ['id', 'target', 'type', 'verdict', 'score', 'time']
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const body = filtered.map((r) => [r.id, r.target, r.kind, r.verdict, String(r.score), r.time].map(escape).join(','))
    const csv = [header.join(','), ...body].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'security-copilot-runs.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const typeOptions: ('All' | Kind)[] = ['All', 'Link', 'Email']
  const verdictOptions: ('All' | Severity)[] = ['All', 'Critical', 'Medium', 'Low', 'Safe']

  return (
    <>
      <SectionTitle eyebrow="Audit trail / all activity" title="Scan history">
        <button className="button secondary" onClick={exportCsv} disabled={filtered.length === 0}>
          <FileText size={15} />
          Export CSV
        </button>
      </SectionTitle>
      <section className="panel history-panel animate-in">
        <div className="toolbar">
          <div className="search-box">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search targets, run IDs…" />
          </div>
        </div>
        <div className="toolbar" style={{ marginBottom: 16 }}>
          <div className="filter-bar">
            <span className="filter-label">Type</span>
            {typeOptions.map((opt) => (
              <button
                key={opt}
                className={`filter-chip ${typeFilter === opt ? 'active' : ''}`}
                onClick={() => setTypeFilter(opt)}
              >
                {opt === 'Link' && <Link2 size={12} />}
                {opt === 'Email' && <Mail size={12} />}
                {opt}
              </button>
            ))}
            <span className="filter-separator" />
            <span className="filter-label">Verdict</span>
            {verdictOptions.map((opt) => (
              <button
                key={opt}
                className={`filter-chip ${verdictFilter === opt ? 'active' : ''}`}
                onClick={() => setVerdictFilter(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
        <RunTable runs={filtered} onSelect={onSelect} loading={loading} error={error} />
      </section>
    </>
  )
}

function SettingsView() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setUrl(getApiBaseUrl())
  }, [])

  function onUrlChange(value: string) {
    setUrl(value)
    setApiBaseUrl(value)
    setStatus('idle')
    setMessage('')
  }

  async function test() {
    setStatus('testing')
    setMessage('')
    try {
      const health = await apiGet<{ status: string; service: string }>('/health')
      setStatus('ok')
      setMessage(`${health.service} — ${health.status}`)
    } catch (err) {
      setStatus('fail')
      setMessage(errorMessage(err))
    }
  }

  return (
    <>
      <SectionTitle eyebrow="Workspace / configuration" title="Settings">
        <button className="button primary" onClick={test} disabled={status === 'testing'}>
          {status === 'testing' ? <Loader2 className="spin" size={16} /> : status === 'ok' ? <Check size={16} /> : <Activity size={16} />}
          {status === 'testing' ? 'Testing' : status === 'ok' ? 'Connection healthy' : 'Test connection'}
        </button>
      </SectionTitle>
      <div className="settings-grid">
        <section className="panel settings-card animate-in">
          <p className="eyebrow">Backend connection</p>
          <h2>FastAPI engine</h2>
          <p className="muted">Configure the analysis service that powers Security Copilot. No authentication is required (POC scope).</p>
          <label>
            Endpoint URL
            <input value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="http://localhost:8000" />
          </label>
          {status !== 'idle' && (
            <div className={`connection-row ${status === 'fail' ? 'connection-fail' : ''}`}>
              <span className={`pulse ${status === 'fail' ? 'danger-pulse' : ''}`} />
              {status === 'testing' ? 'Testing connection…' : message}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
