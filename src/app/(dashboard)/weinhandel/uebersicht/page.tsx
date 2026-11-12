import type { Metadata } from 'next'
import VerkaufCrmSicht from '@/app/(dashboard)/dashboard/_shared/VerkaufCrmSicht'

export const metadata: Metadata = { title: 'Warenwirtschaft – Übersicht' }
export const dynamic = 'force-dynamic'

// KAN-428 (12.11.2026): Einstieg in den Bereich „Warenwirtschaft“ – der Verkaufs-Teil der Sicht „Verkauf & CRM“.
export default function WarenwirtschaftEinstieg() {
  return <VerkaufCrmSicht teil="verkauf" />
}
