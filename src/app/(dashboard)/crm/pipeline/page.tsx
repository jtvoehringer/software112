import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Pipeline – software:112' }
export const dynamic = 'force-dynamic'

// TODO: Implementierung in Session Phase 2 CRM
export default function PipelinePage() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <p className="text-4xl mb-3">📊</p>
        <p className="text-gray-500 text-sm">Verkaufs-Pipeline – wird vorbereitet</p>
      </div>
    </div>
  )
}
