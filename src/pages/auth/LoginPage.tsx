import { Link } from 'wouter'
import { Building2, ChevronLeft, MonitorCheck, ShieldCheck, UserRound } from 'lucide-react'
import { AuthAside, AuthShell } from '../../components/public/AuthShell'

const staffOptions = [
  {
    icon: Building2,
    title: 'بوابة الموظفين',
    text: 'المعاملات ومراجعة الهوية وأعمال الدائرة',
    href: '/staff/login?next=%2Femployee',
  },
  {
    icon: MonitorCheck,
    title: 'غرفة العمليات',
    text: 'المؤشرات التشغيلية للدوائر المسجلة',
    href: '/staff/login?next=%2Foperations',
  },
  {
    icon: ShieldCheck,
    title: 'إدارة المنصة',
    text: 'الحسابات والصلاحيات وسجل الإجراءات',
    href: '/staff/login?next=%2Fsuper-admin',
  },
]

export function LoginPage() {
  return (
    <AuthShell
      aside={
        <AuthAside
          kicker="حساب واحد لكل الخدمات"
          title="ادخل مرة واحدة وأنجز معاملاتك من أي مكان"
          points={[
            'الدخول برقم هاتفك ورمز تحقق لمرة واحدة، دون كلمة مرور',
            'توثيق هويتك مرة واحدة يكفي لكل الخدمات',
            'تابع طلباتك واستلم إشعاراً عند كل تحديث',
            'وثائقك الصادرة محفوظة في حسابك وقابلة للتحقق',
          ]}
        />
      }
    >
      <div className="auth-card">
        <span className="section-kicker">تسجيل الدخول</span>
        <h1>مرحباً بك في ذي قار الرقمية</h1>
        <p className="auth-lead">اختر طريقة الدخول المناسبة لك.</p>

        <Link href="/onboarding" className="auth-choice is-primary">
          <span className="auth-choice-icon">
            <UserRound />
          </span>
          <span className="auth-choice-text">
            <strong>دخول المواطن أو إنشاء حساب</strong>
            <small>برقم الهاتف — يُسترجع حسابك تلقائياً إن كان مسجلاً</small>
          </span>
          <ChevronLeft className="auth-choice-arrow" aria-hidden="true" />
        </Link>

        <div className="auth-divider">
          <span>للموظفين الحكوميين فقط</span>
        </div>

        <div className="auth-choices">
          {staffOptions.map(option => (
            <Link href={option.href} className="auth-choice" key={option.title}>
              <span className="auth-choice-icon">
                <option.icon />
              </span>
              <span className="auth-choice-text">
                <strong>{option.title}</strong>
                <small>{option.text}</small>
              </span>
              <ChevronLeft className="auth-choice-arrow" aria-hidden="true" />
            </Link>
          ))}
        </div>
        <p className="auth-fine">
          <ShieldCheck aria-hidden="true" /> جلسات محمية وصلاحيات محددة لكل دور. لن يطلب منك أي موظف رمز التحقق.
        </p>
      </div>
    </AuthShell>
  )
}
