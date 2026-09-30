'use client'

import { useRouter } from 'next/navigation'
import { deleteZukauf } from './actions'
import StornoButton from '@/components/StornoButton'

// Stornieren eines Zukaufs (KAN-145 B3, 30.09.2026): mit Pflicht-Grund; der Zukauf bleibt als Beleg stehen
// (aktiv = false + Storno-Kennzeichen). Seit KAN-35 lehnt deleteZukauf ab, sobald an der Zielcharge
// Folgebuchungen hängen oder Trauben aus dem Zukauf verpresst bzw. verkauft wurden – die Meldung sagt, was hängt
// und was stattdessen zu tun ist, und erscheint direkt unter dem Knopf.
export default function ZukaufLoeschen({ id, info, hatCharge }: { id: string; info: string; hatCharge: boolean }) {
  const router = useRouter()
  return (
    <StornoButton
      action={grund => deleteZukauf(id, grund)}
      danach={() => router.refresh()}
      hinweis={hatCharge
        ? `Zukauf „${info}“ stornieren: Die zugehörige Charge im Kellerbuch wird auf 0 L gesetzt und abgeschlossen; der Zukauf bleibt als storniert stehen.`
        : `Zukauf „${info}“ stornieren: Er bleibt als storniert stehen und zählt in keinem Bestand.`} />
  )
}
