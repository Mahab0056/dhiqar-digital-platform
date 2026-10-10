import { useId, type Ref } from 'react'
import { AfandiMark, type AfandiMotion } from './AfandiMark'

/**
 * أفندي orb (ported from barmjini-site greeter/AfandiOrb.tsx): a dark glass sphere with light moving inside — a
 * jade → cyan → violet rim, three colour blobs orbiting under a dark core — and the أفندي emblem crisp in the middle.
 * When it «speaks» two thin wobbly voice rings pulse round it (orbEngine plays them as Web Animations).
 * Decorative: aria-hidden (the launcher button / panel title carry the name).
 *
 * States (data-state, afandi.css): arrival · speaking · idle · typing · attention. `rest` freezes every animation.
 */
export type OrbState = 'arrival' | 'speaking' | 'idle' | 'typing' | 'attention'

export function AfandiOrb({
  ref,
  state,
  arrive = false,
  motion = 'none',
  rest = false,
  markSize = 32,
}: {
  ref?: Ref<HTMLSpanElement>
  state: OrbState
  /** the emblem's arrival flourish (spin-up, glasses, moustache, glint) */
  arrive?: boolean
  motion?: AfandiMotion
  rest?: boolean
  markSize?: number
}) {
  const gid = `afd-vg-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <span
      ref={ref}
      className="gr-orb"
      data-state={state}
      data-arrive={arrive ? '' : undefined}
      data-rest={rest ? '' : undefined}
      aria-hidden="true"
    >
      <i className="gr-orb__halo" />
      <svg className="gr-orb__voice gr-orb__voice--b" viewBox="-1.3 -1.3 2.6 2.6" focusable="false">
        <path />
      </svg>
      <svg className="gr-orb__voice gr-orb__voice--a" viewBox="-1.3 -1.3 2.6 2.6" focusable="false">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8cf5d6" />
            <stop offset=".55" stopColor="#70c9eb" />
            <stop offset="1" stopColor="#8b6cff" />
          </linearGradient>
        </defs>
        <path stroke={`url(#${gid})`} />
      </svg>
      <i className="gr-orb__ring" />
      <i className="gr-orb__ring gr-orb__ring--b" />
      <span className="gr-orb__body">
        <i className="gr-orb__base" />
        <i className="gr-orb__spin">
          <i className="gr-orb__flow" />
        </i>
        <i className="gr-orb__blob gr-orb__blob--a" />
        <i className="gr-orb__blob gr-orb__blob--b" />
        <i className="gr-orb__blob gr-orb__blob--c" />
        <i className="gr-orb__comet" />
        <i className="gr-orb__core" />
        <i className="gr-orb__spec" />
      </span>
      <span className="gr-orb__mark">
        <AfandiMark size={markSize} motion={motion} />
      </span>
    </span>
  )
}
