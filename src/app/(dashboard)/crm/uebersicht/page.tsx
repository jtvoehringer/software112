import type { Metadata } from 'next'
import VerkaufCrmSicht from '@/app/(dashboard)/dashboard/_shared/VerkaufCrmSicht'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'

export const metadata: Metadata = { title: 'CRM – Übersicht' }
export const dynamic = 'force-dynamic'

// KAN-428 (12.11.2026): Einstieg in den Bereich „CRM“ – der CRM-Teil der Sicht „Verkauf & CRM“; der Schnellzugriff
// „Datenimport“ (Kontakte und Firmen, KAN-426) nur mit Schreibrecht CRM – dieselbe Regel wie die Seite /crm/import.
export default async function CrmEinstieg() {
  const membership = await getCurrentMembership()
  return <VerkaufCrmSicht teil="crm" crmImport={!!membership && canWrite(membership, 'crm')} />
}
