import type { Metadata } from 'next'
import NachrichtenClient from './NachrichtenClient'

export const metadata: Metadata = { title: 'Nachrichten – software:112' }
export const dynamic = 'force-dynamic'

export default function NachrichtenPage() {
  return <NachrichtenClient />
}
