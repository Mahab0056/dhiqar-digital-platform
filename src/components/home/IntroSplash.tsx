import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import '../../styles/ds/intro-splash.css'

/**
 * Opening splash for the home page: the TQ mark assembles itself from its own layers, then the
 * overlay lifts away to reveal the (already rendered) page.
 *
 * Every visible piece of the mark is cut from the exact colour separations of
 * /brand/dhiqar-unified-logo.png (820×603 frame, see TQLogoMotion), so the pieces line up to the pixel.
 * At the end of the build the pieces are swapped for the three untouched layers, so the final frame
 * *is* the real logo.
 *
 * Plays once per browser session, only on "/" without a hash, never with reduced motion.
 * Skip: the "تخطي" button, Esc, a click/tap anywhere or the mouse wheel.
 */

const FLAG = 'dq-intro-played'
/** total run time in ms — the overlay is removed from the DOM after this */
const TOTAL = 3500
/** fade-out used when the visitor skips */
const SKIP_FADE = 320

const IMG = {
  t: '/brand/motion/tq-t.png',
  q: '/brand/motion/tq-q.png',
  site: '/brand/motion/tq-site.png',
  ring: '/brand/intro/tq-q-ring.png',
  bits: '/brand/intro/tq-q-bits.png',
  body: '/brand/intro/tq-site-body.png',
  arc: '/brand/intro/tq-site-arc.png',
}

/* The detached digital pixels of the Q (bounding boxes in the 820×603 layer frame). */
const W = 820
const H = 603
const QX = 479 // centre of the Q ring
const QY = 261
const BITS: [number, number, number, number][] = [
  [776, 50, 791, 67],
  [673, 51, 687, 64],
  [711, 64, 734, 147],
  [667, 81, 694, 109],
  [751, 85, 764, 99],
  [740, 106, 792, 197],
  [714, 149, 762, 183],
  [803, 150, 815, 162],
  [729, 186, 741, 191],
  [733, 202, 741, 211],
  [756, 218, 767, 229],
  [784, 247, 797, 259],
]

const fragments = BITS.map(([x0, y0, x1, y1], i) => {
  const p = 3
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  // fly in from further out along the ray from the ring centre, with a little scatter
  const dx = (cx - QX) * 1.5 + ((i * 37) % 90) - 20
  const dy = (cy - QY) * 1.4 - 70 - ((i * 53) % 110)
  return {
    key: i,
    style: {
      clipPath: `inset(${((y0 - p) / H) * 100}% ${((W - x1 - p) / W) * 100}% ${((H - y1 - p) / H) * 100}% ${((x0 - p) / W) * 100}%)`,
      transformOrigin: `${(cx / W) * 100}% ${(cy / H) * 100}%`,
      '--fx': `${(dx / W) * 100}cqw`,
      '--fy': `${(dy / W) * 100}cqw`,
      '--fr': `${((i * 71) % 120) - 60}deg`,
      '--d': `${(i % 6) * 0.035 + Math.floor(i / 6) * 0.025}s`,
    } as CSSProperties,
  }
})

/* Circuit traces that draw in towards the tile (viewBox centred on the screen centre). */
const TRACES = [
  { d: 'M-620 -150H-330L-290 -110H-205', d0: 0, alt: false },
  { d: 'M-620 120H-360L-310 70H-205', d0: 0.08, alt: false },
  { d: 'M-160 -620V-360L-120 -320V-215', d0: 0.16, alt: true },
  { d: 'M620 -90H350L300 -40H205', d0: 0.04, alt: true },
  { d: 'M620 170H380L330 120H205', d0: 0.12, alt: false },
  { d: 'M130 620V380L90 340V235', d0: 0.2, alt: false },
  { d: 'M-520 520L-300 300H-210', d0: 0.24, alt: true },
  { d: 'M520 -520L300 -300H210', d0: 0.28, alt: false },
].map(t => ({ ...t, end: endOf(t.d) }))

/* Digital particles converging on the centre. */
const PARTICLES = Array.from({ length: 22 }, (_, i) => {
  const a = (i / 22) * Math.PI * 2 + (i % 3) * 0.35
  const r = 46 + ((i * 29) % 24) // in vmax
  return {
    key: i,
    red: i % 4 === 1,
    style: {
      '--px': `${Math.cos(a) * r}vmax`,
      '--py': `${Math.sin(a) * r}vmax`,
      '--d': `${(i % 7) * 0.05}s`,
      '--sz': `${4 + (i % 3) * 2}px`,
    } as CSSProperties,
  }
})

function shouldPlay(force: boolean) {
  if (typeof window === 'undefined') return false
  if (force) return true
  try {
    if (window.location.pathname !== '/' || window.location.hash) return false
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    if (window.sessionStorage.getItem(FLAG)) return false
  } catch {
    return false
  }
  return true
}

