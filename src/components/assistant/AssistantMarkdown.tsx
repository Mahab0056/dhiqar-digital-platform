import { Fragment, type ReactNode } from 'react'
import { Link } from 'wouter'

/**
 * Markdown-lite for assistant replies: paragraphs, "-" / "1." lists, **bold** and [text](/internal-path) links.
 * Everything is rendered as React text nodes — no HTML from the model ever reaches the DOM, and only same-site
 * paths become links (anything else is shown as plain text).
 */
const INLINE = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g

const isInternalPath = (href: string) => /^\/(?!\/)[\w\-/.?=&%#؀-ۿ]*$/.test(href)

function inline(text: string, onNavigate?: () => void): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(text.slice(last, index))
    if (match[1]) nodes.push(<strong key={`b${index}`}>{match[1]}</strong>)
    else if (match[2] && match[3] && isInternalPath(match[3]))
      nodes.push(
        <Link key={`l${index}`} href={match[3]} className="dqa-link" onClick={onNavigate}>
          {match[2]}
        </Link>
      )
    else nodes.push(match[2] || match[0])
    last = index + match[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] }

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim()
    const bullet = line.match(/^(?:[-•*])\s+(.*)$/)
    const numbered = line.match(/^\d{1,2}[.)-]\s+(.*)$/)
    const current = blocks[blocks.length - 1]
    if (!line) {
      blocks.push({ kind: 'p', lines: [] })
      continue
    }
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol'
      const item = (bullet || numbered)![1]
      if (current && current.kind === kind) current.items.push(item)
      else blocks.push({ kind, items: [item] })
      continue
    }
    if (current && current.kind === 'p') current.lines.push(line)
    else blocks.push({ kind: 'p', lines: [line] })
  }
  return blocks.filter(block => (block.kind === 'p' ? block.lines.length > 0 : block.items.length > 0))
}

export function AssistantMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  return (
    <div className="dqa-md">
      {parseBlocks(text).map((block, index) =>
        block.kind === 'p' ? (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inline(line, onNavigate)}
              </Fragment>
            ))}
          </p>
        ) : block.kind === 'ul' ? (
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item, onNavigate)}</li>
            ))}
          </ul>
        ) : (
          <ol key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item, onNavigate)}</li>
            ))}
          </ol>
        )
      )}
    </div>
  )
}
