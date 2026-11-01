'use client'

import { useFormStatus } from 'react-dom'
import Kreisel from '@/components/ui/Kreisel'


export default function BetriebCard({
  displayName, roleLabel, accentColor,
}: {
  displayName: string
  roleLabel: string
  accentColor?: string | null
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      style={accentColor ? { borderLeftColor: accentColor, borderLeftWidth: 4 } : undefined}
      className="w-full text-left bg-white border border-s112-border rounded-xl px-5 py-4 hover:border-s112-teal hover:shadow-xs transition-all group disabled:opacity-60 disabled:cursor-wait"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-s112-text group-hover:text-s112-blue-700 transition-colors">
            {displayName}
          </p>
          <p className="text-xs text-s112-muted mt-0.5">
            {roleLabel}
          </p>
        </div>
        {pending
          ? <Kreisel />
          : <span className="text-s112-blue-700 opacity-0 group-hover:opacity-100 transition-opacity text-lg">→</span>
        }
      </div>
    </button>
  )
}
