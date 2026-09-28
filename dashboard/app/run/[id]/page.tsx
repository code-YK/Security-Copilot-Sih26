'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Copy,
  Download,
  FileWarning,
  Fingerprint,
  History,
  Link2,
  Loader2,
  Mail,
  Network,
  ShieldCheck,
} from 'lucide-react'
import { Shell } from '@/components/Shell'
import { ClassSpectrum, LabelChip, RiskDial, ToneChip, VerdictStamp } from '@/components/Instruments'
import { ReasonText } from '@/components/ReasonText'
import { apiGet, apiPost, getApiBaseUrl } from '@/lib/api'
import { generateRunReportPdf } from '@/lib/pdfReport'
import { clockTime, errorMessage, relativeTime, repairText, shortId, subjectOf } from '@/lib/runs'
import type { AttachmentScan, AuthValidation, Geolocation, HeaderAnalysis, ReportResponse, RunDetail, WhoisResult } from '@/lib/types'
import { ATTRIBUTION_TEXT, VERDICT_CLASSES, classOf, riskOf, toneOfLabel } from '@/lib/verdict'
import { AttachmentsPanel, AuthPanel, ConnectionsPanel, IdentityPanel, OriginPanel, RouteTrace, artifactOf } from './forensics'

// inspect_website's navigation_error is a raw Playwright exception string —
// translate the common cases into plain language for a report reader.
function friendlyNavError(raw?: string): string {
  if (!raw) return 'the sandbox could not load the page.'
  const text = raw.toLowerCase()
  if (text.includes('timeout')) return 'the page took too long to load and timed out.'
  if (text.includes('name_not_resolved')) return "the domain doesn't resolve — it may not actually exist."
  if (text.includes('connection_refused') || text.includes('connection refused')) return 'the server refused the connection.'
  if (text.includes('cert') || text.includes('ssl')) return "the site's security certificate could not be verified."
  return 'the page failed to load.'
}

function isDeadPage(finalUrl?: string): boolean {
  return !!finalUrl?.startsWith('chrome-error://')
}

function screenshotUrl(path: string): string {
  return `${getApiBaseUrl()}/screenshots/${path.split(/[/\\]/).pop()}`
}

export default function RunPage() {
  const params = useParams<{ id: string }>()
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setDetail(null)
    setError(null)
    apiGet<RunDetail>(`/runs/${params.id}`)
      .then((d) => alive && setDetail(d))
      .catch((err) => alive && setError(errorMessage(err)))
    return () => {
      alive = false
    }
  }, [params.id])

  return (
    <Shell view="cases">
      {error ? (
        <div className="page">
          <div className="empty-state" role="alert">
            <AlertTriangle size={28} />
            <h1>This case file couldn&apos;t be opened</h1>
            <p>{error}</p>
            <Link className="btn btn-ghost" href="/?view=cases">
              Back to case files
            </Link>
          </div>
        </div>
      ) : !detail ? (
        <div className="page">
          <div className="empty-state">
            <Loader2 className="spin" size={26} />
            <p>Opening case file…</p>
          </div>
        </div>
      ) : (
        <Dossier detail={detail} />
      )}
    </Shell>
  )
}

type Chapter = { id: string; n: string; title: string; kicker: string }

