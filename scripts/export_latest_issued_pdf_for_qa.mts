import { writeFile } from 'node:fs/promises'
import { db } from '../server/db.js'

const base = process.env.QA_BASE || 'http://127.0.0.1:8799'
const row = db.prepare('SELECT verification_id FROM issued_documents ORDER BY issued_at DESC LIMIT 1').get() as
  { verification_id?: string } | undefined
if (!row?.verification_id) throw new Error('No issued test document exists.')
const verificationResponse = await fetch(`${base}/api/verify/${row.verification_id}`)
const verification = (await verificationResponse.json()) as { originalPdfUrl?: string }
if (verificationResponse.status !== 200 || !verification.originalPdfUrl)
  throw new Error(`Verification lookup failed: ${verificationResponse.status}`)
const response = await fetch(`${base}${verification.originalPdfUrl}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (response.status !== 200 || !bytes.subarray(0, 4).equals(Buffer.from('%PDF')))
  throw new Error(`PDF export failed: ${response.status}`)
const output = '/tmp/dhiqar-unified-logo-issued-document-qa.pdf'
await writeFile(output, bytes)
console.log(output)
