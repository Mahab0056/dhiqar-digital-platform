import type React from 'react'
import { useEffect, useState } from 'react'
import { BadgeCheck, Fingerprint, LockKeyhole, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { Footer } from '../../components/public/Footer'
import { PublicHeader } from '../../components/public/PublicHeader'

export type CitizenSubmissionAccess = 'checking' | 'guest' | 'identity-required' | 'verified'

export const onboardingPathForService = (serviceKey: string) =>
  `/onboarding?continue=${encodeURIComponent(`/service/${serviceKey}`)}`

export function useCitizenSubmissionAccess() {
  const [access, setAccess] = useState<CitizenSubmissionAccess>('checking')
  useEffect(() => {
    let active = true
    api
      .getSession()
      .then(async session => {
        if (session.role !== 'CITIZEN') return 'guest' as const
        const citizen = await api.getDemoCitizen()
        return citizen.verificationStatus === 'VERIFIED' || citizen.verificationStatus === 'VERIFIED_MANUAL'
          ? ('verified' as const)
          : ('identity-required' as const)
      })
      .then(state => {
        if (active) setAccess(state)
      })
      .catch(() => {
        if (active) setAccess('guest')
      })
    return () => {
      active = false
    }
  }, [])
  return access
}

export function ServiceSubmissionNotice({ access }: { access: CitizenSubmissionAccess }) {
  if (access === 'verified')
    return (
      <div className="service-submission-notice verified">
        <BadgeCheck />
        <div>
          <strong>حسابك موثق وجاهز للإرسال</strong>
          <span>ستُرسل الاستمارة إلى الدائرة المختصة عند الضغط على زر الإرسال.</span>
        </div>
      </div>
    )
  if (access === 'identity-required')
    return (
      <div className="service-submission-notice pending">
        <Fingerprint />
        <div>
          <strong>أكمل توثيق الوجه قبل الإرسال</strong>
          <span>يمكنك مراجعة الاستمارة الآن. عند الإرسال ستكمل فيديو الوجه والتدقيق المطلوب للحساب.</span>
        </div>
      </div>
    )
  if (access === 'guest')
    return (
      <div className="service-submission-notice">
        <LockKeyhole />
        <div>
          <strong>الاستمارة متاحة للمشاهدة والتعبئة</strong>
          <span>لن يطلب منك إنشاء حساب إلا عند الإرسال، ثم يتم توثيق الوجه لحماية الطلب.</span>
        </div>
      </div>
    )
  return (
    <div className="service-submission-notice">
      <RefreshCw className="spin" />
      <div>
        <strong>جاري التحقق من حالة الحساب</strong>
        <span>تستطيع مراجعة تفاصيل الخدمة الآن.</span>
      </div>
    </div>
  )
}

export function PublicServiceFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell public-service-shell">
      <PublicHeader />
      <main className="container public-service-main">{children}</main>
      <Footer />
    </div>
  )
}
