// behoerdenmeldung: keller-behandlungen
'use client'

import { useParams } from 'next/navigation'
import Kellerbehandlungen from '../../../_behandlungen/Kellerbehandlungen'

// KAN-475: Kellerbehandlungen gehören zur Charge (/kellerbuch/weinausbau/[id]/behandlungen). An dieser Adresse bleibt
// die Gebindepflege ohne Charge (Reinigen, Konservieren, Umbenennung, Notiz); liegt genau eine Charge im Gebinde,
// leitet die Komponente auf deren Kellerbehandlungen weiter (QR-Scan › „Behandlung“, alte Lesezeichen).
// Druck (DruckKnopf) und CSV (CsvExportKnopf, Meldung „keller-behandlungen“) stehen in der Komponente.
export default function GebindepflegePage() {
  const params = useParams()
  return <Kellerbehandlungen modus="gebinde" id={params.id as string} />
}
