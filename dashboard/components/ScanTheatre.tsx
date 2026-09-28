'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Minus } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { usePrefersReducedMotion } from '@/components/Instruments'

export type ScanStep = { label: string; at: number }

type StageDef = { key: string; title: string; detail: string; match: RegExp; highlight?: RegExp }

// Keyed off the progress labels agent/graph.py emits (_TOOL_LABELS /
// _friendly_step). A stage lights when its label arrives; each one also
// names the lines of the raw email that step actually reads, so the beam
// visibly "reads" the right headers as the investigation moves.
const EMAIL_STAGES: StageDef[] = [
  { key: 'intake', title: 'Intake', detail: 'Parse MIME, decode body and links', match: /Starting investigation/i, highlight: /^(MIME-Version|Content-Type|Content-Transfer-Encoding):/i },
  { key: 'trace', title: 'Trace the route', detail: 'Received chain → hop-0 origin', match: /delivery path/i, highlight: /^(Received:|\s+by\s)/i },
  { key: 'auth', title: 'Authenticate sender', detail: 'SPF · DKIM · DMARC + alignment', match: /SPF, DKIM/i, highlight: /^(Authentication-Results|DKIM-Signature|Received-SPF|ARC-[\w-]+):/i },
  { key: 'reputation', title: 'Sender reputation', detail: 'Domain age, VirusTotal, MX/TXT', match: /VirusTotal & domain/i, highlight: /^(From|Return-Path|Reply-To):/i },
  { key: 'origin', title: 'Geolocate origin', detail: 'City, ASN · TOR / VPN / hosting', match: /Geolocating/i, highlight: /\b\d{1,3}(\.\d{1,3}){3}\b/ },
  { key: 'payload', title: 'Sandbox attachments', detail: 'True type, macros, PDF JavaScript', match: /attachments/i, highlight: /(filename=|Content-Disposition:\s*attachment|name=")/i },
  { key: 'links', title: 'Detonate links', detail: 'Headless browser, forms, redirects', match: /sandboxed browser|another page|phishing patterns|legitimate site/i, highlight: /https?:\/\//i },
  { key: 'memory', title: 'Cross-case memory', detail: 'Seen before? Campaign links', match: /past cases|recall_similar|correlate/i, highlight: /^(Message-ID|From):/i },
  { key: 'verdict', title: 'Verdict', detail: 'Five-class label, risk, attribution', match: /Finalizing/i },
]

const LINK_STAGES: StageDef[] = [
  { key: 'intake', title: 'Router', detail: 'Blocklist and 24h cache', match: /Starting investigation/i },
  { key: 'sandbox', title: 'Sandbox visit', detail: 'Headless Chromium, screenshot, forms', match: /sandboxed browser|another page/i },
  { key: 'reputation', title: 'Reputation', detail: 'WHOIS age, VirusTotal vendors', match: /VirusTotal/i },
  { key: 'model', title: 'Content model', detail: 'ONNX URL and BERT text models', match: /phishing patterns/i },
  { key: 'origin', title: 'Hosting origin', detail: 'Server IP geolocation', match: /Geolocating/i },
  { key: 'search', title: 'Brand check', detail: 'Search for the real site', match: /legitimate site/i },
  { key: 'memory', title: 'Cross-case memory', detail: 'Seen in past cases?', match: /past cases|recall_similar|correlate/i },
  { key: 'verdict', title: 'Verdict', detail: 'Label, risk, alternatives', match: /Finalizing/i },
]

type StageState = 'pending' | 'active' | 'done' | 'skipped'

function useStages(stages: StageDef[], steps: ScanStep[], finished: boolean) {
  return useMemo(() => {
    const seenAt = new Map<string, number>()
    let activeKey: string | null = null
    for (const step of steps) {
      const stage = stages.find((s) => s.match.test(step.label))
      if (!stage) continue
      if (!seenAt.has(stage.key)) seenAt.set(stage.key, step.at)
      activeKey = stage.key
    }
    const state = (key: string): StageState => {
      if (finished) return seenAt.has(key) ? 'done' : 'skipped'
      if (key === activeKey) return 'active'
      return seenAt.has(key) ? 'done' : 'pending'
    }
    const active = stages.find((s) => s.key === activeKey) ?? null
    const done = stages.filter((s) => state(s.key) === 'done').length
    return { state, seenAt, active, progress: finished ? 1 : Math.min(0.96, (done + 0.5) / stages.length) }
  }, [stages, steps, finished])
}

export function ScanTheatre({
  mode,
  source,
  steps,
  startedAt,
  finished,
  failed,
}: {
  mode: 'email' | 'link'
  source: string
  steps: ScanStep[]
  startedAt: number
  finished: boolean
  failed?: boolean
}) {
  const stages = mode === 'email' ? EMAIL_STAGES : LINK_STAGES
  const { state, seenAt, active, progress } = useStages(stages, steps, finished)

  return (
    <section className={`theatre ${finished ? 'is-finished' : 'is-running'} ${failed ? 'is-failed' : ''}`} aria-label="Live investigation">
      <div className="theatre-head">
        <BrandMark size={34} active={!finished} />
        <div>
          <p className="eyebrow">{finished ? (failed ? 'Investigation stopped' : 'Investigation complete') : 'Agent investigating'}</p>
          <h2>{finished ? (failed ? 'The scan could not finish' : 'Evidence gathered') : active ? `${active.title}…` : 'Warming up…'}</h2>
        </div>
        <Elapsed startedAt={startedAt} running={!finished} />
      </div>
      <div className="theatre-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      <div className="theatre-grid">
        {mode === 'email' ? (
          <EmailSpecimen source={source} highlight={finished ? undefined : active?.highlight} readHighlights={stages.filter((s) => state(s.key) === 'done').map((s) => s.highlight).filter(Boolean) as RegExp[]} scanning={!finished} />
        ) : (
          <LinkSpecimen url={source} caption={active?.detail} scanning={!finished} />
        )}

        <ol className="stages" aria-live="polite">
          {stages.map((s, i) => {
            const st = state(s.key)
            const at = seenAt.get(s.key)
            return (
              <li key={s.key} className={`stage is-${st}`}>
                <span className="stage-node" aria-hidden="true">
                  {st === 'done' ? <Check size={12} strokeWidth={3} /> : st === 'skipped' ? <Minus size={12} /> : <span>{String(i + 1).padStart(2, '0')}</span>}
                </span>
                <span className="stage-text">
                  <strong>{s.title}</strong>
                  <span>{st === 'skipped' ? 'Not needed for this case' : s.detail}</span>
                </span>
                <span className="stage-time tabular">{at != null ? `+${((at - startedAt) / 1000).toFixed(1)}s` : ''}</span>
              </li>
            )
          })}
        </ol>
      </div>

      {steps.length > 0 && (
        <div className="theatre-log" aria-label="Agent log">
          {steps.slice(-4).map((s, i, arr) => (
            <span key={`${s.at}-${i}`} className={i === arr.length - 1 && !finished ? 'is-live' : ''}>
              <code>+{((s.at - startedAt) / 1000).toFixed(1)}s</code>
              {s.label.replace(/\.\.\.$/, '')}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function Elapsed({ startedAt, running }: { startedAt: number; running: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(id)
  }, [running])
  // Once the scan finishes the interval stops, so this freezes at the final time.
  const secs = Math.max(0, (now - startedAt) / 1000)
  return (
    <span className="elapsed tabular" aria-label={`${Math.round(secs)} seconds elapsed`}>
      {secs.toFixed(1)}
      <em>s</em>
    </span>
  )
}

function EmailSpecimen({ source, highlight, readHighlights, scanning }: { source: string; highlight?: RegExp; readHighlights: RegExp[]; scanning: boolean }) {
  const lines = useMemo(() => {
    const all = source.replace(/\r\n/g, '\n').split('\n')
    // Long base64 attachment bodies are noise here — collapse them to one line.
    const out: string[] = []
    let blob = 0
    for (const line of all) {
      if (/^[A-Za-z0-9+/=]{60,}$/.test(line.trim())) {
        blob++
        if (blob === 1) out.push('⋯ encoded attachment data ⋯')
        continue
      }
      blob = 0
      out.push(line)
    }
    return out.slice(0, 140)
  }, [source])
  const box = useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()

  // Bring the lines the current stage is reading into view.
  useEffect(() => {
    const el = box.current
    const hot = el?.querySelector<HTMLElement>('.is-hot')
    if (!el || !hot) return
    el.scrollTo({ top: Math.max(0, hot.offsetTop - el.clientHeight * 0.3), behavior: reduced ? 'auto' : 'smooth' })
  }, [highlight, reduced])

  return (
    <div className="specimen">
      <div className="specimen-bar">
        <span>message/rfc822</span>
        <span>{lines.length} lines · read-only</span>
      </div>
      <div className="specimen-view">
        <div className="specimen-body" ref={box}>
          {lines.map((line, i) => {
            const hot = !!highlight && highlight.test(line)
            const read = !hot && readHighlights.some((r) => r.test(line))
            return (
              <div key={i} className={`specimen-line ${hot ? 'is-hot' : ''} ${read ? 'is-read' : ''}`}>
                <span className="ln">{i + 1}</span>
                <span className="lt">{line || ' '}</span>
              </div>
            )
          })}
        </div>
        {/* Outside the scroller, so the beam sweeps the visible window, not the document. */}
        {scanning && <div className="scanbeam rm-keep-loop" aria-hidden="true" />}
      </div>
    </div>
  )
}

function LinkSpecimen({ url, caption, scanning }: { url: string; caption?: string; scanning: boolean }) {
  let host = url
  let rest = ''
  try {
    const u = new URL(url)
    host = u.host
    rest = `${u.pathname}${u.search}`
  } catch {
    // not a parseable URL — show it as typed
  }
  return (
    <div className="specimen specimen-link">
      <div className="browser-bar">
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="browser-url">
          <b>{host}</b>
          {rest}
        </span>
        <span className="browser-tag">isolated</span>
      </div>
      <div className="browser-viewport">
        <div className="viewport-grid" aria-hidden="true" />
        <div className="viewport-host">
          <span className="eyebrow">Detonating in a sandbox</span>
          <strong>{host}</strong>
          <span>{caption ?? 'Routing through blocklist and cache…'}</span>
        </div>
        {scanning && <div className="scanbeam rm-keep-loop" aria-hidden="true" />}
      </div>
    </div>
  )
}
