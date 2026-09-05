import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../../api'

export function ServiceRequirements({ serviceKey, fallback }: { serviceKey: string; fallback: string[] }) {
  const [requirements, setRequirements] = useState(fallback)
  useEffect(() => {
    let active = true
    api
      .getPlatformServiceSettings(serviceKey)
      .then(item => {
        if (active && item.requiredDocuments.length) setRequirements(item.requiredDocuments)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [serviceKey])
  return (
    <ul>
      {requirements.map(item => (
        <li key={item}>
          <CheckCircle2 /> {item}
        </li>
      ))}
    </ul>
  )
}
