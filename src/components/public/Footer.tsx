import { Link } from 'wouter'
import { FileCheck2, LockKeyhole, ShieldCheck } from 'lucide-react'

const columns = [
  {
    title: 'الخدمات',
    links: [
      { label: 'دليل الخدمات الحكومية', href: '/directory' },
      { label: 'دليل الدوائر', href: '/departments' },
      { label: 'ابدأ معاملة جديدة', href: '/onboarding' },
      { label: 'متابعة معاملة', href: '/citizen#my-requests' },
    ],
  },
  {
    title: 'المساعدة والثقة',
    links: [
      { label: 'التحقق من وثيقة', href: '/verify' },
      { label: 'الشكاوى والمقترحات', href: '/citizen/feedback' },
      { label: 'إمكانية الوصول', href: '/accessibility' },
    ],
  },
  {
    title: 'السياسات',
    links: [
      { label: 'سياسة الخصوصية', href: '/privacy' },
      { label: 'شروط الاستخدام', href: '/terms' },
      { label: 'دخول الموظفين', href: '/staff/login' },
    ],
  },
]

export function Footer() {
  return (
    <footer className="tq-footer">
      <div className="tq-container tq-footer-grid">
        <div className="tq-footer-about">
          <Link href="/" className="tq-footer-brand" aria-label="ذي قار الرقمية — الرئيسية">
            <span className="tq-footer-seals">
              <img src="/brand/iraq-coat-of-arms.png" alt="" />
              <img src="/brand/dhiqar-unified-logo.png" alt="" />
            </span>
            <span>
              <strong>ذي قار الرقمية</strong>
              <small>جمهورية العراق • محافظة ذي قار</small>
            </span>
          </Link>
          <p>
            البوابة الرسمية للخدمات الحكومية في محافظة ذي قار: ابحث عن الخدمة، قدّم طلبك، تابع معاملتك واستلم وثيقتك
            إلكترونياً.
          </p>
          <ul className="tq-footer-trust">
            <li>
              <ShieldCheck /> منصة حكومية رسمية
            </li>
            <li>
              <LockKeyhole /> بيانات محمية ومشفّرة
            </li>
            <li>
              <FileCheck2 /> وثائق قابلة للتحقق
            </li>
          </ul>
        </div>
        {columns.map(column => (
          <nav className="tq-footer-col" aria-label={column.title} key={column.title}>
            <strong>{column.title}</strong>
            {column.links.map(link => (
              <Link href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
      </div>
      <div className="tq-footer-bottom">
        <div className="tq-container tq-footer-bottom-row">
          <span>© {new Date().getFullYear()} محافظة ذي قار. جميع الحقوق محفوظة.</span>
          <span>المنصة الرسمية لمحافظة ذي قار — الإصدار 1.0</span>
        </div>
      </div>
    </footer>
  )
}
