import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'wouter'
import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowLeft, BarChart3, ChevronDown, FileText, Landmark, UsersRound } from 'lucide-react'
import { TQLogoMotion } from './TQLogoMotion'
import { useMotionPref } from './motion-pref'

// hub-and-spoke: every party the platform connects, positioned in the 600×540 visual
const HUB = { x: 300, y: 250 }
const NODES = [
  { icon: UsersRound, label: 'المواطنون', x: 92, y: 96 },
  { icon: Landmark, label: 'الدوائر الحكومية', x: 516, y: 150 },
  { icon: FileText, label: 'الخدمات الرقمية', x: 86, y: 380 },
  { icon: BarChart3, label: 'غرفة العمليات', x: 506, y: 404 },
]
const spoke = (x: number, y: number) => {
  const mx = (HUB.x + x) / 2
  return `M${HUB.x} ${HUB.y} C${mx} ${HUB.y} ${mx} ${y} ${x} ${y}`
}
const css = (vars: Record<string, string | number>) => vars as CSSProperties

// date-palm silhouettes for the riverbank (simple, hand-drawn paths)
function Palm({ x, h, flip = false }: { x: number; h: number; flip?: boolean }) {
  const top = 400 - h
  const s = flip ? -1 : 1
  return (
    <g transform={`translate(${x} 0)`}>
      <path d={`M0 400 C${4 * s} ${top + h * 0.6} ${-6 * s} ${top + h * 0.3} ${3 * s} ${top}`} strokeWidth={h / 26} />
      {[-150, -120, -85, -55, -20, 15, 45, 80, 120, 155].map(angle => {
        const r = (angle * Math.PI) / 180
        const len = h * 0.36
        const ex = 3 * s + Math.sin(r) * len
        const ey = top - Math.cos(r) * len * 0.55 + len * 0.35
        const cx = 3 * s + Math.sin(r) * len * 0.5
        const cy = top - Math.cos(r) * len * 0.5 - 8
        return <path key={angle} d={`M${3 * s} ${top} Q${cx} ${cy} ${ex} ${ey}`} strokeWidth={h / 70} fill="none" />
      })}
    </g>
  )
}

