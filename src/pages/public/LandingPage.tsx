import { useEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { api } from '../../api'
import { useRevealOnScroll } from '../../lib/reveal'
import { Footer } from '../../components/public/Footer'
import { PublicHeader } from '../../components/public/PublicHeader'
import { HeroScene } from '../../components/home/HeroScene'
import { JourneyScene } from '../../components/home/JourneyScene'
import {
  AssistantScene,
  DepartmentScene,
  OperationsScene,
  ServicesScene,
  StartScene,
  VideoScene,
} from '../../components/home/StoryScenes'
import { MotionPrefProvider, useMotionPrefState } from '../../components/home/motion-pref'

// the story, in scroll order — also drives the side progress dots
const SCENES = [
  { id: 'top', label: 'البداية' },
  { id: 'story', label: 'كل خدماتك بمكان واحد' },
  { id: 'journey', label: 'من الطلب إلى الإنجاز' },
  { id: 'department', label: 'كل دائرة تعرف المطلوب' },
  { id: 'operations', label: 'المحافظة أمامك' },
  { id: 'assistant', label: 'مساعدة ذكية' },
  { id: 'video', label: 'الفيديو التعريفي' },
  { id: 'start', label: 'ابدأ الآن' },
]

export function LandingPage() {
  useRevealOnScroll()
  const motionPref = useMotionPrefState()
  const [services, setServices] = useState<number | null>(null)
  const [departments, setDepartments] = useState<number | null>(null)
  const [current, setCurrent] = useState('top')

  useEffect(() => {
    api
      .getServicesSummary()
      .then(summary => setServices(summary.total))
      .catch(() => setServices(null))
    api
      .listDepartments()
      .then(result => setDepartments(result.items.length))
      .catch(() => setDepartments(null))
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) if (entry.isIntersecting) setCurrent(entry.target.id)
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    for (const scene of SCENES) {
      const element = document.getElementById(scene.id)
      if (element) observer.observe(element)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <MotionPrefProvider value={motionPref}>
      <div className="tq-page is-story" id="top" data-motion={motionPref.still ? 'still' : 'on'}>
        <PublicHeader />
        <main id="main-content">
          <HeroScene services={services} departments={departments} />
          <ServicesScene />
          <JourneyScene />
          <DepartmentScene />
          <OperationsScene />
          <AssistantScene />
          <VideoScene />
          <StartScene />
        </main>
        <Footer />

        <nav className="st-dots" aria-label="مشاهد الصفحة">
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
          <button type="button" className="st-motion-toggle" onClick={motionPref.toggle} aria-pressed={motionPref.paused}>
            {motionPref.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {motionPref.paused ? 'تشغيل الحركة' : 'إيقاف الحركة'}
          </button>
        )}
      </div>
    </MotionPrefProvider>
  )
}
