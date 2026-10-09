import { useEffect, useMemo, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { api } from '../../api'
import type { CatalogService, CatalogSummary, DepartmentDirectoryResponse } from '../../types'
import { useRevealOnScroll } from '../../lib/reveal'
import { LandingFooter, LandingHeader, LandingHero } from '../../components/home/Landing'
import {
  PortalCategories,
  PortalDepartments,
  PortalFaq,
  PortalHelp,
  PortalHow,
  PortalLifeEvents,
  PortalPopular,
  PortalStaff,
  PortalTrack,
} from '../../components/home/Portal'
import { MotionPrefProvider, useMotionPrefState } from '../../components/home/motion-pref'

/**
 * Home: a working portal front page. Everything below the hero is live catalog and directory data —
 * the task (search, track, verify) comes first, then ways to browse, then help.
 */
export function LandingPage() {
  useRevealOnScroll()
  const motionPref = useMotionPrefState()
  const [summary, setSummary] = useState<CatalogSummary | null>(null)
  const [services, setServices] = useState<CatalogService[] | null>(null)
  const [departments, setDepartments] = useState<DepartmentDirectoryResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const fail = () => alive && setFailed(true)
    api
      .getServicesSummary()
      .then(value => alive && setSummary(value))
      .catch(fail)
    api
      .listServices()
      .then(value => alive && setServices(value))
      .catch(fail)
    api
      .listDepartments()
      .then(value => alive && setDepartments(value))
      .catch(fail)
    return () => {
      alive = false
    }
  }, [])

  const catalog = useMemo(() => (services ? new Map(services.map(item => [item.key, item])) : null), [services])

  return (
    <MotionPrefProvider value={motionPref}>
      <div className="ld" data-motion={motionPref.still ? 'still' : 'on'}>
        <LandingHeader />
        <main id="main-content">
          <LandingHero
            stats={{
              services: summary?.total ?? null,
              departments: departments?.summary.total ?? null,
              districts: departments?.districts.length ?? null,
            }}
          />
          {failed && (
            <p className="ld-wrap ld-load-error" role="alert">
              تعذّر تحميل بعض البيانات الآن. يمكنك متابعة البحث، أو فتح <a href="/directory">دليل الخدمات</a> مباشرة.
            </p>
          )}
          <PortalPopular catalog={catalog} />
          <PortalCategories summary={summary} />
          <PortalLifeEvents catalog={catalog} />
          <PortalTrack />
          <PortalHow />
          <PortalStaff summary={summary} departments={departments} />
          <PortalDepartments departments={departments} catalog={catalog} />
          <PortalFaq />
          <PortalHelp />
        </main>
        <LandingFooter />

        {!motionPref.reduced && (
          <button type="button" className="ld-motion-toggle"
            onClick={motionPref.toggle}
            aria-pressed={motionPref.paused}
            aria-label={motionPref.paused ? 'تشغيل الحركة' : 'إيقاف الحركة'}
          >
            {motionPref.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            <span>{motionPref.paused ? 'تشغيل الحركة' : 'إيقاف الحركة'}</span>
          </button>
        )}
      </div>
    </MotionPrefProvider>
  )
}
