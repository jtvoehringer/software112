// Typen/Konstanten der Dashboard-Sichten OHNE Server-Imports – werden auch in
// Client-Komponenten (Kanban, Fristen, Checkliste) verwendet.

export const STATUS_LABEL: Record<string, string> = {
  ernte: 'Lese / Übernahme', gaerung: 'Gärung', ausbau: 'Ausbau', abfuellung: 'Abfüllung', abgeschlossen: 'Abgeschlossen',
}

export type Charge = {
  id: string; name: string; jahrgang: number | null; rebsorte: string | null; weinart: string | null
  status: string; menge_liter: number; behaelter: string | null; behaelter_id: string | null
  qualitaetsstufe: string | null; notizen: string | null
  letzteAnalyse: { datum: string; alkohol_vol: number | null; restzucker_gl: number | null; freie_so2_mgl: number | null; gesamtsaeure_gl: number | null } | null
  letzteMassnahme: { datum: string; typ: string | null; menge: number | null; einheit: string | null } | null
  messungFaellig: boolean
  tageSeitMessung: number | null
}

export type FristStatus = 'ueberfaellig' | 'faellig' | 'offen' | 'erledigt' | 'laufend'
export type Frist = {
  key: string
  id?: string                 // nur betriebseigene (Tabelle fristen)
  bezeichnung: string
  hinweis: string
  kategorie: string
  faelligAm: string | null
  status: FristStatus
  statusText: string
  href?: string
  quelle: 'betrieb' | 'system'
}
