import type { Metadata } from 'next'
import KellerbuchSicht from '@/app/(dashboard)/dashboard/kellerbuch/page'

export const metadata: Metadata = { title: 'Kellerbuch – Übersicht' }
export const dynamic = 'force-dynamic'

// KAN-428 (12.11.2026): Einstieg in den Bereich „Kellerbuch“ – derselbe Inhalt wie die Dashboard-Sicht „Kellerbuch“
// (/dashboard/kellerbuch). Die bisherige Übersicht (/kellerbuch) heißt in der Navigation „Gebinde & Chargen“.
export default function KellerbuchEinstieg() {
  return <KellerbuchSicht />
}
