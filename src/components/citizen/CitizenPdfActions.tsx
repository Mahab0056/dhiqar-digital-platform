import { Link } from 'wouter'
import { Download, Eye, QrCode } from 'lucide-react'

type PdfActionsDocument = { status: string; pdfUrl: string; pdfDownloadUrl?: string; verificationId: string }

/**
 * Preview / download / verify for one issued document. A revoked document offers «تحقق» only: its archived PDF
 * carries no revocation mark, so the server no longer serves it to the citizen, and the verify page shows «ملغاة».
 */
export function CitizenPdfActions({ document, compact = false }: { document: PdfActionsDocument; compact?: boolean }) {
  return (
    <div className={compact ? 'issued-pdf-actions compact' : 'issued-pdf-actions'}>
      {document.status !== 'REVOKED' && (
        <>
          <a className="button primary" href={document.pdfUrl} target="_blank" rel="noreferrer">
            <Eye /> معاينة PDF
          </a>
          <a className="button outline" href={document.pdfDownloadUrl || `${document.pdfUrl}?download=1`} download>
            <Download /> تنزيل PDF
          </a>
        </>
      )}
      <Link className="button outline" href={`/verify/${document.verificationId}`}>
        <QrCode /> تحقق
      </Link>
    </div>
  )
}
