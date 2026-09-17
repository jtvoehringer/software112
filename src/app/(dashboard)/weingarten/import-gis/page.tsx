import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { redirect } from 'next/navigation'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import ImportGisClient from './ImportGisClient'

export const metadata: Metadata = { title: 'eAMA-GIS importieren – software:112' }
export const dynamic = 'force-dynamic'

// ── eAMA-GIS-Import (Stufe 2 Rieden-Koordinaten, 27.8.2026) ─────────────────
export default async function ImportGisPage() {
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/weingarten')
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weingarten" className="hover:text-s112-blue-700 transition-colors">Rieden</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">eAMA-GIS importieren</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text">Umrisse aus dem eAMA importieren</h1>
      <p className="text-sm text-s112-muted mt-0.5 mb-6">Feldstück-Polygone aus dem INVEKOS-GIS werden über die AMA-Feldstücknummer den Rieden zugeordnet – Umriss und Mittelpunkt je Ried, optional Schlag-Umrisse je Grundstück.</p>
      <ImportGisClient />
    </div>
  )
}
