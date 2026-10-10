import { redirect } from 'next/navigation'

export const metadata = { title: 'Neue Charge' }
export const dynamic = 'force-dynamic'

// Chargen werden ausschließlich über Pressungen oder Verschneidungen angelegt – Pressungen seit dem Pilottest
// (30.09.2026) im Kellerbuch
export default function NeuePage() {
  redirect('/kellerbuch/pressungen')
}
