import type { Metadata } from 'next'
import WeingartenSicht from '@/app/(dashboard)/dashboard/weingarten/page'

export const metadata: Metadata = { title: 'Weingarten & Ernte' }
export const dynamic = 'force-dynamic'

// KAN-427 (12.11.2026): Einstieg in den Bereich „Rieden“ – derselbe Inhalt wie die Dashboard-Sicht „Weingarten & Ernte“
// (/dashboard/weingarten), unter eigener Adresse, damit der Bereich „Rieden“ markiert bleibt.
export default function RiedenEinstieg() {
  return <WeingartenSicht />
}
