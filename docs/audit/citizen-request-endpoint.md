# Citizen request detail endpoint

`GET /api/citizen/service-requests/:reference` — session `CITIZEN`, scoped to the logged-in citizen
(another citizen's reference returns **404** exactly like a missing one). Implemented in
`server/routes/service-requests.ts` (`serializeServiceRequestDetailForCitizen`).

Every service-request notification now links to `/citizen/request/${reference}` (reference = `TQS-YYYY-NNNNN`).

## Response shape

Everything the list endpoint (`GET /api/citizen/service-requests`) returns per item, plus the detail fields:

```ts
{
  // ---- same as the list item ----
  id: number
  reference: string                 // TQS-2026-00042
  serviceKey: string
  serviceName: string
  departmentId: string
  departmentName: string
  department: string                // = departmentName
  status: 'SUBMITTED' | 'UNDER_REVIEW' | 'ACTION_REQUIRED' | 'APPROVED' | 'REJECTED' | 'APPOINTMENT_REQUESTED' | 'PAYMENT_PENDING'
  formData: Record<string, string>
  currentAction: string             // what happens next, in Arabic (shown prominently)
  decisionNote: string | null
  requiredDocument: string | null
  decidedAt: string | null
  checklist: ChecklistItem[]        // raw checklist (see `documents` for a friendlier view)
  attachments: Array<{ id, mediaId, label, documentKey, originalName, mimeType, sizeBytes, available }>
  payments: PaymentIntent[]         // all intents; office receipts have provider 'office', mode 'OFFICE'
  paymentStatus: 'NOT_REQUIRED' | 'PENDING' | 'PAID' | 'PAY_AT_OFFICE'
  officeReceipt: OfficeReceipt | null
  createdAt: string
  updatedAt: string
  appointment: {
    id: string
    reference: string               // APT-2026-00042
    department: string
    preferredDate: string           // YYYY-MM-DD — the confirmed date when confirmed === true
    preferredTime: string           // HH:MM
    status: 'REQUESTED' | 'CONFIRMED' | 'CANCELLED'
    confirmed: boolean
    note: string | null             // attendance instructions from the department
    updatedAt: string
  } | null

  // ---- detail only ----
  serviceChannel: 'ONLINE_SUBMISSION' | 'APPOINTMENT_REQUIRED' | 'INFORMATION_ONLY'
  issuesDocument: boolean           // false for complaints / reports / appointments: approval issues no PDF
  documents: Array<{
    key: string
    label: string
    required: boolean
    status: 'MISSING' | 'UPLOADED' | 'VERIFIED' | 'REJECTED'
    rejectionReason: string | null  // set when status === 'REJECTED' — re-upload via
                                    // POST /api/citizen/service-requests/:reference/upload-document (documentKey)
    uploaded: boolean
    updatedAt: string | null
  }>
  fee: {
    amountIqd: number | null        // official catalog fee (null = none)
    paymentStatus: same as above
    owed: Array<{ reference: string; amountIqd: number; status: string }>  // pay at /citizen/pay/:reference
    payAtOffice: boolean            // official fee, no online gateway → pay at the department counter
    officeReceipt: OfficeReceipt | null
  }
  transfers: Array<{ fromDepartmentName: string; toDepartmentName: string; createdAt: string }>
  issuedDocuments: Array<{
    id: string
    title: string
    documentNumber: string
    verificationId: string
    status: string                  // ACTIVE | REVOKED
    issuedAt: string
    revokedAt: string | null
    revokedReason: string | null
    pdfUrl: string                  // /api/citizen/issued-documents/:id/pdf
  }>
  timeline: Array<{
    type: string                    // audit action, e.g. SERVICE_REQUEST_CREATED, SERVICE_DOCUMENT_REJECTED,
                                    // SERVICE_REQUEST_APPOINTMENT_CONFIRMED, SERVICE_REQUEST_OFFICE_PAYMENT_RECORDED …
    title: string                   // Arabic title ready to display
    description: string | null      // Arabic detail (document + reason, slot, receipt, amount…)
    actor: 'CITIZEN' | 'DEPARTMENT' | 'SYSTEM'   // staff names are never exposed
    createdAt: string
  }>                                // oldest first
}

type OfficeReceipt = {
  paymentReference: string
  receiptNumber: string | null
  amountIqd: number
  note: string | null
  recordedAt: string | null
}
```

The submit response (`POST /api/service-requests`, 201) now also carries `appointment` (same shape as above,
`null` when none), `payAtOffice: boolean` and `feeIqd: number | null`.
