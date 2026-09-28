'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  AtSign,
  Check,
  Puzzle,
  Download,
  FileUp,
  Globe2,
  Inbox,
  Link2,
  Loader2,
  Mail,
  MailCheck,
  Paperclip,
  RotateCcw,
  Route,
  Search,
  Server,
} from 'lucide-react'
import { Shell, type View } from '@/components/Shell'
import { ClassSpectrum, CountUp, LabelChip, RiskDial, ToneChip, VerdictStamp } from '@/components/Instruments'
import { ReasonText } from '@/components/ReasonText'
import { ScanTheatre, type ScanStep } from '@/components/ScanTheatre'
import { WorldOriginMap } from '@/components/WorldOriginMap'
import { apiGet, apiPost, apiPostStream, getApiBaseUrl, setApiBaseUrl } from '@/lib/api'
import { EMAIL_SAMPLES, LINK_SAMPLES } from '@/lib/samples'
import {
  clockTime,
  errorMessage,
  fetchRunDetail,
  relativeTime,
  senderOf,
  shortId,
  subjectOf,
  useOrigins,
  useRuns,
} from '@/lib/runs'
import type { Campaign, RunDetail, RunSummary, Verdict } from '@/lib/types'
import { CLASS_NAME, VERDICT_CLASSES, classOf, className as labelName, isThreatLabel, riskOf, toneOfLabel } from '@/lib/verdict'

const VIEWS: View[] = ['command', 'investigate', 'feed', 'campaigns', 'cases', 'settings']

export default function Page() {
  const router = useRouter()
  const [view, setView] = useState<View>('command')
  const [mode, setMode] = useState<'email' | 'link'>('email')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Once opened, Investigate stays mounted (just hidden) so an in-flight
  // investigation keeps streaming while the analyst looks at other views.
  const [investigateMounted, setInvestigateMounted] = useState(false)

  // Deep links: `/?view=cases`, `/?view=investigate&mode=link`. Legacy
  // `/?run=<id>` (pre-/run/[id] bookmarks and reports) still redirects, and
  // `/?draft=<id>` is the Gmail add-on's "Check Report" hand-off: open
  // Investigate on the email and let it auto-load and run.
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
      setMode('email')
      go('investigate', false)
      return
    }
    const v = params.get('view') as View | null
    if (v && VIEWS.includes(v)) go(v, false)
    if (params.get('mode') === 'link') setMode('link')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function go(next: View, push = true) {
    setView(next)
    if (next === 'investigate') setInvestigateMounted(true)
    if (push) {
      const url = next === 'command' ? '/' : `/?view=${next}${next === 'investigate' && mode === 'link' ? '&mode=link' : ''}`
      window.history.replaceState(null, '', url)
    }
    window.scrollTo({ top: 0 })
  }

  function investigate(m: 'email' | 'link') {
    setMode(m)
    go('investigate')
  }

  return (
    <Shell view={view} onNavigate={(v) => go(v)} busy={busy}>
      {view !== 'investigate' && (
        <div className="page" key={view}>
          {view === 'command' && <CommandView onInvestigate={investigate} onNavigate={(v) => go(v)} />}
          {view === 'feed' && <FeedView />}
          {view === 'campaigns' && <CampaignsView />}
          {view === 'cases' && <CasesView />}
          {view === 'settings' && <SettingsView />}
        </div>
      )}
      {investigateMounted && (
        <div className="page" hidden={view !== 'investigate'}>
          <InvestigateView mode={mode} onMode={setMode} draftId={draftId} onBusy={setBusy} />
        </div>
      )}
    </Shell>
  )
}

/* ═══ Shared bits ═══════════════════════════════════════════════════ */

function ViewHead({ index, eyebrow, title, children }: { index: string; eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="view-head">
      <div>
        <p className="eyebrow">
          <span className="eyebrow-index">{index}</span>
          {eyebrow}
        </p>
        <h1 className="view-title">{title}</h1>
      </div>
      {children && <div className="view-head-actions">{children}</div>}
    </header>
  )
}

function StateLine({ loading, error, empty, emptyText }: { loading: boolean; error: string | null; empty: boolean; emptyText: React.ReactNode }) {
  if (loading)
    return (
      <div className="state-line">
        <Loader2 className="spin" size={16} /> Loading…
      </div>
    )
  if (error)
    return (
      <div className="state-line is-error" role="alert">
        <AlertTriangle size={16} /> {error}
      </div>
    )
  if (empty)
    return (
      <div className="state-line">
        <Inbox size={16} /> {emptyText}
      </div>
    )
  return null
}

function CaseRow({ run, index = 0 }: { run: RunSummary; index?: number }) {
  const router = useRouter()
  const sender = senderOf(run)
  const tone = toneOfLabel(run.verdict?.label)
  return (
    <button
      className={`case-row tone-${tone}`}
      onClick={() => router.push(`/run/${run.id}`)}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
    >
      <span className="case-row-rail" aria-hidden="true" />
      <span className="case-row-kind" aria-hidden="true">
        {run.case_type === 'email' ? <Mail size={15} /> : <Link2 size={15} />}
      </span>
      <span className="case-row-main">
        <strong>{subjectOf(run)}</strong>
        <span>{sender ?? (run.case_type === 'link' ? 'Link investigation' : 'Pasted text')}</span>
      </span>
      <LabelChip label={run.verdict?.label} />
      <span className="case-row-risk tabular" title="Risk score">
        {riskOf(run.verdict)}
      </span>
      <span className="case-row-time">{relativeTime(run.created_at)}</span>
      <ArrowUpRight className="case-row-go" size={16} aria-hidden="true" />
    </button>
  )
}

