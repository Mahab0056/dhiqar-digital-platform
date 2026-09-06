import { Link } from 'wouter'
import { Home, Search } from 'lucide-react'
import { PublicHeader } from '../components/public/PublicHeader'
import { Footer } from '../components/public/Footer'

export function NotFound() {
  return (
    <div className="public-shell">
      <PublicHeader />
      <main className="gov-container not-found">
        <strong>404</strong>
        <h1>الصفحة غير موجودة</h1>
        <p>الصفحة التي طلبتها غير متاحة أو نُقلت إلى عنوان آخر. ابحث عن الخدمة التي تريدها أو عد إلى الرئيسية.</p>
        <div className="not-found-actions">
          <Link href="/directory" className="gov-btn primary">
            <Search size={16} /> البحث في دليل الخدمات
          </Link>
          <Link href="/" className="gov-btn outline">
            <Home size={16} /> العودة إلى الرئيسية
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  )
}
