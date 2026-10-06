'use client'

import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'
import { verarbeitungStornieren } from '../../../actions'

// KAN-41 Paket 3a: Verarbeitung stornieren – Gegenbuchung am Storno-Tag, die Menge geht zurück an die Charge
export default function VerarbeitungStorno({ id, chargeId }: { id: string; chargeId: string }) {
  const router = useRouter()
  return (
    <StornoButton schwebend
      action={grund => verarbeitungStornieren(id, chargeId, grund)}
      hinweis="Die Menge geht zurück an die Charge; im Kellerbuch steht eine Gegenbuchung am heutigen Tag."
      danach={() => router.refresh()} />
  )
}
