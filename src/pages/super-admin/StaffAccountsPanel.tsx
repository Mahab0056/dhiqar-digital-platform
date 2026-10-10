import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  ShieldOff,
  UserX,
  UserCheck,
  Smartphone,
} from 'lucide-react'
import { api } from '../../api'
import type { StaffAccount, StaffRole } from '../../types'

export const staffRoleLabels: Record<StaffRole, string> = {
  EMPLOYEE: 'موظف معاملات',
  IDENTITY_REVIEWER: 'مراجع هوية',
  OPERATIONS: 'غرفة العمليات',
  SUPER_ADMIN: 'مدير النظام',
}

const emailLooksValid = (value: string) => !value.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())

/** Work email used for Google / email-code sign-in. Only the super admin sets it; empty unlinks. */
function StaffEmailCell({
  account,
  busy,
  onSave,
}: {
  account: StaffAccount
  busy: boolean
  onSave: (email: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(account.email || '')
  if (!editing)
    return (
      <div className="staff-email-cell">
        {account.email ? <small dir="ltr">{account.email}</small> : <small className="muted">لا يوجد بريد مرتبط</small>}
        <button
          type="button"
          className="icon-button"
          title="تعديل البريد الإلكتروني للدخول"
          aria-label={`تعديل بريد ${account.username}`}
          disabled={busy}
          onClick={() => {
            setValue(account.email || '')
            setEditing(true)
          }}
        >
          <Pencil />
        </button>
      </div>
    )
  const valid = emailLooksValid(value)
  return (
    <form
      className="staff-email-cell editing"
      onSubmit={event => {
        event.preventDefault()
        if (!valid) return
        onSave(value.trim() ? value.trim().toLowerCase() : null)
        setEditing(false)
      }}
    >
      <input
        type="email"
        value={value}
        onChange={event => setValue(event.target.value)}
        placeholder="name@thi-qar.com"
        dir="ltr"
        aria-invalid={!valid}
        aria-label={`بريد ${account.username}`}
        autoFocus
      />
      <button type="submit" className="button primary" disabled={busy || !valid}>
        حفظ
      </button>
      <button type="button" className="button ghost" onClick={() => setEditing(false)}>
        إلغاء
      </button>
    </form>
  )
}

export function StaffAccountsPanel() {
  const [accounts, setAccounts] = useState<StaffAccount[]>([])
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ title: string; secret?: string } | null>(null)
  const [form, setForm] = useState({
    username: '',
    fullName: '',
    email: '',
    role: 'EMPLOYEE' as StaffRole,
    departmentId: '',
  })
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api.listStaffAccounts()
      setAccounts(result.accounts)
      setDepartments(result.departments)
      setError('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const act = async (task: () => Promise<{ title: string; secret?: string } | void>) => {
    setBusy(true)
    setError('')
    try {
      const result = await task()
      if (result) setNotice(result)
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    act(async () => {
      const result = await api.createStaffAccount({
        username: form.username,
        fullName: form.fullName,
        role: form.role,
        departmentId: form.departmentId || null,
        email: form.email.trim() ? form.email.trim().toLowerCase() : null,
      })
      setForm({ username: '', fullName: '', email: '', role: 'EMPLOYEE', departmentId: '' })
      return {
        title: `أُنشئ الحساب ${result.account.username}. سلّم كلمة المرور المؤقتة للموظف بشكل آمن — لن تُعرض مرة أخرى.`,
        secret: result.temporaryPassword || undefined,
      }
    })

  const visible = accounts.filter(item =>
    `${item.username} ${item.fullName} ${item.email || ''} ${item.departmentName || ''} ${staffRoleLabels[item.role]}`
      .toLowerCase()
      .includes(filter.toLowerCase())
  )

  return (
    <section className="admin-panel staff-accounts-panel" id="staff-accounts">
      <div className="panel-heading">
        <div>
          <h2>حسابات الموظفين والصلاحيات</h2>
          <p>
            حساب مستقل لكل موظف مرتبط بدائرته ودوره. كل إجراء يُسجل باسم صاحبه. البريد الإلكتروني المسجّل هنا هو الوحيد
            الذي يقبله الدخول بحساب Google أو برمز البريد.
          </p>
        </div>
        <button className="button ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} /> تحديث
        </button>
      </div>

      <form
        className="staff-create-form"
        onSubmit={event => {
          event.preventDefault()
          void create()
        }}
      >
        <label>
          اسم المستخدم
          <input
            value={form.username}
            onChange={e => setForm({ ...form, username: e.target.value.toLowerCase() })}
            placeholder="ali.hassan"
            dir="ltr"
            required
            minLength={3}
          />
        </label>
        <label>
          الاسم الكامل
          <input
            value={form.fullName}
            onChange={e => setForm({ ...form, fullName: e.target.value })}
            required
            minLength={3}
          />
        </label>
        <label>
          البريد الإلكتروني (اختياري)
          <input
            type="email"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="name@thi-qar.com"
            dir="ltr"
            aria-invalid={!emailLooksValid(form.email)}
          />
        </label>
        <label>
          الدور
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as StaffRole })}>
            {(Object.keys(staffRoleLabels) as StaffRole[]).map(role => (
              <option value={role} key={role}>
                {staffRoleLabels[role]}
              </option>
            ))}
          </select>
        </label>
        <label>
          الدائرة
          <select value={form.departmentId} onChange={e => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">— بدون دائرة —</option>
            {departments.map(item => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" type="submit" disabled={busy || !emailLooksValid(form.email)}>
          <Plus /> إنشاء حساب
        </button>
      </form>

      {notice && (
        <div className="form-success staff-notice" role="status">
          <CheckCircle2 />
          <div>
            <p>{notice.title}</p>
            {notice.secret && (
              <div className="secret-box">
                <code dir="ltr">{notice.secret}</code>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="نسخ"
                  onClick={() => void navigator.clipboard?.writeText(notice.secret || '')}
                >
                  <Copy />
                </button>
              </div>
            )}
          </div>
          <button type="button" className="button ghost" onClick={() => setNotice(null)}>
            إغلاق
          </button>
        </div>
      )}
      {error && (
        <div className="form-error">
          <AlertTriangle /> {error}
        </div>
      )}

      <div className="staff-table-tools">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="بحث بالاسم أو البريد أو الدائرة أو الدور"
        />
        <span>{visible.length.toLocaleString('en-US')} حساب</span>
      </div>
      <div className="table-scroll">
        <table className="staff-table">
          <thead>
            <tr>
              <th>المستخدم</th>
              <th>
                <Mail size={14} aria-hidden="true" /> بريد الدخول
              </th>
              <th>الدور</th>
              <th>الدائرة</th>
              <th>MFA</th>
              <th>الحالة</th>
              <th>آخر دخول</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(item => (
              <tr key={item.id} className={item.status === 'DISABLED' ? 'disabled-row' : ''}>
                <td>
                  <strong>{item.fullName}</strong>
                  <small dir="ltr">{item.username}</small>
                </td>
                <td>
                  <StaffEmailCell
                    key={item.email || ''}
                    account={item}
                    busy={busy}
                    onSave={email =>
                      void act(() =>
                        api.updateStaffAccount(item.id, { email }).then(() => ({
                          title: email
                            ? `رُبط البريد ${email} بحساب ${item.username}؛ يمكنه الآن الدخول بحساب Google أو برمز البريد.`
                            : `أُلغي ربط البريد عن حساب ${item.username}.`,
                        }))
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    value={item.role}
                    disabled={busy}
                    onChange={e =>
                      void act(() =>
                        api.updateStaffAccount(item.id, { role: e.target.value as StaffRole }).then(() => undefined)
                      )
                    }
                  >
                    {(Object.keys(staffRoleLabels) as StaffRole[]).map(role => (
                      <option value={role} key={role}>
                        {staffRoleLabels[role]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={item.departmentId || ''}
                    disabled={busy}
                    onChange={e =>
                      void act(() =>
                        api.updateStaffAccount(item.id, { departmentId: e.target.value || null }).then(() => undefined)
                      )
                    }
                  >
                    <option value="">—</option>
                    {departments.map(dep => (
                      <option value={dep.id} key={dep.id}>
                        {dep.name}
                      </option>
                    ))}
                  </select>
                  {/* manager = an EMPLOYEE of that department with the flag (no separate role value) */}
                  <label
                    className="staff-manager-toggle"
                    title={
                      item.role === 'EMPLOYEE' && item.departmentId
                        ? 'يسند الطلبات لموظفي الدائرة ويرى توزيع العمل والمتأخرات'
                        : 'متاح لموظف معاملات مرتبط بدائرة فقط'
                    }
                  >
                    <input
                      type="checkbox"
                      checked={item.isDepartmentManager}
                      disabled={busy || item.role !== 'EMPLOYEE' || !item.departmentId}
                      onChange={e => {
                        // read now: a controlled checkbox snaps back to the prop value after the handler
                        const next = e.target.checked
                        void act(() =>
                          api.updateStaffAccount(item.id, { isDepartmentManager: next }).then(() => ({
                            title: next
                              ? `أصبح ${item.fullName} مدير ${item.departmentName || 'الدائرة'}.`
                              : `أُلغيت صلاحية مدير الدائرة عن ${item.fullName}.`,
                          }))
                        )
                      }}
                    />
                    مدير الدائرة
                  </label>
                </td>
                <td>
                  <span className={item.totpEnabled ? 'status-pill on' : 'status-pill off'}>
                    <Smartphone size={12} /> {item.totpEnabled ? 'مفعّل' : 'غير مفعّل'}
                  </span>
                </td>
                <td>
                  <span className={item.status === 'ACTIVE' ? 'status-pill on' : 'status-pill off'}>
                    {item.status === 'ACTIVE' ? 'فعّال' : 'معطّل'}
                  </span>
                  {item.mustChangePassword && <small className="muted">بانتظار تغيير كلمة المرور</small>}
                  {item.lockedUntil && item.lockedUntil > new Date().toISOString() && (
                    <small className="muted">مقفل مؤقتاً</small>
                  )}
                </td>
                <td>
                  <small>
                    {item.lastLoginAt
                      ? new Date(item.lastLoginAt).toLocaleString('ar-IQ', { dateStyle: 'medium', timeStyle: 'short' })
                      : 'لم يسجل بعد'}
                  </small>
                </td>
                <td className="row-actions">
                  <button
                    className="icon-button"
                    title="إعادة تعيين كلمة المرور"
                    aria-label={`إعادة تعيين كلمة مرور ${item.username}`}
                    disabled={busy}
                    onClick={() =>
                      window.confirm(
                        `إعادة تعيين كلمة مرور ${item.fullName} (${item.username})؟ ستُنهى جلساته الحالية وسيحتاج كلمة المرور المؤقتة الجديدة للدخول.`
                      ) &&
                      void act(async () => {
                        const result = await api.resetStaffPassword(item.id)
                        return {
                          title: `كلمة مرور مؤقتة جديدة للحساب ${item.username}:`,
                          secret: result.temporaryPassword,
                        }
                      })
                    }
                  >
                    <KeyRound />
                  </button>
                  <button
                    className="icon-button"
                    title="إلغاء المصادقة الثنائية"
                    aria-label={`إلغاء المصادقة الثنائية لـ ${item.username}`}
                    disabled={busy || !item.totpEnabled}
                    onClick={() =>
                      window.confirm(
                        `إلغاء المصادقة الثنائية للحساب ${item.username}؟ سيدخل بكلمة المرور فقط حتى يعيد التفعيل.`
                      ) &&
                      void act(() =>
                        api
                          .resetStaffMfa(item.id)
                          .then(() => ({ title: `أُلغيت المصادقة الثنائية للحساب ${item.username}.` }))
                      )
                    }
                  >
                    <ShieldOff />
                  </button>
                  <button
                    className="icon-button"
                    title={item.status === 'ACTIVE' ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                    aria-label={`${item.status === 'ACTIVE' ? 'تعطيل' : 'تفعيل'} حساب ${item.username}`}
                    disabled={busy}
                    onClick={() =>
                      (item.status !== 'ACTIVE' ||
                        window.confirm(
                          `تعطيل حساب ${item.fullName} (${item.username})؟ ستُنهى جلساته ولن يتمكن من الدخول.`
                        )) &&
                      void act(() =>
                        api
                          .setStaffStatus(item.id, item.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')
                          .then(() => undefined)
                      )
                    }
                  >
                    {item.status === 'ACTIVE' ? <UserX /> : <UserCheck />}
                  </button>
                </td>
              </tr>
            ))}
            {!visible.length && !loading && (
              <tr>
                <td colSpan={8} className="muted">
                  لا توجد حسابات مطابقة.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
