'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePrefersReducedMotion } from '@/components/Instruments'
import type { Origin } from '@/lib/runs'
import { WORLD_COLS, WORLD_LAT_TOP, WORLD_ROWS, WORLD_STEP } from '@/lib/worldDots'
import { className as labelName, severityOf, toneOfLabel } from '@/lib/verdict'

const CELL = 8
const W = WORLD_COLS * CELL
const H = WORLD_ROWS.length * CELL
// Where the arcs land: the analyst's desk. SIH26106 is for Indian cyber
// cells, bank fraud units and SOCs, so the receiving end sits in India.
const HOME = { lat: 22.6, lon: 79.0, label: 'Analyst desk · IN' }

const project = (lat: number, lon: number) => ({
  x: ((lon + 180) / WORLD_STEP) * CELL,
  y: ((WORLD_LAT_TOP - lat) / WORLD_STEP) * CELL,
})

// Every land dot as one path — ~2.5k circles in a single DOM node instead of
// 2.5k elements, so the map costs one paint, not thousands.
function landPath(): string {
  const r = 1.55
  let d = ''
  WORLD_ROWS.forEach((hex, row) => {
    for (let h = 0; h < hex.length; h++) {
      const nibble = parseInt(hex[h], 16)
      for (let b = 0; b < 4; b++) {
        if (!(nibble & (8 >> b))) continue
        const x = (h * 4 + b + 0.5) * CELL
        const y = (row + 0.5) * CELL
        d += `M${x - r} ${y}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`
      }
    }
  })
  return d
}

type Cluster = { key: string; x: number; y: number; items: Origin[]; label: string }

const RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, Safe: 0, Unknown: 0 }

function cluster(origins: Origin[]): Cluster[] {
  const map = new Map<string, Cluster>()
  for (const o of origins) {
    const key = `${o.lat.toFixed(0)}:${o.lon.toFixed(0)}`
    const { x, y } = project(o.lat, o.lon)
    const c = map.get(key) ?? { key, x, y, items: [], label: o.label }
    c.items.push(o)
    if (RANK[severityOf(o.label)] > RANK[severityOf(c.label)]) c.label = o.label
    map.set(key, c)
  }
  return [...map.values()]
}

function arcPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dist = Math.hypot(to.x - from.x, to.y - from.y)
  return `M${from.x} ${from.y}Q${mx} ${my - dist * 0.32} ${to.x} ${to.y}`
}

export function WorldOriginMap({ origins, loading }: { origins: Origin[] | null; loading?: boolean }) {
  const router = useRouter()
  const reduced = usePrefersReducedMotion()
  const land = useMemo(landPath, [])
  const clusters = useMemo(() => cluster(origins ?? []), [origins])
  const home = project(HOME.lat, HOME.lon)
  const [hover, setHover] = useState<Cluster | null>(null)

  return (
    <div className="worldmap">
      <svg viewBox={`0 0 ${W} ${H}`} className="worldmap-svg" role="img" aria-label={mapSummary(clusters)}>
        <defs>
          <radialGradient id="wm-glow">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* graticule — every 30° */}
        <g className="wm-graticule">
          {[-150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150].map((lon) => {
            const x = project(0, lon).x
            return <line key={`lon${lon}`} x1={x} y1={0} x2={x} y2={H} />
          })}
          {[60, 30, 0, -30].map((lat) => {
            const y = project(lat, 0).y
            return <line key={`lat${lat}`} x1={0} y1={y} x2={W} y2={y} className={lat === 0 ? 'equator' : ''} />
          })}
        </g>
        <path className="wm-land" d={land} />

        {clusters.map((c, i) => {
          const d = arcPath(c, home)
          return (
            <g key={`arc-${c.key}`} className={`wm-arc tone-${toneOfLabel(c.label)}`} style={{ '--d': `${300 + i * 90}ms` } as React.CSSProperties}>
              <path d={d} pathLength={1} />
              {!reduced && (
                // opacity=0 until its first run: before `begin`, SMIL leaves the
                // packet parked at the SVG origin (top-left corner).
                <circle r="2.6" className="wm-packet" opacity="0">
                  <animateMotion dur={`${3.2 + (i % 4) * 0.45}s`} begin={`${1 + i * 0.35}s`} repeatCount="indefinite" path={d} />
                  <animate
                    attributeName="opacity"
                    values="0;1;1;0"
                    keyTimes="0;0.12;0.85;1"
                    dur={`${3.2 + (i % 4) * 0.45}s`}
                    begin={`${1 + i * 0.35}s`}
                    repeatCount="indefinite"
                  />
                </circle>
              )}
            </g>
          )
        })}

        <g className="wm-home" transform={`translate(${home.x} ${home.y})`}>
          <circle r="14" className="wm-home-ring" />
          <circle r="4.5" className="wm-home-dot" />
        </g>

        {clusters.map((c, i) => {
          const n = c.items.length
          const r = 4.2 + Math.min(5, n - 1) * 1.3
          return (
            <g
              key={c.key}
              className={`wm-origin tone-${toneOfLabel(c.label)}`}
              transform={`translate(${c.x} ${c.y})`}
              tabIndex={0}
              role="button"
              aria-label={`${n} case${n > 1 ? 's' : ''} from ${c.items[0].place || c.items[0].ip}, worst verdict ${labelName(c.label)}`}
              onMouseEnter={() => setHover(c)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(c)}
              onBlur={() => setHover(null)}
              onClick={() => router.push(`/run/${c.items[0].runId}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  router.push(`/run/${c.items[0].runId}`)
                }
              }}
              style={{ '--d': `${i * 90}ms` } as React.CSSProperties}
            >
              <circle r={r * 4} fill="url(#wm-glow)" className="wm-origin-glow" />
              <circle r={r} className="wm-origin-pulse" style={{ animationDelay: `${(i % 5) * 0.5}s` }} />
              <circle r={r} className="wm-origin-dot" />
              {n > 1 && (
                <text className="wm-origin-count" y={r + 13} textAnchor="middle">
                  ×{n}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      <div className="worldmap-beam" aria-hidden="true" />
      <span className="worldmap-home-label" style={{ left: `${(home.x / W) * 100}%`, top: `${(home.y / H) * 100}%` }}>
        {HOME.label}
      </span>

      {hover && (
        <div
          className={`worldmap-tip tone-${toneOfLabel(hover.label)}`}
          style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}
          role="tooltip"
        >
          <span className="tip-place">
            {hover.items[0].countryCode && <b>{hover.items[0].countryCode}</b>}
            {hover.items[0].place || 'Unknown location'}
          </span>
          {hover.items.slice(0, 3).map((o) => (
            <span key={o.runId} className="tip-case">
              <i />
              <span className="tip-subject">{o.subject}</span>
              <code>{o.ip}</code>
            </span>
          ))}
          {hover.items.length > 3 && <span className="tip-more">+{hover.items.length - 3} more</span>}
          {hover.items.some((o) => o.anonymized) && <span className="tip-flag">Anonymized relay (TOR / VPN)</span>}
        </div>
      )}

      {!loading && clusters.length === 0 && (
        <div className="worldmap-empty">
          <span>No geolocated origins yet.</span>
          <span>Investigate a raw .eml — its origin IP lands here.</span>
        </div>
      )}
    </div>
  )
}

function mapSummary(clusters: Cluster[]): string {
  if (clusters.length === 0) return 'World map of email origins — none recorded yet.'
  const places = clusters.map((c) => `${c.items[0].place || c.items[0].ip} (${c.items.length})`).join('; ')
  return `World map of email origins: ${places}.`
}
