'use client'

/**
 * Shared data hooks and formatting helpers for runs — used by the dashboard
 * views (app/page.tsx), the case page (app/run/[id]) and the shell's
 * backend-status pill.
 */
import { useEffect, useState } from 'react'
import { ApiError, apiGet } from '@/lib/api'
import type { Geolocation, HeaderAnalysis, RunDetail, RunSummary } from '@/lib/types'

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.'
}

export function relativeTime(seconds: number): string {
  const diff = Date.now() - seconds * 1000
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export function clockTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const RFC822_START = /^[\w-]+:/

// cp1252's 0x80–0x9F block, so UTF-8 text that was mis-decoded as cp1252
// ("â€”" for "—") can be turned back into its original bytes.
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

/** Repairs mojibake like "verify KYC â€” now" → "verify KYC — now"; returns the input unchanged otherwise. */
export function repairText(text: string): string {
  if (!/[ÂÃâ][\u0080-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(text)) return text
  const bytes: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code < 0x100) bytes.push(code)
    else if (CP1252[ch] !== undefined) bytes.push(CP1252[ch])
    else return text // a genuine non-Latin-1 character: this isn't mojibake
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    return text
  }
}

/** Raw .eml inputs start with headers; show their Subject instead of "Received: from …". */
export function subjectOf(summary: { case_type: string; raw_input: string }): string {
  if (summary.case_type !== 'email') return summary.raw_input
  const subject = summary.raw_input.match(/^Subject:[ \t]*(.+)$/im)
  if (subject && RFC822_START.test(summary.raw_input.trimStart())) return repairText(subject[1].trim())
  return repairText(summary.raw_input.split('\n')[0].slice(0, 140))
}

/** The sender ("From:") line of a raw email, if there is one. */
export function senderOf(summary: { case_type: string; raw_input: string }): string | null {
  if (summary.case_type !== 'email') return null
  const m = summary.raw_input.match(/^From:[ \t]*(.+)$/im)
  return m ? m[1].trim() : null
}

export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

export function useRuns(query: string, refreshMs?: number) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!refreshMs) return
    const id = setInterval(() => setTick((t) => t + 1), refreshMs)
    return () => clearInterval(id)
  }, [refreshMs])

  useEffect(() => {
    let alive = true
    // Background refreshes keep the current list on screen instead of
    // blanking it to a loading state every interval.
    if (tick === 0) {
      setRuns(null)
      setError(null)
    }
    apiGet<RunSummary[]>(query)
      .then((data) => {
        if (!alive) return
        setRuns(data)
        setError(null)
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err))
      })
    return () => {
      alive = false
    }
  }, [query, tick])

  return { runs, error, loading: runs === null && !error, tick }
}

export type BackendHealth = 'checking' | 'online' | 'offline'

/** Real reachability, polled — the shell's status pill used to be static text. */
export function useBackendHealth(intervalMs = 30000): BackendHealth {
  const [state, setState] = useState<BackendHealth>('checking')
  useEffect(() => {
    let alive = true
    const check = () =>
      apiGet<{ status: string }>('/health')
        .then(() => alive && setState('online'))
        .catch(() => alive && setState('offline'))
    check()
    const id = setInterval(check, intervalMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [intervalMs])
  return state
}

/** Where a case's email originated, for the dot-matrix origin map. */
export type Origin = {
  runId: string
  label: string
  subject: string
  ip: string
  lat: number
  lon: number
  place: string
  countryCode: string | null
  anonymized: boolean
}

// Run details are immutable once written, so cache them for the session —
// switching views back to Command shouldn't re-download every case.
const detailCache = new Map<string, Promise<RunDetail | null>>()

export function fetchRunDetail(id: string): Promise<RunDetail | null> {
  let hit = detailCache.get(id)
  if (!hit) {
    hit = apiGet<RunDetail>(`/runs/${id}`).catch(() => null)
    detailCache.set(id, hit)
  }
  return hit
}

function originOf(detail: RunDetail): Origin | null {
  const geo = detail.tool_calls.find((c) => c.tool === 'geolocate_ip')?.artifact as unknown as Geolocation | undefined
  const loc = geo?.location
  if (!geo?.available || loc?.lat == null || loc?.lon == null) return null
  const headers = detail.tool_calls.find((c) => c.tool === 'analyze_email_headers')?.artifact as unknown as HeaderAnalysis | undefined
  return {
    runId: detail.id,
    label: detail.verdict?.label ?? 'inconclusive',
    subject: headers?.subject ? repairText(headers.subject) : subjectOf(detail),
    ip: geo.ip,
    lat: loc.lat,
    lon: loc.lon,
    place: [loc.city, loc.country].filter(Boolean).join(', '),
    countryCode: loc.country_code ?? null,
    anonymized: !!geo.infrastructure?.anonymized,
  }
}

/** Geolocated origins for the given runs (fetched a few at a time). */
export function useOrigins(runs: RunSummary[] | null, max = 40): Origin[] | null {
  const [origins, setOrigins] = useState<Origin[] | null>(null)
  const key = runs ? runs.slice(0, max).map((r) => r.id).join(',') : ''

  useEffect(() => {
    if (!runs) return
    let alive = true
    const ids = runs.slice(0, max).map((r) => r.id)
    const found: Origin[] = []
    let next = 0
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++]
        const detail = await fetchRunDetail(id)
        const origin = detail && originOf(detail)
        if (origin) found.push(origin)
      }
    }
    Promise.all(Array.from({ length: 5 }, worker)).then(() => {
      if (alive) setOrigins([...found])
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return origins
}
