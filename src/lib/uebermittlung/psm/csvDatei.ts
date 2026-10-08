// ── PSM-Übermittlung: Adapter „csv-datei“ (KAN-120) ──────────────────────────────────────────────────────
// Dieselben Spalten wie die CSV „psm-uebermittlung“ (KAN-87) – kein zweites Format.

import { csvText } from '@/lib/csv'
import { SPALTEN_PSM_UEBERMITTLUNG } from '@/lib/behoerden/psm_uebermittlung'
import type { PsmUebermittlungsAdapter } from './adapter'
import { pflichtHinweise } from './stand'

export const CSV_DATEI_ADAPTER: PsmUebermittlungsAdapter = {
  kanal: 'csv-datei',
  validiere: (zeilen, betriebsnummer) => pflichtHinweise(zeilen, betriebsnummer),
  serialisiere: (zeilen, betriebsnummer) => ({
    text: csvText(zeilen, SPALTEN_PSM_UEBERMITTLUNG),
    dateiteile: ['PSM-Übermittlung', betriebsnummer],
    zeilen: zeilen.length,
  }),
}
