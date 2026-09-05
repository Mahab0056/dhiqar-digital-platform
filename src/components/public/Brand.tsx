import { Link } from 'wouter'

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="ذي قار الرقمية - الرئيسية">
      <span className="brand-seals">
        <img className="iraq-emblem" src="/brand/iraq-coat-of-arms.png" alt="شعار جمهورية العراق" />
        <img className="dhiqar-emblem" src="/brand/dhiqar-unified-logo.png" alt="شعار محافظة ذي قار" />
      </span>
      {!compact && (
        <span>
          <strong>ذي قار الرقمية</strong>
          <small>جمهورية العراق • محافظة ذي قار</small>
        </span>
      )}
    </Link>
  )
}
