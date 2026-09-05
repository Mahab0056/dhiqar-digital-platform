import { Link } from 'wouter'
import { Brand } from '../components/public/Brand'

export function NotFound() {
  return (
    <div className="not-found">
      <Brand />
      <strong>404</strong>
      <h1>الصفحة غير موجودة</h1>
      <p>المسار الذي فتحته غير متاح أو تم نقله إلى مسار آخر.</p>
      <Link href="/" className="button primary">
        العودة للرئيسية
      </Link>
    </div>
  )
}
