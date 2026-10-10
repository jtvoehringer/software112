import type { Metadata } from 'next'
import NachrichtenClient from './NachrichtenClient'

export const metadata: Metadata = { title: 'Nachrichten' }
export const dynamic = 'force-dynamic'

export default function NachrichtenPage() {
  // Sweep 114: Hauptüberschrift für Screenreader – die Postfach-Ansicht hat keinen sichtbaren Seitentitel
  return (
    <>
      <h1 className="sr-only">Nachrichten</h1>
      <NachrichtenClient />
    </>
  )
}