function Dossier({ detail }: { detail: RunDetail }) {
  const v = detail.verdict ?? {}
  const tone = toneOfLabel(v.label)
  const risk = riskOf(v)
  const headers = artifactOf<HeaderAnalysis>(detail, 'analyze_email_headers')
  const auth = artifactOf<AuthValidation>(detail, 'validate_email_auth')
  const geo = artifactOf<Geolocation>(detail, 'geolocate_ip')
  const attachments = artifactOf<AttachmentScan>(detail, 'scan_attachments')
  const senderRep = detail.tool_calls.find((c) => c.tool === 'domain_reputation' && headers?.from_domain && c.artifact.domain === headers.from_domain)
  const inspectCalls = detail.tool_calls.filter((c) => c.tool === 'inspect_website')
  const vtCalls = detail.tool_calls.filter((c) => c.tool === 'domain_reputation' && c.artifact.virustotal?.available)
  const recallCalls = detail.tool_calls.filter((c) => c.tool === 'recall_similar_cases' && (c.artifact.matches?.length ?? 0) > 0)
  const isEmail = detail.case_type === 'email'
  const hasHeaders = !!headers?.available
  const title = hasHeaders ? repairText(headers!.subject || '(no subject)') : subjectOf(detail)
  const cls = classOf(v.label)
  const classIndex = cls ? VERDICT_CLASSES.indexOf(cls) + 1 : null

  const chapters: Chapter[] = [
    { id: 'detect', n: '01', title: 'Detect', kicker: 'The verdict, and why' },
    ...(hasHeaders || geo?.available ? [{ id: 'trace', n: '02', title: 'Trace', kicker: 'Where it really came from' }] : []),
    ...(hasHeaders ? [{ id: 'authenticate', n: '03', title: 'Authenticate', kicker: 'Is the sender who they claim?' }] : []),
    ...((attachments?.count ?? 0) > 0 || inspectCalls.length > 0 || vtCalls.length > 0
      ? [{ id: 'payload', n: '04', title: isEmail ? 'Payload' : 'Detonate', kicker: isEmail ? 'What it carries, opened safely' : 'What the sandbox saw' }]
      : []),
    { id: 'attribute', n: '05', title: 'Attribute', kicker: "Who's behind it, what it connects to" },
    { id: 'report', n: '06', title: 'Report', kicker: 'Evidence, out the door' },
  ]
  const active = useScrollSpy(chapters.map((c) => c.id))

  return (
    <div className="page dossier">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/?view=cases">Case files</Link>
        <span aria-hidden="true">/</span>
        <code>{shortId(detail.id)}</code>
      </nav>

      <header className={`dossier-head tone-${tone}`}>
        <div className="dossier-title">
          <p className="eyebrow">
            <span className="eyebrow-index">{isEmail ? 'Email' : 'Link'}</span>
            Case file · opened {relativeTime(detail.created_at)} · {clockTime(detail.created_at)}
          </p>
          <h1>{title}</h1>
          {hasHeaders && headers!.from && (
            <p className="dossier-from">
              <Mail size={15} aria-hidden="true" />
              <code>{headers!.from}</code>
            </p>
          )}
          {!isEmail && (
            <p className="dossier-from">
              <Link2 size={15} aria-hidden="true" />
              <code>{detail.raw_input}</code>
            </p>
          )}
          <div className="dossier-tags">
            <LabelChip label={v.label} />
            {detail.campaign_id && (
              <ToneChip tone="uv">
                <Network size={13} /> Campaign {detail.campaign_id}
              </ToneChip>
            )}
            {v.attribution && v.attribution !== 'unknown' && <ToneChip tone="unknown">{ATTRIBUTION_TEXT[v.attribution] ?? v.attribution}</ToneChip>}
          </div>
          <div className="dossier-actions">
            <DownloadReportButton detail={detail} />
            {detail.case_type === 'link' && <ReportBlockButton url={detail.raw_input} />}
            {isEmail && <ViewInGmailButton runId={detail.id} />}
          </div>
        </div>
        <div className="dossier-verdict">
          <VerdictStamp label={v.label} sub={classIndex ? `Class ${classIndex} of 5` : 'Unclassified'} />
          <RiskDial risk={risk} tone={tone} size={178} />
        </div>
      </header>

      <section className="panel panel-spectrum is-compact" aria-label="Where this case sits among the five classes">
        <ClassSpectrum current={v.label} />
      </section>

      <div className="dossier-body">
        <nav className="chapter-nav" aria-label="Case chapters">
          {chapters.map((c) => (
            <a key={c.id} href={`#${c.id}`} className={active === c.id ? 'is-active' : ''}>
              <span>{c.n}</span>
              {c.title}
            </a>
          ))}
        </nav>

        <div className="chapters">
          <ChapterSection chapter={chapters.find((c) => c.id === 'detect')!}>
            <div className="detect">
              <div className="detect-read">
                <p className="eyebrow">The copilot&apos;s read</p>
                <ReasonText text={v.reason || 'No reasoning was recorded for this run.'} voice />
              </div>
              {(v.risk_factors?.length ?? 0) > 0 && (
                <div className="detect-factors">
                  <p className="eyebrow">Red flags · each one moved the risk score</p>
                  <ol className="factor-list is-numbered">
                    {v.risk_factors!.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ol>
                </div>
              )}
              {v.mitigation && (
                <div className="advice">
                  <span className="eyebrow">
                    <ShieldCheck size={13} /> What to do
                  </span>
                  <ReasonText text={v.mitigation} />
                </div>
              )}
              {(v.legitimate_alternatives?.length ?? 0) > 0 && (
                <div className="alternatives">
                  <p className="eyebrow">The real site, probably</p>
                  {v.legitimate_alternatives!.map((alt) => (
                    <a key={alt.url} href={alt.url} target="_blank" rel="noreferrer">
                      <Link2 size={14} />
                      {alt.title}
                      <ArrowUpRight size={14} />
                    </a>
                  ))}
                </div>
              )}
              {detail.tool_calls.length === 0 && (
                <p className="muted">
                  Served from the router&apos;s fast path — a blocklist match or a cached result for this exact target — so no fresh tool
                  calls ran for this entry.
                </p>
              )}
            </div>
          </ChapterSection>

          {chapters.some((c) => c.id === 'trace') && (
            <ChapterSection chapter={chapters.find((c) => c.id === 'trace')!}>
              {hasHeaders && (
                <div className="subsection">
                  <h3>Delivery route</h3>
                  <p className="muted">Received headers, oldest first — each server stamps the message as it passes.</p>
                  <RouteTrace headers={headers!} geo={geo} />
                </div>
              )}
              <div className="subsection">
                <h3>Origin</h3>
                {hasHeaders ? (
                  <OriginPanel headers={headers!} geo={geo} />
                ) : (
                  geo && <OriginPanel headers={{ available: true, origin_ip: geo.ip }} geo={geo} />
                )}
              </div>
            </ChapterSection>
          )}

          {hasHeaders && (
            <ChapterSection chapter={chapters.find((c) => c.id === 'authenticate')!}>
              {auth?.available ? (
                <div className="subsection">
                  <h3>Sender authentication</h3>
                  <AuthPanel auth={auth} />
                </div>
              ) : (
                <p className="muted">Sender authentication wasn&apos;t checked for this message.</p>
              )}
              <div className="subsection">
                <h3>Claimed identity</h3>
                <IdentityPanel headers={headers!} whois={senderRep?.artifact.whois as WhoisResult | undefined} />
              </div>
            </ChapterSection>
          )}

          {chapters.some((c) => c.id === 'payload') && (
            <ChapterSection chapter={chapters.find((c) => c.id === 'payload')!}>
              {(attachments?.count ?? 0) > 0 && (
                <div className="subsection">
                  <h3>Attachments</h3>
                  <AttachmentsPanel scan={attachments!} />
                </div>
              )}
              {inspectCalls.map((call, i) => (
                <div className="subsection" key={i}>
                  <h3>{inspectCalls.length > 1 ? `Sandbox visit ${i + 1} of ${inspectCalls.length}` : 'Sandbox visit'}</h3>
                  <PageInspection call={call} />
                </div>
              ))}
              {vtCalls.map((call, i) => (
                <div className="subsection" key={`vt-${i}`}>
                  <h3>
                    Reputation{typeof call.artifact.domain === 'string' ? <> · <code>{call.artifact.domain}</code></> : null}
                  </h3>
                  <VirusTotalPanel call={call} />
                </div>
              ))}
            </ChapterSection>
          )}

          <ChapterSection chapter={chapters.find((c) => c.id === 'attribute')!}>
            <div className="attribution-grid">
              <div className="attribution-card">
                <p className="eyebrow">Likely actor</p>
                <strong>{v.attribution ? ATTRIBUTION_TEXT[v.attribution] ?? v.attribution : 'Unknown'}</strong>
                <p>{v.attribution_reason || 'Not enough evidence to attribute this case to an actor type.'}</p>
              </div>
              <div className={`attribution-card ${detail.campaign_id ? 'tone-uv is-lit' : ''}`}>
                <p className="eyebrow">Campaign</p>
                <strong>{detail.campaign_id ? <code>{detail.campaign_id}</code> : 'Not clustered'}</strong>
                <p>
                  {detail.campaign_id
                    ? 'This case clusters with other malicious investigations that read alike — likely the same operation.'
                    : 'No similar malicious case yet. Campaigns form once two or more investigations cluster together.'}
                </p>
                {detail.campaign_id && (
                  <Link className="btn btn-quiet" href="/?view=campaigns">
                    See the campaign <ArrowUpRight size={14} />
                  </Link>
                )}
              </div>
            </div>
            <div className="subsection">
              <h3>Connections to past cases</h3>
              <ConnectionsPanel runId={detail.id} />
            </div>
            {recallCalls.map((call, i) => (
              <div className="subsection" key={`sim-${i}`}>
                <h3>
                  <History size={16} /> Similar past investigations
                </h3>
                <SimilarCases call={call} />
              </div>
            ))}
          </ChapterSection>

          <ChapterSection chapter={chapters.find((c) => c.id === 'report')!}>
            <ReportChapter detail={detail} />
          </ChapterSection>
        </div>
      </div>
    </div>
  )
}

function ChapterSection({ chapter, children }: { chapter: Chapter; children: React.ReactNode }) {
  return (
    <section id={chapter.id} className="chapter" aria-labelledby={`${chapter.id}-title`}>
      <header className="chapter-head">
        <span className="chapter-n">{chapter.n}</span>
        <div>
          <h2 id={`${chapter.id}-title`}>{chapter.title}</h2>
          <p>{chapter.kicker}</p>
        </div>
      </header>
      <div className="chapter-body">{children}</div>
    </section>
  )
}

function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0])
  const key = ids.join(',')
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-20% 0px -65% 0px' },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return active
}

