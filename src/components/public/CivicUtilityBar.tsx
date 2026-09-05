import { Link } from 'wouter'
import { Accessibility, Globe, QrCode } from 'lucide-react'

export function CivicUtilityBar() {
  return (
    <div className="gov-utility">
      <div className="gov-container">
        <span className="gov-utility-identity">
          <img src="/brand/iraq-coat-of-arms.png" alt="" aria-hidden="true" />
          <strong>جمهورية العراق</strong>
          <i aria-hidden="true" />
          <span>محافظة ذي قار</span>
        </span>
        <nav className="gov-utility-links" aria-label="روابط مساعدة">
          <Link href="/verify">
            <QrCode size={14} /> التحقق من الوثائق
          </Link>
          <a href="#accessibility">
            <Accessibility size={14} /> إمكانية الوصول
          </a>
          <span className="gov-utility-lang" aria-label="اللغة الحالية">
            <Globe size={14} /> العربية
          </span>
        </nav>
      </div>
    </div>
  )
}
