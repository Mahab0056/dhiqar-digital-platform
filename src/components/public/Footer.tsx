import { Link } from 'wouter'
import { Brand } from './Brand'

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Brand />
          <p>
            البوابة الإلكترونية للخدمات الحكومية في محافظة ذي قار، للوصول إلى الخدمات وتقديم الطلبات ومتابعة المعاملات
            إلكترونياً.
          </p>
        </div>
        <div>
          <strong>الخدمات والمنصة</strong>
          <Link href="/#services">الخدمات الحكومية</Link>
          <Link href="/departments">دليل الدوائر</Link>
          <Link href="/directory">الخدمات الحكومية</Link>
          <Link href="/citizen#my-requests">متابعة المعاملات</Link>
          <Link href="/citizen/feedback">الشكاوى والمقترحات</Link>
        </div>
        <div id="privacy">
          <strong>المعلومات والثقة</strong>
          <Link href="/verify">التحقق من الوثائق</Link>
          <a href="#privacy">سياسة الخصوصية</a>
          <Link href="/terms">شروط الاستخدام</Link>
          <a href="#accessibility">إمكانية الوصول</a>
        </div>
      </div>
      <div className="container footer-bottom" id="accessibility">
        <span>جميع الحقوق محفوظة © محافظة ذي قار</span>
        <span>واجهة عربية • دعم RTL • أرقام إنجليزية • متوافق مع الهاتف</span>
      </div>
    </footer>
  )
}
