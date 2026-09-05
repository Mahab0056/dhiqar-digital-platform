import { Link } from 'wouter'
import { Download, Eye, QrCode } from 'lucide-react'
import type { IssuedDocument } from '../../types'

export function CitizenPdfActions({ document, compact = false }: { document: IssuedDocument; compact?: boolean }) {
  return (
    <div className={compact ? 'issued-pdf-actions compact' : 'issued-pdf-actions'}>
      <a className="button primary" href={document.pdfUrl} target="_blank" rel="noreferrer">
        <Eye /> معاينة PDF
      </a>
      <a className="button outline" href={document.pdfDownloadUrl} download>
        <Download /> تنزيل PDF
      </a>
      <Link className="button outline" href={`/verify/${document.verificationId}`}>
        <QrCode /> تحقق
      </Link>
    </div>
  )
}
