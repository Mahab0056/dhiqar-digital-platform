import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  KeyRound,
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

export function StaffAccountsPanel() {
  const [accounts, setAccounts] = useState<StaffAccount[]>([])
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ title: string; secret?: string } | null>(null)
  const [form, setForm] = useState({ username: '', fullName: '', role: 'EMPLOYEE' as StaffRole, departmentId: '' })
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
      })
      setForm({ username: '', fullName: '', role: 'EMPLOYEE', departmentId: '' })
      return {
        title: `أُنشئ الحساب ${result.account.username}. سلّم كلمة المرور المؤقتة للموظف بشكل آمن — لن تُعرض مرة أخرى.`,
        secret: result.temporaryPassword || undefined,
      }
    })

  const visible = accounts.filter(item =>
    `${item.username} ${item.fullName} ${item.departmentName || ''} ${staffRoleLabels[item.role]}`
      .toLowerCase()
      .includes(filter.toLowerCase())
  )

  return (
    <section className="admin-panel staff-accounts-panel" id="staff-accounts">
      <div className="panel-heading">
        <div>
          <h2>حسابات الموظفين والصلاحيات</h2>
          <p>حساب مستقل لكل موظف مرتبط بدائرته ودوره. كل إجراء يُسجل باسم صاحبه.</p>
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
        <button className="button primary" type="submit" disabled={busy}>
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
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="بحث بالاسم أو الدائرة أو الدور" />
        <span>{visible.length.toLocaleString('en-US')} حساب</span>
      </div>
      <div className="table-scroll">
        <table className="staff-table">
          <thead>
            <tr>
              <th>المستخدم</th>
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
                    disabled={busy}
                    onClick={() =>
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
                    disabled={busy || !item.totpEnabled}
                    onClick={() =>
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
                    disabled={busy}
                    onClick={() =>
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
                <td colSpan={7} className="muted">
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
