'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { CaseGraph as CaseGraphData } from '@/lib/types'
import { useTheme } from '@/lib/theme'

type GNode = CaseGraphData['nodes'][number] & { x?: number; y?: number }

// Canvas can't read CSS variables per draw, so resolve the theme's tokens
// once per theme change and hand the graph plain colour strings.
function readTokens() {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return {
    domain: v('--c-low'),
    ip: v('--c-medium'),
    sender: v('--uv'),
    bad: v('--c-critical'),
    ink: v('--ink-2'),
    faint: v('--line-strong'),
    surface: v('--surface'),
  }
}

export default function CaseGraph({ graph }: { graph: CaseGraphData }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const { dark } = useTheme()
  const [c, setC] = useState<ReturnType<typeof readTokens> | null>(null)

  useEffect(() => {
    // Wait a frame so the data-theme swap has applied before reading tokens.
    const raf = requestAnimationFrame(() => setC(readTokens()))
    return () => cancelAnimationFrame(raf)
  }, [dark])

  // The canvas defaults to the window width; size it to its panel instead.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const data = useMemo(() => ({ nodes: graph.nodes.map((n) => ({ ...n })), links: graph.links.map((l) => ({ ...l })) }), [graph])

  const colorOf = (n: GNode) => (!c ? '#888' : n.type === 'ip' ? c.ip : n.type === 'sender' || n.type === 'email' ? c.sender : c.domain)

  return (
    <div ref={box} className="graph-box">
      {width > 0 && c && (
        <ForceGraph2D
          graphData={data}
          width={width}
          height={380}
          backgroundColor="rgba(0,0,0,0)"
          cooldownTicks={120}
          linkColor={() => c.faint}
          linkWidth={(l) => Math.min(3, 0.6 + ((l as { case_count?: number }).case_count ?? 1) * 0.5)}
          nodeRelSize={5}
          nodeLabel={(n) => {
            const g = n as GNode
            return `${g.type}: ${g.value} — ${g.case_count} case(s), ${g.malicious_case_count} malicious`
          }}
          nodeCanvasObject={(n, ctx, scale) => {
            const g = n as GNode
            const x = g.x ?? 0
            const y = g.y ?? 0
            const r = g.in_case ? 6 : 4
            if (g.malicious_case_count > 0) {
              ctx.beginPath()
              ctx.arc(x, y, r + 3.2, 0, 2 * Math.PI)
              ctx.strokeStyle = c.bad
              ctx.lineWidth = 1.4
              ctx.stroke()
            }
            ctx.beginPath()
            if (g.type === 'ip') ctx.rect(x - r, y - r, r * 2, r * 2)
            else ctx.arc(x, y, r, 0, 2 * Math.PI)
            ctx.fillStyle = colorOf(g)
            ctx.fill()
            if (g.in_case) {
              ctx.lineWidth = 1.5
              ctx.strokeStyle = c.surface
              ctx.stroke()
            }
            const size = Math.max(2.6, 11 / scale)
            ctx.font = `${size}px ${getComputedStyle(document.body).getPropertyValue('--font-mono') || 'monospace'}`
            ctx.fillStyle = c.ink
            ctx.textBaseline = 'middle'
            ctx.fillText(g.value.replace(/[<>]/g, ''), x + r + 5, y)
          }}
        />
      )}
    </div>
  )
}
