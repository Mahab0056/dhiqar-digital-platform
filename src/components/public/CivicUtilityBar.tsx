import { Link } from 'wouter'
import { Landmark } from 'lucide-react'

export function CivicUtilityBar() {
  return (
    <div className="civic-utility">
      <div className="container">
        <span>
          <Landmark size={13} /> جمهورية العراق <i /> محافظة ذي قار
        </span>
        <nav>
          <a href="#accessibility">إمكانية الوصول</a>
          <a href="#privacy">الخصوصية</a>
          <Link href="/verify">التحقق من الوثائق</Link>
        </nav>
      </div>
    </div>
  )
}
