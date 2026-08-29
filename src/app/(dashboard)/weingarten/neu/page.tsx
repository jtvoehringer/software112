import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import WeingartenForm from '@/components/weingarten/WeingartenForm'
import { createWeingarten } from '../actions'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'

export const metadata: Metadata = { title: 'Neue Ried – software:112' }

export default async function NeuePage() {
  // Rückmeldung 24.8.2026: "Neue Ried"-Link wird in der Übersicht bereits
  // nur bei writeOk angezeigt (page.tsx) - diese Seite war aber direkt per
  // URL trotzdem für jeden Tenant-Nutzer erreichbar. createWeingarten blockt
  // serverseitig zwar bereits ab (requireWrite() in actions.ts), ein
  // Nur-Lesen-Nutzer sähe aber erst nach dem Ausfüllen und Absenden eine
  // Fehlermeldung - hier stattdessen gleich zurück zur Übersicht leiten.
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/weingarten')

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weingarten" className="hover:text-s112-teal transition-colors">Rieden</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Neu anlegen</span>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Neue Ried</h1>

      <WeingartenForm action={createWeingarten} />
    </div>
  )
}
