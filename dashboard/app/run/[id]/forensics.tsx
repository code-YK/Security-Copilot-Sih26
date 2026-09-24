'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
import type {
  AttachmentScan,
  AuthCheck,
  AuthValidation,
  CaseGraph as CaseGraphData,
  Geolocation,
  HeaderAnalysis,
  RunDetail,
} from '@/lib/types'

// Leaflet and the force graph both touch `window`, so they can't render on the server.
const OriginMap = dynamic(() => import('@/components/OriginMap'), { ssr: false })
const CaseGraph = dynamic(() => import('@/components/CaseGraph'), { ssr: false })

export function artifactOf<T>(detail: RunDetail, tool: string): T | undefined {
  return detail.tool_calls.find((c) => c.tool === tool)?.artifact as T | undefined
}

function resultClass(result?: string): string {
  if (result === 'pass') return 'safe'
  if (result === 'fail') return 'critical'
  if (result === 'softfail') return 'medium'
  return 'low'
}

function AuthBadge({ name, check }: { name: string; check?: AuthCheck }) {
  const result = check?.result ?? 'n/a'
  return (
    <span className={`badge ${resultClass(result)}`} title={`reported: ${check?.reported ?? '—'}, computed: ${check?.computed ?? '—'}`}>
      <span className="badge-dot" />
      {name}: {result}
    </span>
  )
}

export function EmailForensicsPanel({ detail }: { detail: RunDetail }) {
  const headers = artifactOf<HeaderAnalysis>(detail, 'analyze_email_headers')
  const auth = artifactOf<AuthValidation>(detail, 'validate_email_auth')
  const geo = artifactOf<Geolocation>(detail, 'geolocate_ip')
  const attachments = artifactOf<AttachmentScan>(detail, 'scan_attachments')
  if (!headers?.available) return null

  const loc = geo?.location
  const infra = geo?.infrastructure
  const place = [loc?.city, loc?.region, loc?.country].filter(Boolean).join(', ')

  return (
    <section className="panel animate-in animate-in-delay-1">
      <p className="eyebrow">Email forensics</p>
      <p>
        <strong>From:</strong> {headers.from ?? '—'} &nbsp; <strong>Return-Path:</strong> {headers.return_path ?? '—'}
        {headers.reply_to && (
          <>
            {' '}
            &nbsp; <strong>Reply-To:</strong> {headers.reply_to}
          </>
        )}
      </p>

      {auth?.available && (
        <div className="modal-meta" style={{ marginTop: 8 }}>
          <AuthBadge name="SPF" check={auth.spf} />
          <AuthBadge name="DKIM" check={auth.dkim} />
          <AuthBadge name="DMARC" check={auth.dmarc} />
          <span className="muted">
            SPF aligned: {String(auth.alignment?.spf_aligned ?? 'n/a')} · DKIM aligned: {String(auth.alignment?.dkim_aligned ?? 'n/a')}
            {auth.dmarc?.policy ? ` · DMARC policy: p=${auth.dmarc.policy}` : ''}
          </span>
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>Origin</h3>
      {headers.origin_ip ? (
        <>
          <p>
            <strong>{headers.origin_ip}</strong> {place && `— ${place}`} {loc?.isp && `· ${loc.isp}`} {loc?.asn && `(${loc.asn})`}
          </p>
          <div className="modal-meta">
            {infra?.is_tor && <span className="badge critical">TOR exit node</span>}
            {infra?.is_vpn && <span className="badge high">VPN range</span>}
            {infra?.is_hosting && <span className="badge medium">Hosting / datacenter</span>}
            {geo?.reputation?.available && (
              <span className="badge low">AbuseIPDB score {geo.reputation.abuse_confidence_score}%</span>
            )}
          </div>
          {loc?.lat != null && loc?.lon != null && (
            <div style={{ marginTop: 10 }}>
              <OriginMap lat={loc.lat} lon={loc.lon} label={`${headers.origin_ip} — ${place}`} />
            </div>
          )}
        </>
      ) : (
        <p className="muted">No public originating IP found in the headers.</p>
      )}

      <h3 style={{ marginTop: 16 }}>Trace path (oldest hop first)</h3>
      <ol>
        {(headers.received_chain ?? []).map((hop) => (
          <li key={hop.index}>
            {hop.from_host ?? '?'} {hop.ip && `[${hop.ip}]`} → {hop.by_host ?? '?'}{' '}
            <span className="muted">{hop.timestamp ?? 'no timestamp'}</span>{' '}
            {hop.flags.map((f) => (
              <span key={f} className={`badge ${f === 'origin' ? 'low' : 'medium'}`}>
                {f.replace(/_/g, ' ')}
              </span>
            ))}
          </li>
        ))}
      </ol>

      {(headers.flags?.length ?? 0) > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Header anomalies</h3>
          <ul>
            {headers.flags!.map((f) => (
              <li key={f.code}>
                <span className={`badge ${f.severity === 'high' ? 'critical' : f.severity}`}>{f.severity}</span> {f.detail}
              </li>
            ))}
          </ul>
        </>
      )}

      {(attachments?.count ?? 0) > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Attachments</h3>
          <ul>
            {attachments!.attachments!.map((a) => (
              <li key={a.sha256}>
                <strong>{a.filename}</strong> <span className="muted">({a.detected_mime ?? 'unknown type'}, {a.size} bytes, sha256 {a.sha256.slice(0, 16)}…)</span>
                {a.flags.map((f) => (
                  <div key={f.code}>
                    <span className="badge critical">{f.code.replace(/_/g, ' ')}</span> {f.detail}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

export function ConnectionsPanel({ runId }: { runId: string }) {
  const [graph, setGraph] = useState<CaseGraphData | null>(null)

  useEffect(() => {
    apiGet<CaseGraphData>(`/runs/${runId}/graph`).then(setGraph).catch(() => setGraph(null))
  }, [runId])

  if (!graph || graph.nodes.length === 0) return null
  return (
    <section className="panel animate-in animate-in-delay-2">
      <p className="eyebrow">Connections to past cases</p>
      <p className="muted">
        Domains, IPs and sender addresses in this case, plus everything they were seen with in other investigations.
      </p>
      <CaseGraph graph={graph} />
    </section>
  )
}
