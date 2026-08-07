import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import NeuerJahrgangForm from './NeuerJahrgangForm'

export const metadata: Metadata = { title: 'Neuer Jahrgang – software:112' }

export default async function NeuerJahrgangPage() {
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/erntemeldung')

  const aktuellesJahr = new Date().getFullYear()

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/erntemeldung" className="hover:text-s112-teal transition-colors">Lese</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Neuer Jahrgang</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Neuer Jahrgang</h1>
        <p className="text-sm text-s112-muted mt-0.5">Jahrgang anlegen und Erntezeitraum festlegen</p>
      </div>
      <div className="card">
        <NeuerJahrgangForm aktuellesJahr={aktuellesJahr} />
      </div>
    </div>
  )
}
