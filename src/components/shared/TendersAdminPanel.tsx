import { useCallback, useEffect, useState } from 'react'
import { Link } from 'wouter'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Trophy,
  X,
} from 'lucide-react'
import { api } from '../../api'
import type { DepartmentSummary, Tender, TenderInput, TenderType } from '../../types'
import { closingLabel, formatDate, formatIqd, isFuture, TENDER_STATUS, TENDER_TYPE } from '../../lib/news-format'

/**
 * Tenders & auctions registry for staff. The super admin publishes for any entity; a department manager
 * publishes for their own department only (the server enforces both).
 */
type Form = {
  reference: string
  title: string
  type: TenderType
  departmentId: string
  entityName: string
  district: string
  description: string
  estimatedCostIqd: string
  bidBond: string
  publishedAt: string
  closingAt: string
  documentUrl: string
  sourceUrl: string
}

const pad = (n: number) => String(n).padStart(2, '0')
/** ISO → value for <input type="datetime-local"> in the browser's zone. */
const toLocalInput = (iso: string) => {
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const emptyForm = (departmentId = ''): Form => ({
  reference: '',
  title: '',
  type: 'TENDER',
  departmentId,
  entityName: '',
  district: '',
  description: '',
  estimatedCostIqd: '',
  bidBond: '',
  publishedAt: toLocalInput(new Date().toISOString()),
  closingAt: toLocalInput(new Date(Date.now() + 14 * 86_400_000).toISOString()),
  documentUrl: '',
  sourceUrl: '',
})

const formOf = (tender: Tender): Form => ({
  reference: tender.reference,
  title: tender.title,
  type: tender.type,
  departmentId: tender.departmentId || '',
  entityName: tender.entityName,
  district: tender.district || '',
  description: tender.description,
  estimatedCostIqd: tender.estimatedCostIqd === null ? '' : String(tender.estimatedCostIqd),
  bidBond: tender.bidBond || '',
  publishedAt: toLocalInput(tender.publishedAt),
  closingAt: toLocalInput(tender.closingAt),
  documentUrl: tender.documentUrl || '',
  sourceUrl: tender.sourceUrl || '',
})

export function TendersAdminPanel({ scope }: { scope: 'admin' | 'department' }) {
  const [items, setItems] = useState<Tender[]>([])
  const [departments, setDepartments] = useState<DepartmentSummary[]>([])
  const [form, setForm] = useState<Form>(() => emptyForm())
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems((await api.listStaffTenders()).items)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    if (scope === 'admin')
      api
        .listDepartments()
        .then(result => setDepartments(result.items))
        .catch(() => setDepartments([]))
  }, [load, scope])

  const startCreate = () => {
    setForm(emptyForm())
    setEditing(null)
    setOpen(true)
    setNotice('')
  }
  const startEdit = (tender: Tender) => {
    setForm(formOf(tender))
    setEditing(tender.id)
    setOpen(true)
    setNotice('')
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    const cost = form.estimatedCostIqd.replace(/[^\d]/g, '')
    const input: TenderInput = {
      reference: form.reference.trim(),
      title: form.title.trim(),
      type: form.type,
      district: form.district.trim() || null,
      description: form.description.trim(),
      estimatedCostIqd: cost ? Number(cost) : null,
      bidBond: form.bidBond.trim() || null,
      publishedAt: new Date(form.publishedAt).toISOString(),
      closingAt: new Date(form.closingAt).toISOString(),
      documentUrl: form.documentUrl.trim() || null,
      sourceUrl: form.sourceUrl.trim() || null,
      ...(scope === 'admin'
        ? { departmentId: form.departmentId || null, entityName: form.entityName.trim() || undefined }
        : {}),
    }
    try {
      if (editing) await api.updateTender(editing, input)
      else await api.createTender(input)
      setNotice(editing ? 'حُفظت التعديلات.' : 'نُشر الإعلان وأصبح ظاهراً للعموم في موعد نشره.')
      setOpen(false)
      setEditing(null)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changeState = async (tender: Tender, state: 'ACTIVE' | 'CLOSED' | 'CANCELLED' | 'AWARDED') => {
    const labels = { ACTIVE: 'إعادة فتح', CLOSED: 'إغلاق مبكر', CANCELLED: 'إلغاء', AWARDED: 'تسجيل الإحالة' }
    const note =
      state === 'CANCELLED' || state === 'AWARDED'
        ? window.prompt(`${labels[state]}: ملاحظة تظهر للعموم (اختياري)`, '')
        : ''
    if (note === null) return
    if (!window.confirm(`${labels[state]} للإعلان «${tender.title}»؟`)) return
    try {
      await api.setTenderState(tender.id, state, note || undefined)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const set = (key: keyof Form) => (event: { target: { value: string } }) =>
    setForm(current => ({ ...current, [key]: event.target.value }))

  return (
    <section className="admin-panel tenders-admin-panel" id="tenders-admin">
      <div className="panel-heading">
        <div>
          <h2>المناقصات والمزادات</h2>
          <p>
            {scope === 'admin'
              ? 'انشر إعلانات أي جهة في المحافظة، وعدّل أو ألغِ أو سجّل الإحالة. تظهر الإعلانات في الصفحة الرئيسية وصفحة المناقصات.'
              : 'إعلانات دائرتك فقط. يُغلق الإعلان تلقائياً عند موعد الغلق، ويمكنك إلغاؤه أو تسجيل الإحالة.'}
          </p>
        </div>
        <div className="department-workbench-actions">
          <button className="button ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'spin' : ''} /> تحديث
          </button>
          <button className="button primary" onClick={startCreate}>
            <Plus /> إعلان جديد
          </button>
        </div>
      </div>

      {notice && (
        <div className="form-success" role="status">
          <CheckCircle2 /> {notice}
        </div>
      )}
      {error && (
        <div className="form-error" role="alert">
          <AlertTriangle /> {error}
        </div>
      )}

      {open && (
        <form
          className="staff-create-form tender-form"
          onSubmit={event => {
            event.preventDefault()
            void submit()
          }}
        >
          <label>
            نوع الإعلان
            <select value={form.type} onChange={set('type')}>
              <option value="TENDER">مناقصة</option>
              <option value="AUCTION">مزايدة / مزاد</option>
            </select>
          </label>
          <label>
            رقم الإعلان
            <input value={form.reference} onChange={set('reference')} required maxLength={60} placeholder="م/2026/14" />
          </label>
          <label className="tender-form-wide">
            العنوان
            <input value={form.title} onChange={set('title')} required minLength={5} maxLength={300} />
          </label>
          {scope === 'admin' && (
            <>
              <label>
                الجهة (من سجل الدوائر)
                <select value={form.departmentId} onChange={set('departmentId')}>
                  <option value="">— جهة خارج السجل —</option>
                  {departments.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {!form.departmentId && (
                <label>
                  اسم الجهة
                  <input value={form.entityName} onChange={set('entityName')} required minLength={2} maxLength={160} />
                </label>
              )}
            </>
          )}
          <label>
            القضاء (اختياري)
            <input value={form.district} onChange={set('district')} maxLength={60} placeholder="الناصرية" />
          </label>
          <label>
            الكلفة التخمينية بالدينار (اختياري)
            <input value={form.estimatedCostIqd} onChange={set('estimatedCostIqd')} inputMode="numeric" dir="ltr" />
          </label>
          <label>
            التأمينات الأولية (اختياري)
            <input
              value={form.bidBond}
              onChange={set('bidBond')}
              maxLength={200}
              placeholder="1% من الكلفة التخمينية"
            />
          </label>
          <label>
            تاريخ النشر
            <input type="datetime-local" value={form.publishedAt} onChange={set('publishedAt')} required />
          </label>
          <label>
            موعد الغلق
            <input type="datetime-local" value={form.closingAt} onChange={set('closingAt')} required />
          </label>
          <label>
            رابط وثائق الإعلان (PDF)
            <input type="url" value={form.documentUrl} onChange={set('documentUrl')} dir="ltr" placeholder="https://" />
          </label>
          <label>
            رابط المصدر الرسمي
            <input type="url" value={form.sourceUrl} onChange={set('sourceUrl')} dir="ltr" placeholder="https://" />
          </label>
          <label className="tender-form-wide">
            التفاصيل والشروط
            <textarea value={form.description} onChange={set('description')} maxLength={4000} rows={4} />
          </label>
          <div className="tender-form-actions">
            <button className="button primary" type="submit" disabled={busy}>
              {editing ? 'حفظ التعديلات' : 'نشر الإعلان'}
            </button>
            <button type="button" className="button ghost" onClick={() => setOpen(false)}>
              <X /> إلغاء
            </button>
          </div>
        </form>
      )}

      <div className="table-scroll">
        <table className="staff-table">
          <thead>
            <tr>
              <th>الإعلان</th>
              <th>الجهة</th>
              <th>الغلق</th>
              <th>الكلفة</th>
              <th>الحالة</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td>
                  <strong>{item.title}</strong>
                  <br />
                  <small className="muted">
                    {TENDER_TYPE[item.type].label} · {item.reference}
                    {isFuture(item.publishedAt) ? ` · يُنشر ${formatDate(item.publishedAt)}` : ''}
                  </small>
                </td>
                <td>{item.entityName}</td>
                <td>
                  {formatDate(item.closingAt, true)}
                  <br />
                  <small className="muted">{item.status === 'OPEN' ? closingLabel(item.closingAt) : ''}</small>
                </td>
                <td>{formatIqd(item.estimatedCostIqd) || '—'}</td>
                <td>
                  <span className={item.status === 'OPEN' ? 'status-pill on' : 'status-pill off'}>
                    {TENDER_STATUS[item.status].label}
                  </span>
                </td>
                <td className="row-actions">
                  <Link href={`/tenders/${item.id}`} className="icon-button" title="عرض للعموم" aria-label="عرض للعموم">
                    <ExternalLink />
                  </Link>
                  <button
                    type="button"
                    className="icon-button"
                    title="تعديل"
                    aria-label="تعديل"
                    onClick={() => startEdit(item)}
                  >
                    <Pencil />
                  </button>
                  {item.status === 'OPEN' ? (
                    <>
                      <button
                        type="button"
                        className="icon-button"
                        title="إلغاء الإعلان"
                        aria-label="إلغاء الإعلان"
                        onClick={() => void changeState(item, 'CANCELLED')}
                      >
                        <Ban />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="إغلاق مبكر"
                        aria-label="إغلاق مبكر"
                        onClick={() => void changeState(item, 'CLOSED')}
                      >
                        <X />
                      </button>
                    </>
                  ) : (
                    <>
                      {item.status !== 'AWARDED' && item.status !== 'CANCELLED' && (
                        <button
                          type="button"
                          className="icon-button"
                          title="تسجيل الإحالة"
                          aria-label="تسجيل الإحالة"
                          onClick={() => void changeState(item, 'AWARDED')}
                        >
                          <Trophy />
                        </button>
                      )}
                      <button
                        type="button"
                        className="icon-button"
                        title="إعادة فتح"
                        aria-label="إعادة فتح"
                        onClick={() => void changeState(item, 'ACTIVE')}
                      >
                        <RotateCcw />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className="muted">
                  {loading ? 'جارٍ التحميل…' : 'لا توجد إعلانات بعد. ابدأ بـ «إعلان جديد».'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
