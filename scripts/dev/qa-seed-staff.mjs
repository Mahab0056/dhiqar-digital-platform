// Creates the QA staff accounts (reviewer + operations + municipality employee) with fixed passwords.
const base = process.env.QA_BASE || 'http://localhost:8787'
const post = async (path, body, cookie) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
  const set = res.headers.getSetCookie?.() || []
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data, cookie: set.map(c => c.split(';')[0]).join('; ') }
}
let admin = await post('/api/auth/staff/login', { username: 'superadmin', password: 'Admin-Strong-2026!' })
if (admin.status !== 200) {
  const legacy = process.env.SUPER_ADMIN_PASSWORD || 'super-admin-demo-pass-123'
  admin = await post('/api/auth/staff/login', { username: 'superadmin', password: legacy })
  await post(
    '/api/auth/staff/change-password',
    { currentPassword: legacy, newPassword: 'Admin-Strong-2026!' },
    admin.cookie
  )
  admin = await post('/api/auth/staff/login', { username: 'superadmin', password: 'Admin-Strong-2026!' })
}
console.log('superadmin', admin.status)
const wanted = [
  {
    username: 'emp.muni',
    fullName: 'موظف بلديات ذي قار',
    role: 'EMPLOYEE',
    departmentId: 'dhiqar-municipalities',
    password: 'Emp-Muni-2026!',
  },
  {
    username: 'reviewer.qa',
    fullName: 'مراجع الهوية',
    role: 'IDENTITY_REVIEWER',
    departmentId: null,
    password: 'Audit-Pass-2026!',
  },
  {
    username: 'ops.qa',
    fullName: 'موظف غرفة العمليات',
    role: 'OPERATIONS',
    departmentId: null,
    password: 'Audit-Pass-2026!',
  },
]
const existing = await fetch(base + '/api/super-admin/staff', { headers: { cookie: admin.cookie } }).then(r => r.json())
for (const account of wanted) {
  if (existing.accounts?.some(a => a.username === account.username)) {
    console.log(account.username, 'exists')
    continue
  }
  const created = await post('/api/super-admin/staff', account, admin.cookie)
  const temporary = created.data?.temporaryPassword
  if (!temporary) {
    console.log(account.username, 'FAILED', created.status, created.data?.message)
    continue
  }
  const first = await post('/api/auth/staff/login', { username: account.username, password: temporary })
  const changed = await post(
    '/api/auth/staff/change-password',
    { currentPassword: temporary, newPassword: account.password },
    first.cookie
  )
  console.log(account.username, 'created', changed.status === 200 ? 'ready' : `password change ${changed.status}`)
}
