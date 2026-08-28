import { readFileSync } from 'node:fs'

const source = readFileSync('src/App.tsx', 'utf8')
const targets = [
  ['لوحة العمل', '/employee#workboard', 'id="workboard"'],
  ['المعاملات', '/employee#employee-applications', 'id="employee-applications"'],
  ['الكشوفات', '/employee#employee-service-requests', 'id="employee-service-requests"'],
  ['الأرشيف', '/employee#employee-archive', 'id="employee-archive"'],
  ['سجل الإجراءات', '/employee#employee-activity', 'id="employee-activity"'],
]
for (const [label, href, anchor] of targets) {
  if (!source.includes(`label: '${label}', href: '${href}'`)) throw new Error(`missing navigation target for ${label}`)
  if (!source.includes(anchor)) throw new Error(`missing content anchor for ${label}`)
}
if (source.includes("label: 'المعاملات', href: '/employee'")) throw new Error('legacy repeated employee link remains')
console.log('employee_navigation_qa=pass')