export function IntroSplash({ forcePlay = false, onDone }: { forcePlay?: boolean; onDone?: () => void }) {
  const [show, setShow] = useState(() => shouldPlay(forcePlay))
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<number[]>([])
  const leavingRef = useRef(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  const finish = useCallback(() => {
    timers.current.forEach(id => window.clearTimeout(id))
    timers.current = []
    setShow(false)
    doneRef.current?.()
  }, [])

  const skip = useCallback(() => {
    if (leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    timers.current.forEach(id => window.clearTimeout(id))
    timers.current = [window.setTimeout(finish, SKIP_FADE)]
  }, [finish])

  useEffect(() => {
    if (!show) return
    try {
      window.sessionStorage.setItem(FLAG, '1')
    } catch {
      /* private mode — it simply plays again next time */
    }
    timers.current.push(window.setTimeout(finish, TOTAL))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', skip, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', skip)
      timers.current.forEach(id => window.clearTimeout(id))
      timers.current = []
    }
  }, [show, finish, skip])

  if (!show) return null

  return (
    <div className={`ixs${leaving ? ' is-leaving' : ''}`} dir="rtl" onPointerDown={skip}>
      <div className="ixs-scene" aria-hidden="true">
        <div className="ixs-glow" />
        <svg className="ixs-traces" viewBox="-500 -500 1000 1000" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="ixs-grid" width="40" height="40" patternUnits="userSpaceOnUse" x="-20" y="-20">
              <path d="M40 0H0V40" fill="none" />
            </pattern>
          </defs>
          <rect className="ixs-grid" x="-1000" y="-1000" width="2000" height="2000" fill="url(#ixs-grid)" />
          {TRACES.map(t => (
            <g
              key={t.d}
              className={`ixs-trace${t.alt ? ' is-alt' : ''}`}
              style={{ '--d': `${t.d0}s` } as CSSProperties}
            >
              <path pathLength={1} d={t.d} />
              <circle r={4.5} cx={t.end[0]} cy={t.end[1]} />
            </g>
          ))}
        </svg>
        <div className="ixs-particles">
          {PARTICLES.map(p => (
            <i key={p.key} className={p.red ? 'is-red' : undefined} style={p.style} />
          ))}
        </div>

        <div className="ixs-stage">
          <div className="ixs-tile">
            <div className="ixs-plate">
              <i className="ixs-glint" />
            </div>
            <svg className="ixs-outline">
              <rect x="0" y="0" width="100%" height="100%" rx="28" pathLength={1} />
            </svg>
            <div className="ixs-mark">
              {/* animated pieces */}
              <div className="ixs-pieces">
                <img className="ixs-body" src={IMG.body} alt="" decoding="async" />
                <img className="ixs-arc" src={IMG.arc} alt="" decoding="async" />
                <img className="ixs-tbar" src={IMG.t} alt="" decoding="async" />
                <img className="ixs-tstem" src={IMG.t} alt="" decoding="async" />
                <img className="ixs-ring" src={IMG.ring} alt="" decoding="async" />
                {fragments.map(f => (
                  <img key={f.key} className="ixs-bit" src={IMG.bits} alt="" decoding="async" style={f.style} />
                ))}
                <svg className="ixs-comet" viewBox={`0 0 ${W} ${H}`}>
                  <circle cx={QX} cy={QY} r={230} pathLength={1} transform={`rotate(158 ${QX} ${QY})`} />
                  <circle
                    className="is-core"
                    cx={QX}
                    cy={QY}
                    r={230}
                    pathLength={1}
                    transform={`rotate(158 ${QX} ${QY})`}
                  />
                </svg>
              </div>
              {/* the untouched logo layers — swapped in when the build completes */}
              <div className="ixs-final">
                <img src={IMG.site} alt="" />
                <img src={IMG.t} alt="" />
                <img src={IMG.q} alt="" />
              </div>
              <div className="ixs-shine">
                <i />
              </div>
            </div>
          </div>

          <div className="ixs-words">
            <p className="ixs-title">
              <span style={{ '--d': '0s' } as CSSProperties}>ذي</span>{' '}
              <span style={{ '--d': '0.08s' } as CSSProperties}>قار</span>{' '}
              <span style={{ '--d': '0.16s' } as CSSProperties}>الرقمية</span>
            </p>
            <p className="ixs-sub">محافظة ذي قار · البوابة الرسمية</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="ixs-skip"
        aria-label="تخطي المقدمة"
        onPointerDown={e => e.stopPropagation()}
        onClick={skip}
      >
        تخطي
      </button>
    </div>
  )
}

/** end point of an absolute M/L/H/V path */
function endOf(d: string): [number, number] {
  let x = 0
  let y = 0
  const re = /([MLHV])([^MLHV]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    const v = m[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
    if (m[1] === 'H') x = v[v.length - 1]
    else if (m[1] === 'V') y = v[v.length - 1]
    else {
      x = v[v.length - 2]
      y = v[v.length - 1]
    }
  }
  return [x, y]
}

export default IntroSplash
