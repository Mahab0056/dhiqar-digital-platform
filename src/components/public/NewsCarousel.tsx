import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { dhiqarNews } from '../../news'

export function NewsCarousel() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused || dhiqarNews.length < 2) return
    const timer = window.setInterval(() => setActiveIndex(current => (current + 1) % dhiqarNews.length), 7000)
    return () => window.clearInterval(timer)
  }, [paused])
  const item = dhiqarNews[activeIndex]
  if (!item) return null
  return (
    <section
      className="home-news-carousel"
      id="news"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="container">
        <div className="home-news-head">
          <div>
            <span className="section-kicker">أخبار ذي قار</span>
            <h2>آخر المستجدات من مصادرها</h2>
          </div>
          <span>
            {String(activeIndex + 1).padStart(2, '0')} / {String(dhiqarNews.length).padStart(2, '0')}
          </span>
        </div>
        <article className="news-slide" key={item.title}>
          <div className="news-slide-media">
            <img src={item.image} alt={item.title} />
            <span>{item.category}</span>
          </div>
          <div className="news-slide-copy">
            <small>المصدر: {item.source}</small>
            <h3>{item.title}</h3>
            <p>اطلع على التفاصيل الأصلية وتاريخ النشر من المصدر المرتبط مباشرة.</p>
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">
              فتح الخبر من المصدر <ArrowLeft />
            </a>
          </div>
        </article>
        <div className="news-slider-controls">
          <div className="news-dots" aria-label="اختيار الخبر">
            {dhiqarNews.map((news, index) => (
              <button
                key={news.title}
                className={index === activeIndex ? 'active' : ''}
                onClick={() => setActiveIndex(index)}
                aria-label={`عرض الخبر ${index + 1}`}
              />
            ))}
          </div>
          <div className="news-arrows">
            <button
              onClick={() => setActiveIndex(current => (current - 1 + dhiqarNews.length) % dhiqarNews.length)}
              aria-label="الخبر السابق"
            >
              ‹
            </button>
            <button
              onClick={() => setActiveIndex(current => (current + 1) % dhiqarNews.length)}
              aria-label="الخبر التالي"
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
