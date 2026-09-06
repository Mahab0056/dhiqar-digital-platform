import { Link } from 'wouter'
import { ArrowRight, Accessibility, FileText, ShieldCheck } from 'lucide-react'
import { PublicHeader } from '../../components/public/PublicHeader'
import { Footer } from '../../components/public/Footer'

type Section = { title: string; body: string[] }
type InfoKind = 'privacy' | 'terms' | 'accessibility'

const content: Record<InfoKind, { kicker: string; title: string; intro: string; sections: Section[] }> = {
  privacy: {
    kicker: 'سياسة الخصوصية',
    title: 'كيف تتعامل المنصة مع بياناتك',
    intro:
      'منصة ذي قار الرقمية تجمع الحد الأدنى من البيانات اللازمة لتقديم الخدمة الحكومية المطلوبة، وتحفظها مشفرة، ولا تشاركها إلا مع الدائرة المختصة بالمعاملة.',
    sections: [
      {
        title: 'ما الذي نجمعه',
        body: [
          'رقم الهاتف للتحقق برمز لمرة واحدة، والاسم الكامل، وصور مستمسك الهوية وفيديو قصير للوجه عند طلب توثيق الحساب.',
          'بيانات الطلب التي تدخلها بنفسك (العنوان، الموقع على الخريطة إن اخترت تحديده، والمستمسكات المطلوبة للخدمة).',
        ],
      },
      {
        title: 'كيف نحفظها',
        body: [
          'تُحفظ الصور والفيديو والمستمسكات مشفرة على خوادم المنصة، وتُفتح فقط لموظف الدائرة المختصة أو مراجع الهوية المخوّل، ويُسجل كل اطلاع في سجل التدقيق.',
          'المستمسكات المرفقة بالطلبات تُحذف تلقائياً بعد انتهاء مدة الاحتفاظ المحددة لكل نوع (30 إلى 90 يوماً بعد إغلاق الطلب) ما لم يتطلب القانون خلاف ذلك.',
        ],
      },
      {
        title: 'حقوقك',
        body: [
          'يمكنك الاطلاع على حالة معاملاتك وسجل إشعاراتك في أي وقت من لوحة المواطن، وطلب تصحيح بياناتك عبر مركز خدمة المواطن في الدائرة المختصة.',
          'لا تُستخدم بياناتك لأي غرض تسويقي، ولا تُباع أو تُشارك مع جهات غير حكومية.',
        ],
      },
    ],
  },
  terms: {
    kicker: 'شروط الاستخدام',
    title: 'قواعد استخدام منصة ذي قار الرقمية',
    intro:
      'باستخدامك المنصة فإنك توافق على الشروط التالية، الموضوعة لحماية المواطن والدوائر الحكومية على حد سواء.',
    sections: [
      {
        title: 'صحة البيانات',
        body: [
          'تتحمل مسؤولية صحة البيانات والمستمسكات التي تقدمها. تقديم معلومات أو مستندات غير صحيحة يعرّض الطلب للرفض وقد يُحال إلى الجهات المختصة.',
          'الوثائق الصادرة عن المنصة تحمل معرّف تحقق رقمياً (QR)؛ أي تعديل عليها يُبطلها.',
        ],
      },
      {
        title: 'الحساب والأمان',
        body: [
          'حسابك مرتبط برقم هاتفك. لا تشارك رموز التحقق مع أي شخص، ولن يطلبها منك موظفو المنصة بأي وسيلة.',
          'يحق للمنصة إيقاف أي حساب يُستخدم بطريقة تسيء إلى الخدمة أو تخالف القانون.',
        ],
      },
      {
        title: 'الرسوم والمواعيد',
        body: [
          'الرسوم المعروضة هي الرسوم الرسمية المعتمدة من الدائرة المختصة، وتُسدد إلكترونياً عند توفر بوابة الدفع أو في الدائرة عند إكمال الإجراء. لا تُعرض أي رسوم غير مؤكدة.',
          'مدد الإنجاز المعروضة تقديرية وتحددها الدائرة بعد تدقيق الطلب.',
        ],
      },
    ],
  },
  accessibility: {
    kicker: 'إمكانية الوصول',
    title: 'منصة يمكن للجميع استخدامها',
    intro:
      'صُممت المنصة لتعمل على الهاتف والحاسوب، بواجهة عربية كاملة من اليمين إلى اليسار، مع مراعاة معايير الوصول لذوي الإعاقة.',
    sections: [
      {
        title: 'ما تدعمه المنصة',
        body: [
          'وضع نهاري وليلي بتباين مقروء، وأحجام خطوط لا تقل عن 12 بكسل، وعناصر تفاعل يمكن الوصول إليها بلوحة المفاتيح وقارئ الشاشة.',
          'البحث بالكتابة أو بالصوت عن الخدمات، وإشعارات فورية بحالة المعاملة على الهاتف.',
          'يمكن إنجاز أي خدمة بديلاً بالحضور إلى الدائرة المختصة؛ دليل الدوائر يعرض العنوان والموقع على الخريطة.',
        ],
      },
      {
        title: 'أبلغنا عن عائق',
        body: [
          'إذا واجهت صعوبة في استخدام أي صفحة أو خدمة، أرسل مقترحاً من صفحة الشكاوى والمقترحات مع ذكر الصفحة والمشكلة، وستُعالج ضمن خطة التحسين المستمر.',
        ],
      },
    ],
  },
}

const icons = { privacy: ShieldCheck, terms: FileText, accessibility: Accessibility }

export function InfoPage({ kind }: { kind: InfoKind }) {
  const page = content[kind]
  const Icon = icons[kind]
  return (
    <div className="public-shell gov-info-page">
      <PublicHeader />
      <main className="gov-container gov-info-main">
        <nav className="gov-breadcrumb" aria-label="مسار الصفحة">
          <Link href="/">الرئيسية</Link>
          <span aria-hidden="true">/</span>
          <span>{page.kicker}</span>
        </nav>
        <header className="gov-info-header">
          <span className="gov-info-icon">
            <Icon />
          </span>
          <div>
            <span className="gov-kicker">{page.kicker}</span>
            <h1>{page.title}</h1>
            <p>{page.intro}</p>
          </div>
        </header>
        <div className="gov-info-sections">
          {page.sections.map(section => (
            <section key={section.title} className="gov-info-section">
              <h2>{section.title}</h2>
              {section.body.map(paragraph => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
        </div>
        <footer className="gov-info-footer">
          <small>آخر تحديث: {new Date().toLocaleDateString('en-GB')}</small>
          <Link href="/" className="gov-btn outline">
            <ArrowRight size={16} /> العودة إلى الرئيسية
          </Link>
        </footer>
      </main>
      <Footer />
    </div>
  )
}