/* ═══ 01 · Command ══════════════════════════════════════════════════ */

function CommandView({ onInvestigate, onNavigate }: { onInvestigate: (m: 'email' | 'link') => void; onNavigate: (v: View) => void }) {
  const { runs, error, loading } = useRuns('/runs?limit=200')
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  useEffect(() => {
    apiGet<Campaign[]>('/campaigns').then(setCampaigns).catch(() => setCampaigns([]))
  }, [])
  const origins = useOrigins(runs)
  const list = runs ?? []

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of list) {
      const k = classOf(r.verdict?.label)
      if (k) c[k] = (c[k] ?? 0) + 1
    }
    return c
  }, [list])
  const threats = list.filter((r) => isThreatLabel(r.verdict?.label)).length
  const countries = new Set((origins ?? []).map((o) => o.countryCode).filter(Boolean)).size
  const anonymized = (origins ?? []).filter((o) => o.anonymized).length

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="eyebrow-index">SIH26106</span>
            Email threat detection · geolocation · forensic intelligence
          </p>
          <h1 className="display">
            Every email leaves a trail.
            <span className="voice"> We follow it.</span>
          </h1>
          <p className="lede">
            Drop in a raw email. The copilot traces its route hop by hop, checks who really sent it, sandboxes whatever it
            carries, and links it to the campaign behind it.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => onInvestigate('email')}>
              <Mail size={18} />
              Investigate an email
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => onInvestigate('link')}>
              <Link2 size={18} />
              Scan a link
            </button>
          </div>
          <ol className="doctrine" aria-label="How a case is worked">
            {['Detect', 'Trace', 'Attribute', 'Report'].map((s, i) => (
              <li key={s} style={{ animationDelay: `${200 + i * 70}ms` }}>
                <span>0{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>

        <div className="hero-map">
          <div className="hero-map-head">
            <p className="eyebrow">
              <Globe2 size={13} /> Origin radar
            </p>
            <span className="live-tag">
              <i /> live
            </span>
          </div>
          <WorldOriginMap origins={origins} loading={origins === null} />
          <div className="hero-map-foot">
            <span>
              <b className="tabular">{origins?.length ?? '—'}</b> traced origins
            </span>
            <span>
              <b className="tabular">{origins ? countries : '—'}</b> countries
            </span>
            <span>
              <b className="tabular">{origins ? anonymized : '—'}</b> via TOR / VPN
            </span>
          </div>
        </div>
      </section>

      <section className="kpis" aria-label="Key figures">
        <Kpi label="Cases investigated" value={list.length} loading={loading} note="emails and links, all time" />
        <Kpi label="Threats caught" value={threats} loading={loading} note="suspicious or worse" tone="critical" />
        <Kpi label="Campaigns linked" value={campaigns?.length ?? 0} loading={campaigns === null} note="clustered by SecureBERT" tone="uv" />
        <Kpi label="Countries of origin" value={countries} loading={origins === null} note="from hop-0 geolocation" />
      </section>

      <section className="panel panel-spectrum">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Five-class verdicts · SIH26106 taxonomy</p>
            <h2>How your mail breaks down</h2>
          </div>
          <button className="btn btn-quiet" onClick={() => onNavigate('cases')}>
            All case files <ArrowRight size={15} />
          </button>
        </div>
        {loading || error ? <StateLine loading={loading} error={error} empty={false} emptyText="" /> : <ClassSpectrum counts={counts} />}
      </section>

      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Latest activity</p>
              <h2>Recent cases</h2>
            </div>
            <button className="btn btn-quiet" onClick={() => onNavigate('feed')}>
              Live feed <ArrowRight size={15} />
            </button>
          </div>
          <StateLine loading={loading} error={error} empty={list.length === 0} emptyText="No cases yet — investigate an email to open the first one." />
          <div className="case-list">
            {list.slice(0, 6).map((r, i) => (
              <CaseRow key={r.id} run={r} index={i} />
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Detection activity · 14 days</p>
              <h2>Cases per day</h2>
            </div>
            <div className="legend">
              <span className="legend-threat">Threat</span>
              <span className="legend-clean">Clean</span>
            </div>
          </div>
          <ActivityChart runs={list} />
        </section>
      </div>
    </>
  )
}

function Kpi({ label, value, note, loading, tone }: { label: string; value: number; note: string; loading?: boolean; tone?: string }) {
  return (
    <div className={`kpi ${tone ? `kpi-${tone}` : ''}`}>
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{loading ? '—' : <CountUp value={value} />}</strong>
      <span className="kpi-note">{note}</span>
    </div>
  )
}

function ActivityChart({ runs }: { runs: RunSummary[] }) {
  const days = 14
  const buckets = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const out = Array.from({ length: days }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() - (days - 1 - i))
      return { date: d, threat: 0, clean: 0 }
    })
    for (const r of runs) {
      const d = new Date(r.created_at * 1000)
      d.setHours(0, 0, 0, 0)
      const idx = Math.round((d.getTime() - out[0].date.getTime()) / 86400000)
      if (idx < 0 || idx >= days) continue
      if (isThreatLabel(r.verdict?.label)) out[idx].threat++
      else out[idx].clean++
    }
    return out
  }, [runs])
  const max = Math.max(1, ...buckets.map((b) => b.threat + b.clean))
  const any = buckets.some((b) => b.threat + b.clean > 0)

  if (!any) return <div className="state-line">No cases in the last two weeks.</div>

  return (
    <div className="activity" role="img" aria-label={`Cases per day over ${days} days`}>
      <div className="activity-bars">
        {buckets.map((b, i) => {
          const total = b.threat + b.clean
          const label = b.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
          return (
            <div className="activity-col" key={i} title={`${label}: ${b.threat} threat · ${b.clean} clean`}>
              <div className="activity-stack" style={{ height: `${(total / max) * 100}%`, animationDelay: `${i * 30}ms` }}>
                {b.threat > 0 && <span className="seg-threat" style={{ flexGrow: b.threat }} />}
                {b.clean > 0 && <span className="seg-clean" style={{ flexGrow: b.clean }} />}
              </div>
              {total > 0 && <span className="activity-n tabular">{total}</span>}
            </div>
          )
        })}
      </div>
      <div className="activity-axis">
        {buckets.map((b, i) => (
          <span key={i}>{i % 2 === 1 || i === days - 1 ? b.date.toLocaleDateString(undefined, { day: 'numeric' }) : ''}</span>
        ))}
      </div>
    </div>
  )
}

/* ═══ 02 · Investigate ══════════════════════════════════════════════ */

type Outcome = { verdict: Omit<Verdict, 'run_id'>; runId: string }

function InvestigateView({
  mode,
  onMode,
  draftId,
  onBusy,
}: {
  mode: 'email' | 'link'
  onMode: (m: 'email' | 'link') => void
  draftId: string | null
  onBusy: (b: boolean) => void
}) {
  const [emailText, setEmailText] = useState('')
  const [url, setUrl] = useState('')
  const [scan, setScan] = useState<{ mode: 'email' | 'link'; source: string; startedAt: number } | null>(null)
  const [steps, setSteps] = useState<ScanStep[]>([])
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fromGmail, setFromGmail] = useState(false)
  const running = !!scan && !outcome && !error
  const beginRef = useRef<HTMLButtonElement>(null)

  useEffect(() => onBusy(running), [running, onBusy])

  const start = useCallback(
    async (m: 'email' | 'link', source: string, gmailMessageId?: string | null) => {
      const text = source.trim()
      if (!text) return
      setScan({ mode: m, source: text, startedAt: Date.now() })
      setSteps([])
      setOutcome(null)
      setError(null)
      try {
        const path = m === 'email' ? '/check-email-stream' : '/check-links-stream'
        const body = m === 'email' ? { text } : { urls: [text] }
        let result: Outcome | null = null
        for await (const event of apiPostStream(path, body)) {
          if (event.type === 'progress') setSteps((prev) => [...prev, { label: event.label, at: Date.now() }])
          else if (event.type === 'done') result = { verdict: event.verdict, runId: event.run_id }
        }
        if (!result) throw new Error('The stream ended without a verdict.')
        setOutcome(result)
        // Only for the Gmail add-on's hand-off: remember which Gmail message
        // this run belongs to, so reopening it in Gmail shows this report.
        if (gmailMessageId) {
          apiPost('/gmail-reports', { message_id: gmailMessageId, run_id: result.runId }).catch(() => {
            // Best-effort — the case itself is already saved to history.
          })
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : errorMessage(err))
      }
    },
    [],
  )

  // Arrived from Gmail's "Check Report" button (/?draft=<id>): load the
  // email the add-on handed off and start immediately — the whole point of
  // that path is "click in Gmail, land here, watch it run".
  useEffect(() => {
    if (!draftId) return
    let alive = true
    apiGet<{ text: string; message_id: string | null }>(`/email-drafts/${draftId}`)
      .then((draft) => {
        if (!alive) return
        setFromGmail(true)
        setEmailText(draft.text)
        void start('email', draft.text, draft.message_id)
      })
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [draftId, start])

  function reset() {
    setScan(null)
    setSteps([])
    setOutcome(null)
    setError(null)
  }

  const showTheatre = !!scan

  return (
    <>
      <ViewHead
        index="02"
        eyebrow={fromGmail ? 'Handed off from Gmail' : 'Open a case'}
        title={
          <>
            Investigate <span className="voice">{mode === 'email' ? 'an email' : 'a link'}</span>
          </>
        }
      >
        {!showTheatre && (
          <div className="segmented" role="tablist" aria-label="What to investigate">
            <button role="tab" aria-selected={mode === 'email'} className={mode === 'email' ? 'is-on' : ''} onClick={() => onMode('email')}>
              <Mail size={15} /> Email
            </button>
            <button role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'is-on' : ''} onClick={() => onMode('link')}>
              <Link2 size={15} /> Link
            </button>
          </div>
        )}
        {showTheatre && !running && (
          <button className="btn btn-ghost" onClick={reset}>
            <RotateCcw size={15} /> New investigation
          </button>
        )}
      </ViewHead>

      {fromGmail && (
        <div className="notice">
          <MailCheck size={17} />
          <span>
            This message came from the Gmail add-on&apos;s <b>Check Report</b> button. The finished report is linked back to the
            email, so reopening it in Gmail jumps straight here.
          </span>
        </div>
      )}

      {!showTheatre && mode === 'email' && (
        <EmailIntake
          value={emailText}
          onChange={setEmailText}
          onBegin={() => start('email', emailText)}
          beginRef={beginRef}
        />
      )}
      {!showTheatre && mode === 'link' && <LinkIntake value={url} onChange={setUrl} onBegin={(u) => start('link', u ?? url)} />}

      {showTheatre && scan && (
        <>
          <ScanTheatre
            mode={scan.mode}
            source={scan.source}
            steps={steps}
            startedAt={scan.startedAt}
            finished={!running}
            failed={!!error}
          />
          {error && (
            <div className="panel reveal-error" role="alert">
              <AlertTriangle size={20} />
              <div>
                <h3>The investigation didn&apos;t finish</h3>
                <p>{error}</p>
              </div>
              <button className="btn btn-primary" onClick={() => start(scan.mode, scan.source)}>
                <RotateCcw size={15} /> Try again
              </button>
            </div>
          )}
          {outcome && <VerdictReveal outcome={outcome} mode={scan.mode} onReset={reset} />}
        </>
      )}
    </>
  )
}

