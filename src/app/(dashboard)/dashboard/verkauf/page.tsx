import type { Metadata } from 'next'
import VerkaufCrmSicht from '../_shared/VerkaufCrmSicht'

export const metadata: Metadata = { title: 'Verkauf & CRM' }
export const dynamic = 'force-dynamic'

// Sicht „Verkauf & CRM“ im Bereich Übersicht – unverändert eine gemeinsame Seite (KAN-428, Entscheidung 12.11.2026).
// Der Inhalt liegt in ../_shared/VerkaufCrmSicht.tsx; Warenwirtschaft und CRM zeigen dort jeweils ihren Teil.
export default function VerkaufCrmSeite() {
  return <VerkaufCrmSicht teil="beide" />
}
