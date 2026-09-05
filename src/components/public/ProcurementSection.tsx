import { ArrowLeft, FileArchive } from 'lucide-react'
import { dhiqarNews, officialProcurementLinks } from '../../news'

export function ProcurementSection() {
  return (
    <>
      <section className="section news-section news-archive" aria-hidden="true">
        <div className="container">
          <div className="section-heading">
            <div>
              <span className="section-kicker">أخبار ذي قار</span>
              <h2>متابعة مصورة من المصادر المعروضة</h2>
            </div>
            <p>تحتفظ كل بطاقة برابط مصدرها. راجع المصدر للخبر الكامل وتاريخ النشر قبل اتخاذ أي إجراء.</p>
          </div>
          <div className="news-grid">
            {dhiqarNews.map((item, index) => (
              <article className={index === 0 ? 'news-card featured' : 'news-card'} key={item.title}>
                <img src={item.image} alt={item.title} loading="lazy" />
                <div>
                  <span>{item.category}</span>
                  <h3>{item.title}</h3>
                  <p>المصدر: {item.source}</p>
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                    فتح المصدر <ArrowLeft />
                  </a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="section procurement-section" id="procurement">
        <div className="container">
          <div className="section-heading light">
            <div>
              <span className="section-kicker">المناقصات والمزادات</span>
              <h2>بوابة شفافة إلى الإعلانات المنشورة</h2>
            </div>
            <p>
              تظهر الروابط الرسمية المتاحة حالياً. لا تُنشأ أي مناقصة أو مزاد داخل المنصة قبل إدخال الإعلان من الجهة
              صاحبة الصلاحية.
            </p>
          </div>
          <div className="procurement-grid">
            {officialProcurementLinks.map(item => (
              <a href={item.href} target="_blank" rel="noreferrer" key={item.title}>
                <span>
                  <FileArchive />
                </span>
                <div>
                  <small>{item.source}</small>
                  <h3>{item.title}</h3>
                  <p>{item.detail}</p>
                </div>
                <ArrowLeft />
              </a>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
