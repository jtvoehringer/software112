import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import BehaelterForm from '@/components/kellerbuch/BehaelterForm'
import { createBehaelter } from '../../actions'

export const metadata: Metadata = { title: 'Neuer Behälter – software:112' }
export const dynamic = 'force-dynamic'

export default function NeuePage() {
  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neuer Behälter</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-6">Neuer Behälter</h1>
      <BehaelterForm action={createBehaelter} />
    </div>
  )
}
