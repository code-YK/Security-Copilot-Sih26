'use client'

import { useEffect, useRef, useState } from 'react'
import { CLASS_NAME, VERDICT_CLASSES, classOf, className as labelName, toneOfLabel, type Tone } from '@/lib/verdict'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/**
 * A number that counts up to its value. Job: delight at a moment the user is
 * already reading the figure — short (≤900ms), eased out, and skipped
 * entirely under reduced motion. The final value is what's rendered for
 * assistive tech from the first frame (aria-label), never the tween.
 */
export function CountUp({ value, duration = 900, suffix = '' }: { value: number; duration?: number; suffix?: string }) {
  const reduced = usePrefersReducedMotion()
  const [shown, setShown] = useState(reduced ? value : 0)
  const from = useRef(0)

  useEffect(() => {
    if (reduced) {
      setShown(value)
      return
    }
    const start = performance.now()
    const origin = from.current
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 4)
      setShown(Math.round(origin + (value - origin) * eased))
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = value
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, reduced])

  return (
    <span className="tabular" aria-label={`${value}${suffix}`}>
      <span aria-hidden="true">
        {shown}
        {suffix}
      </span>
    </span>
  )
}

// 'uv' is the copilot's own colour (campaign links, agent activity) — the
// one non-verdict tone, so a campaign chip never reads as a severity.
export function ToneChip({ tone, children, dot = true }: { tone: Tone | 'uv'; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={`chip tone-${tone}`}>
      {dot && <i className="chip-dot" aria-hidden="true" />}
      {children}
    </span>
  )
}

/** A verdict chip for a raw backend label — colour plus the class name, never colour alone. */
export function LabelChip({ label }: { label?: string }) {
  return <ToneChip tone={toneOfLabel(label)}>{labelName(label)}</ToneChip>
}

/**
 * The risk instrument: a 270° gauge with a tick every 10 points. The arc
 * draws in once on mount (the case's verdict "settling"), then holds.
 */
export function RiskDial({ risk, tone, size = 168, caption = 'risk score' }: { risk: number; tone: Tone; size?: number; caption?: string }) {
  const stroke = Math.max(6, size * 0.055)
  const r = size / 2 - stroke - 6
  const c = size / 2
  const sweep = 270
  const arcLen = (2 * Math.PI * r * sweep) / 360
  const filled = (Math.max(0, Math.min(100, risk)) / 100) * arcLen
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const a = ((135 + (sweep * i) / 10) * Math.PI) / 180
    const inner = r + stroke / 2 + 3
    const outer = inner + (i % 5 === 0 ? 7 : 4)
    return { x1: c + inner * Math.cos(a), y1: c + inner * Math.sin(a), x2: c + outer * Math.cos(a), y2: c + outer * Math.sin(a), major: i % 5 === 0 }
  })

  return (
    <div className={`dial tone-${tone}`} style={{ width: size, height: size }} role="img" aria-label={`${caption} ${risk} out of 100`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <g transform={`rotate(135 ${c} ${c})`}>
          <circle className="dial-track" cx={c} cy={c} r={r} strokeWidth={stroke} strokeDasharray={`${arcLen} 9999`} />
          <circle
            className="dial-fill"
            cx={c}
            cy={c}
            r={r}
            strokeWidth={stroke}
            strokeDasharray={`${filled} 9999`}
            style={{ '--dial-len': `${filled}` } as React.CSSProperties}
          />
        </g>
        {ticks.map((t, i) => (
          <line key={i} className={`dial-tick ${t.major ? 'major' : ''}`} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />
        ))}
      </svg>
      <div className="dial-readout">
        <strong>
          <CountUp value={risk} />
        </strong>
        <span>{caption}</span>
      </div>
    </div>
  )
}

/**
 * The verdict, stamped. Job: attention + delight at the one moment an
 * investigation concludes — it lands once (scale-down + slight rotation,
 * ≤450ms), then sits still. Under reduced motion it simply fades in.
 */
export function VerdictStamp({ label, sub, size = 'lg' }: { label?: string; sub?: string; size?: 'md' | 'lg' }) {
  return (
    <div className={`stamp stamp-${size} tone-${toneOfLabel(label)}`} role="status">
      <span className="stamp-label">{labelName(label)}</span>
      {sub && <span className="stamp-sub">{sub}</span>}
    </div>
  )
}

/**
 * SIH26106's five verdict classes as one strip, least to most harmful.
 * - `counts`: a distribution (Command view) — segment widths follow volume.
 * - `current`: one case (case page) — equal segments, its class lit.
 */
export function ClassSpectrum({ counts, current }: { counts?: Record<string, number>; current?: string }) {
  const active = classOf(current)
  const total = counts ? VERDICT_CLASSES.reduce((s, k) => s + (counts[k] ?? 0), 0) : 0

  return (
    <div className={`spectrum ${counts ? 'is-distribution' : 'is-marker'}`}>
      <div className="spectrum-bar" role="img" aria-label={counts ? spectrumSummary(counts, total) : `Classified as ${labelName(current)}`}>
        {VERDICT_CLASSES.map((k, i) => {
          const n = counts?.[k] ?? 0
          const grow = counts ? (total ? Math.max(n, n > 0 ? total * 0.04 : 0) : 1) : 1
          return (
            <span
              key={k}
              className={`spectrum-seg tone-${toneOfLabel(k)} ${active === k ? 'is-current' : ''} ${counts && n === 0 ? 'is-empty' : ''}`}
              style={{ flexGrow: grow, animationDelay: `${i * 60}ms` }}
            />
          )
        })}
      </div>
      <div className="spectrum-legend">
        {VERDICT_CLASSES.map((k, i) => (
          <div key={k} className={`spectrum-key tone-${toneOfLabel(k)} ${active === k ? 'is-current' : ''}`}>
            <span className="spectrum-key-index">0{i + 1}</span>
            <span className="spectrum-key-name">{CLASS_NAME[k]}</span>
            {counts && (
              <span className="spectrum-key-count tabular">
                {counts[k] ?? 0}
                <em>{total ? Math.round(((counts[k] ?? 0) / total) * 100) : 0}%</em>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function spectrumSummary(counts: Record<string, number>, total: number): string {
  return `${total} classified cases: ` + VERDICT_CLASSES.map((k) => `${counts[k] ?? 0} ${CLASS_NAME[k]}`).join(', ')
}
