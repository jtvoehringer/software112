'use client'

// KAN-150 F2 (01.10.2026): Analyse stornieren (mit Grund) bzw. eine stornierte endgültig löschen
import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'
import { stornoAnalyse, endgueltigLoeschenAnalyse } from '../../../actions'

export default function AnalyseStorno({ id, chargeId, storniert }: { id: string; chargeId: string; storniert: boolean }) {
  const router = useRouter()
  return storniert ? (
    <StornoButton modus="loeschen" label="Endgültig löschen" schwebend danach={() => router.refresh()}
      action={grund => endgueltigLoeschenAnalyse(id, chargeId, grund)}
      hinweis="Nur bei Fehleinträgen: Die stornierte Analyse wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll." />
  ) : (
    <StornoButton schwebend danach={() => router.refresh()}
      action={grund => stornoAnalyse(id, chargeId, grund)}
      hinweis="Die Analyse bleibt als storniert im Weinbuch stehen, gilt aber nicht mehr (DAC-Antrag, Dashboard, Rückverfolgung)." />
  )
}
