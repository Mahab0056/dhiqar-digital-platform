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
          <Link href="/directory">دليل الخدمات الحكومية</Link>
          <Link href="/departments">دليل الدوائر</Link>
          <Link href="/citizen">لوحة المواطن ومتابعة المعاملات</Link>
          <Link href="/citizen/feedback">الشكاوى والمقترحات</Link>
          <Link href="/staff/login">دخول الموظفين</Link>
        </div>
        <div>
          <strong>المعلومات والثقة</strong>
          <Link href="/verify">التحقق من الوثائق</Link>
          <Link href="/privacy">سياسة الخصوصية</Link>
          <Link href="/terms">شروط الاستخدام</Link>
          <Link href="/accessibility">إمكانية الوصول</Link>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>جميع الحقوق محفوظة © محافظة ذي قار</span>
        <span>واجهة عربية • دعم RTL • أرقام إنجليزية • متوافق مع الهاتف</span>
      </div>
    </footer>
  )
}
