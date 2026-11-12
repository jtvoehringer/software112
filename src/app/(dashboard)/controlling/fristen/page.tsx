import type { Metadata } from 'next'
import FristenSicht from '@/app/(dashboard)/dashboard/fristen/page'

export const metadata: Metadata = { title: 'Meldungen & Fristen' }
export const dynamic = 'force-dynamic'

// KAN-428 (12.11.2026): Einstieg in den Bereich „Controlling“ – derselbe Inhalt wie die Dashboard-Sicht „Meldungen &
// Fristen“ (/dashboard/fristen), die unter Übersicht für alle erreichbar bleibt.
export default function ControllingEinstieg() {
  return <FristenSicht />
}
