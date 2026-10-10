import { useId } from 'react'

/**
 * أفندي brand mark — ported unchanged (shapes, tiers, motion hooks) from the owner's أفندي assistant
 * (barmjini-site client/src/raddad/AfandiMark.tsx) so مساعد ذي قار wears the same logo: the classic Baghdadi «أفندي»
 * clerk as an AI employee — a chat-bubble head, a sidara worn at a tilt, round glasses and a handlebar moustache.
 * Colour = currentColor; Afandi's own palette (#061024 tile, #3eebc0 jade) comes from afandi.css.
 *
 * Optical sizes (one viewBox, detail drops as the mark shrinks):
 *   ≤ 16 px micro · ≤ 27 px glyph (one-path moustache bar) · 28–39 px small (creased sidara, bridge) · ≥ 40 px full.
 * Motion (decorative, off under prefers-reduced-motion): "glint" sweeps light across the lenses; "typing" turns the
 * moustache into typing dots. Hooks used by the orb: .rd-mark__head · .rd-mark__glasses · .rd-mark__moustache.
 */
export type AfandiMotion = 'none' | 'glint' | 'typing'

/** Head = speech bubble, tail bottom-left. */
const HEAD =
  'M11 12.5H21A6 6 0 0 1 27 18.5V20.5A5.5 5.5 0 0 1 21.5 26H12.6L6.6 29.4L7.3 25A5.5 5.5 0 0 1 5 20.5V18.5A6 6 0 0 1 11 12.5Z'
/** Sidara: boat-shaped side-cap, tilted, with the crease dip near the middle. */
const CAP =
  'M7.4 13.2L5.9 10.1Q5.6 9.1 6.7 9.1Q11.3 9.7 15.5 9.5Q16.4 9.5 17.1 9Q20.5 7.7 24.4 7.2Q25.6 7.1 25.6 8.3L24.7 13.2Z'
/** Small sizes: one continuous boat silhouette, higher on the front side only. */
const CAP_SIMPLE = 'M6.3 13.4C6.1 11.5 7.3 10.7 9.5 10.4L21.6 8.3C24.3 7.8 25.7 8.6 25.7 10.6L25.4 13.4Z'
/** Small sizes: the moustache as one bold bar with lifted ends. */
const MOUSTACHE_BAR =
  'M11.1 23.1C12.8 21.6 14.8 21.5 16 22.3C17.2 21.5 19.2 21.6 20.9 23.1C19.2 24.9 17.2 24.8 16 23.9C14.8 24.8 12.8 24.9 11.1 23.1Z'
/** Handlebar moustache with curled tips. */
const MOUSTACHE =
  'M16 21.7C15 21.5 13.6 21.8 12.8 22.6C12.4 23 12 23 11.7 22.7C11.9 23.8 13.4 24.1 14.6 23.6C15.2 23.3 15.7 23 16 22.7C16.3 23 16.8 23.3 17.4 23.6C18.6 24.1 20.1 23.8 20.3 22.7C20 23 19.6 23 19.2 22.6C18.4 21.8 17 21.5 16 21.7Z'

type Tier = 'micro' | 'glyph' | 'small' | 'full'
const tierFor = (size: number): Tier => (size <= 16 ? 'micro' : size <= 27 ? 'glyph' : size < 40 ? 'small' : 'full')

/** Per-tier geometry: lens centre y, lens radius, lens stroke, head stroke. */
const GEO: Record<Tier, { y: number; r: number; lens: number; head: number }> = {
  micro: { y: 18.6, r: 3.3, lens: 2.6, head: 2.9 },
  glyph: { y: 17.7, r: 3.05, lens: 2.1, head: 2.4 },
  small: { y: 17.9, r: 2.85, lens: 1.8, head: 2.1 },
  full: { y: 17.9, r: 2.85, lens: 1.8, head: 2.1 },
}

export function AfandiMark({
  size = 28,
  className = '',
  title,
  motion = 'none',
}: {
  size?: number
  className?: string
  /** Accessible name; omit for a decorative mark (aria-hidden). */
  title?: string
  motion?: AfandiMotion
}) {
  const tier = tierFor(size)
  const g = GEO[tier]
  const glint = motion === 'glint' && size >= 26
  const typing = motion === 'typing'
  const clipId = `afx-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const ly = g.y
  const motionClass = glint ? ' rd-mark--glint' : typing ? ' rd-mark--typing' : ''

  return (
    <svg
      className={`rd-mark rd-mark--${tier}${motionClass} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title && <title>{title}</title>}
      <path className="rd-mark__fill" d={HEAD} stroke="none" />
      <path className="rd-mark__head" d={HEAD} strokeWidth={g.head} />
      <path
        className="rd-mark__cap"
        d={tier === 'micro' || tier === 'glyph' ? CAP_SIMPLE : CAP}
        fill="currentColor"
        stroke="none"
      />
      <g className="rd-mark__line rd-mark__glasses">
        <circle cx={12} cy={ly} r={g.r} strokeWidth={g.lens} />
        <circle cx={20} cy={ly} r={g.r} strokeWidth={g.lens} />
        {(tier === 'small' || tier === 'full') && (
          <path d={`M${12 + g.r - 0.05} ${ly - 0.3}Q16 ${ly - 1.2} ${20 - g.r + 0.05} ${ly - 0.3}`} strokeWidth={1.5} />
        )}
        {tier === 'full' && (
          <path d={`M9.2 ${ly - 0.7}L6.4 ${ly - 1.5}M22.8 ${ly - 0.7}L25.6 ${ly - 1.5}`} strokeWidth={1.4} />
        )}
      </g>
      {typing ? (
        <g className="rd-mark__dots" fill="currentColor" stroke="none">
          <circle className="rd-mark__dot" cx={12.9} cy={22.9} r={1.25} />
          <circle className="rd-mark__dot" cx={16} cy={22.9} r={1.25} />
          <circle className="rd-mark__dot" cx={19.1} cy={22.9} r={1.25} />
        </g>
      ) : (
        tier !== 'micro' && (
          <path
            className="rd-mark__line rd-mark__moustache"
            d={tier === 'glyph' ? MOUSTACHE_BAR : MOUSTACHE}
            fill="currentColor"
            stroke="none"
          />
        )
      )}
      {glint && (
        <>
          <clipPath id={clipId}>
            <circle cx={12} cy={ly} r={g.r + g.lens / 2} />
            <circle cx={20} cy={ly} r={g.r + g.lens / 2} />
          </clipPath>
          <g clipPath={`url(#${clipId})`} stroke="none">
            <path className="rd-mark__glint" d={`M7 ${ly - 5}h1.9l-3.4 10h-1.9z`} />
          </g>
        </>
      )}
    </svg>
  )
}

/** Afandi's app-icon tile (#061024 + jade mark), as in /brand/afandi/afandi-icon.svg. */
export function AfandiTile({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <span className={`afd-tile ${className}`.trim()} style={{ width: size, height: size }} aria-hidden="true">
      <AfandiMark size={Math.round(size * 0.9)} />
    </span>
  )
}
