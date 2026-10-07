import { Link } from 'wouter'
import { Compass, Home, Search } from 'lucide-react'
import { PublicHeader } from '../components/public/PublicHeader'
import { Footer } from '../components/public/Footer'

export function NotFound() {
  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content" className="tq-content not-found-page">
        <div className="tq-container">
          <div className="tq-state">
            <span className="tq-state-icon" aria-hidden="true">
              <Compass />
            </span>
            <span className="not-found-code">404</span>
            <h1>الصفحة غير موجودة</h1>
            <p>الصفحة التي طلبتها غير متاحة أو نُقلت إلى عنوان آخر. ابحث عن الخدمة التي تريدها أو عد إلى الرئيسية.</p>
            <div className="tq-page-actions">
              <Link href="/directory" className="button primary">
                <Search /> البحث في دليل الخدمات
              </Link>
              <Link href="/" className="button outline">
                <Home /> الصفحة الرئيسية
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
