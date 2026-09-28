'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import {
  Check,
  CircleSlash,
  FileCode2,
  FileText,
  FileWarning,
  Fingerprint,
  Link2,
  Minus,
  Paperclip,
  Rocket,
  X,
} from 'lucide-react'
import { ToneChip } from '@/components/Instruments'
import { apiGet } from '@/lib/api'
import type {
  AttachmentResult,
  AttachmentScan,
  AuthCheck,
  AuthValidation,
  CaseGraph as CaseGraphData,
  Geolocation,
  HeaderAnalysis,
  HeaderFlag,
  RunDetail,
  WhoisResult,
} from '@/lib/types'
import { toneOfLabel, type Tone } from '@/lib/verdict'

// Leaflet and the force graph both touch `window`, so they can't render on the server.
const OriginMap = dynamic(() => import('@/components/OriginMap'), { ssr: false, loading: () => <div className="map-skeleton" /> })
const CaseGraph = dynamic(() => import('@/components/CaseGraph'), { ssr: false, loading: () => <div className="graph-skeleton" /> })

export function artifactOf<T>(detail: RunDetail, tool: string): T | undefined {
  return detail.tool_calls.find((c) => c.tool === tool)?.artifact as T | undefined
}

export function flagTone(severity?: string): Tone {
  if (severity === 'critical') return 'critical'
  if (severity === 'high') return 'high'
  if (severity === 'medium') return 'medium'
  return 'low'
}

function Flag({ flag }: { flag: HeaderFlag }) {
  return (
    <li className={`flag tone-${flagTone(flag.severity)}`}>
      <span className="flag-sev">{flag.severity}</span>
      <span>{flag.detail}</span>
    </li>
  )
}

/* ─── 02 · Trace ─────────────────────────────────────────────────── */

/**
 * The Received chain drawn as a route, oldest hop first: the origin server
 * at the top, the recipient's mailbox at the bottom, and a packet that
 * travels the line — the "trace" in Detect → Trace → Attribute → Report.
 */
export function RouteTrace({ headers, geo }: { headers: HeaderAnalysis; geo?: Geolocation }) {
  const hops = headers.received_chain ?? []
  if (hops.length === 0) return <p className="muted">No Received headers — the delivery route can&apos;t be reconstructed.</p>
  const loc = geo?.location
  const place = [loc?.city, loc?.country].filter(Boolean).join(', ')

  return (
    <ol className="route" aria-label="Delivery route, oldest hop first">
      <span className="route-line" aria-hidden="true">
        <span className="route-packet rm-keep-loop" />
      </span>
      {hops.map((hop, i) => {
        const isOrigin = hop.flags.includes('origin')
        const odd = hop.flags.filter((f) => f !== 'origin')
        return (
          <li key={hop.index} className={`hop ${isOrigin ? 'is-origin' : ''} ${odd.length ? 'is-flagged' : ''}`} style={{ animationDelay: `${i * 90}ms` }}>
            <span className="hop-node" aria-hidden="true" />
            <div className="hop-body">
              <div className="hop-top">
                <span className="hop-index">{isOrigin ? 'hop 0 · origin' : `hop ${i}`}</span>
                {hop.timestamp && <time>{hop.timestamp}</time>}
              </div>
              <div className="hop-path">
                <code className="hop-host">{hop.from_host ?? 'unknown host'}</code>
                <span className="hop-arrow">→</span>
                <code className="hop-host">{hop.by_host ?? '?'}</code>
              </div>
              <div className="hop-meta">
                {hop.ip && (
                  <code className={`hop-ip ${hop.ip_is_public ? '' : 'is-private'}`}>
                    {hop.ip}
                    {!hop.ip_is_public && ' · private'}
                  </code>
                )}
                {isOrigin && place && <span className="hop-place">{place}</span>}
                {isOrigin && geo?.infrastructure?.is_tor && <ToneChip tone="critical">TOR exit</ToneChip>}
                {isOrigin && geo?.infrastructure?.is_vpn && <ToneChip tone="high">VPN</ToneChip>}
                {isOrigin && geo?.infrastructure?.is_hosting && <ToneChip tone="medium">Hosting</ToneChip>}
                {odd.map((f) => (
                  <ToneChip key={f} tone="medium">
                    {f.replace(/_/g, ' ')}
                  </ToneChip>
                ))}
              </div>
            </div>
          </li>
        )
      })}
      <li className="hop is-final">
        <span className="hop-node" aria-hidden="true" />
        <div className="hop-body">
          <div className="hop-top">
            <span className="hop-index">delivered</span>
          </div>
          <span className="muted">Recipient mailbox</span>
        </div>
      </li>
    </ol>
  )
}

