import { Link } from 'wouter'
import { MessageSquareWarning, PlayCircle } from 'lucide-react'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'
import { PageHeader } from '../../components/public/PageHeader'
import { GuideVideo } from '../../components/guides/GuideVideo'
import { guides } from '../../components/guides/guides'

/** /guides — the platform's tutorial videos, each with Arabic captions. */
export function GuidesPage() {
  return (
    <div className="tq-page">
      <PublicHeader />
      <main id="main-content">
        <PageHeader
          crumbs={[{ label: 'فيديوهات تعليمية' }]}
          kicker={
            <>
              <PlayCircle size={15} /> فيديوهات تعليمية
            </>
          }
          title="تعلّم المنصة بدقيقة"
          description="فيديوهات قصيرة بترجمة عربية: كيف تسجّل، وكيف تحمي حسابك، وكيف تمشي معاملتك."
        />
        <section className="tq-content">
          <div className="tq-container">
            <div className="guides-grid">
              {guides.map(guide => (
                <article className="tq-panel guide-card" key={guide.id} id={`guide-${guide.id}`}>
                  <GuideVideo id={guide.id} />
                  <div className="guide-card-body">
                    <span className="guide-length">{guide.length}</span>
                    <h2>{guide.title}</h2>
                    <p>{guide.summary}</p>
                  </div>
                </article>
              ))}
            </div>
            <p className="tq-note is-info guides-note">
              <MessageSquareWarning aria-hidden="true" />
              <span>
                ما لقيت جوابك؟{' '}
                <Link href="/citizen/feedback" className="gov-link">
                  أرسل سؤالك من صفحة الشكاوى والمقترحات
                </Link>
                .
              </span>
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
