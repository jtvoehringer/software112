// behoerdenmeldung: keller-behandlungen
'use client'

import { useParams } from 'next/navigation'
import Kellerbehandlungen from '../../../_behandlungen/Kellerbehandlungen'

// KAN-475 (BKI-Sitzung 16.11.2026): Kellerbehandlungen werden an der Charge erfasst und angezeigt – sie bleiben bei
// der Charge, auch wenn sie das Gebinde wechselt. Seit KAN-479 ist das auch die Seite der Behördenmeldung
// „keller-behandlungen“ (Druck über DruckKnopf, CSV über CsvExportKnopf in der Komponente).
export default function KellerbehandlungenDerChargePage() {
  const params = useParams()
  return <Kellerbehandlungen modus="charge" id={params.id as string} />
}