/** Header facts parsed client-side, so the intake shows what it's holding before anything is sent. */
function peekEmail(text: string) {
  if (!/^[\w-]+:/.test(text.trimStart())) return null
  const header = text.split(/\r?\n\r?\n/)[0]
  const get = (name: string) => header.match(new RegExp(`^${name}:[ \\t]*(.+)$`, 'im'))?.[1].trim()
  return {
    from: get('From'),
    subject: get('Subject'),
    hops: (header.match(/^Received:/gim) ?? []).length,
    attachments: (text.match(/Content-Disposition:\s*attachment/gi) ?? []).length,
    links: new Set(text.match(/https?:\/\/[^\s"'<>]+/gi) ?? []).size,
    auth: /^Authentication-Results:/im.test(header),
  }
}

function EmailIntake({
  value,
  onChange,
  onBegin,
  beginRef,
}: {
  value: string
  onChange: (v: string) => void
  onBegin: () => void
  beginRef: React.RefObject<HTMLButtonElement | null>
}) {
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const peek = useMemo(() => peekEmail(value), [value])

  async function load(file?: File) {
    if (!file) return
    onChange(await file.text())
    requestAnimationFrame(() => beginRef.current?.focus())
  }

  return (
    <div className="intake-grid">
      <section
        className={`intake ${dragging ? 'is-dragging' : ''} ${value ? 'has-value' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void load(e.dataTransfer.files?.[0])
        }}
      >
        <div className="intake-drop">
          <svg className="envelope" viewBox="0 0 64 48" aria-hidden="true">
            <rect className="envelope-body" x="2" y="6" width="60" height="40" rx="5" />
            <path className="envelope-flap" d="M3 8 L32 29 L61 8" />
            <rect className="envelope-scan" x="0" y="4" width="64" height="2" rx="1" />
          </svg>
          <div>
            <h2>Drop the raw email here</h2>
            <p>
              A <code>.eml</code> file, or paste the full source below — headers included. Headers are what let us trace the route
              and verify the sender.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={() => fileInput.current?.click()}>
            <FileUp size={16} /> Browse .eml
          </button>
          <input ref={fileInput} type="file" accept=".eml,message/rfc822" hidden onChange={(e) => load(e.target.files?.[0])} />
        </div>

        <label className="field">
          <span className="field-label">Raw message source</span>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={'Received: from …\nFrom: …\nSubject: …\n\n(body)'}
            rows={9}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onBegin()
            }}
          />
        </label>

        {peek && (
          <div className="peek" aria-label="What we can already see">
            {peek.from && (
              <span className="peek-item peek-wide">
                <AtSign size={14} />
                <code>{peek.from}</code>
              </span>
            )}
            {peek.subject && (
              <span className="peek-item peek-wide">
                <Mail size={14} />
                {peek.subject}
              </span>
            )}
            <span className="peek-item">
              <Route size={14} />
              {peek.hops} hop{peek.hops === 1 ? '' : 's'}
            </span>
            <span className="peek-item">
              <Paperclip size={14} />
              {peek.attachments} attachment{peek.attachments === 1 ? '' : 's'}
            </span>
            <span className="peek-item">
              <Link2 size={14} />
              {peek.links} link{peek.links === 1 ? '' : 's'}
            </span>
          </div>
        )}
        {value && !peek && (
          <p className="hint">
            No header block detected — this will be read as plain text. Paste the full source (Gmail: ⋮ → Show original) for route and
            sender checks.
          </p>
        )}

        <div className="intake-actions">
          <span className="hint">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to begin
          </span>
          <button ref={beginRef} className="btn btn-primary btn-lg" onClick={onBegin} disabled={!value.trim()}>
            Begin investigation <ArrowRight size={17} />
          </button>
        </div>
      </section>

      <aside className="intake-side">
        <p className="eyebrow">Try a specimen</p>
        <div className="samples">
          {EMAIL_SAMPLES.map((s) => (
            <button
              key={s.id}
              className={`sample tone-${s.tone}`}
              onClick={() => {
                onChange(s.text)
                requestAnimationFrame(() => beginRef.current?.focus())
              }}
            >
              <span className="sample-rail" aria-hidden="true" />
              <strong>{s.title}</strong>
              <span>{s.hint}</span>
            </button>
          ))}
        </div>
        <p className="eyebrow side-gap">What the agent checks</p>
        <ul className="checklist">
          <li>
            <Route size={15} /> Received chain, hop by hop, to the origin server
          </li>
          <li>
            <Check size={15} /> SPF, DKIM and DMARC — with domain alignment
          </li>
          <li>
            <Globe2 size={15} /> Origin city, ISP and ASN · TOR / VPN / hosting
          </li>
          <li>
            <Paperclip size={15} /> Attachments, never opened: true type, macros, PDF JavaScript
          </li>
          <li>
            <Link2 size={15} /> Every link, detonated in a sandboxed browser
          </li>
          <li>
            <Server size={15} /> Past cases — is this part of a campaign?
          </li>
        </ul>
      </aside>
    </div>
  )
}

function LinkIntake({ value, onChange, onBegin }: { value: string; onChange: (v: string) => void; onBegin: (u?: string) => void }) {
  return (
    <div className="intake-grid">
      <section className="intake">
        <label className="field">
          <span className="field-label">URL to detonate</span>
          <div className="url-field">
            <Link2 size={18} aria-hidden="true" />
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://example.com/login"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onBegin()
              }}
            />
          </div>
        </label>
        <p className="hint">
          The page opens in an isolated headless browser — screenshot, forms, redirects and hosting are recorded; nothing runs on your
          machine.
        </p>
        <div className="intake-actions">
          <span />
          <button className="btn btn-primary btn-lg" onClick={() => onBegin()} disabled={!value.trim()}>
            Detonate link <ArrowRight size={17} />
          </button>
        </div>
      </section>
      <aside className="intake-side">
        <p className="eyebrow">Try a specimen</p>
        <div className="samples">
          {LINK_SAMPLES.map((s, i) => (
            <button
              key={s.url}
              className={`sample tone-${i === 0 ? 'critical' : 'safe'}`}
              onClick={() => {
                onChange(s.url)
              }}
            >
              <span className="sample-rail" aria-hidden="true" />
              <strong>
                <code>{s.url}</code>
              </strong>
              <span>{s.hint}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}

function VerdictReveal({ outcome, mode, onReset }: { outcome: Outcome; mode: 'email' | 'link'; onReset: () => void }) {
  const router = useRouter()
  const v = outcome.verdict
  const risk = riskOf(v)
  const tone = toneOfLabel(v.label)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    fetchRunDetail(outcome.runId).then(setDetail)
    panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [outcome.runId])

  // Skip captures of Chrome's own error page (a domain that didn't resolve).
  const shot = detail?.tool_calls.find(
    (c) => c.tool === 'inspect_website' && c.screenshot_path && !c.artifact.final_url?.startsWith('chrome-error://'),
  )?.screenshot_path
  const factors = detail?.verdict?.risk_factors ?? []

  return (
    <section className={`reveal tone-${tone}`} ref={panel} aria-label="Verdict">
      <div className="reveal-instruments">
        <VerdictStamp label={v.label} sub={`Case ${shortId(outcome.runId)}`} />
        <RiskDial risk={risk} tone={tone} />
      </div>
      <div className="reveal-body">
        <p className="eyebrow">The copilot&apos;s read</p>
        <ReasonText text={v.reason} voice />
        {factors.length > 0 && (
          <ul className="factor-list">
            {factors.slice(0, 6).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
        {v.mitigation && (
          <div className="advice">
            <span className="eyebrow">What to do</span>
            <ReasonText text={v.mitigation} />
          </div>
        )}
        {shot && (
          <figure className="reveal-shot">
            <img src={`${getApiBaseUrl()}/screenshots/${shot.split(/[/\\]/).pop()}`} alt="Sandbox screenshot of the scanned page" />
            <figcaption>Captured in the sandbox</figcaption>
          </figure>
        )}
        <div className="reveal-actions">
          <button className="btn btn-primary btn-lg" onClick={() => router.push(`/run/${outcome.runId}`)}>
            Open the case file <ArrowRight size={17} />
          </button>
          <button className="btn btn-ghost btn-lg" onClick={onReset}>
            <RotateCcw size={16} /> {mode === 'email' ? 'Investigate another email' : 'Scan another link'}
          </button>
        </div>
      </div>
    </section>
  )
}

/* ═══ 03 · Live feed ════════════════════════════════════════════════ */

const REFRESH_MS = 15000

function FeedView() {
  const { runs, error, loading, tick } = useRuns('/runs?limit=200', REFRESH_MS)
  const [filter, setFilter] = useState<string>('all')
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  // Anything that appears after the first load is "new" and gets a one-time highlight.
  useEffect(() => {
    if (!runs) return
    if (seen.current === null) {
      seen.current = new Set(runs.map((r) => r.id))
      return
    }
    const added = runs.filter((r) => !seen.current!.has(r.id)).map((r) => r.id)
    added.forEach((id) => seen.current!.add(id))
    if (added.length) setFresh(new Set(added))
  }, [runs])

  const items = useMemo(() => {
    const list = runs ?? []
    if (filter === 'all') return list
    if (filter === 'threats') return list.filter((r) => isThreatLabel(r.verdict?.label))
    return list.filter((r) => classOf(r.verdict?.label) === filter)
  }, [runs, filter])

  const groups = useMemo(() => {
    const out: { day: string; items: RunSummary[] }[] = []
    const today = new Date().toDateString()
    const yesterday = new Date(Date.now() - 86400000).toDateString()
    for (const r of items) {
      const d = new Date(r.created_at * 1000)
      const key = d.toDateString() === today ? 'Today' : d.toDateString() === yesterday ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
      const last = out[out.length - 1]
      if (last?.day === key) last.items.push(r)
      else out.push({ day: key, items: [r] })
    }
    return out
  }, [items])

  return (
    <>
      <ViewHead index="03" eyebrow="Real-time alerting" title={<>Live <span className="voice">feed</span></>}>
        <span className="refresh" title="Refreshes every 15 seconds">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8" className="refresh-track" />
            <circle cx="10" cy="10" r="8" className="refresh-fill rm-keep-loop" key={tick} />
          </svg>
          Auto-refresh · 15s
        </span>
      </ViewHead>

      <div className="filters" role="toolbar" aria-label="Filter the feed">
        {[
          { id: 'all', label: 'Everything' },
          { id: 'threats', label: 'Threats only' },
          ...VERDICT_CLASSES.map((k) => ({ id: k, label: CLASS_NAME[k] })),
        ].map((f) => (
          <button
            key={f.id}
            className={`filter ${filter === f.id ? 'is-on' : ''} ${VERDICT_CLASSES.includes(f.id as never) ? `tone-${toneOfLabel(f.id)}` : ''}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
          >
            {VERDICT_CLASSES.includes(f.id as never) && <i className="chip-dot" aria-hidden="true" />}
            {f.label}
          </button>
        ))}
        <span className="filters-count tabular">{items.length} alerts</span>
      </div>

      <StateLine loading={loading} error={error} empty={!loading && !error && items.length === 0} emptyText="Nothing matches this filter." />

      <div className="timeline">
        {groups.map((g) => (
          <section key={g.day} className="timeline-day">
            <h3 className="timeline-date">{g.day}</h3>
            <div className="timeline-items">
              {g.items.map((r, i) => (
                <FeedItem key={r.id} run={r} index={i} fresh={fresh.has(r.id)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}

// The agent's reason can open with a "- " bullet; the feed wants plain prose.
function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.replace(/^[-*]\s+/, '').replace(/\*\*/g, '')
}

function FeedItem({ run, index, fresh }: { run: RunSummary; index: number; fresh: boolean }) {
  const router = useRouter()
  const tone = toneOfLabel(run.verdict?.label)
  const sender = senderOf(run)
  return (
    <button
      className={`feed-item tone-${tone} ${fresh ? 'is-fresh' : ''}`}
      onClick={() => router.push(`/run/${run.id}`)}
      style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
    >
      <span className="feed-node" aria-hidden="true" />
      <span className="feed-time">
        {new Date(run.created_at * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
      </span>
      <span className="feed-card">
        <span className="feed-top">
          <LabelChip label={run.verdict?.label} />
          <span className="feed-kind">
            {run.case_type === 'email' ? <Mail size={13} /> : <Link2 size={13} />}
            {run.case_type}
          </span>
          <span className="feed-risk tabular">
            risk <b>{riskOf(run.verdict)}</b>
          </span>
        </span>
        <strong className="feed-subject">{subjectOf(run)}</strong>
        {sender && <code className="feed-sender">{sender}</code>}
        {run.verdict?.reason && <span className="feed-reason">{firstLine(run.verdict.reason)}</span>}
      </span>
    </button>
  )
}

/* ═══ 04 · Campaigns ════════════════════════════════════════════════ */

function CampaignsView() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<Campaign[]>('/campaigns').then(setCampaigns).catch((err) => setError(errorMessage(err)))
  }, [])

  return (
    <>
      <ViewHead index="04" eyebrow="Identity correlation · clustering" title={<>Campaigns <span className="voice">behind the mail</span></>} />
      <p className="view-lede">
        Malicious cases whose investigations read alike — embedded with SecureBERT and clustered with DBSCAN. Shared domains, IPs and
        senders are the thread that ties one gang&apos;s emails together.
      </p>
      <StateLine
        loading={campaigns === null && !error}
        error={error}
        empty={campaigns?.length === 0}
        emptyText="No campaigns yet — it takes at least two similar malicious cases to form one."
      />
      <div className="campaigns">
        {campaigns?.map((c, i) => (
          <CampaignCard key={c.campaign_id} campaign={c} index={i} />
        ))}
      </div>
    </>
  )
}

function CampaignCard({ campaign: c, index }: { campaign: Campaign; index: number }) {
  const router = useRouter()
  const label = c.labels[0]
  const tone = toneOfLabel(label)
  const ents = c.shared_entities.slice(0, 5)
  const cases = c.run_ids.slice(0, 5)
  const H = Math.max(cases.length, ents.length, 2) * 34 + 10
  const y = (i: number, n: number) => (H / (n + 1)) * (i + 1)

  return (
    <article className={`campaign tone-${tone}`} style={{ animationDelay: `${Math.min(index, 5) * 50}ms` }}>
      <header className="campaign-head">
        <div>
          <p className="eyebrow">Campaign</p>
          <h3>
            <code>{c.campaign_id}</code>
          </h3>
        </div>
        <div className="campaign-count">
          <strong className="tabular">{c.case_count}</strong>
          <span>linked cases</span>
        </div>
      </header>
      <div className="campaign-labels">
        {c.labels.map((l) => (
          <LabelChip key={l} label={l} />
        ))}
      </div>

      <svg className="constellation" viewBox={`0 0 320 ${H}`} role="img" aria-label={`${c.case_count} cases linked through ${ents.map((e) => e.value).join(', ')}`}>
        {cases.map((_, ci) =>
          ents.map((_, ei) => (
            <path
              key={`${ci}-${ei}`}
              d={`M40 ${y(ci, cases.length)} C 160 ${y(ci, cases.length)}, 160 ${y(ei, ents.length)}, 206 ${y(ei, ents.length)}`}
              className="const-link"
              pathLength={1}
              style={{ animationDelay: `${(ci + ei) * 60}ms` }}
            />
          )),
        )}
        {cases.map((id, ci) => (
          <g key={id} transform={`translate(40 ${y(ci, cases.length)})`} className="const-case">
            <circle r="7" />
            <text x="-14" y="4" textAnchor="end">
              {shortId(id).slice(0, 4)}
            </text>
          </g>
        ))}
        {ents.map((e, ei) => (
          <g key={e.value} transform={`translate(212 ${y(ei, ents.length)})`} className="const-ent">
            <rect x="-6" y="-6" width="12" height="12" rx="2" />
            <text x="14" y="4">
              {e.value.length > 16 ? `${e.value.slice(0, 15)}…` : e.value}
            </text>
          </g>
        ))}
      </svg>

      <dl className="campaign-meta">
        <div>
          <dt>Shared evidence</dt>
          <dd>
            {c.shared_entities.length === 0 ? (
              '—'
            ) : (
              c.shared_entities.map((e) => (
                <span key={e.value} className="entity">
                  <em>{e.type}</em>
                  <code>{e.value}</code>
                </span>
              ))
            )}
          </dd>
        </div>
        <div className="campaign-dates">
          <div>
            <dt>First seen</dt>
            <dd>{c.first_seen ? clockTime(c.first_seen) : '—'}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{c.last_seen ? clockTime(c.last_seen) : '—'}</dd>
          </div>
        </div>
      </dl>
      <div className="campaign-cases">
        {c.run_ids.map((id) => (
          <button key={id} className="case-pill" onClick={() => router.push(`/run/${id}`)}>
            {shortId(id)} <ArrowUpRight size={13} />
          </button>
        ))}
      </div>
    </article>
  )
}

/* ═══ 05 · Case files ═══════════════════════════════════════════════ */

function CasesView() {
  const router = useRouter()
  const { runs, error, loading } = useRuns('/runs?limit=200')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'email' | 'link'>('all')
  const [cls, setCls] = useState<string>('all')

  const filtered = useMemo(() => {
    let list = runs ?? []
    if (query) {
      const q = query.toLowerCase()
      list = list.filter((r) => `${subjectOf(r)} ${senderOf(r) ?? ''} ${r.id} ${r.verdict?.label}`.toLowerCase().includes(q))
    }
    if (kind !== 'all') list = list.filter((r) => r.case_type === kind)
    if (cls !== 'all') list = list.filter((r) => (classOf(r.verdict?.label) ?? r.verdict?.label) === cls)
    return list
  }, [runs, query, kind, cls])

  function exportCsv() {
    const header = ['id', 'subject_or_target', 'type', 'verdict', 'risk', 'created_at']
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const body = filtered.map((r) =>
      [r.id, subjectOf(r), r.case_type, r.verdict?.label ?? '', String(riskOf(r.verdict)), new Date(r.created_at * 1000).toISOString()]
        .map(escape)
        .join(','),
    )
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'security-copilot-cases.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <ViewHead index="05" eyebrow="Audit trail" title={<>Case <span className="voice">files</span></>}>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={15} /> Export CSV
        </button>
      </ViewHead>

      <div className="cases-tools">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject, sender, case ID…" aria-label="Search cases" />
        </label>
        <div className="segmented segmented-sm" role="group" aria-label="Case type">
          {(['all', 'email', 'link'] as const).map((k) => (
            <button key={k} className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)} aria-pressed={kind === k}>
              {k === 'all' ? 'All' : k === 'email' ? 'Email' : 'Link'}
            </button>
          ))}
        </div>
        <div className="filters filters-inline" role="group" aria-label="Verdict">
          <button className={`filter ${cls === 'all' ? 'is-on' : ''}`} onClick={() => setCls('all')} aria-pressed={cls === 'all'}>
            Any verdict
          </button>
          {VERDICT_CLASSES.map((k) => (
            <button key={k} className={`filter tone-${toneOfLabel(k)} ${cls === k ? 'is-on' : ''}`} onClick={() => setCls(k)} aria-pressed={cls === k}>
              <i className="chip-dot" aria-hidden="true" />
              {CLASS_NAME[k]}
            </button>
          ))}
        </div>
      </div>

      <section className="panel panel-flush">
        <div className="table-scroll">
          <table className="cases-table">
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Type</th>
                <th scope="col">Verdict</th>
                <th scope="col">Risk</th>
                <th scope="col">Opened</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const risk = riskOf(r.verdict)
                const tone = toneOfLabel(r.verdict?.label)
                return (
                  <tr
                    key={r.id}
                    className={`tone-${tone}`}
                    tabIndex={0}
                    onClick={() => router.push(`/run/${r.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') router.push(`/run/${r.id}`)
                    }}
                  >
                    <td>
                      <strong className="cell-subject">{subjectOf(r)}</strong>
                      <code className="cell-id">{shortId(r.id)}</code>
                      {senderOf(r) && <code className="cell-sender">{senderOf(r)}</code>}
                    </td>
                    <td>
                      <span className="cell-kind">
                        {r.case_type === 'email' ? <Mail size={14} /> : <Link2 size={14} />}
                        {r.case_type === 'email' ? 'Email' : 'Link'}
                      </span>
                    </td>
                    <td>
                      <LabelChip label={r.verdict?.label} />
                    </td>
                    <td>
                      <span className="risk-cell">
                        <span className="risk-track" aria-hidden="true">
                          <span style={{ transform: `scaleX(${risk / 100})` }} />
                        </span>
                        <b className="tabular">{risk}</b>
                      </span>
                    </td>
                    <td className="cell-time">
                      {relativeTime(r.created_at)}
                      <span>{clockTime(r.created_at)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <StateLine loading={loading} error={error} empty={!loading && !error && filtered.length === 0} emptyText="No cases match." />
      </section>
    </>
  )
}

/* ═══ Settings ══════════════════════════════════════════════════════ */

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
      <ViewHead index="—" eyebrow="Workspace configuration" title="Settings" />
      <div className="settings-grid">
        <section className="panel">
          <p className="eyebrow">Backend connection</p>
          <h2>Forensics engine</h2>
          <p className="muted">
            The FastAPI service that runs the agent. No authentication in this build (POC scope) — keep it on localhost or behind a
            tunnel you control.
          </p>
          <label className="field">
            <span className="field-label">Endpoint URL</span>
            <input className="input" value={url} onChange={(e) => onUrlChange(e.target.value)} placeholder="http://localhost:8010" spellCheck={false} />
          </label>
          <div className="settings-actions">
            <button className="btn btn-primary" onClick={test} disabled={status === 'testing'}>
              {status === 'testing' ? <Loader2 className="spin" size={16} /> : <Server size={16} />}
              {status === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {status === 'ok' && <ToneChip tone="safe">{message}</ToneChip>}
            {status === 'fail' && (
              <span className="state-line is-error" role="alert">
                <AlertTriangle size={15} /> {message}
              </span>
            )}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Entry points</p>
          <h2>Where cases come from</h2>
          <ul className="integrations">
            <li>
              <Puzzle size={18} />
              <div>
                <strong>Chrome extension</strong>
                <span>
                  Instant check on every page and on every Gmail message you open. Build it, then load <code>extension/dist</code> unpacked
                  from <code>chrome://extensions</code>.
                </span>
              </div>
            </li>
            <li>
              <MailCheck size={18} />
              <div>
                <strong>Gmail add-on and auto-scanner</strong>
                <span>
                  Labels new mail <b>Dangerous</b> / <b>Suspicious</b> / <b>Safe</b> every minute, and its <b>Check Report</b> button hands
                  a message to this dashboard. Needs the backend reachable over HTTPS — see <code>gmail-addon/README.md</code>.
                </span>
              </div>
            </li>
            <li>
              <FileUp size={18} />
              <div>
                <strong>Dashboard and CLI</strong>
                <span>
                  Drop a <code>.eml</code> into Investigate, or run <code>python cli.py email &lt; message.eml</code>.
                </span>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </>
  )
}