export function HeroScene({ services, departments }: { services: number | null; departments: number | null }) {
  const ref = useRef<HTMLElement>(null)
  const tile = useRef<HTMLDivElement>(null)
  const { still } = useMotionPref()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const sceneY = useTransform(scrollYProgress, [0, 1], still ? ['0%', '0%'] : ['0%', '14%'])
  const skyY = useTransform(scrollYProgress, [0, 1], still ? ['0%', '0%'] : ['0%', '6%'])
  const visualY = useTransform(scrollYProgress, [0, 1], still ? ['0%', '0%'] : ['0%', '-12%'])
  const copyFade = useTransform(scrollYProgress, [0.55, 0.95], [1, still ? 1 : 0.2])

  // the logo tile leans gently toward the pointer
  useEffect(() => {
    const hero = ref.current
    if (!hero || still || !window.matchMedia('(hover: hover)').matches) {
      tile.current?.style.removeProperty('--rx')
      tile.current?.style.removeProperty('--ry')
      return
    }
    let frame = 0
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = hero.getBoundingClientRect()
        const px = (event.clientX - box.left) / box.width - 0.5
        const py = (event.clientY - box.top) / box.height - 0.5
        tile.current?.style.setProperty('--ry', `${(-14 + px * 16).toFixed(2)}deg`)
        tile.current?.style.setProperty('--rx', `${(8 - py * 10).toFixed(2)}deg`)
      })
    }
    hero.addEventListener('pointermove', onMove)
    return () => {
      cancelAnimationFrame(frame)
      hero.removeEventListener('pointermove', onMove)
    }
  }, [still])

  return (
    <section className="st-hero" ref={ref} aria-labelledby="st-hero-title">
      {/* night scene built from the real photograph of the Ziggurat of Ur */}
      <motion.div className="st-sky" style={{ y: skyY }} aria-hidden="true" />
      <motion.div className="st-scape" style={{ y: sceneY }} aria-hidden="true">
        <div className="st-zig">
          <img src="/brand/landmarks/ur-ziggurat-panorama.jpg" alt="" fetchPriority="high" />
          <span className="st-zig-light" />
          <span className="st-lamps">
            {Array.from({ length: 14 }, (_, index) => (
              <i key={index} style={css({ '--i': index })} />
            ))}
          </span>
        </div>
        <div className="st-water">
          <div className="st-zig is-reflection">
            <img src="/brand/landmarks/ur-ziggurat-panorama.jpg" alt="" />
            <span className="st-zig-light" />
          </div>
          <span className="st-ripple" />
        </div>
        <svg className="st-palms" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice">
          <Palm x={60} h={330} />
          <Palm x={150} h={250} flip />
          <Palm x={240} h={190} />
          <Palm x={1380} h={210} flip />
          <Palm x={1470} h={300} />
          <Palm x={1560} h={240} flip />
        </svg>
      </motion.div>
      <div className="st-hero-shade" aria-hidden="true" />

      <div className="st-wrap st-hero-grid">
        <motion.div className="st-hero-copy" style={{ opacity: copyFade }}>
          <span className="st-eyebrow is-light st-in" style={css({ '--i': 0 })}>
            المنصة الرسمية لحكومة محافظة ذي قار
          </span>
          <h1 id="st-hero-title" className="st-in" style={css({ '--i': 1 })}>
            محافظة كاملة،
            <em>مترابطة رقمياً.</em>
          </h1>
          <p className="st-in" style={css({ '--i': 2 })}>
            المواطن، الدائرة، الموظف، وغرفة العمليات — ضمن منظومة وحدة. قدّم معاملتك وتابعها خطوة بخطوة من مكانك.
          </p>
          <div className="st-hero-actions st-in" style={css({ '--i': 3 })}>
            <Link href="/onboarding" className="st-btn is-light">
              ابدأ معاملتك <ArrowLeft aria-hidden="true" />
            </Link>
            <a href="#story" className="st-btn is-text">
              استكشف المنصة
            </a>
          </div>
          <dl className="st-hero-facts st-in" style={css({ '--i': 4 })}>
            <div>
              <dt>خدمة حكومية</dt>
              <dd>{services ? services.toLocaleString('ar-IQ') : '—'}</dd>
            </div>
            <div>
              <dt>دائرة وجهة</dt>
              <dd>{departments ? departments.toLocaleString('ar-IQ') : '—'}</dd>
            </div>
            <div>
              <dt>قضاء</dt>
              <dd>{(12).toLocaleString('ar-IQ')}</dd>
            </div>
          </dl>
        </motion.div>

        <motion.div className="st-hero-visual" style={{ y: visualY }} aria-hidden="true">
          <svg className="st-net" viewBox="0 0 600 540">
            <defs>
              <filter id="st-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <radialGradient id="st-pad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#3cc27a" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#3cc27a" stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* the platform the mark stands on */}
            <ellipse cx="300" cy="400" rx="230" ry="62" fill="url(#st-pad)" />
            <ellipse className="st-ring" cx="300" cy="400" rx="250" ry="70" filter="url(#st-glow)" />
            <ellipse className="st-ring is-mid" cx="300" cy="400" rx="185" ry="50" />
            <ellipse className="st-ring is-inner" cx="300" cy="400" rx="120" ry="32" filter="url(#st-glow)" />
            {/* orbit sweeping around the hub, like the reference */}
            <ellipse className="st-orbit" cx="300" cy="260" rx="270" ry="150" transform="rotate(-12 300 260)" />
            {NODES.map((node, index) => (
              <g key={node.label}>
                <path className="st-net-spoke" d={spoke(node.x, node.y)} filter="url(#st-glow)" />
                <path
                  className="st-net-pulse"
                  d={spoke(node.x, node.y)}
                  pathLength={100}
                  style={css({ '--i': index })}
                />
              </g>
            ))}
          </svg>
          {NODES.map((node, index) => (
            <span
              key={node.label}
              className="st-node"
              style={css({ left: `${(node.x / 600) * 100}%`, top: `${(node.y / 540) * 100}%`, '--i': index })}
            >
              <node.icon />
              {node.label}
            </span>
          ))}
          <div className="st-hub" style={{ left: `${(HUB.x / 600) * 100}%`, top: `${(HUB.y / 540) * 100}%` }}>
            <div className="st-tile" ref={tile}>
              <TQLogoMotion speed={0.6} play={!still} />
            </div>
          </div>
        </motion.div>
      </div>

      <a href="#story" className="st-scroll-cue">
        اكتشف أكثر <ChevronDown aria-hidden="true" />
      </a>
    </section>
  )
}
