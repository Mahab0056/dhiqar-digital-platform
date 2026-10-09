import type { CSSProperties } from 'react'

/**
 * The original TQ mark, revealed layer by layer (building, T, Q) while digital lines converge on it.
 * Layers are exact colour separations of /brand/dhiqar-unified-logo.png — the logo itself is never redrawn.
 * Styles live in /brand/motion/tq-logo-motion.css, shared with the standalone tq-logo-motion.html.
 */
const LINES = [
  { d: 'M-220 140H-70L-30 100H0', delay: 0, end: [0, 100] },
  { d: 'M-220 430H-50L0 480H120', delay: 0.12, end: [120, 480] },
  { d: 'M330 -190V-70L370 -30V0', delay: 0.24, end: [370, 0] },
  { d: 'M1040 60H910L870 100H815', delay: 0.06, end: [815, 100], alt: true },
  { d: 'M1040 320H930L890 280H745', delay: 0.18, end: [745, 280], alt: true },
  { d: 'M1020 720H870L800 650V590', delay: 0.3, end: [800, 590], alt: true },
  { d: 'M400 800V700L440 660V605', delay: 0.36, end: [440, 605] },
  { d: 'M-140 780L-10 650H130', delay: 0.42, end: [130, 650] },
] as const

export function TQLogoMotion({
  speed = 1,
  play = true,
  className = '',
}: {
  speed?: number
  play?: boolean
  className?: string
}) {
  return (
    <>
      <link rel="stylesheet" href="/brand/motion/tq-logo-motion.css" precedence="default" />
      <div
        className={`tqm ${className}`}
        data-play={play ? '' : undefined}
        style={{ '--tqm-s': speed } as CSSProperties}
        role="img"
        aria-label="شعار ذي قار الرقمية"
      >
        <svg viewBox="0 0 820 603" aria-hidden="true">
          {LINES.map(line => (
            <path
              key={line.d}
              className={`tqm-line${'alt' in line ? ' is-alt' : ''}`}
              pathLength={1}
              d={line.d}
              style={{ '--d': `${line.delay}s` } as CSSProperties}
            />
          ))}
          {LINES.map(line => (
            <circle
              key={`n${line.d}`}
              className={`tqm-node${'alt' in line ? ' is-alt' : ''}`}
              cx={line.end[0]}
              cy={line.end[1]}
              r={7}
              style={{ '--d': `${line.delay}s` } as CSSProperties}
            />
          ))}
        </svg>
        <img className="tqm-site" src="/brand/motion/tq-site.png" alt="" />
        <img className="tqm-t" src="/brand/motion/tq-t.png" alt="" />
        <img className="tqm-q" src="/brand/motion/tq-q.png" alt="" />
      </div>
    </>
  )
}
