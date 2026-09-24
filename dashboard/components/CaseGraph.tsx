'use client'

import { useEffect, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { CaseGraph as CaseGraphData } from '@/lib/types'

export default function CaseGraph({ graph }: { graph: CaseGraphData }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // The canvas defaults to the window width; size it to its panel instead.
  useEffect(() => {
    const update = () => setWidth(box.current?.clientWidth ?? 0)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return (
    <div ref={box} style={{ width: '100%', overflow: 'hidden' }}>
      {width > 0 && (
        <ForceGraph2D
          graphData={graph}
          width={width}
          height={360}
          nodeAutoColorBy="type"
          nodeLabel={(n) => `${n.type}: ${n.value} — ${n.case_count} case(s), ${n.malicious_case_count} malicious`}
          nodeCanvasObjectMode={() => 'after'}
          nodeCanvasObject={(n, ctx) => {
            // Default dots plus a small text label, so the graph reads without hovering.
            ctx.font = '3px sans-serif'
            ctx.fillStyle = '#888'
            ctx.fillText(n.value, (n.x ?? 0) + 5, (n.y ?? 0) + 1)
          }}
        />
      )}
    </div>
  )
}
