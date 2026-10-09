import { useEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useRevealOnScroll } from '../../lib/reveal'
import {
  LandingFooter,
  LandingHeader,
  LandingHero,
  LandingHow,
  LandingJourney,
  LandingOperations,
} from '../../components/home/Landing'
import {
  LandingAssistant,
  LandingDepartment,
  LandingServices,
  LandingStart,
} from '../../components/home/LandingStory'
import { MotionPrefProvider, useMotionPrefState } from '../../components/home/motion-pref'

// the story, in scroll order — also drives the side dots
const SCENES = [
  { id: 'top', label: 'البداية' },
  { id: 'services', label: 'كل خدماتك بمكان واحد' },
  { id: 'journey', label: 'من الطلب إلى الإنجاز' },
  { id: 'department', label: 'كل دائرة تعرف المطلوب' },
  { id: 'operations', label: 'المحافظة أمامك' },
  { id: 'assistant', label: 'مساعدة ذكية' },
  { id: 'how', label: 'شوف شلون تشتغل' },
  { id: 'start', label: 'ابدأ الآن' },
]

export function LandingPage() {
  useRevealOnScroll()
  const motionPref = useMotionPrefState()
  const [current, setCurrent] = useState('top')

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) if (entry.isIntersecting) setCurrent(entry.target.id)
      },
      { rootMargin: '-45% 0px -50% 0px' }
    )
    for (const scene of SCENES) {
      const element = document.getElementById(scene.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <MotionPrefProvider value={motionPref}>
      <div className="ld" data-motion={motionPref.still ? 'still' : 'on'}>
        <LandingHeader />
        <main id="main-content">
          <LandingHero />
          <LandingServices />
          <LandingJourney />
          <LandingDepartment />
          <LandingOperations />
          <LandingAssistant />
          <LandingHow />
          <LandingStart />
        </main>
        <LandingFooter />

        <nav className="ld-dots" aria-label="أقسام الصفحة">
          {SCENES.map(scene => (
            <a
              key={scene.id}
              href={`#${scene.id}`}
              className={current === scene.id ? 'is-on' : ''}
              aria-current={current === scene.id ? 'true' : undefined}
            >
              <span>{scene.label}</span>
            </a>
          ))}
        </nav>

        {!motionPref.reduced && (
          <button type="button" className="ld-motion-toggle" onClick={motionPref.toggle} aria-pressed={motionPref.paused}>
            {motionPref.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {motionPref.paused ? 'تشغيل الحركة' : 'إيقاف الحركة'}
          </button>
        )}
      </div>
    </MotionPrefProvider>
  )
}
