import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  Ban,
  ExternalLink,
  Eye,
  FileCheck2,
  LayoutGrid,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useSession } from '../../lib/session'
import {
  documentsApi,
  ISSUED_PAGE,
  previewUrl,
  type DocumentTemplateView,
  type IssuedDocumentRow,
  type TemplateAssignmentRow,
} from './documentsApi'
import '../../styles/ds/documents.css'

type View = 'gallery' | 'assign' | 'issued'

/**
 * «نماذج الوثائق»: the gallery of official document templates, the per-service mapping of a department
 * (managers and the super admin edit it) and the register of issued documents with revocation.
 */
export function DocumentTemplatesPanel({ departmentId }: { departmentId?: string }) {
  const [view, setView] = useState<View>('gallery')
  const [templates, setTemplates] = useState<DocumentTemplateView[]>([])
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([])
  const [error, setError] = useState('')
  useEffect(() => {
    documentsApi
      .templates()
      .then(result => {
        setTemplates(result.templates)
        setCategories(result.categories)
      })
      .catch(err => setError((err as Error).message))
  }, [])
  return (
    <section className="docs-panel" id="document-templates" dir="rtl">
      <header className="docs-panel-head">
        <div>
          <span className="section-kicker">الوثائق الرسمية الصادرة للمواطن</span>
          <h2>نماذج الوثائق</h2>
          <p>
            كل إجازة أو موافقة أو شهادة تصدر من المنصة تُطبع على نموذج رسمي بترويسة الدائرة وختم إلكتروني ورمز تحقق
            مشفّر لا يُقرأ إلا عبر المنصة.
          </p>
        </div>
        <nav className="docs-switch" role="tablist" aria-label="أقسام نماذج الوثائق">
          {(
            [
              ['gallery', 'معرض النماذج', LayoutGrid],
              ['assign', 'تعيين النماذج للخدمات', SlidersHorizontal],
              ['issued', 'الوثائق الصادرة', Archive],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              className={view === id ? 'active' : ''}
              onClick={() => setView(id)}
            >
              <Icon aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>
      </header>
      {error && <p className="form-error">{error}</p>}
      {view === 'gallery' && <TemplateGallery templates={templates} categories={categories} />}
      {view === 'assign' && <AssignmentEditor templates={templates} fixedDepartmentId={departmentId} />}
      {view === 'issued' && <IssuedRegister templates={templates} />}
    </section>
  )
}

// ---------------------------------------------------------------- gallery

function TemplateGallery({
  templates,
  categories,
}: {
  templates: DocumentTemplateView[]
  categories: Array<{ id: string; label: string }>
}) {
  const [category, setCategory] = useState('ALL')
  const [open, setOpen] = useState<DocumentTemplateView | null>(null)
  const shown = templates.filter(item => category === 'ALL' || item.category === category)
  return (
    <div className="docs-gallery">
      <div className="docs-chips" role="group" aria-label="تصفية حسب الفئة">
        {[{ id: 'ALL', label: 'كل النماذج' }, ...categories].map(item => (
          <button
            key={item.id}
            type="button"
            className={category === item.id ? 'active' : ''}
            onClick={() => setCategory(item.id)}
          >
            {item.label}
            <b>{item.id === 'ALL' ? templates.length : templates.filter(t => t.category === item.id).length}</b>
          </button>
        ))}
      </div>
      <div className="docs-grid">
        {shown.map(template => (
          <article key={template.id} className="docs-card">
            <button
              type="button"
              className="docs-thumb"
              onClick={() => setOpen(template)}
              aria-label={`معاينة ${template.title}`}
            >
              <img src={template.thumbnailUrl} alt="" loading="lazy" />
              <span className="docs-thumb-hover">
                <Eye aria-hidden="true" /> معاينة PDF
              </span>
            </button>
            <div className="docs-card-body">
              <span className="docs-tag">{template.categoryLabel}</span>
              <h3>{template.title}</h3>
              <small dir="ltr">{template.titleEn}</small>
              <p>{template.description}</p>
              <span className="docs-family">{template.familyLabel}</span>
              {!template.issuable && (
                <small className="docs-card-note">للاطلاع فقط: لا يصدر عند الموافقة ولا يُعيَّن لخدمة.</small>
              )}
              {template.requiresAppointment && (
                <small className="docs-card-note">
                  يُعيَّن للخدمات التي تتطلب حضور المواطن فقط، ويصدر مع موعد الحضور.
                </small>
              )}
            </div>
          </article>
        ))}
      </div>
      {open && <TemplateDialog template={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

/**
 * Rendered into <body>: the workspace tab panel animates `transform`, which makes it the containing block of any
 * `position: fixed` descendant — inline, the "full-screen" dialog was laid out inside the panel, far below the
 * viewport. Focus moves into the dialog on open and returns to the card that opened it on close.
 */
function TemplateDialog({ template, onClose }: { template: DocumentTemplateView; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  // once per opening (the parent passes a new onClose on every render)
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onCloseRef.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])
  return createPortal(
    <div className="docs-dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="docs-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={template.title}
        onClick={event => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="docs-tag">{template.categoryLabel}</span>
            <h3>{template.title}</h3>
          </div>
          <button ref={closeRef} type="button" className="button ghost small" onClick={onClose} aria-label="إغلاق">
            <X />
          </button>
        </header>
        <div className="docs-dialog-body">
          <PdfFrame src={template.sampleUrl} title={`نموذج ${template.title}`} />
          <aside>
            <p>{template.description}</p>
            <dl>
              <div>
                <dt>الشكل</dt>
                <dd>{template.familyLabel}</dd>
              </div>
              <div>
                <dt>مدة النفاذ الافتراضية</dt>
                <dd>{template.defaultValidityDays ? `${template.defaultValidityDays} يوماً` : 'غير محددة'}</dd>
              </div>
              <div>
                <dt>المخوّل بالتوقيع</dt>
                <dd>{template.defaultSignerTitle}</dd>
              </div>
            </dl>
            <h4>الحقول المطبوعة</h4>
            <ul className="docs-fields">
              {template.fields.map(field => (
                <li key={field.key}>{field.label}</li>
              ))}
            </ul>
            <p className="gov-muted">
              <QrCode aria-hidden="true" /> رمز QR يحمل رمزاً مشفّراً موقّعاً فقط (بلا بيانات شخصية) ويُقرأ عبر صفحة
              التحقق في المنصة.
            </p>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  )
}

function PdfFrame({ src, title }: { src: string; title: string }) {
  return (
    <div className="docs-pdf">
      <iframe src={`${src}${src.includes('#') ? '' : '#toolbar=0&navpanes=0&view=FitH'}`} title={title} />
      <a className="button outline small" href={src} target="_blank" rel="noreferrer">
        <ExternalLink /> فتح في نافذة جديدة
      </a>
    </div>
  )
}

// ---------------------------------------------------------------- assignment editor

type Draft = {
  templateId: string
  title: string
  conditions: string
  validityDays: string
  signerTitle: string
  /** optional named signer («اسم الموقّع»), printed under the signer's title */
  signerName: string
}

const draftOf = (row: TemplateAssignmentRow): Draft => ({
  templateId: row.templateId,
  title: row.customTitle || '',
  conditions: (row.customConditions || []).join('\n'),
  validityDays: row.validityDays === null ? '' : String(row.validityDays),
  signerTitle: row.signerTitle || '',
  signerName: row.signerName || '',
})

function useDebounced<T>(value: T, delay: number) {
  const [current, setCurrent] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setCurrent(value), delay)
    return () => window.clearTimeout(timer)
  }, [value, delay])
  return current
}

function AssignmentEditor({
  templates,
  fixedDepartmentId,
}: {
  templates: DocumentTemplateView[]
  fixedDepartmentId?: string
}) {
  const { session } = useSession()
  const [departments, setDepartments] = useState<Array<{ id: string; name: string; canEdit: boolean }>>([])
  const [departmentId, setDepartmentId] = useState(fixedDepartmentId || '')
  const [data, setData] = useState<Awaited<ReturnType<typeof documentsApi.assignments>> | null>(null)
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const isAdmin = session?.role === 'SUPER_ADMIN'

  useEffect(() => {
    if (fixedDepartmentId) return
    documentsApi
      .departments()
      .then(list => {
        setDepartments(list)
        if (!departmentId && list[0]) setDepartmentId(isAdmin ? '' : list[0].id)
      })
      .catch(err => setError((err as Error).message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedDepartmentId, isAdmin])

  const load = useCallback(async () => {
    if (!session) return
    if (isAdmin && !departmentId) return setData(null)
    try {
      setData(await documentsApi.assignments(departmentId || undefined))
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [departmentId, isAdmin, session])
  useEffect(() => {
    setSelectedKey(null)
    void load()
  }, [load])

  const selected = data?.services.find(item => item.serviceKey === selectedKey) || null
  useEffect(() => {
    setDraft(selected ? draftOf(selected) : null)
  }, [selected?.serviceKey, selected?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  // a save or reset reloads the row (new updatedAt) right after its confirmation is set, so that reload keeps it;
  // another service, a field edit (edit()) or the next save()/reset() clears it
  useEffect(() => setMessage(''), [selected?.serviceKey])

  const filtered = useMemo(
    () =>
      (data?.services || []).filter(item =>
        `${item.title} ${item.documentTitle} ${item.category}`.includes(query.trim())
      ),
    [data, query]
  )
  const byId = useMemo(() => new Map(templates.map(item => [item.id, item])), [templates])
  // only templates that are issued on approval can be assigned (a rejection letter never is)
  const grouped = useMemo(() => {
    const map = new Map<string, DocumentTemplateView[]>()
    for (const item of templates.filter(template => template.issuable))
      map.set(item.categoryLabel, [...(map.get(item.categoryLabel) || []), item])
    return [...map.entries()]
  }, [templates])
  const debounced = useDebounced(draft, 600)
  const livePreview =
    debounced && data && selected
      ? previewUrl({
          templateId: debounced.templateId,
          departmentId: data.department.id,
          serviceKey: selected.serviceKey,
          title: debounced.title,
          conditions: debounced.conditions,
          validityDays: debounced.validityDays,
          signerTitle: debounced.signerTitle,
          signerName: debounced.signerName.trim(),
        })
      : null

  /**
   * Every field edit goes through here: the green confirmation belongs to the state that was saved, so it goes as
   * soon as the draft differs from it (as it does on entry to save()/reset(): a failed save never shows it).
   */
  const edit = (patch: Partial<Draft>) => {
    setMessage('')
    setDraft(current => (current ? { ...current, ...patch } : current))
  }

  const save = async () => {
    if (!data || !selected || !draft) return
    setMessage('')
    setBusy(true)
    setError('')
    try {
      await documentsApi.saveAssignment(data.department.id, selected.serviceKey, {
        templateId: draft.templateId,
        customTitle: draft.title.trim() || null,
        customConditions: draft.conditions
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length >= 3),
        validityDays: draft.validityDays.trim() === '' ? null : Math.max(0, Number(draft.validityDays) || 0),
        signerTitle: draft.signerTitle.trim() || null,
        signerName: draft.signerName.trim() || null,
      })
      setMessage('حُفظ النموذج لهذه الخدمة. ستصدر الوثائق الجديدة به فوراً.')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const reset = async () => {
    if (!data || !selected) return
    setMessage('')
    setBusy(true)
    setError('')
    try {
      await documentsApi.resetAssignment(data.department.id, selected.serviceKey)
      setMessage('أُعيد النموذج الافتراضي المستنتج من اسم الخدمة.')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="docs-assign">
      <div className="docs-toolbar">
        {!fixedDepartmentId && departments.length > 1 && (
          <label className="docs-select">
            <span>الدائرة</span>
            <select value={departmentId} onChange={event => setDepartmentId(event.target.value)}>
              <option value="">اختر الدائرة…</option>
              {departments.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="docs-search">
          <Search aria-hidden="true" />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث عن خدمة أو نموذج" />
        </label>
        {data && (
          <span className={data.canEdit ? 'tq-badge is-success' : 'tq-badge'}>
            {data.canEdit ? 'يمكنك تعديل النماذج' : 'عرض فقط — التعديل لمدير الدائرة'}
          </span>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!data ? (
        <p className="docs-empty">{isAdmin ? 'اختر دائرة لعرض خدماتها ونماذج وثائقها.' : 'جارٍ التحميل…'}</p>
      ) : (
        <div className="docs-assign-layout">
          <ul className="docs-service-list" aria-label={`خدمات ${data.department.name}`}>
            {filtered.map(item => (
              <li key={item.serviceKey}>
                <button
                  type="button"
                  className={selectedKey === item.serviceKey ? 'selected' : ''}
                  onClick={() => setSelectedKey(item.serviceKey)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.issuesDocument ? (
                      <>
                        <FileCheck2 aria-hidden="true" /> {byId.get(item.templateId)?.title || item.templateId}
                        {item.overridden && <em>معدّل</em>}
                      </>
                    ) : (
                      <small>لا تصدر وثيقة (شكوى/بلاغ/موعد)</small>
                    )}
                  </span>
                </button>
              </li>
            ))}
            {!filtered.length && <li className="docs-empty">لا توجد خدمات مطابقة.</li>}
          </ul>
          <div className="docs-editor">
            {!selected || !draft ? (
              <p className="docs-empty">اختر خدمة من القائمة لعرض نموذج الوثيقة التي تصدر عند الموافقة عليها.</p>
            ) : (
              <>
                <h3>{selected.title}</h3>
                {!selected.issuesDocument && (
                  <p className="gov-muted">
                    هذه الخدمة تُغلق بقرار دون وثيقة. يبقى تعيين النموذج محفوظاً إن تغيّر نوع الخدمة لاحقاً.
                  </p>
                )}
                <fieldset disabled={!data.canEdit || busy}>
                  <label>
                    نوع الوثيقة
                    <select value={draft.templateId} onChange={event => edit({ templateId: event.target.value })}>
                      {grouped.map(([label, items]) => (
                        <optgroup key={label} label={label}>
                          {items.map(item => (
                            <option
                              key={item.id}
                              value={item.id}
                              disabled={item.requiresAppointment && !selected.needsAttendance}
                            >
                              {item.title}
                              {item.id === selected.defaultTemplateId ? ' (افتراضي)' : ''}
                              {item.requiresAppointment && !selected.needsAttendance ? ' — لخدمات الحضور فقط' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <label>
                    عنوان الوثيقة{' '}
                    <small>اختياري — الافتراضي: {selected.overridden ? 'حسب النموذج' : selected.documentTitle}</small>
                    <input
                      value={draft.title}
                      maxLength={90}
                      onChange={event => edit({ title: event.target.value })}
                      placeholder="مثال: إجازة حفر بئر مائي"
                    />
                  </label>
                  <div className="docs-row">
                    <label>
                      مدة النفاذ (يوم) <small>فارغ = الافتراضي، 0 = بلا انتهاء</small>
                      <input
                        inputMode="numeric"
                        value={draft.validityDays}
                        onChange={event => edit({ validityDays: event.target.value.replace(/[^\d]/g, '') })}
                        placeholder={byId.get(draft.templateId)?.defaultValidityDays?.toString() || 'بلا انتهاء'}
                      />
                    </label>
                    <label>
                      صفة المخوّل بالتوقيع
                      <input
                        value={draft.signerTitle}
                        maxLength={80}
                        onChange={event => edit({ signerTitle: event.target.value })}
                        placeholder={byId.get(draft.templateId)?.defaultSignerTitle}
                      />
                    </label>
                  </div>
                  <label>
                    اسم الموقّع{' '}
                    <small>اختياري — يُطبع تحت صفة المخوّل بالتوقيع، ولا يُطبع اسم الموظف الذي يوافق على الطلب</small>
                    <input
                      value={draft.signerName}
                      maxLength={80}
                      autoComplete="off"
                      onChange={event => edit({ signerName: event.target.value })}
                      placeholder="الاسم كما يُطبع على الوثيقة"
                    />
                  </label>
                  <label>
                    الشروط والملاحظات <small>سطر لكل شرط — فارغ = شروط النموذج الافتراضية</small>
                    <textarea
                      rows={4}
                      value={draft.conditions}
                      onChange={event => edit({ conditions: event.target.value.slice(0, 1800) })}
                      placeholder={byId.get(draft.templateId)?.defaultConditions.join('\n')}
                    />
                  </label>
                </fieldset>
                <div className="docs-actions">
                  {data.canEdit && (
                    <>
                      <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
                        <Save /> حفظ النموذج للخدمة
                      </button>
                      {selected.overridden && (
                        <button type="button" className="button ghost" disabled={busy} onClick={() => void reset()}>
                          <RotateCcw /> إرجاع الافتراضي
                        </button>
                      )}
                    </>
                  )}
                  {selected.updatedBy && (
                    <small className="gov-muted">
                      آخر تعديل: {selected.updatedBy} — {new Date(selected.updatedAt || '').toLocaleString('en-GB')}
                    </small>
                  )}
                </div>
                {message && <p className="docs-ok">{message}</p>}
                {livePreview && <PdfFrame key={livePreview} src={livePreview} title="معاينة النموذج" />}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- issued register + revocation

function IssuedRegister({ templates }: { templates: DocumentTemplateView[] }) {
  const [rows, setRows] = useState<IssuedDocumentRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadedAt, setLoadedAt] = useState(0)
  const [query, setQuery] = useState('')
  const [revoking, setRevoking] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const titles = useMemo(() => new Map(templates.map(item => [item.id, item.title])), [templates])
  // the server searches the whole register (number, title, holder, service, reference) and pages through it
  const search = useDebounced(query.trim(), 350)
  const requestId = useRef(0)
  const fetchPage = useCallback(
    (offset: number) => {
      const id = ++requestId.current
      return documentsApi
        .issued({ q: search || undefined, offset, limit: ISSUED_PAGE })
        .then(page => {
          if (id !== requestId.current) return // a newer search answered first
          setRows(previous => (offset && previous ? [...previous, ...page] : page))
          setHasMore(page.length === ISSUED_PAGE)
          setLoadedAt(Date.now())
          setError('')
        })
        .catch(err => {
          if (id === requestId.current) setError((err as Error).message)
        })
    },
    [search]
  )
  const load = useCallback(() => {
    void fetchPage(0)
  }, [fetchPage])
  useEffect(load, [load])
  const loadMore = async () => {
    setLoadingMore(true)
    await fetchPage(rows?.length || 0)
    setLoadingMore(false)
  }
  const shown = rows || []
  const revoke = async (id: string) => {
    try {
      await documentsApi.revoke(id, reason)
      const revokedReason = reason.trim()
      // update in place: keeps the pages already loaded
      setRows(previous =>
        (previous || []).map(row =>
          row.id === id ? { ...row, status: 'REVOKED', revokedReason, revokedAt: new Date().toISOString() } : row
        )
      )
      setRevoking(null)
      setReason('')
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const state = (row: IssuedDocumentRow) =>
    row.status !== 'ACTIVE'
      ? ['ملغاة', 'is-danger']
      : row.expiresAt && Date.parse(row.expiresAt) < loadedAt
        ? ['منتهية النفاذ', 'is-warning']
        : ['نافذة', 'is-success']
  return (
    <div className="docs-issued">
      <div className="docs-toolbar">
        <label className="docs-search">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="رقم الوثيقة أو الاسم أو رقم المعاملة"
            aria-label="ابحث في كل الوثائق الصادرة"
          />
        </label>
        <button type="button" className="button outline small" onClick={load}>
          <RefreshCw /> تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {rows === null ? (
        <p className="docs-empty">جارٍ التحميل…</p>
      ) : !shown.length ? (
        <p className="docs-empty">{search ? 'لا توجد وثائق صادرة مطابقة للبحث.' : 'لا توجد وثائق صادرة بعد.'}</p>
      ) : (
        <ul className="docs-issued-list">
          {shown.map(row => {
            const [label, tone] = state(row)
            return (
              <li key={row.id}>
                <div className="docs-issued-main">
                  <strong>{row.documentTitle}</strong>
                  <span dir="ltr">{row.documentNumber}</span>
                  <small>
                    {row.citizenName} • {row.serviceRequestReference || row.applicationReference} •{' '}
                    {titles.get(row.templateId || '') || 'نموذج سابق'} • صدرت{' '}
                    {new Date(row.issuedAt).toLocaleDateString('en-GB')}
                    {row.expiresAt ? ` • نافذة لغاية ${new Date(row.expiresAt).toLocaleDateString('en-GB')}` : ''}
                  </small>
                  {row.revokedReason && <small className="docs-revoked">سبب الإلغاء: {row.revokedReason}</small>}
                </div>
                <span className={`tq-badge ${tone}`}>{label}</span>
                <div className="docs-issued-actions">
                  <a className="button ghost small" href={row.pdfUrl} target="_blank" rel="noreferrer">
                    <Eye /> PDF
                  </a>
                  <a
                    className="button ghost small"
                    href={`/verify/${encodeURIComponent(row.verificationId)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ShieldCheck /> صفحة التحقق
                  </a>
                  {row.status === 'ACTIVE' && (
                    <button type="button" className="button ghost small danger" onClick={() => setRevoking(row.id)}>
                      <Ban /> إلغاء
                    </button>
                  )}
                </div>
                {revoking === row.id && (
                  <form
                    className="docs-revoke"
                    onSubmit={event => {
                      event.preventDefault()
                      void revoke(row.id)
                    }}
                  >
                    <label>
                      سبب الإلغاء (يظهر في صفحة التحقق ويُبلَّغ به صاحب الوثيقة)
                      <input
                        value={reason}
                        maxLength={300}
                        onChange={event => setReason(event.target.value)}
                        autoFocus
                      />
                    </label>
                    <button type="submit" className="button primary small" disabled={reason.trim().length < 5}>
                      تأكيد الإلغاء
                    </button>
                    <button type="button" className="button ghost small" onClick={() => setRevoking(null)}>
                      تراجع
                    </button>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {rows !== null && hasMore && (
        <div className="docs-actions">
          <button type="button" className="button outline small" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'جارٍ التحميل…' : 'عرض المزيد من الوثائق الأقدم'}
          </button>
        </div>
      )}
    </div>
  )
}