export function OriginPanel({ headers, geo }: { headers: HeaderAnalysis; geo?: Geolocation }) {
  if (!headers.origin_ip) {
    return <p className="muted">No public originating IP in the headers — the trail ends inside a private network or a stripped relay.</p>
  }
  const loc = geo?.location
  const infra = geo?.infrastructure
  const place = [loc?.city, loc?.region, loc?.country].filter(Boolean).join(', ')
  const abuse = geo?.reputation?.available ? geo.reputation.abuse_confidence_score ?? 0 : null

  const tiles: { label: string; on: boolean | null | undefined; tone: Tone; note: string }[] = [
    { label: 'TOR exit node', on: infra?.is_tor, tone: 'critical', note: 'Tor Project exit list' },
    { label: 'VPN range', on: infra?.is_vpn, tone: 'high', note: 'X4BNet VPN ranges' },
    { label: 'Hosting / datacenter', on: infra?.is_hosting, tone: 'medium', note: 'Not a home or office line' },
  ]

  return (
    <div className="origin">
      <div className="origin-map">
        {loc?.lat != null && loc?.lon != null ? (
          <OriginMap lat={loc.lat} lon={loc.lon} label={`${headers.origin_ip} — ${place}`} />
        ) : (
          <div className="map-skeleton is-empty">Location unavailable{geo?.detail ? ` — ${geo.detail}` : ''}</div>
        )}
      </div>
      <div className="origin-facts">
        <dl className="facts">
          <div>
            <dt>Origin IP</dt>
            <dd>
              <code>{headers.origin_ip}</code>
            </dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{place || '—'}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>
              {loc?.isp || loc?.org || '—'}
              {loc?.asn && <code className="dd-sub">{loc.asn}</code>}
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd className="muted">{loc?.source === 'maxmind' ? 'MaxMind GeoLite2 (offline)' : loc?.source ?? '—'}</dd>
          </div>
        </dl>
        <div className="infra-tiles">
          {tiles.map((t) => (
            <div key={t.label} className={`infra-tile ${t.on ? `is-on tone-${t.tone}` : ''}`}>
              <span className="infra-state">{t.on ? <Check size={13} strokeWidth={3} /> : t.on === false ? <Minus size={13} /> : '?'}</span>
              <strong>{t.label}</strong>
              <span>{t.on ? 'Yes' : t.on === false ? 'No' : 'Unknown'} · {t.note}</span>
            </div>
          ))}
          <div className={`infra-tile ${abuse != null && abuse >= 25 ? `is-on tone-${abuse >= 75 ? 'critical' : 'medium'}` : ''}`}>
            <span className="infra-state tabular">{abuse ?? '—'}</span>
            <strong>AbuseIPDB confidence</strong>
            <span>{abuse == null ? 'No key configured or not reported' : `${abuse}% · ${geo?.reputation?.total_reports ?? 0} reports`}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── 03 · Authenticate ──────────────────────────────────────────── */

function sealTone(result?: string): Tone {
  if (result === 'pass') return 'safe'
  if (result === 'fail' || result === 'permerror') return 'critical'
  if (result === 'softfail' || result === 'temperror') return 'medium'
  return 'low'
}

function Seal({ name, what, check }: { name: string; what: string; check?: AuthCheck }) {
  const result = check?.result ?? 'none'
  const tone = sealTone(result)
  const Icon = result === 'pass' ? Check : result === 'fail' || result === 'permerror' ? X : result === 'none' ? CircleSlash : Minus
  return (
    <div className={`seal tone-${tone}`}>
      <div className="seal-ring" aria-hidden="true">
        <svg className="seal-svg" viewBox="0 0 100 100">
          <defs>
            <path id={`seal-${name}`} d="M50 50 m-37 0 a37 37 0 1 1 74 0 a37 37 0 1 1 -74 0" />
          </defs>
          <circle cx="50" cy="50" r="46" className="seal-outer" />
          <circle cx="50" cy="50" r="29" className="seal-inner" />
          {/* textLength = the ring's circumference (2π·37 ≈ 232), so the legend closes exactly on itself. */}
          <text className="seal-text">
            <textPath href={`#seal-${name}`} textLength="229" lengthAdjust="spacing">
              {`${name} · ${what} · `}
            </textPath>
          </text>
        </svg>
        <Icon className="seal-icon" size={26} strokeWidth={2.6} />
      </div>
      <strong className="seal-name">{name}</strong>
      <span className="seal-result">{result}</span>
      <span className="seal-meta">
        reported <code>{check?.reported ?? '—'}</code> · live <code>{check?.computed ?? '—'}</code>
      </span>
      {check?.policy && (
        <span className="seal-meta">
          policy <code>p={check.policy}</code>
        </span>
      )}
    </div>
  )
}

export function AuthPanel({ auth }: { auth: AuthValidation }) {
  const a = auth.alignment
  const mark = (v: boolean | null | undefined) => (v == null ? 'n/a' : v ? 'aligned' : 'not aligned')
  return (
    <>
      <div className="seals">
        <Seal name="SPF" what="sending server allowed?" check={auth.spf} />
        <Seal name="DKIM" what="signature intact?" check={auth.dkim} />
        <Seal name="DMARC" what="domain policy met?" check={auth.dmarc} />
      </div>
      <div className="alignment">
        <span className={a?.spf_aligned === false ? 'is-bad' : a?.spf_aligned ? 'is-good' : ''}>SPF {mark(a?.spf_aligned)}</span>
        <span className={a?.dkim_aligned === false ? 'is-bad' : a?.dkim_aligned ? 'is-good' : ''}>DKIM {mark(a?.dkim_aligned)}</span>
        {auth.from_domain && (
          <span>
            with <code>{auth.from_domain}</code>
          </span>
        )}
      </div>
    </>
  )
}

function domainOf(addr?: string | null): string | null {
  const m = addr?.match(/@([^>\s]+)/)
  return m ? m[1].toLowerCase() : null
}

export function IdentityPanel({ headers, whois }: { headers: HeaderAnalysis; whois?: WhoisResult }) {
  const fromDomain = headers.from_domain ?? domainOf(headers.from)
  const rows: { k: string; v?: string | null; bad?: boolean }[] = [
    { k: 'From', v: headers.from },
    { k: 'Return-Path', v: headers.return_path, bad: !!fromDomain && !!domainOf(headers.return_path) && domainOf(headers.return_path) !== fromDomain },
    { k: 'Reply-To', v: headers.reply_to, bad: !!fromDomain && !!domainOf(headers.reply_to) && domainOf(headers.reply_to) !== fromDomain },
    { k: 'Message-ID', v: headers.message_id },
  ]
  return (
    <div className="identity">
      <dl className="identity-table">
        {rows.map((r) => (
          <div key={r.k} className={r.bad ? 'is-bad' : ''}>
            <dt>{r.k}</dt>
            <dd>
              <code>{r.v || '—'}</code>
              {r.bad && <span className="mismatch">different domain</span>}
            </dd>
          </div>
        ))}
      </dl>
      {whois?.available && typeof whois.age_days === 'number' && (
        <div className={`domain-age ${whois.age_days < 30 ? 'tone-critical is-young' : whois.age_days < 180 ? 'tone-medium is-young' : ''}`}>
          <strong className="tabular">{whois.age_days}</strong>
          <span>
            days since <code>{fromDomain}</code> was registered
            {whois.age_days < 30 ? ' — brand-new domains are a classic phishing tell.' : '.'}
          </span>
        </div>
      )}
      {(headers.flags?.length ?? 0) > 0 && (
        <>
          <p className="eyebrow sub-gap">Header anomalies</p>
          <ul className="flags">
            {headers.flags!.map((f) => (
              <Flag key={f.code} flag={f} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/* ─── 04 · Payload ───────────────────────────────────────────────── */

const DISGUISE_CODES = ['double_extension', 'type_mismatch', 'content_type_mismatch']

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function AttachmentsPanel({ scan }: { scan: AttachmentScan }) {
  const list = scan.attachments ?? []
  if (list.length === 0) return <p className="muted">No attachments on this message.</p>
  return (
    <div className="attachments">
      {list.map((a) => (
        <AttachmentCard key={a.sha256} a={a} />
      ))}
    </div>
  )
}

function AttachmentCard({ a }: { a: AttachmentResult }) {
  const worst = a.flags.some((f) => f.severity === 'critical') ? 'critical' : a.flags.some((f) => f.severity === 'high') ? 'high' : a.flags.length ? 'medium' : 'safe'
  // Trust the scanner's own judgement (it knows which types are compatible, e.g. docx/zip).
  const mismatch = a.flags.some((f) => DISGUISE_CODES.includes(f.code))
  // What the name makes it look like: "invoice.pdf.exe" poses as a .pdf.
  const exts = a.filename.toLowerCase().split('.').slice(1)
  const posesAs = a.flags.some((f) => f.code === 'double_extension') && exts.length >= 2 ? exts[exts.length - 2] : a.claimed_extension
  const pdf = a.pdf

  return (
    <article className={`attachment tone-${worst}`}>
      <header className="attachment-head">
        <span className="file-glyph" aria-hidden="true">
          {pdf ? <FileText size={22} /> : a.flags.length ? <FileWarning size={22} /> : <Paperclip size={22} />}
          <em>.{a.claimed_extension ?? '?'}</em>
        </span>
        <div className="attachment-title">
          <strong>{a.filename}</strong>
          <span>
            {bytes(a.size)} · declared <code>{a.declared_type ?? '—'}</code>
          </span>
        </div>
        <ToneChip tone={worst as Tone}>{a.flags.length ? `${a.flags.length} finding${a.flags.length > 1 ? 's' : ''}` : 'Clean'}</ToneChip>
      </header>

      <div className="typecheck" aria-label="Claimed versus real file type">
        <div>
          <span>Poses as</span>
          <code>.{posesAs ?? '?'}</code>
        </div>
        <span className={`typecheck-arrow ${mismatch ? 'is-bad' : ''}`}>{mismatch ? '≠' : '='}</span>
        <div>
          <span>Magic bytes say</span>
          <code>{a.detected_extension ? `.${a.detected_extension}` : 'unknown'}</code>
        </div>
        <div className="typecheck-extra">
          <span>Macros</span>
          <code>{a.macros ? (a.macros.has_macros ? (a.macros.autoexec ? 'yes · auto-run' : 'yes') : 'none') : 'n/a'}</code>
        </div>
        <div className="typecheck-extra">
          <span>ClamAV</span>
          <code>{a.clamav?.available ? (a.clamav.infected ? a.clamav.signature : 'clean') : 'not running'}</code>
        </div>
      </div>

      {a.flags.length > 0 && (
        <ul className="flags">
          {a.flags.map((f, i) => (
            <Flag key={`${f.code}-${i}`} flag={f} />
          ))}
        </ul>
      )}

      {pdf?.available && (
        <div className="pdf-sandbox">
          <p className="eyebrow">
            <FileCode2 size={13} /> PDF sandbox · parsed, never opened
          </p>
          <div className="pdf-vectors">
            {[
              { on: pdf.has_javascript, label: 'Embedded JavaScript', note: 'Runs on open in many readers', icon: FileCode2 },
              { on: pdf.has_launch_action, label: '/Launch action', note: 'Can start an external program', icon: Rocket },
              { on: pdf.has_embedded_files, label: 'Embedded files', note: 'Hidden payload inside the PDF', icon: Paperclip },
            ].map((v) => (
              <div key={v.label} className={`pdf-vector ${v.on ? 'is-on' : ''}`}>
                <v.icon size={16} aria-hidden="true" />
                <strong>{v.label}</strong>
                <span>{v.on ? 'Present' : 'Not found'} · {v.note}</span>
              </div>
            ))}
          </div>
          <dl className="facts facts-inline">
            <div>
              <dt>Pages</dt>
              <dd className="tabular">{pdf.page_count ?? '—'}</dd>
            </div>
            <div>
              <dt>Links inside</dt>
              <dd className="tabular">{pdf.links?.length ?? 0}</dd>
            </div>
            {typeof pdf.text_classification?.phishing_score === 'number' && (
              <div>
                <dt>Text reads as phishing</dt>
                <dd className="tabular">{Math.round(pdf.text_classification.phishing_score * 100)}%</dd>
              </div>
            )}
          </dl>
          {(pdf.link_verdicts?.length ?? 0) > 0 ? (
            <ul className="pdf-links">
              {pdf.link_verdicts!.map((l) => (
                <li key={l.url}>
                  <Link2 size={14} aria-hidden="true" />
                  <code>{l.url}</code>
                  <ToneChip tone={toneOfLabel(l.label === 'dangerous' ? 'phishing' : l.label === 'safe' ? 'legitimate' : l.label === 'suspicious' ? 'suspicious' : 'inconclusive')}>
                    {l.label} · {Math.round(l.confidence * 100)}%
                  </ToneChip>
                </li>
              ))}
            </ul>
          ) : (
            (pdf.links?.length ?? 0) > 0 && (
              <ul className="pdf-links">
                {pdf.links!.map((l) => (
                  <li key={l}>
                    <Link2 size={14} aria-hidden="true" />
                    <code>{l}</code>
                  </li>
                ))}
              </ul>
            )
          )}
          {pdf.text_excerpt && (
            <details className="excerpt">
              <summary>Extracted text{pdf.text_truncated ? ' (excerpt)' : ''}</summary>
              <pre>{pdf.text_excerpt}</pre>
            </details>
          )}
        </div>
      )}

      <div className="hashes">
        <Fingerprint size={14} aria-hidden="true" />
        <code title={a.sha256}>sha256 {a.sha256}</code>
        {a.md5 && <code title={a.md5}>md5 {a.md5}</code>}
      </div>
    </article>
  )
}

/* ─── 05 · Attribute ─────────────────────────────────────────────── */

export function ConnectionsPanel({ runId }: { runId: string }) {
  const [graph, setGraph] = useState<CaseGraphData | null | undefined>(undefined)

  useEffect(() => {
    apiGet<CaseGraphData>(`/runs/${runId}/graph`)
      .then(setGraph)
      .catch(() => setGraph(null))
  }, [runId])

  if (graph === undefined) return <div className="graph-skeleton" />
  if (!graph || graph.nodes.length === 0) return <p className="muted">No shared domains, IPs or senders with past cases yet.</p>
  const other = graph.nodes.filter((n) => !n.in_case).length
  return (
    <div className="connections">
      <div className="connections-legend">
        <span className="lg-domain">Domain</span>
        <span className="lg-ip">IP</span>
        <span className="lg-sender">Sender</span>
        <span className="lg-bad">Seen in a malicious case</span>
      </div>
      <CaseGraph graph={graph} />
      <p className="muted small">
        {graph.nodes.length} entities · {other} of them appear in other investigations. Drag to explore; hover a node for its history.
      </p>
    </div>
  )
}
