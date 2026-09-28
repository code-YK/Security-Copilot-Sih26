/**
 * Renders the agent's REASON / MITIGATION text. agent/agent_node.py asks for
 * an opening sentence plus "- " bullets, optionally with **bold** — a narrow
 * enough format that a small renderer beats a markdown dependency.
 *
 * `voice` sets the opening sentence in the copilot's serif voice (the one
 * place Instrument Serif appears), so the AI's conclusion reads as a
 * distinct speaker from the evidence around it.
 */
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
  )
}

type Block = { type: 'p' | 'ul'; lines: string[] }

function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const bullet = line.startsWith('- ') || line.startsWith('* ')
    const content = bullet ? line.slice(2).trim() : line
    const type = bullet ? 'ul' : 'p'
    const last = blocks[blocks.length - 1]
    if (last?.type === type) last.lines.push(content)
    else blocks.push({ type, lines: [content] })
  }
  return blocks
}

export function ReasonText({ text, voice = false }: { text: string; voice?: boolean }) {
  const blocks = toBlocks(text)
  let leadUsed = !voice
  return (
    <div className="reason">
      {blocks.map((block, i) => {
        if (block.type === 'ul') {
          return (
            <ul key={i}>
              {block.lines.map((line, j) => (
                <li key={j}>{renderInline(line)}</li>
              ))}
            </ul>
          )
        }
        return block.lines.map((line, j) => {
          if (!leadUsed) {
            leadUsed = true
            // The lead is the first sentence only; anything after it stays body copy.
            const m = line.match(/^(.+?[.!?])(\s+.+)?$/)
            return (
              <p key={`${i}-${j}`}>
                <span className="voice">{renderInline(m ? m[1] : line)}</span>
                {m?.[2] && renderInline(m[2])}
              </p>
            )
          }
          return <p key={`${i}-${j}`}>{renderInline(line)}</p>
        })
      })}
    </div>
  )
}
