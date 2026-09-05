import { Link } from 'wouter'
import { ArrowLeft, ArrowRight, Building2, LockKeyhole, MonitorCheck, ShieldCheck, UserRound } from 'lucide-react'
import { Brand } from '../../components/public/Brand'
import { CivicUtilityBar } from '../../components/public/CivicUtilityBar'

export function LoginPage() {
  const options = [
    {
      icon: UserRound,
      title: 'دخول أو إنشاء حساب المواطن',
      text: 'استرجع حسابك برقم الهاتف أو أكمل تسجيلك وتوثيق الوجه',
      href: '/onboarding',
      tone: 'citizen',
    },
    {
      icon: Building2,
      title: 'بوابة الموظفين',
      text: 'حساب شخصي لكل موظف: المعاملات، مراجعة الهوية، الدوائر',
      href: '/staff/login?next=%2Femployee',
      tone: 'employee',
    },
    {
      icon: MonitorCheck,
      title: 'غرفة العمليات',
      text: 'متابعة المؤشرات التشغيلية للدوائر المسجلة',
      href: '/staff/login?next=%2Foperations',
      tone: 'operations',
    },
    {
      icon: ShieldCheck,
      title: 'إدارة المنصة',
      text: 'الحسابات والصلاحيات وسجل الإجراءات',
      href: '/staff/login?next=%2Fsuper-admin',
      tone: 'super-admin',
    },
  ]
  return (
    <div className="login-page login-v3">
      <CivicUtilityBar />
      <div className="login-backdrop" />
      <header className="login-top container">
        <Brand />
        <Link href="/">
          <ArrowRight /> العودة للرئيسية
        </Link>
      </header>
      <main className="container login-v3-content">
        <section className="login-v3-intro">
          <span className="login-v3-kicker">
            <LockKeyhole size={15} /> منصة ذي قار الرقمية
          </span>
          <h1>تسجيل الدخول أو إنشاء حساب</h1>
          <p>
            يمكن للمواطن استرجاع حسابه المحفوظ برقم الهاتف أو إكمال التسجيل لأول مرة؛ وبوابات العمل الحكومية لها صلاحيات
            مستقلة. لكل بوابة صلاحيات محددة وفق الغرض الوظيفي.
          </p>
          <div className="login-v3-security">
            <ShieldCheck />
            <span>جلسات محمية وصلاحيات وصول محددة</span>
          </div>
        </section>
        <section className="login-v3-choices" aria-label="اختيار بوابة الدخول">
          {options.map((option, index) => (
            <Link
              href={option.href}
              className={`login-v3-option ${option.tone} ${index === 0 ? 'primary-access' : ''}`}
              key={option.title}
            >
              <span className="login-v3-icon">
                <option.icon />
              </span>
              <div>
                <small>{index === 0 ? 'خدمات المواطن' : 'وصول مقيّد'}</small>
                <h2>{option.title}</h2>
                <p>{option.text}</p>
              </div>
              <span className="login-v3-arrow">
                <ArrowLeft />
              </span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  )
}
