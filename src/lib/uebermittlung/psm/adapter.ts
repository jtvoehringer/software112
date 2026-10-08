// ── PSM-Übermittlung: Adapter-Schicht (KAN-120, 08.10.2026) ───────────────────────────────────────────────
//
// Ein Adapter bringt die Aufzeichnungen (Zeilen der Meldung „psm-uebermittlung“, KAN-87) in die Form eines
// Übermittlungskanals. Heute gibt es nur „csv-datei“: Die Datei legt der Betrieb der Prüfstelle vor (Entscheidung
// Jörgen 06.10.2026 – manuell, Identifikation über die Betriebsnummer, Korrektur = Bericht nochmals vorlegen).
// Eine künftige elektronische Schnittstelle bekommt einen eigenen Adapter mit `sende()` und einen eigenen Kanal
// (CHECK in psm_uebermittlungen.kanal und in s112_psm_uebermittlung_protokollieren erweitern).

import type { PsmUebermittlungZeile } from '@/lib/behoerden/psm_uebermittlung'

export type PsmKanal = 'csv-datei'

export type PsmDatei = {
  text: string
  /** Teile für csvDateiname() (Datum hängt csvDateiname an) */
  dateiteile: (string | null)[]
  zeilen: number
}

export interface PsmUebermittlungsAdapter {
  kanal: PsmKanal
  /** Hinweise zu fehlenden Pflichtangaben – blockieren den Export nicht */
  validiere(zeilen: readonly PsmUebermittlungZeile[], betriebsnummer: string | null): string[]
  serialisiere(zeilen: readonly PsmUebermittlungZeile[], betriebsnummer: string | null): PsmDatei
  /** Elektronische Übermittlung – der CSV-Adapter sendet nicht (manuelle Vorlage) */
  sende?(datei: PsmDatei): Promise<{ referenzExtern: string | null }>
}