/* ─── Report chapter ─────────────────────────────────────────────── */

const TOOL_NAME: Record<string, string> = {
  analyze_email_headers: 'Header analysis',
  validate_email_auth: 'SPF / DKIM / DMARC',
  geolocate_ip: 'IP geolocation',
  scan_attachments: 'Attachment sandbox',
  domain_reputation: 'Domain reputation',
  inspect_website: 'Sandboxed browser',
  content_classifier: 'Content model',
  web_search: 'Web search',
  recall_similar_cases: 'Case memory',
  correlate_entity: 'Entity correlation',
}

function ReportChapter({ detail }: { detail: RunDetail }) {
  const [hash, setHash] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // A fingerprint of the stored evidence, computed in the browser — anyone
  // holding the same case export can recompute it and compare.
  useEffect(() => {
    if (!crypto?.subtle) return
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(detail.raw_input)).then((buf) => {
      setHash(Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''))
    })
  }, [detail.raw_input])

  const steps = useMemo(() => detail.tool_calls.map((c) => ({ tool: c.tool, arg: typeof c.args.url === 'string' ? c.args.url : typeof c.args.domain === 'string' ? c.args.domain : typeof c.args.ip === 'string' ? c.args.ip : '' })), [detail.tool_calls])

  return (
    <div className="report">
      <div className="report-actions">
        <DownloadReportButton detail={detail} large />
        {detail.case_type === 'link' && <ReportBlockButton url={detail.raw_input} />}
        {detail.case_type === 'email' && <ViewInGmailButton runId={detail.id} />}
      </div>
      <p className="muted">
        The PDF carries the verdict, confidence, SPF/DKIM/DMARC, the origin and its VPN/TOR/hosting flags, attribution, the campaign
        and the full delivery path. Email bodies are stored with PII masked (Microsoft Presidio); headers are kept intact as evidence.
      </p>

      <div className="fingerprint">
        <Fingerprint size={18} aria-hidden="true" />
        <div>
          <span className="eyebrow">Evidence fingerprint · SHA-256 of the stored case input</span>
          <code>{hash ?? 'computing…'}</code>
        </div>
        {hash && (
          <button
            className="icon-btn"
            aria-label="Copy fingerprint"
            onClick={() => {
              navigator.clipboard?.writeText(hash).then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 1600)
              })
            }}
          >
            {copied ? <ShieldCheck size={16} /> : <Copy size={16} />}
          </button>
        )}
      </div>

      {steps.length > 0 && (
        <>
          <p className="eyebrow sub-gap">Investigation log · {steps.length} steps</p>
          <ol className="toollog">
            {steps.map((s, i) => (
              <li key={i}>
                <span className="toollog-n tabular">{String(i + 1).padStart(2, '0')}</span>
                <strong>{TOOL_NAME[s.tool] ?? s.tool}</strong>
                {s.arg && <code>{s.arg}</code>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}

function DownloadReportButton({ detail, large = false }: { detail: RunDetail; large?: boolean }) {
  const [busy, setBusy] = useState(false)
  async function handleClick() {
    setBusy(true)
    try {
      await generateRunReportPdf(detail)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className={`btn btn-primary ${large ? 'btn-lg' : ''}`} onClick={handleClick} disabled={busy}>
      {busy ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
      {busy ? 'Preparing PDF…' : 'Download forensic PDF'}
    </button>
  )
}

// Reports outward instead of attacking back (backend/reporting.py): adds the
// domain to this tool's blocklist — the router refuses it from then on — and
// submits it to VirusTotal. Two independent, best-effort actions.
function ReportBlockButton({ url }: { url: string }) {
  const [state, setState] = useState<
    { status: 'idle' } | { status: 'loading' } | { status: 'done'; result: ReportResponse } | { status: 'error'; message: string }
  >({ status: 'idle' })

  async function handleClick() {
    setState({ status: 'loading' })
    try {
      const result = await apiPost<ReportResponse>('/report', { url })
      setState({ status: 'done', result })
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) })
    }
  }

  if (state.status === 'done') {
    const { result } = state
    return (
      <span className="done-note" role="status">
        <Ban size={15} />
        {result.added_to_blocklist ? 'Blocked' : 'Already blocked'}
        {result.virustotal.reported ? ' and reported to VirusTotal.' : ` — VirusTotal: ${result.virustotal.detail}`}
      </span>
    )
  }

  return (
    <button className="btn btn-danger" onClick={handleClick} disabled={state.status === 'loading'}>
      {state.status === 'loading' ? <Loader2 size={16} className="spin" /> : <Ban size={16} />}
      {state.status === 'loading' ? 'Reporting…' : 'Report & block'}
      {state.status === 'error' && <span className="btn-error"> — {state.message}</span>}
    </button>
  )
}

// Only renders when this case came from the Gmail add-on's "Check Report"
// button (backend/api/routes_gmail_reports.py records that association).
function ViewInGmailButton({ runId }: { runId: string }) {
  const [messageId, setMessageId] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    apiGet<{ message_id: string }>(`/gmail-reports/by-run/${runId}`)
      .then((r) => alive && setMessageId(r.message_id))
      .catch(() => {
        // No association — expected for most cases.
      })
    return () => {
      alive = false
    }
  }, [runId])
  if (!messageId) return null
  return (
    <a className="btn btn-ghost" href={`https://mail.google.com/mail/u/0/#all/${messageId}`} target="_blank" rel="noreferrer">
      <Mail size={16} /> View in Gmail
    </a>
  )
}

/* ─── Link evidence ──────────────────────────────────────────────── */

function PageInspection({ call }: { call: RunDetail['tool_calls'][number] }) {
  const a = call.artifact
  const crossOrigin = (a.links ?? []).filter((l) => !l.same_origin).length
  const passwordForms = (a.forms ?? []).filter((f) => f.has_password_field)
  const visited = typeof call.args.url === 'string' ? call.args.url : a.final_url
  // A domain that doesn't resolve lands headless Chrome on its own error page
  // (chrome-error://chromewebdata/) — and the "screenshot" is of that page.
  const dead = isDeadPage(a.final_url)
  const hops = a.redirect_chain ?? []

  return (
    <div className="inspection">
      <div className="browser-frame">
        <div className="browser-bar">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="browser-url">{dead ? visited : a.final_url || visited}</span>
          {typeof a.status_code === 'number' && <span className="browser-tag">HTTP {a.status_code}</span>}
          {dead && <span className="browser-tag is-dead">no answer</span>}
        </div>
        {call.screenshot_path && !dead ? (
          <img className="browser-shot" src={screenshotUrl(call.screenshot_path)} alt="Sandbox screenshot of the scanned page" loading="lazy" />
        ) : (
          <div className="browser-empty">
            <FileWarning size={20} />
            <span>
              No screenshot —{' '}
              {dead
                ? "the domain didn't answer. It doesn't resolve or refused the connection — typical of phishing hosts that are already taken down, or not live yet."
                : friendlyNavError(a.navigation_error || a.error)}
            </span>
          </div>
        )}
      </div>

      {hops.length > 1 && (
        <ol className="redirects" aria-label="Redirect chain">
          {hops.map((hop, i) => (
            <li key={i}>
              <code>{hop.url}</code>
              {typeof hop.status === 'number' && <span className="redirect-status">{hop.status}</span>}
            </li>
          ))}
        </ol>
      )}

      <dl className="facts facts-grid">
        {a.forms && (
          <div className={passwordForms.length ? 'is-bad' : ''}>
            <dt>Forms</dt>
            <dd>
              {a.forms.length === 0
                ? 'None on the page'
                : `${a.forms.length} found${passwordForms.length ? ` · ${passwordForms.length} ask for a password → ${passwordForms.map((f) => f.action || 'this page').join(', ')}` : ' · none ask for a password'}`}
            </dd>
          </div>
        )}
        {a.links && (
          <div>
            <dt>Outbound links</dt>
            <dd>
              {a.links.length}
              {crossOrigin > 0 ? ` · ${crossOrigin} to other domains` : ''}
            </dd>
          </div>
        )}
        {a.network_requests && (
          <div>
            <dt>Network requests</dt>
            <dd className="tabular">{a.network_requests.length}</dd>
          </div>
        )}
        {a.server_ip && (
          <div>
            <dt>Served from</dt>
            <dd>
              <code>{a.server_ip}</code>
            </dd>
          </div>
        )}
        {a.asset_dominant_foreign_origin && (
          <div className="is-bad span-2">
            <dt>Borrowed assets</dt>
            <dd>
              {a.asset_dominant_foreign_origin.asset_count} images/scripts/styles load straight from{' '}
              <code>{a.asset_dominant_foreign_origin.domain}</code> — a copied page reusing the real site&apos;s assets.
            </dd>
          </div>
        )}
      </dl>

      {a.page_text && (
        <details className="excerpt">
          <summary>Visible page text (excerpt)</summary>
          <pre>{a.page_text.slice(0, 900)}</pre>
        </details>
      )}
    </div>
  )
}

function VirusTotalPanel({ call }: { call: RunDetail['tool_calls'][number] }) {
  const vt = call.artifact.virustotal!
  const whois = call.artifact.whois
  const malicious = vt.malicious_count ?? 0
  const suspicious = vt.suspicious_count ?? 0
  const harmless = vt.harmless_count ?? 0
  const total = malicious + suspicious + harmless

  return (
    <div className="vt">
      <div className="vt-head">
        {total > 0 ? (
          <div className="vt-score">
            <strong className="tabular">{malicious + suspicious}</strong>
            <span>/ {total} vendors flag it</span>
          </div>
        ) : (
          <p className="vt-none">
            VirusTotal has no vendor verdicts on this domain yet — usual for a freshly registered phishing domain, so absence here is
            not a clean bill of health.
          </p>
        )}
        {whois?.available && typeof whois.age_days === 'number' && (
          <div className={`vt-age ${whois.age_days < 30 ? 'tone-critical' : ''}`}>
            <strong className="tabular">{whois.age_days}</strong>
            <span>days old</span>
          </div>
        )}
      </div>
      {total > 0 && (
        <div className="vt-bar" role="img" aria-label={`${malicious} malicious, ${suspicious} suspicious, ${harmless} harmless`}>
          {malicious > 0 && <span className="vt-mal" style={{ flexGrow: malicious }} />}
          {suspicious > 0 && <span className="vt-sus" style={{ flexGrow: suspicious }} />}
          {harmless > 0 && <span className="vt-ok" style={{ flexGrow: harmless }} />}
        </div>
      )}
      {total > 0 && <div className="vt-counts">
        <span className="vt-mal-t">{malicious} malicious</span>
        <span className="vt-sus-t">{suspicious} suspicious</span>
        <span className="vt-ok-t">{harmless} harmless</span>
        {typeof vt.community_reputation === 'number' && <span>community {vt.community_reputation}</span>}
      </div>}
      {vt.flagged_by && vt.flagged_by.length > 0 && (
        <ul className="vendors">
          {vt.flagged_by.map((f) => (
            <li key={f.vendor}>
              <strong>{f.vendor}</strong>
              <span>{f.result || f.category || 'flagged'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SimilarCases({ call }: { call: RunDetail['tool_calls'][number] }) {
  const router = useRouter()
  const matches = call.artifact.matches ?? []
  return (
    <ul className="similar">
      {matches.map((m) => (
        <li key={m.run_id}>
          <button onClick={() => router.push(`/run/${m.run_id}`)}>
            <span className="similar-pct tabular">{Math.round(m.similarity * 100)}%</span>
            <span className="similar-main">
              <strong>{subjectOf(m)}</strong>
              <span>{m.reason.slice(0, 180)}</span>
            </span>
            <LabelChip label={m.label} />
          </button>
        </li>
      ))}
    </ul>
  )
}
